package me.capcom.smsgateway.modules.directory

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

class DirectoryService internal constructor(private val ctx: Context, internal val database:DirectoryDb=DirectoryDb(ctx),
    localProvider:DirectoryProvider=DirectoryProvider(ctx.applicationContext)) {
    private val db get()=database.writableDatabase
    private val region get()=ctx.getSharedPreferences("iphone",0).getString("region","CN")?:"CN"
    private val local by lazy { PeerDirectoryAgent(ctx,PeerDirectoryAgent.LOCAL_LINK,this,localProvider) }
    internal val monitor by lazy { DirectoryMonitor(ctx.applicationContext) }

    @Synchronized fun tickLocal(deviceId:String="server") {
        require(deviceId=="server")
        val packet=local.prepare()
        local.accept(sync(deviceId,packet))
        flushMissedAlerts()
    }

    fun revoke(device:String) {
        db.atomic {
            db.execSQL("DELETE FROM grants WHERE device=?",arrayOf(device))
            db.execSQL("DELETE FROM directory_versions WHERE device=?",arrayOf(device))
            db.execSQL("UPDATE jobs SET state='revoked',detail='设备配对已撤销',finished=? WHERE device=? AND state='queued'",
                arrayOf(System.currentTimeMillis(),device))
            // A reused legacy role must not inherit the old phone's sources, jobs or sequence.
            db.execSQL("DELETE FROM identities WHERE device=?",arrayOf(device))
            db.execSQL("DELETE FROM sources WHERE device=?",arrayOf(device))
            db.execSQL("DELETE FROM calls WHERE device=?",arrayOf(device))
            db.execSQL("DELETE FROM call_seen WHERE device=?",arrayOf(device))
            db.execSQL("DELETE FROM seen WHERE device=?",arrayOf(device))
            db.execSQL("DELETE FROM missed_alerts WHERE device=?",arrayOf(device))
        }
    }

    /** device is supplied by the authenticated peer registry, never the JSON body. */
    fun sync(device:String, packet:JSONObject):JSONObject = db.atomic {
        require(device.isNotBlank())
        val contacts=packet.optBoolean("contacts")
        val writes=contacts&&packet.optBoolean("write")
        val calls=packet.optBoolean("calls")
        db.execSQL("INSERT OR REPLACE INTO grants VALUES(?,?,?,?)",arrayOf(device,if(contacts)1 else 0,if(writes)1 else 0,if(calls)1 else 0))
        val acks=JSONArray()
        val accepted=JSONArray()
        val events=packet.optJSONArray("events")?:JSONArray()
        val results=packet.optJSONArray("results")?:JSONArray()
        require(events.length()<=32 && results.length()<=32)
        // Associate newly-created Provider IDs before accepting their first snapshot.
        for(r in results.objects()) acceptResult(device,r,accepted)
        var contactsChanged=false
        for(e in events.objects()){
            val kind=e.getString("kind")
            val raw=e.getString("raw")
            val seq=e.getLong("seq")
            require(raw.toLong()>0 && seq>0 && kind in setOf("contact","call"))
            if(kind=="contact"&&!contacts || kind=="call"&&!calls)continue
            val previous=db.scalar("SELECT seq FROM seen WHERE device=? AND kind=? AND raw=?",device,kind,raw)?.toLong()?:0
            if(seq>previous){
                val record=e.optJSONObject("record")
                if(record!=null)require(record.getString("rawId")==raw)
                if(kind=="contact"){ingestContact(device,raw,record);contactsChanged=true}
                else if(record==null)db.execSQL("DELETE FROM calls WHERE device=? AND raw=?",arrayOf(device,raw))
                else {
                    val now=System.currentTimeMillis()
                    if(previous==0L && record.optBoolean("notifyMissed") && record.optString("type")=="missed"
                        && record.optLong("date") in (now-3600000L)..now)
                        db.execSQL("INSERT OR IGNORE INTO missed_alerts VALUES(?,?)",arrayOf(device,raw+":"+record.getLong("date")))
                    db.execSQL("INSERT OR REPLACE INTO calls VALUES(?,?,?,?)",arrayOf(device,raw,record.getLong("date"),record.toString()))
                }
                db.execSQL("INSERT OR REPLACE INTO seen VALUES(?,?,?,?)",arrayOf(device,kind,raw,seq))
            }
            acks.put(JSONObject().put("kind",kind).put("raw",raw).put("seq",seq))
        }
        if(contactsChanged)markAndroidContactsChanged(device)
        val response=JSONObject().put("ack",acks).put("accepted",accepted)
        if(writes)nextWrite(device)?.let{response.put("job",it)}
        response
    }

    private fun nextWrite(device:String):JSONObject? = db.rows(
        "SELECT id,raw,expected,action,payload FROM jobs WHERE device=? AND state='queued' ORDER BY created,rowid LIMIT 1",device
    ){ c -> JSONObject().put("id",c.getString(0)).put("rawId",c.getString(1)).put("expected",c.getString(2))
        .put("action",c.getString(3)).put("payload",JSONObject(c.getString(4)))
    }.firstOrNull()

    internal fun localWriteActive(id:String)=db.scalar("""SELECT 1 FROM jobs j JOIN grants g ON g.device=j.device
        WHERE j.device='server' AND j.id=? AND j.state='queued' AND g.contacts=1 AND g.writing=1""",id)!=null

    internal fun acceptLocalReceipt(receipt:JSONObject) {
        db.atomic {
            val accepted=JSONArray()
            acceptResult("server",receipt,accepted)
            if(accepted.length()!=0)db.execSQL("UPDATE applied SET acked=1 WHERE link=? AND id=?",
                arrayOf(PeerDirectoryAgent.LOCAL_LINK,receipt.getString("id")))
        }
        dispatchLocalWrite()
    }

    private fun dispatchLocalWrite() {
        nextWrite("server")?.let(local::offerWrite)
    }

    private fun flushMissedAlerts(){
        val pending=db.rows("SELECT a.device,a.event FROM missed_alerts a JOIN grants g ON g.device=a.device WHERE g.calls=1 LIMIT 20"){
            it.getString(0) to it.getString(1)
        }
        pending.forEach { (device,event)->
            me.capcom.smsgateway.modules.iphone.PhoneAlert.enqueue(ctx,device,event)
            db.execSQL("DELETE FROM missed_alerts WHERE device=? AND event=?",arrayOf(device,event))
        }
    }

    private fun acceptResult(device:String,result:JSONObject,accepted:JSONArray){
        val id=result.getString("id")
        val state=result.getString("state")
        require(validId(id) && state in setOf("done","denied","conflict","failed"))
        val job=db.rows("SELECT contact,action,raw,state FROM jobs WHERE id=? AND device=?",id,device){ c->
            listOf(c.getString(0),c.getString(1),c.getString(2).orEmpty(),c.getString(3))
        }.firstOrNull()?:return
        if(job[3]=="queued"){
            val raw=result.optString("rawId",job[2])
            if(state=="done"){
                require(raw.toLong()>0 && (job[1]=="create" || raw==job[2]))
                if(job[1]=="delete"){ingestContact(device,raw,null);markAndroidContactsChanged(device)}
                if(job[1]=="create"){
                    // Snapshot may have arrived before the receipt, or vice versa.
                    db.execSQL("UPDATE sources SET contact=? WHERE device=? AND raw=?",arrayOf(job[0],device,raw))
                }
            }
            db.execSQL("UPDATE jobs SET state=?,detail=?,raw=?,finished=? WHERE id=? AND device=?",arrayOf(
                state,result.optString("detail").take(200),raw,System.currentTimeMillis(),id,device))
        }
        accepted.put(id)
    }

    private fun ingestContact(device:String,raw:String,record:JSONObject?){
        val previous=db.scalar("SELECT contact FROM sources WHERE device=? AND raw=?",device,raw)
        if(record==null){
            if(previous!=null){
                db.execSQL("UPDATE sources SET deleted=1 WHERE device=? AND raw=?",arrayOf(device,raw))
                db.execSQL("DELETE FROM identities WHERE device=? AND raw=?",arrayOf(device,raw))
                // Retain the last authorised snapshot for explicit restore. Restoring a
                // unified card never silently recreates the deleted Android raw-contact.
                if(db.scalar("SELECT 1 FROM sources WHERE contact=? AND deleted=0 LIMIT 1",previous)==null){
                    db.execSQL("UPDATE contacts SET deleted=2 WHERE id=? AND manual=0 AND deleted=0",arrayOf(previous))
                }
                bump(previous)
            }
            return
        }
        val name=record.getString("name")
        val numbers=record.getJSONArray("numbers").strings()
        val keys=numbers.mapNotNull { sourceKey(region,it) }.toSet()
        val requested=db.scalar("SELECT contact FROM jobs WHERE device=? AND raw=? AND action='create' AND state='done' ORDER BY finished DESC LIMIT 1",device,raw)
        val contact=requested?:previous?:matching(keys,name)?:newId().also {
            db.execSQL("INSERT INTO contacts(id) VALUES(?)",arrayOf(it))
        }
        db.execSQL("INSERT OR REPLACE INTO sources VALUES(?,?,?,?,?,0)",arrayOf(device,raw,contact,record.getString("revision"),record.toString()))
        db.execSQL("UPDATE contacts SET deleted=0 WHERE id=? AND deleted=2",arrayOf(contact))
        db.execSQL("DELETE FROM identities WHERE device=? AND raw=?",arrayOf(device,raw))
        keys.forEach { db.execSQL("INSERT INTO identities VALUES(?,?,?)",arrayOf(device,raw,it)) }
        bump(contact)
    }

    private fun matching(keys:Set<String>,name:String):String? {
        val candidates=keys.flatMap{key->matchingIds(key)}.distinct()
        if(candidates.size!=1)return null
        val existing=candidates.single()
        val names=db.rows("SELECT s.payload FROM sources s JOIN grants g ON g.device=s.device WHERE s.contact=? AND s.deleted=0 AND g.contacts=1",existing){
            JSONObject(it.getString(0)).optString("name").trim()
        }.filter{it.isNotEmpty()}
        val knownNames=names.ifEmpty{listOfNotNull(db.scalar("SELECT alias FROM contacts WHERE id=?",existing)).filter{it.isNotBlank()}}
        return existing.takeIf { name.isBlank() || knownNames.all{it.equals(name.trim(),true)} }
    }
    private fun matchingIds(key:String):List<String> = db.rows("""
        SELECT DISTINCT s.contact FROM identities i JOIN sources s ON s.device=i.device AND s.raw=i.raw
        JOIN contacts c ON c.id=s.contact JOIN grants g ON g.device=s.device
        WHERE i.number=? AND c.deleted=0 AND s.deleted=0 AND g.contacts=1
        UNION SELECT a.contact FROM alias_identity a JOIN contacts c ON c.id=a.contact WHERE a.number=? AND c.deleted=0""",key,key){it.getString(0)}

    private fun bump(id:String) { db.execSQL("UPDATE contacts SET revision=revision+1 WHERE id=?",arrayOf(id)) }

    fun resolveName(number:String,allowedDevice:(String)->Boolean={true}):String? =
        AndroidDirectory(this).resolve(number,allowedDevice)

    internal fun contactReadError(allowed:(String)->Boolean):String? =
        if(allowed("server")&&deviceAccess("server").optBoolean("contactsRead"))
            ctx.getSharedPreferences("directory-sync",0).getString("contact-error",null) else null
    internal fun regionCode()=region
    internal fun markAndroidContactsChanged(device:String) {
        db.execSQL("INSERT OR REPLACE INTO directory_versions VALUES(?,?)",arrayOf(device,newId()))
    }
    internal fun androidContactsVersion(allowed:(String)->Boolean):String {
        val visible=JSONArray()
        db.rows("""SELECT g.device,g.writing,v.version FROM grants g LEFT JOIN directory_versions v
            ON v.device=g.device WHERE g.contacts=1 ORDER BY g.device"""){
            Triple(it.getString(0),it.getInt(1),it.getString(2).orEmpty())
        }.forEach { (device,writing,version)->
            if(allowed(device))visible.put(JSONArray().put(device).put(writing).put(version))
        }
        visible.put(contactReadError(allowed).orEmpty())
        return me.capcom.smsgateway.modules.iphone.PrivateStore.hash(visible.toString())
    }
    fun androidContacts(query:String,offset:Int,allowed:(String)->Boolean,favorite:Boolean=false)=AndroidDirectory(this).list(query,offset,allowed,favorite)
    fun androidContact(id:String,allowed:(String)->Boolean)=AndroidDirectory(this).view(id,allowed)
    fun androidMutate(owner:String,action:String,body:JSONObject,allowed:(String)->Boolean)=AndroidDirectory(this).mutate(owner,action,body,allowed).also { result ->
        if(result.optString("deviceId")=="server" && result.optString("state")=="queued"){
            // The durable mutation committed before this offer. The regular sync loop
            // still replays a pending job after a crash or a transient provider failure.
            dispatchLocalWrite()
        }
    }

    private fun visibleSources(id:String,allowed:(String)->Boolean,deleted:Boolean):List<JSONObject> =
        db.rows("""SELECT s.device,s.payload,s.deleted FROM sources s JOIN grants g ON s.device=g.device
            WHERE s.contact=? AND (s.deleted=0 OR ?='1') AND g.contacts=1 ORDER BY s.device,s.raw""",id,if(deleted)"1" else "0"){ c ->
            Triple(c.getString(0),c.getString(1),c.getInt(2)!=0)
        }.filter{allowed(it.first)}.map{(device,json,gone)->JSONObject(json).put("deviceId",device).put("deleted",gone)}

    fun view(id:String,allowed:(String)->Boolean,includeDeleted:Boolean=false,includeConflict:Boolean=true):JSONObject? {
        val row=db.rows("SELECT alias,phones,revision,favorite,preferred,deleted,manual FROM contacts WHERE id=?",id){c->
            JSONObject().put("alias",c.getString(0)).put("explicit",c.getString(1)).put("revision",c.getLong(2))
                .put("favorite",c.getInt(3)!=0).put("preferred",c.getString(4)).put("deleted",c.getInt(5)!=0)
                .put("manual",c.getInt(6)!=0)
        }.firstOrNull()?:return null
        if(row.getBoolean("deleted")&&!includeDeleted)return null
        val items=visibleSources(id,allowed,row.getBoolean("deleted"))
        val hadSources=db.scalar("SELECT 1 FROM sources WHERE contact=? LIMIT 1",id)!=null
        val wholeCard=db.rows("""SELECT DISTINCT s.device,coalesce(g.contacts,0) FROM sources s
            LEFT JOIN grants g ON g.device=s.device WHERE s.contact=?""",id){it.getString(0) to it.getInt(1)}
            .all{(device,granted)->allowed(device)&&granted==1}
        if(items.isEmpty() && (!row.getBoolean("manual") || !wholeCard || (hadSources && !row.has("alias") && !row.has("explicit"))))return null
        val preferred=items.firstOrNull{it.getString("deviceId")==row.optString("preferred")}
        val name=listOf(row.optString("alias").takeIf{wholeCard},preferred?.optString("name")).plus(items.map{it.optString("name")})
            .firstOrNull{!it.isNullOrBlank()}.orEmpty()
        val numbers=if(wholeCard && row.has("explicit"))JSONArray(row.getString("explicit")).strings()
            else items.flatMap{it.getJSONArray("numbers").strings()}.distinct()
        val conflict=includeConflict && numbers.any { num ->
            sourceKey(region,num)?.let{key -> matchingIds(key).any{it!=id && view(it,allowed,includeConflict=false)!=null} }?:false
        }
        return JSONObject().put("id",id).put("name",name).put("numbers",JSONArray(numbers))
            .put("sources",JSONArray(items)).put("revision",row.getLong("revision")).put("favorite",row.getBoolean("favorite"))
            .put("deleted",row.getBoolean("deleted")).put("conflict",conflict).put("preferredDeviceId",preferred?.getString("deviceId").orEmpty())
    }

    fun contacts(search:String,offset:Int,allowed:(String)->Boolean,trash:Boolean=false,favorites:Boolean=false):JSONObject{
        val ids=db.rows("SELECT id FROM contacts WHERE "+(if(trash)"deleted<>0" else "deleted=0")+" ORDER BY id"){it.getString(0)}
        val q=search.trim()
        val matches=ids.asSequence().mapNotNull{view(it,allowed,includeDeleted=trash)}.filter{!favorites||it.getBoolean("favorite")}.filter{ row ->
            q.isEmpty() || row.getString("name").contains(q,true) || row.getJSONArray("numbers").strings().any{it.contains(q)}
                || row.getJSONArray("sources").objects().any{it.optString("name").contains(q,true)}
        }.drop(offset).take(51).toList()
        return page(matches,offset,50)
    }

    fun history(device:String?,offset:Int,allowed:(String)->Boolean,includeNames:Boolean):JSONObject{
        val records=ArrayList<JSONObject>()
        var skip=offset
        val args=if(device==null)emptyArray() else arrayOf(device)
        val where=if(device==null)"" else " AND c.device=?"
        db.rawQuery("SELECT c.device,c.raw,c.payload FROM calls c JOIN grants g ON g.device=c.device WHERE g.calls=1"+where+" ORDER BY c.date DESC,c.device,c.raw",args).use { c->
            while(records.size<=50 && c.moveToNext()) {
                val d=c.getString(0)
                if(!allowed(d))continue
                if(skip>0){skip--;continue}
                val row=JSONObject(c.getString(2))
                row.put("id","android:"+d+":"+c.getString(1)).put("deviceId",d).put("source","android")
                if(includeNames)resolveName(row.optString("number"),allowed)?.let{row.put("name",it)}
                records.add(row)
            }
        }
        return page(records,offset,50)
    }

    fun missed(installation:String,allowed:(String)->Boolean):JSONObject{
        require(installation.isNotBlank())
        var count=0
        db.rawQuery("SELECT c.device,c.payload FROM calls c JOIN grants g ON c.device=g.device WHERE g.calls=1 AND NOT EXISTS(SELECT 1 FROM call_seen s WHERE s.installation=? AND s.device=c.device AND s.raw=c.raw AND s.date=c.date)",arrayOf(installation)).use { c->
            while(c.moveToNext())if(allowed(c.getString(0))&&JSONObject(c.getString(1)).optString("type")=="missed")count++
        }
        return JSONObject().put("count",count)
    }
    fun seenCalls(installation:String,records:JSONArray,allowed:(String)->Boolean):JSONObject{
        require(installation.isNotBlank() && records.length()<=100)
        db.atomic {
            for(item in records.objects()){
                val id=item.getString("id")
                require(id.startsWith("android:")&&id.length<=180)
                val compound=id.removePrefix("android:");val raw=compound.substringAfterLast(':');val device=compound.substringBeforeLast(':',"")
                require(device.isNotBlank()&&(raw.toLongOrNull()?:0L)>0)
                if(!allowed(device))throw SecurityException()
                val record=db.scalar("SELECT c.payload FROM calls c JOIN grants g ON g.device=c.device WHERE g.calls=1 AND c.device=? AND c.raw=?",device,raw)?.let(::JSONObject)?:continue
                if(record.optString("type")!="missed"||record.getLong("date")!=item.getLong("date"))continue
                db.execSQL("INSERT OR IGNORE INTO call_seen VALUES(?,?,?,?)",arrayOf(installation,device,raw,record.getLong("date")))
            }
        }
        return missed(installation,allowed)
    }

    private fun page(rows:List<JSONObject>,offset:Int,size:Int)=JSONObject().put("items",JSONArray(rows.take(size)))
        .put("next",if(rows.size>size)offset+size else JSONObject.NULL)

    fun jobs(id:String?,allowed:(String)->Boolean,jobId:String?=null):JSONObject {
        require(jobId==null || id!=null && validId(jobId))
        val where=when { jobId!=null -> " WHERE id=? AND contact=?"; id!=null -> " WHERE contact=?"; else -> "" }
        val args=listOfNotNull(jobId,id).toTypedArray()
        val items=JSONArray()
        db.rawQuery("SELECT id,contact,device,raw,action,state,detail,created FROM jobs"+where+" ORDER BY created DESC,rowid DESC",args).use { c->
            while(items.length()<100 && c.moveToNext())if(allowed(c.getString(2)))
                items.put(JSONObject().put("id",c.getString(0)).put("contactId",c.getString(1)).put("deviceId",c.getString(2))
                    .put("rawId",c.getString(3)).put("action",c.getString(4)).put("state",c.getString(5)).put("detail",c.getString(6)).put("created",c.getLong(7)))
        }
        return JSONObject().put("items",items)
    }

    fun deviceAccess(device:String):JSONObject = db.rows("SELECT contacts,writing,calls FROM grants WHERE device=?",device){c->
        JSONObject().put("contactsRead",c.getInt(0)!=0).put("contactsWrite",c.getInt(1)!=0).put("callsRead",c.getInt(2)!=0)
    }.firstOrNull()?:JSONObject()

    fun mutate(owner:String,action:String,b:JSONObject,allowed:(String)->Boolean):JSONObject =
        DirectoryEdits(this,region,allowed).run(owner,action,b)

    internal fun retireLegacyWrites(){
        // Retired assistant workflows must not later create contacts when a phone reconnects.
        db.execSQL("""UPDATE jobs SET state='revoked',detail='旧助手联系人功能已停用，未执行写回',finished=?
            WHERE state='queued' AND NOT EXISTS(
                SELECT 1 FROM changes c WHERE c.id=jobs.id AND c.contact=jobs.contact
                AND c.action IN ('android-create','android-edit'))""",arrayOf(System.currentTimeMillis()))
    }

    companion object {
        @Volatile private var instance:DirectoryService?=null
        @Synchronized fun get(context:Context):DirectoryService =
            instance?:DirectoryService(context.applicationContext).also{it.retireLegacyWrites();instance=it}
    }
}
