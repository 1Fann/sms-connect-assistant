package me.capcom.smsgateway.modules.iphone

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import android.os.SystemClock
import com.google.gson.Gson
import org.json.JSONArray
import org.json.JSONObject
import java.security.MessageDigest

/** Stores one paired phone separately from the Android SMS provider. */
class PeerHub(val ctx: Context): SQLiteOpenHelper(ctx,"paired-phone.db",null,2) {
    private val gson=Gson()
    private val prefs=ctx.getSharedPreferences("peer-hub",0)
    private var lastSeen=-60000L
    private var active=JSONObject()
    val paired get()=prefs.contains("auth")
    override fun onCreate(db:SQLiteDatabase) {
        db.execSQL("CREATE TABLE history(id INTEGER PRIMARY KEY, row TEXT NOT NULL)")
        db.execSQL("CREATE TABLE sends(id TEXT PRIMARY KEY, row TEXT NOT NULL, sub INTEGER NOT NULL, phase TEXT NOT NULL, checked INTEGER NOT NULL DEFAULT 0)")
        db.execSQL("CREATE TABLE push_events(id TEXT PRIMARY KEY,address TEXT NOT NULL)")
    }
    override fun onUpgrade(db:SQLiteDatabase,old:Int,new:Int) {
        if(old<2) {
            db.execSQL("ALTER TABLE sends ADD COLUMN checked INTEGER NOT NULL DEFAULT 0")
            db.execSQL("CREATE TABLE push_events(id TEXT PRIMARY KEY,address TEXT NOT NULL)")
            db.rawQuery("SELECT id,row FROM sends WHERE phase='done'",null).use { c->while(c.moveToNext()) {
                if(gson.fromJson(c.getString(1),SmsRow::class.java).state=="sent")db.execSQL("UPDATE sends SET phase='sent' WHERE id=?",arrayOf(c.getString(0)))
            } }
        }
    }

    @Synchronized fun invite():String {
        check(!paired) { "已有接入手机，请先解除配对" }
        val code=PrivateStore.token().take(20)
        prefs.edit().putString("invite",PrivateStore.hash(code)).putLong("expiry",System.currentTimeMillis()+180000).commit()
        return code
    }
    @Synchronized fun pair(code:String,token:String):Boolean {
        if(!token.matches(Regex("[a-f0-9]{64}")))return false
        val digest=PrivateStore.hash(token)
        if(paired)return authorized(token)
        if(!code.matches(Regex("[a-f0-9]{20}")) || System.currentTimeMillis()>prefs.getLong("expiry",0) || PrivateStore.hash(code)!=prefs.getString("invite",null))return false
        return prefs.edit().remove("invite").remove("expiry").putString("auth",digest).putLong("push-after",System.currentTimeMillis()).commit()
    }
    fun authorized(token:String):Boolean = token.length==64 && MessageDigest.isEqual(PrivateStore.hash(token).toByteArray(),prefs.getString("auth","")!!.toByteArray())
    @Synchronized fun forget(){
        prefs.edit().clear().commit()
        writableDatabase.delete("history",null,null); writableDatabase.delete("sends",null,null);writableDatabase.delete("push_events",null,null)
        active=JSONObject(); lastSeen=-60000
    }
    fun online()=SystemClock.elapsedRealtime()-lastSeen in 0..15000
    @Synchronized fun lines():List<Map<String,Any>> {
        val slots=if(online())active else JSONObject(prefs.getString("slots","{}")!!)
        val labels=PhoneLabels(ctx)
        return slots.keys().asSequence().map { labels.line(100+it.toInt(),online()) }.toList().sortedBy { it["id"] as Int }
    }
    private fun rows(sql:String,args:Array<String>?=null):List<SmsRow> = readableDatabase.rawQuery(sql,args).use {
        buildList { while(it.moveToNext())add(gson.fromJson(it.getString(0),SmsRow::class.java)) }
    }
    fun page(before:Long)=rows("SELECT row FROM history WHERE id<? ORDER BY id DESC LIMIT 200",arrayOf(before.toString()))
    fun outgoing()=rows("SELECT row FROM sends ORDER BY rowid DESC LIMIT 100")
    fun sent(id:String)=rows("SELECT row FROM sends WHERE id=?",arrayOf(id)).firstOrNull()
    @Synchronized fun queue(id:String,address:String,body:String,sim:Int):SmsRow {
        sent(id)?.let {require(it.address==address && it.body==body && it.sim==sim);return it}
        require(online() && active.has((sim-100).toString())){"手机或线路已离线"}
        val row=SmsRow(id,address,address,null,body,System.currentTimeMillis(),false,true,sim,"accepted")
        writableDatabase.execSQL("INSERT INTO sends(id,row,sub,phase) VALUES(?,?,?,?)",arrayOf(id,gson.toJson(row),active.getInt((sim-100).toString()),"queued"))
        return row
    }
    private fun finish(id:String,state:String) {
        val old=sent(id)?:return
        if(old.state in setOf("failed","delivered") || (old.state=="sent" && state !in setOf("sent","delivered","failed")))return
        writableDatabase.execSQL("UPDATE sends SET row=?,phase=? WHERE id=? AND phase!='queued'",arrayOf(gson.toJson(old.copy(state=state)),PeerDeliveryPolicy.phase(state),id))
    }
    @Synchronized fun sync(token:String,b:JSONObject):JSONObject {
        check(authorized(token))
        val slots=b.getJSONObject("slots");require(slots.keys().asSequence().all {it in setOf("1","2","3","4") && slots.getInt(it)>=0})
        val list=b.getJSONArray("rows");require(list.length()<=40)
        // Existing installations start notification tracking at the upgrade, so old
        // history imported for the first time does not create an alert storm.
        if(!prefs.contains("push-after"))check(prefs.edit().putLong("push-after",System.currentTimeMillis()).commit())
        val pushAfter=prefs.getLong("push-after",Long.MAX_VALUE)
        val protocol=b.optInt("protocol",1)
        val db=writableDatabase;db.beginTransaction()
        try{
            for(i in 0 until list.length()){
                val r=gson.fromJson(list.getJSONObject(i).toString(),SmsRow::class.java)
                val id=r.id.removePrefix("sms:").toLong();require(id>0 && r.address.length<=256 && r.body.length<=200000)
                val exists=db.rawQuery("SELECT 1 FROM history WHERE id=?",arrayOf(id.toString())).use { it.moveToFirst() }
                if(!exists && r.incoming && r.date>=pushAfter)db.execSQL("INSERT OR IGNORE INTO push_events VALUES(?,?)",arrayOf(id.toString(),r.address))
                // Keep the original opaque ID prefix so existing clients retain message identity.
                // It identifies the paired peer, regardless of manufacturer or model.
                db.execSQL("INSERT OR REPLACE INTO history VALUES(?,?)",arrayOf(id,gson.toJson(r.copy(id="xia:"+id,sim=r.sim?.plus(100)))))
            }
            val response=JSONObject()
            val receipts=b.optJSONArray("receipts")?:JSONArray();require(receipts.length()<=100)
            val acked=JSONArray()
            for(i in 0 until receipts.length()) {
                val id=receipts.getString(i);require(id.matches(Regex("[a-fA-F0-9-]{36}")))
                db.execSQL("UPDATE sends SET phase='handed' WHERE id=? AND phase='offered'",arrayOf(id));acked.put(id)
            }
            response.put("acked",acked)
            val states=b.getJSONObject("states");require(states.length()<=100);states.keys().forEach {id->val s=states.getString(id)
                val phase=db.rawQuery("SELECT phase FROM sends WHERE id=?",arrayOf(id)).use { if(it.moveToFirst())it.getString(0) else "" }
                // An unknown result without a receipt is not proof of accepting an offer.
                if(PeerDeliveryPolicy.acceptState(phase,s))finish(id,s)
            }
            val now=System.currentTimeMillis()
            val queued=rows(if(protocol>=2)"SELECT row FROM sends WHERE phase IN ('offered','queued') ORDER BY CASE phase WHEN 'offered' THEN 0 ELSE 1 END,rowid LIMIT 1" else "SELECT row FROM sends WHERE phase='queued' ORDER BY rowid LIMIT 1").firstOrNull()
            if(queued!=null){
                val sub=db.rawQuery("SELECT sub FROM sends WHERE id=?",arrayOf(queued.id)).use{it.moveToFirst();it.getInt(0)}
                val offered=db.rawQuery("SELECT phase FROM sends WHERE id=?",arrayOf(queued.id)).use{it.moveToFirst();it.getString(0)=="offered"}
                db.execSQL("UPDATE sends SET phase=? WHERE id=?",arrayOf(if(protocol>=2)"offered" else "handed",queued.id))
                if(!offered && (now-queued.date !in 0..20000 || slots.optInt((queued.sim!!-100).toString(),-1)!=sub))finish(queued.id,"failed")
                else {
                    db.execSQL("UPDATE sends SET row=? WHERE id=?",arrayOf(gson.toJson(queued.copy(state="unknown")),queued.id))
                    response.put("job",JSONObject(gson.toJson(queued)).put("sub",sub).put("expires",queued.date+20000).put("protocol",protocol))
                }
            }
            val inspect=rows("SELECT row FROM sends WHERE phase IN ('handed','offered','sent') ORDER BY checked,rowid LIMIT 100").map{it.id}
            inspect.forEach {db.execSQL("UPDATE sends SET checked=? WHERE id=?",arrayOf(now,it))}
            response.put("inspect",JSONArray(inspect))
            db.setTransactionSuccessful()
            if(slots.toString()!=prefs.getString("slots",null))prefs.edit().putString("slots",slots.toString()).apply()
            active=slots;lastSeen=SystemClock.elapsedRealtime()
            return response
        }finally{db.endTransaction()}
    }
    /** At-least-once notification enqueue; the unique work name coalesces retries. */
    fun flushPush() {
        val (owner,pending)=synchronized(this) {
            prefs.getString("auth","") to readableDatabase.rawQuery("SELECT id,address FROM push_events ORDER BY rowid LIMIT 20",null).use { c->buildList { while(c.moveToNext())add(c.getString(0) to c.getString(1)) } }
        }
        for((id,address) in pending) {
            if(owner!=prefs.getString("auth",""))return
            WebPushWorker.enqueuePeer(ctx,address,"peer-"+owner+"-"+id)
            synchronized(this) { if(owner==prefs.getString("auth",""))writableDatabase.delete("push_events","id=?",arrayOf(id)) }
        }
    }
    companion object {
        @Volatile private var instance:PeerHub?=null
        @Synchronized fun get(ctx:Context)=instance?:PeerHub(ctx.applicationContext).also{instance=it}
    }
}
