package me.capcom.smsgateway.modules.iphone

import android.content.Context
import android.database.DatabaseUtils
import me.capcom.smsgateway.modules.directory.DirectoryService
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import com.google.gson.Gson
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

/** One database owns each peer credential, its histories, notifications, SIMs and jobs. */
class PeerHub internal constructor(val ctx: Context, databaseName:String="paired-phone.db",
    private val registry:DeviceRegistry=DeviceRegistry(ctx),
    private val directory:()->DirectoryService={DirectoryService.get(ctx)}
): SQLiteOpenHelper(ctx,databaseName,null,3) {
    private val gson=Gson()
    val paired get()=devices().any { it["id"]!="server" }

    override fun onCreate(db:SQLiteDatabase) {
        db.execSQL("CREATE TABLE history(id INTEGER PRIMARY KEY, row TEXT NOT NULL)")
        db.execSQL("CREATE TABLE sends(id TEXT PRIMARY KEY, row TEXT NOT NULL, sub INTEGER NOT NULL, phase TEXT NOT NULL, checked INTEGER NOT NULL DEFAULT 0)")
        db.execSQL("CREATE TABLE push_events(id TEXT PRIMARY KEY,address TEXT NOT NULL)")
        upgradeRegistry(db)
    }
    override fun onUpgrade(db:SQLiteDatabase,old:Int,new:Int) {
        if(old<2) {
            db.execSQL("ALTER TABLE sends ADD COLUMN checked INTEGER NOT NULL DEFAULT 0")
            db.execSQL("CREATE TABLE push_events(id TEXT PRIMARY KEY,address TEXT NOT NULL)")
            db.rawQuery("SELECT id,row FROM sends WHERE phase='done'",null).use { c->while(c.moveToNext()) {
                if(gson.fromJson(c.getString(1),SmsRow::class.java).state=="sent")db.execSQL("UPDATE sends SET phase='sent' WHERE id=?",arrayOf(c.getString(0)))
            } }
        }
        if(old<3) upgradeRegistry(db)
    }

    // SQLiteOpenHelper runs schema migration and user_version change in one transaction.
    private fun upgradeRegistry(db:SQLiteDatabase) {
        registry.create(db)
        db.execSQL("ALTER TABLE history RENAME TO history_v2")
        db.execSQL("CREATE TABLE history(seq INTEGER PRIMARY KEY AUTOINCREMENT,device TEXT NOT NULL,source_id INTEGER NOT NULL,row TEXT NOT NULL,UNIQUE(device,source_id))")
        db.execSQL("INSERT INTO history(seq,device,source_id,row) SELECT id,'peer',id,row FROM history_v2")
        db.execSQL("DROP TABLE history_v2")
        db.execSQL("ALTER TABLE sends ADD COLUMN device TEXT NOT NULL DEFAULT 'peer'")
        db.execSQL("ALTER TABLE sends ADD COLUMN slot INTEGER")
        db.execSQL("ALTER TABLE history ADD COLUMN address TEXT")
        db.execSQL("ALTER TABLE sends ADD COLUMN address TEXT")
        for(table in listOf("history","sends")) {
            db.rawQuery("SELECT rowid,row FROM "+table,null).use { c-> while(c.moveToNext()){
                val row=gson.fromJson(c.getString(1),SmsRow::class.java)
                db.execSQL("UPDATE "+table+" SET address=? WHERE rowid=?",arrayOf(row.address,c.getLong(0)))
            } }
        }
        db.execSQL("CREATE INDEX history_owner_address ON history(device,address)")
        db.execSQL("CREATE INDEX sends_owner_address ON sends(device,address)")
        db.execSQL("CREATE INDEX job_owner ON sends(device,phase,checked)")
        db.execSQL("ALTER TABLE push_events RENAME TO push_events_v2")
        db.execSQL("CREATE TABLE push_events(device TEXT NOT NULL,id TEXT NOT NULL,address TEXT NOT NULL,PRIMARY KEY(device,id))")
        db.execSQL("INSERT INTO push_events(device,id,address) SELECT 'peer',id,address FROM push_events_v2")
        db.execSQL("DROP TABLE push_events_v2")
    }

    private fun scalar(sql:String,vararg args:String):String? =
        readableDatabase.rawQuery(sql,args).use { if(it.moveToFirst()) it.getString(0) else null }

    @Synchronized fun invite():String {
        val code=PrivateStore.token().take(20)
        writableDatabase.execSQL("DELETE FROM invitations")
        writableDatabase.execSQL("INSERT INTO invitations(code_hash,expires) VALUES(?,?)",arrayOf(PrivateStore.hash(code),System.currentTimeMillis()+180000))
        return code
    }

    @Synchronized fun deviceForToken(token:String):String? {
        if(!token.matches(Regex("[a-f0-9]{64}")))return null
        return scalar("SELECT device FROM devices WHERE auth=? AND revoked=0",PrivateStore.hash(token))
    }
    fun authorized(token:String)=deviceForToken(token)!=null

    @Synchronized fun pair(code:String,token:String):Boolean = requestLink(code,token,"")=="ok"
    @Synchronized fun requestLink(code:String,token:String,model:String,previousToken:String?=null):String {
        if(!token.matches(Regex("[a-f0-9]{64}")))return "forbidden"
        if(authorized(token)) return "ok"
        if(!code.matches(Regex("[a-f0-9]{20}")))return "forbidden"
        val digest=PrivateStore.hash(token)
        if (scalar("SELECT digest FROM retired_tokens WHERE digest=?",digest)!=null) return "forbidden"
        val restoreDevice=previousToken?.takeIf { it.matches(Regex("[a-f0-9]{64}")) }?.let {
            scalar("SELECT device FROM devices WHERE auth=? AND revoked=1",PrivateStore.hash(it))
        }
        val codeHash=PrivateStore.hash(code)
        val db=writableDatabase
        db.beginTransaction()
        try {
            val valid=db.rawQuery("SELECT pending_auth FROM invitations WHERE code_hash=? AND expires>?",arrayOf(codeHash,System.currentTimeMillis().toString())).use{ c->
                c.moveToFirst() && (c.isNull(0) || c.getString(0)==digest)
            }
            if(!valid) return "forbidden"
            db.execSQL("UPDATE invitations SET pending_auth=?,model=?,restore_device=? WHERE code_hash=?",arrayOf(digest,model.take(80),restoreDevice,codeHash))
            db.setTransactionSuccessful()
        } finally { db.endTransaction() }
        return "pending"
    }

    @Synchronized fun pending():Pair<String,String>?=readableDatabase.rawQuery(
        "SELECT pending_auth,model FROM invitations WHERE pending_auth IS NOT NULL AND expires>?",arrayOf(System.currentTimeMillis().toString())
    ).use { if(it.moveToFirst()) it.getString(0) to it.getString(1) else null }

    @Synchronized fun approve(digest:String) {
        val request=pending() ?: return
        require(request.first==digest)
        val db=writableDatabase
        db.beginTransaction()
        try { enroll(db,digest,request.second);db.setTransactionSuccessful() }
        finally {db.endTransaction()}
    }
    private fun enroll(db:SQLiteDatabase,digest:String,model:String) {
        val known=scalar("SELECT restore_device FROM invitations WHERE pending_auth=?",digest)
        if(known!=null) {
            db.execSQL("UPDATE devices SET revoked=0,auth=?,push_after=? WHERE device=? AND revoked=1",arrayOf(digest,System.currentTimeMillis(),known))
        } else {
            val id=UUID.randomUUID().toString()
            db.execSQL("INSERT INTO devices(device,auth,label,model,push_after) VALUES(?,?,?,?,?)",arrayOf(id,digest,model.ifBlank{"共享手机"},model,System.currentTimeMillis()))
        }
        db.execSQL("DELETE FROM invitations WHERE pending_auth=?",arrayOf(digest))
    }

    @Synchronized fun revoke(id:String) {
        require(id!="server")
        val db=writableDatabase
        db.beginTransaction()
        try{
            db.execSQL("INSERT OR IGNORE INTO retired_tokens SELECT auth FROM devices WHERE device=? AND auth IS NOT NULL",arrayOf(id))
            db.execSQL("UPDATE devices SET revoked=1 WHERE device=?",arrayOf(id))
            db.execSQL("DELETE FROM push_events WHERE device=?",arrayOf(id))
            db.execSQL("DELETE FROM invitations")
            db.setTransactionSuccessful()
        } finally {db.endTransaction()}
        registry.offline(id)
        directory().revoke(id)
    }

    @Synchronized fun devices()=registry.devices(readableDatabase)
    @Synchronized fun allLines():List<Map<String,Any>> {
        registry.refreshLocal(writableDatabase)
        return registry.lines(readableDatabase)
    }
    fun lines()=allLines().filter{it["deviceId"]!="server"}
    fun line(id:String)=allLines().firstOrNull{it["lineId"]==id}
    fun localHistory(row:SmsRow):SmsRow {
        val alias=row.sourceSubscription?.let { scalar("SELECT alias FROM lines WHERE device='server' AND sub=?",it.toString())?.toInt() }
        return row.copy(sim=alias?:row.sim,sourceSubscription=null)
    }
    fun localSendAlias(requestId:String,oldSlot:Int?):Int? =
        scalar("SELECT alias FROM lines JOIN sms_bindings USING(sub) WHERE device='server' AND request_id=?",requestId)?.toInt() ?: oldSlot
    @Synchronized fun isRemote(alias:Int)=scalar("SELECT device FROM lines WHERE alias=?",alias.toString())?.let{it!="server"} ?: (alias in 101..104)
    @Synchronized fun deviceOfAlias(alias:Int):String? {
        if(alias in 1..4)registry.refreshLocal(writableDatabase)
        return scalar("SELECT device FROM lines WHERE alias=?",alias.toString())
    }

    fun clientReceipt(scope:String,id:String) {
        writableDatabase.execSQL("INSERT OR IGNORE INTO client_receipts(scope,id) VALUES(?,?)",arrayOf(scope,id))
    }
    fun clientReceipts(scope:String):List<String> =
        readableDatabase.rawQuery("SELECT id FROM client_receipts WHERE scope=? ORDER BY rowid LIMIT 100",arrayOf(scope)).use { c->
            buildList { while(c.moveToNext()) add(c.getString(0)) }
        }
    fun confirmClientReceipts(scope:String,ids:List<String>) {
        val db=writableDatabase
        db.beginTransaction()
        try {
            ids.forEach { db.delete("client_receipts","scope=? AND id=?",arrayOf(scope,it)) }
            db.setTransactionSuccessful()
        } finally { db.endTransaction() }
    }

    private fun checkedName(name:String)=name.trim().also { require(it.length<=30 && it.none(Char::isISOControl)) }
    @Synchronized fun renameDevice(id:String,name:String) {
        val label=checkedName(name)
        require(devices().any{it["id"]==id})
        writableDatabase.execSQL("UPDATE devices SET label=? WHERE device=?",arrayOf(label.ifEmpty{if(id=="server")"服务器手机" else "共享手机"},id))
    }
    @Synchronized fun renameLine(alias:Int,name:String) {
        val label=checkedName(name)
        val line=allLines().first{it["id"]==alias}
        writableDatabase.execSQL("UPDATE lines SET name=? WHERE alias=?",arrayOf(label.ifEmpty{"卡 "+line["slot"]},alias))
    }
    @Synchronized fun configureLine(lineId:String,action:String) {
        val target=line(lineId) ?: throw IllegalArgumentException("线路不存在")
        val db=writableDatabase
        when(action) {
            "default" -> db.execSQL("INSERT OR REPLACE INTO line_preferences(name,line_id) VALUES('default',?)",arrayOf(lineId))
            "no-default" -> db.execSQL("DELETE FROM line_preferences WHERE name='default' AND line_id=?",arrayOf(lineId))
            "enable","disable" -> db.execSQL("UPDATE lines SET enabled=? WHERE line_id=?",arrayOf(if(action=="enable")1 else 0,lineId))
            "first" -> db.execSQL("UPDATE lines SET sort_order=(SELECT min(sort_order)-1 FROM lines) WHERE line_id=?",arrayOf(lineId))
            "confirm" -> {require(target["present"]==true);confirmLine(lineId)}
            else -> throw IllegalArgumentException("未知线路操作")
        }
    }

    /** Only the Android administrator can move an identity, and only away from
     * an absent source. Retain numeric aliases for archived and legacy rows. */
    @Synchronized fun moveIdentity(oldId:String,newId:String) {
        val known=allLines()
        val old=known.single { it["lineId"]==oldId }
        val next=known.single { it["lineId"]==newId }
        require(old["present"]==false && next["present"]==true && next["deviceOnline"]==true && oldId!=newId)
        val db=writableDatabase
        db.beginTransaction()
        try {
            db.execSQL("UPDATE lines SET line_id=?,enabled=0 WHERE line_id=?",arrayOf(UUID.randomUUID().toString(),oldId))
            db.execSQL("UPDATE lines SET line_id=?,name=?,confirmed=1,enabled=1,sort_order=? WHERE line_id=?",
                arrayOf(oldId,old["simName"],old["sortOrder"],newId))
            db.execSQL("UPDATE line_preferences SET line_id=? WHERE line_id=?",arrayOf(oldId,newId))
            db.setTransactionSuccessful()
        } finally { db.endTransaction() }
    }

    @Synchronized fun confirmLine(lineId:String) {
        writableDatabase.execSQL("UPDATE lines SET confirmed=1 WHERE line_id=? AND present=1",arrayOf(lineId))
    }
    @Synchronized fun bindLocalSend(requestId:String,alias:Int,lineId:String?=null):Int {
        val line=allLines().single{it["id"]==alias && it["deviceId"]=="server" && it["smsAvailable"]==true && (lineId==null || it["lineId"]==lineId)}
        val slot=line["slot"] as Int
        bindSubmission(requestId,slot,line["subscriptionId"] as Int)
        return slot
    }
    @Synchronized fun bindSubmission(requestId:String,slot:Int,sub:Int) {
        writableDatabase.execSQL("INSERT OR IGNORE INTO sms_bindings(request_id,slot,sub) VALUES(?,?,?)",arrayOf(requestId,slot,sub))
        require(expectedSub(requestId,slot)==sub) {"线路绑定已变化"}
    }
    @Synchronized fun expectedSub(requestId:String,slot:Int):Int? =
        readableDatabase.rawQuery("SELECT slot,sub FROM sms_bindings WHERE request_id=?",arrayOf(requestId)).use { c->
            if(c.moveToFirst()){require(c.getInt(0)==slot);c.getInt(1)} else null
        }

    private fun rows(sql:String,args:Array<String>?=null):List<SmsRow> = readableDatabase.rawQuery(sql,args).use {
        buildList { while(it.moveToNext())add(gson.fromJson(it.getString(0),SmsRow::class.java)) }
    }
    // All rows returned by a paged query must be in scope before LIMIT is applied.
    private fun scope(devices:Set<String>?):String = when {
        devices==null -> ""
        devices.isEmpty() -> " AND 0"
        else -> devices.joinToString(prefix=" AND device IN (",postfix=")") { DatabaseUtils.sqlEscapeString(it) }
    }
    fun page(before:Long,devices:Set<String>?=null)=rows("SELECT row FROM history WHERE seq<?"+scope(devices)+" ORDER BY seq DESC LIMIT 200",arrayOf(before.toString()))
    fun visibleAddresses(devices:Set<String>):Set<String> {
        val filter=scope(devices)
        val query="SELECT address FROM history WHERE address IS NOT NULL"+filter+" UNION SELECT address FROM sends WHERE address IS NOT NULL"+filter
        return readableDatabase.rawQuery(query,null).use { c -> buildSet { while(c.moveToNext())add(c.getString(0)) } }
    }
    fun pageCursor(id:String):Long {
        val device=if(id.startsWith("xia:"))"peer" else id.substringBeforeLast(':')
        return scalar("SELECT seq FROM history WHERE device=? AND source_id=?",device,id.substringAfterLast(':'))!!.toLong()
    }
    fun outgoing(devices:Set<String>?=null)=rows("SELECT row FROM sends WHERE 1"+scope(devices)+" ORDER BY rowid DESC LIMIT 100")
    fun sent(id:String,devices:Set<String>?=null)=rows("SELECT row FROM sends WHERE id=?"+scope(devices),arrayOf(id)).firstOrNull()
    @Synchronized fun queue(id:String,address:String,body:String,sim:Int):SmsRow {
        sent(id)?.let {require(it.address==address && it.body==body && it.sim==sim);return it}
        val line=lines().singleOrNull{it["id"]==sim && it["smsAvailable"]==true} ?: throw IllegalArgumentException("手机或线路不可用")
        val row=SmsRow(id,address,address,null,body,System.currentTimeMillis(),false,true,sim,"accepted")
        writableDatabase.execSQL("INSERT INTO sends(id,row,sub,phase,device,slot,address) VALUES(?,?,?,'queued',?,?,?)",
            arrayOf(id,gson.toJson(row),line["subscriptionId"],line["deviceId"],line["slot"],address))
        return row
    }
    private fun finish(owner:String,id:String,state:String) {
        val old=rows("SELECT row FROM sends WHERE device=? AND id=?",arrayOf(owner,id)).firstOrNull()?:return
        if(old.state in setOf("failed","delivered") || (old.state=="sent" && state !in setOf("sent","delivered","failed")))return
        writableDatabase.execSQL("UPDATE sends SET row=?,phase=? WHERE device=? AND id=? AND phase!='queued'",arrayOf(gson.toJson(old.copy(state=state)),PeerDeliveryPolicy.phase(state),owner,id))
    }

    // Gson can create an instance with null values in non-null Kotlin fields.
    // Validate the untrusted wire record before accepting it into durable history.
    private fun receivedRow(json:JSONObject):SmsRow {
        val id=requireNotNull(json.opt("id") as? String)
        val address=requireNotNull(json.opt("address") as? String)
        val body=requireNotNull(json.opt("body") as? String)
        require(id.removePrefix("sms:").toLongOrNull()?.let{it>0}==true && address.length<=256 && body.length<=200000)
        val date=requireNotNull(json.opt("date") as? Number).toLong()
        val incoming=requireNotNull(json.opt("incoming") as? Boolean)
        val read=requireNotNull(json.opt("read") as? Boolean)
        val display=(json.opt("display") as? String) ?: address
        val sender=json.opt("name") as? String
        require(display.length<=512 && (sender?.length?:0)<=512)
        val state=(json.opt("state") as? String) ?: "unknown"
        require(state in setOf("received","accepted","sent","failed","delivered","unknown"))
        return SmsRow(id,address,display,sender,body,date,incoming,read,
            (json.opt("sim") as? Number)?.toInt(),state,json.opt("creator") as? String,
            json.opt("error") as? String,(json.opt("sourceSubscription") as? Number)?.toInt())
    }

    @Synchronized fun sync(token:String,b:JSONObject):JSONObject {
        val device=deviceForToken(token) ?: throw SecurityException("设备授权已撤销")
        val reply=syncSms(device,b)
        if(b.optInt("protocol")>=3) b.optJSONObject("directory")?.let { packet->
            runCatching { directory().sync(device,packet) }.onSuccess { reply.put("directory",it) }
        }
        return reply
    }

    private fun syncSms(device:String,b:JSONObject):JSONObject {
        val slots=DeviceRegistry.slotMap(b.getJSONObject("slots"))
        val list=b.getJSONArray("rows");require(list.length()<=40)
        val protocol=b.optInt("protocol",1)
        val now=System.currentTimeMillis()
        val db=writableDatabase
        db.beginTransaction()
        try{
            registry.observe(db,device,slots)
            val pushAfter=scalar("SELECT push_after FROM devices WHERE device=?",device)!!.toLong()
            for(i in 0 until list.length()) {
                val r=receivedRow(requireNotNull(list.optJSONObject(i)))
                val source=r.id.removePrefix("sms:").toLong()
                val exists=scalar("SELECT seq FROM history WHERE device=? AND source_id=?",device,source.toString())!=null
                if(!exists && r.incoming && r.date>=pushAfter) db.execSQL("INSERT OR IGNORE INTO push_events(device,id,address) VALUES(?,?,?)",arrayOf(device,source,r.address))
                val alias = if(r.sourceSubscription!=null) scalar("SELECT alias FROM lines WHERE device=? AND sub=?",device,r.sourceSubscription.toString())?.toInt()
                    else r.sim?.let{scalar("SELECT alias FROM lines WHERE device=? AND slot=? AND present=1",device,it.toString())?.toInt()}
                val publicId=(if(device=="peer")"xia" else device)+":"+source
                val json=gson.toJson(r.copy(id=publicId,sim=alias,sourceSubscription=null))
                if(exists) db.execSQL("UPDATE history SET row=?,address=? WHERE device=? AND source_id=?",arrayOf(json,r.address,device,source))
                else db.execSQL("INSERT INTO history(device,source_id,row,address) VALUES(?,?,?,?)",arrayOf(device,source,json,r.address))
            }
            val response=JSONObject().put("deviceId",device).put("protocol",minOf(3,protocol))
            val receipts=b.optJSONArray("receipts")?:JSONArray();require(receipts.length()<=100)
            val acked=JSONArray()
            for(i in 0 until receipts.length()) {
                val id=receipts.getString(i);require(id.matches(JOB))
                db.execSQL("UPDATE sends SET phase='handed' WHERE device=? AND id=? AND phase='offered'",arrayOf(device,id))
                acked.put(id)
            }
            response.put("acked",acked)
            val states=b.getJSONObject("states");require(states.length()<=100)
            states.keys().forEach { id->
                val state=states.getString(id)
                val phase=scalar("SELECT phase FROM sends WHERE device=? AND id=?",device,id)
                if(phase!=null && PeerDeliveryPolicy.acceptState(phase,state))finish(device,id,state)
            }
            val queued=rows(if(protocol>=2)"SELECT row FROM sends WHERE phase IN ('offered','queued') AND device=? ORDER BY CASE phase WHEN 'offered' THEN 0 ELSE 1 END,rowid LIMIT 1" else "SELECT row FROM sends WHERE phase='queued' AND device=? ORDER BY rowid LIMIT 1",arrayOf(device)).firstOrNull()
            if(queued!=null) {
                db.rawQuery("SELECT sub,slot,phase FROM sends WHERE device=? AND id=?",arrayOf(device,queued.id)).use { c->
                    check(c.moveToFirst())
                    val sub=c.getInt(0)
                    val slot=if(c.isNull(1))queued.sim!!-100 else c.getInt(1)
                    val offered=c.getString(2)=="offered"
                    db.execSQL("UPDATE sends SET phase=? WHERE device=? AND id=?",arrayOf(if(protocol>=2)"offered" else "handed",device,queued.id))
                    if(!offered && (now-queued.date !in 0..20000 || slots[slot]!=sub)) finish(device,queued.id,"failed")
                    else {
                        db.execSQL("UPDATE sends SET row=? WHERE device=? AND id=?",arrayOf(gson.toJson(queued.copy(state="unknown")),device,queued.id))
                        // Old clients see only their own slots encoded as 101..104 on the wire.
                        response.put("job",JSONObject(gson.toJson(queued)).put("slot",slot).put("sim",slot+100)
                            .put("sub",sub).put("expires",queued.date+20000).put("protocol",minOf(3,protocol)))
                    }
                }
            }
            val inspect=rows("SELECT row FROM sends WHERE phase IN ('handed','offered','sent') AND device=? ORDER BY checked,rowid LIMIT 100",arrayOf(device)).map{it.id}
            inspect.forEach {db.execSQL("UPDATE sends SET checked=? WHERE device=? AND id=?",arrayOf(now,device,it))}
            response.put("inspect",JSONArray(inspect))
            db.execSQL("UPDATE devices SET last_seen=?,protocol=?,model=CASE WHEN ?='' THEN model ELSE ? END,os=? WHERE device=?",
                arrayOf(now,protocol,b.optString("model").take(80),b.optString("model").take(80),b.optString("os").take(32),device))
            val directory=b.optJSONObject("directory")
            fun flag(value:Boolean)=if(value)1 else 0
            db.execSQL("UPDATE devices SET sms_read=?,sms_send=?,contacts_read=?,contacts_write=?,calls_read=?,voice_version=? WHERE device=?",
                arrayOf(flag(b.optBoolean("smsRead",true)),flag(b.optBoolean("smsAvailable",true)),flag(directory?.optBoolean("contacts")==true),
                    flag(directory?.optBoolean("write")==true),flag(directory?.optBoolean("calls")==true),b.optString("voiceAgentVersion").take(40),device))
            db.setTransactionSuccessful()
            registry.seen(device)
            return response
        }finally{db.endTransaction()}
    }

    fun flushPush() {
        val pending=readableDatabase.rawQuery("SELECT p.device,p.id,p.address FROM push_events p JOIN devices d ON d.device=p.device WHERE d.revoked=0 ORDER BY p.rowid LIMIT 20",null).use { c->
            buildList { while(c.moveToNext())add(Triple(c.getString(0),c.getString(1),c.getString(2))) }
        }
        for((device,id,address) in pending) {
            if(scalar("SELECT device FROM devices WHERE device=? AND revoked=0",device)==null) continue
            val row=rows("SELECT row FROM history WHERE device=? AND source_id=?",arrayOf(device,id)).firstOrNull()
            val source=if(device=="peer")ctx.getSharedPreferences("peer-hub",0).getString("auth",device) else device
            WebPushWorker.enqueuePeer(ctx,address,"peer-"+source+"-"+id,row,device)
            writableDatabase.delete("push_events","device=? AND id=?",arrayOf(device,id))
        }
    }
    companion object {
        private val JOB=Regex("[a-fA-F0-9-]{36}")
        @Volatile private var instance:PeerHub?=null
        @Synchronized fun get(ctx:Context)=instance?:PeerHub(ctx.applicationContext).also{instance=it}
    }
}
