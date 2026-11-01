package me.capcom.smsgateway.modules.directory

import android.database.sqlite.SQLiteDatabase
import me.capcom.smsgateway.modules.iphone.PrivateStore
import org.json.JSONArray
import org.json.JSONObject

internal class StaleContact : IllegalStateException("联系人已改变，请刷新后重新确认")

internal class DirectoryEdits(
    private val service:DirectoryService, private val region:String, private val allowed:(String)->Boolean
){
    private val db get()=service.database.writableDatabase

    private fun revision(id:String,version:Long,deleted:Boolean=false):JSONObject{
        val row=service.view(id,allowed,includeDeleted=deleted,includeConflict=false)?:throw NoSuchElementException()
        if(row.getLong("revision")!=version)throw StaleContact()
        return row
    }
    private fun allSourcesAllowed(id:String) {
        val devices=db.rows("SELECT DISTINCT device FROM sources WHERE contact=?",id){it.getString(0)}
        if(devices.any{!allowed(it)})throw SecurityException()
    }
    private fun contactData(b:JSONObject):JSONObject{
        val payload=JSONObject()
        if(b.has("name")){
            val name=b.getString("name").trim()
            require(name.length<=200 && name.none{it.isISOControl()})
            payload.put("name",name)
        }
        if(b.has("numbers")){
            val numbers=b.getJSONArray("numbers").strings().map{it.trim()}.distinct()
            require(numbers.size<=32 && numbers.all{it.length in 1..96 && it.none{ch->ch.isISOControl()}})
            payload.put("numbers",JSONArray(numbers))
        }
        return payload
    }
    private fun applyGlobal(id:String,b:JSONObject,payload:JSONObject){
        if(payload.has("name"))db.execSQL("UPDATE contacts SET alias=?,manual=1 WHERE id=?",arrayOf(payload.getString("name"),id))
        if(payload.has("numbers")){
            val numbers=payload.getJSONArray("numbers")
            db.execSQL("UPDATE contacts SET phones=?,manual=1 WHERE id=?",arrayOf(numbers.toString(),id))
            db.execSQL("DELETE FROM alias_identity WHERE contact=?",arrayOf(id))
            numbers.strings().mapNotNull{lookupKey(region,it)}.distinct().forEach {
                db.execSQL("INSERT INTO alias_identity VALUES(?,?)",arrayOf(id,it))
            }
        }
        if(b.has("favorite"))db.execSQL("UPDATE contacts SET favorite=? WHERE id=?",arrayOf(if(b.getBoolean("favorite"))1 else 0,id))
        if(b.has("preferredDeviceId")){
            val device=b.getString("preferredDeviceId")
            require(device.isEmpty() || allowed(device) && db.scalar("SELECT 1 FROM sources WHERE device=? AND contact=? AND deleted=0",device,id)!=null)
            db.execSQL("UPDATE contacts SET preferred=? WHERE id=?",arrayOf(device,id))
        }
    }
    fun run(owner:String,action:String,b:JSONObject):JSONObject = db.atomic {
        require(action in setOf("create","edit","delete","restore","merge","split"))
        val request=b.getString("requestId")
        require(validId(request))
        val fingerprint=PrivateStore.hash(owner+":"+action+":"+b.toString())
        db.rows("SELECT fingerprint,contact FROM changes WHERE id=?",request){it.getString(0) to it.getString(1)}.singleOrNull()?.let { previous ->
            require(previous.first==fingerprint)
            if(service.view(previous.second,allowed,includeDeleted=true,includeConflict=false)==null)throw NoSuchElementException()
            return@atomic JSONObject().put("id",previous.second).put("replayed",true)
        }
        val now=System.currentTimeMillis()
        var id=if(action=="create")newId() else b.getString("id")
        require(validId(id))
        val before=if(action=="create")null else revision(id,b.getLong("revision"),action=="restore")
        val targets=(b.optJSONArray("targets")?:JSONArray()).objects()
        require(targets.size<=32 && targets.map{it.getString("deviceId") to it.optString("rawId")}.distinct().size==targets.size)
        if(action=="delete")require(b.optBoolean("confirm")==true)
        if(action in setOf("merge","split","restore"))require(targets.isEmpty())
        val payload=contactData(b)
        val global=targets.isEmpty() || action=="create" || b.optBoolean("updateGlobal",false)
        if(global)allSourcesAllowed(id)
        when(action){
            "create"->{
                require(payload.optString("name").isNotBlank() || (payload.optJSONArray("numbers")?.length()?:0)>0)
                db.execSQL("INSERT INTO contacts(id,manual) VALUES(?,1)",arrayOf(id))
                applyGlobal(id,b,payload)
            }
            "edit"->if(global)applyGlobal(id,b,payload)
            "restore"->{
                // When the last Android source was deleted, restore only a local
                // overlay from the tombstone. A new Android copy needs an explicit job.
                if(db.scalar("SELECT 1 FROM sources WHERE contact=? AND deleted=0 LIMIT 1",id)==null)
                    applyGlobal(id,JSONObject(),JSONObject().put("name",before!!.getString("name")).put("numbers",before.getJSONArray("numbers")))
                db.execSQL("UPDATE contacts SET deleted=0 WHERE id=?",arrayOf(id))
            }
            "delete"->if(global)db.execSQL("UPDATE contacts SET deleted=1 WHERE id=?",arrayOf(id))
            "merge"->{
                val other=b.getString("otherId")
                require(id!=other)
                revision(other,b.getLong("otherRevision"))
                allSourcesAllowed(other)
                ensureNoPending(id);ensureNoPending(other)
                // Live source numbers are assembled from currently authorised sources
                // when the card is read. Never persist them as a global override as a
                // side effect of merging: later withdrawing a source must hide them.
                val explicit=db.rows("SELECT phones FROM contacts WHERE id IN (?,?) AND phones IS NOT NULL",id,other){
                    JSONArray(it.getString(0)).strings()
                }
                if(explicit.isNotEmpty()){
                    val combined=explicit.flatten().distinct()
                    require(combined.size<=32)
                    applyGlobal(id,JSONObject(),JSONObject().put("numbers",JSONArray(combined)))
                }
                db.execSQL("UPDATE sources SET contact=? WHERE contact=?",arrayOf(id,other))
                db.execSQL("UPDATE contacts SET deleted=1,revision=revision+1 WHERE id=?",arrayOf(other))
            }
            "split"->{
                val device=b.getString("deviceId");val raw=b.getString("rawId")
                require(allowed(device))
                ensureNoPending(id)
                require(db.scalar("SELECT 1 FROM sources WHERE device=? AND raw=? AND contact=? AND deleted=0",device,raw,id)!=null)
                val splitId=newId()
                db.execSQL("INSERT INTO contacts(id) VALUES(?)",arrayOf(splitId))
                db.execSQL("UPDATE sources SET contact=? WHERE device=? AND raw=?",arrayOf(splitId,device,raw))
                db.execSQL("UPDATE contacts SET revision=revision+1 WHERE id=?",arrayOf(id))
                id=splitId
            }
        }
        for(target in targets) {
            val device=target.getString("deviceId")
            if(!allowed(device))throw SecurityException()
            require(service.deviceAccess(device).optBoolean("contactsWrite")){"目标设备尚未授权通讯录写回"}
            val raw=target.optString("rawId")
            val op=target.getString("action")
            val expected=target.optString("revision")
            val targetPayload=if(op=="update" && target.has("fields")) {
                val fields=target.getJSONArray("fields").strings().toSet()
                require(fields.isNotEmpty() && fields.all{it in setOf("name","numbers") && payload.has(it)})
                JSONObject().apply{fields.forEach{put(it,payload.get(it))}}
            }else payload
            when(op){
                "create" -> {
                    require(action in setOf("create","edit") && raw.isBlank())
                    require(payload.optString("name").isNotBlank() || (payload.optJSONArray("numbers")?.length()?:0)>0)
                    require(db.scalar("SELECT 1 FROM sources WHERE device=? AND contact=? AND deleted=0",device,id)==null){"目标设备已有来源，请明确选择修改"}
                    require(db.scalar("SELECT 1 FROM jobs WHERE device=? AND contact=? AND action='create' AND state='queued'",device,id)==null)
                }
                "update","delete"->{
                    require((op=="update" && action=="edit" && payload.length()>0) || (op=="delete" && action=="delete"))
                    val source=db.rows("SELECT revision,payload FROM sources WHERE device=? AND raw=? AND contact=? AND deleted=0",device,raw,id){
                        it.getString(0) to JSONObject(it.getString(1))
                    }.singleOrNull()?:throw StaleContact()
                    if(source.first!=expected)throw StaleContact()
                    require(!source.second.optBoolean("readOnly")){"只读来源"}
                }
                else -> throw IllegalArgumentException("未知来源操作")
            }
            db.execSQL("INSERT INTO jobs(id,contact,device,raw,expected,action,payload,state,created) VALUES(?,?,?,?,?,?,?,'queued',?)",
                arrayOf(newId(),id,device,raw.ifEmpty{null},expected.ifEmpty{null},op,targetPayload.toString(),now))
        }
        db.execSQL("UPDATE contacts SET revision=revision+1 WHERE id=?",arrayOf(id))
        db.execSQL("INSERT INTO changes VALUES(?,?,?,?,?,?)",arrayOf(request,owner,action,fingerprint,id,now))
        JSONObject().put("id",id).put("queued",targets.size)
    }
    private fun ensureNoPending(id:String){
        require(db.scalar("SELECT 1 FROM jobs WHERE contact=? AND state='queued'",id)==null){"请等待来源写回结束"}
    }
}
