package me.capcom.smsgateway.modules.directory

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.os.SystemClock
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.Executors

/** Only small durable deltas travel with a peer heartbeat. Provider I/O happens off
 * the SMS loop. Each pairing credential has its own journal and acknowledgements. */
class PeerDirectoryAgent(context:Context, private val link:String) {
    private val ctx=context.applicationContext
    private val provider=DirectoryProvider(ctx)
    private val db get()=DirectoryService.get(ctx).database.writableDatabase
    private val local = link == LOCAL_LINK

    private fun stillLinked(): Boolean {
        if(local)return ctx.getSharedPreferences("iphone",0).getBoolean("enabled",false)
        val prefs=ctx.getSharedPreferences("peer-client",0)
        if(!prefs.getBoolean("enabled",false))return false
        val token=me.capcom.smsgateway.modules.iphone.SecretVault(ctx).get("peer-token")?:return false
        return me.capcom.smsgateway.modules.iphone.PrivateStore.hash(token.toString(Charsets.UTF_8))==link
    }

    fun prepare(): JSONObject {
        val canRead=provider.allowed("contacts.read")
        val canWrite=provider.allowed("contacts.write")
        val canCalls=provider.allowed("calls.read")
        if(!canCalls && db.scalar("SELECT 1 FROM call_baselines WHERE link=?",link)!=null)
            db.execSQL("DELETE FROM call_baselines WHERE link=?",arrayOf(link))
        scheduleScan(canRead,canCalls)
        val out=JSONObject().put("contacts",canRead).put("write",canWrite).put("calls",canCalls)
        val events=JSONArray()
        val records=db.rows("SELECT kind,raw,payload,serial,gone FROM observed WHERE link=? AND dirty=1 AND ((kind='contact' AND ?='1') OR (kind='call' AND ?='1')) ORDER BY serial LIMIT 24",
            link,if(canRead)"1" else "0",if(canCalls)"1" else "0"){ c ->
            JSONObject().put("kind",c.getString(0)).put("raw",c.getString(1)).put("seq",c.getLong(3)).apply {
                if(c.getInt(4)==0)put("record",JSONObject(c.getString(2)))
            }
        }
        var bytes=0
        for(record in records){
            val size=record.toString().toByteArray().size
            if(bytes+size>240_000 && events.length()>0)break
            events.put(record);bytes+=size
        }
        return out.put("events",events).put("results",JSONArray(db.rows(
            "SELECT result FROM applied WHERE link=? AND acked=0 LIMIT 20",link){JSONObject(it.getString(0))}))
    }

    fun accept(response:JSONObject) {
        val acks=response.optJSONArray("ack")?:JSONArray()
        db.atomic {
            for(a in acks.objects()){
                db.execSQL("UPDATE observed SET dirty=0 WHERE link=? AND kind=? AND raw=? AND serial=?",
                    arrayOf(link,a.getString("kind"),a.getString("raw"),a.getLong("seq")))
            }
            (response.optJSONArray("accepted")?:JSONArray()).strings().forEach { id ->
                db.execSQL("UPDATE applied SET acked=1 WHERE link=? AND id=?",arrayOf(link,id))
            }
        }
        val job=response.optJSONObject("job")?:return
        val id=job.getString("id")
        val key=link+":"+id
        synchronized(inFlight){if(!inFlight.add(key))return}
        executor.execute {
            try{
                if(!stillLinked())return@execute
                if(db.scalar("SELECT id FROM applied WHERE link=? AND id=?",link,id)!=null){
                    db.execSQL("UPDATE applied SET acked=0 WHERE link=? AND id=?",arrayOf(link,id))
                } else {
                    val result=provider.apply(link,job,::stillLinked){
                        val values=android.content.ContentValues().apply{put("link",link);put("id",id)}
                        db.insertWithOnConflict("attempts",null,values,SQLiteDatabase.CONFLICT_IGNORE)!=-1L
                    }
                    db.execSQL("INSERT OR IGNORE INTO applied(link,id,result) VALUES(?,?,?)",arrayOf(link,id,result.toString()))
                    synchronized(scans){scans.remove(link)}
                }
            }catch(_:Exception){ /* Retry the same operation UUID on the next offer. */ }
            finally { synchronized(inFlight){inFlight.remove(key)} }
        }
    }

    private fun scheduleScan(contacts:Boolean,calls:Boolean) {
        if(!contacts && !calls)return
        val now=SystemClock.elapsedRealtime()
        synchronized(scans){
            if(now-(scans[link]?:-60_000L)<30_000L)return
            synchronized(inFlight){if(!inFlight.add(link))return}
            scans[link]=now
        }
        executor.execute {
            try {
                if(!stillLinked())return@execute
                if(contacts)runCatching{scan("contact")}
                if(calls)runCatching{scan("call")}
            } finally { synchronized(inFlight){inFlight.remove(link)} }
        }
    }

    private data class Delta(val raw:String,val version:String,val body:String)
    private fun scan(kind:String) {
        val start=System.currentTimeMillis()
        val baseline=if(kind=="call")db.scalar("SELECT started FROM call_baselines WHERE link=?",link)?.toLong() else null
        val old=db.rows("SELECT raw,version FROM observed WHERE link=? AND kind=? AND gone=0",link,kind){ it.getString(0) to it.getString(1) }.toMap()
        val seen=HashSet<String>()
        val updates=ArrayList<Delta>()
        val collect:(String,String,JSONObject?)->Unit={raw,version,data->
            seen.add(raw)
            if(version!=old[raw] && data!=null){
                if(kind=="call" && baseline!=null && data.optString("type")=="missed" && raw !in old &&
                    data.optLong("date") in maxOf(baseline,start-3600000L)..start)
                    data.put("notifyMissed",true)
                if(kind=="contact") {
                    data.put("observedAt",start)
                    // Leave a recoverable, read-only projection instead of letting a
                    // single pathological native card consume the SMS sync body budget.
                    if(data.toString().toByteArray().size>160000){
                        data.remove("photo")
                        data.put("name",data.optString("name").take(200)).put("readOnly",true)
                        data.put("numbers",JSONArray(data.getJSONArray("numbers").strings().take(64).map{it.take(96)}))
                        data.put("partial",true)
                    }
                }
                updates.add(Delta(raw,version,data.toString()))
            }
        }
        if(kind=="contact")provider.scanContacts(old,collect) else provider.scanCalls(collect)
        // A provider can return a successful but empty cursor during unlock/account
        // recovery. Never infer a wipe of the whole address book or call log from it.
        val removed=if(seen.isEmpty() && old.isNotEmpty()){
            if(kind!="contact")return
            val retired=provider.deletedContacts()
            db.rows("SELECT raw,payload FROM observed WHERE link=? AND kind='contact' AND gone=0",link){
                it.getString(0) to JSONObject(it.getString(1))
            }.filter { (_,contact)->
                val timestamp=retired[contact.optString("contactId")]?:return@filter false
                val observedAt=contact.optLong("observedAt",Long.MAX_VALUE)
                timestamp>=observedAt
            }.map{it.first}
        }else old.keys-seen
        if(!provider.allowed(if(kind=="contact")"contacts.read" else "calls.read") || !stillLinked())return
        if(updates.isEmpty()&&removed.isEmpty()&&(kind!="call"||baseline!=null))return
        db.atomic {
            if(kind=="call" && baseline==null)db.execSQL("INSERT OR IGNORE INTO call_baselines VALUES(?,?)",arrayOf(link,start))
            var seq=db.scalar("SELECT seq FROM sequences WHERE link=?",link)?.toLong()?:0L
            for(delta in updates)db.execSQL("INSERT OR REPLACE INTO observed VALUES(?,?,?,?,?,?,1,0)",arrayOf(link,kind,delta.raw,delta.version,delta.body,++seq))
            for(raw in removed)db.execSQL("UPDATE observed SET gone=1,dirty=1,payload='{}',serial=? WHERE link=? AND kind=? AND raw=?",arrayOf(++seq,link,kind,raw))
            db.execSQL("INSERT OR REPLACE INTO sequences VALUES(?,?)",arrayOf(link,seq))
        }
    }

    companion object {
        internal const val LOCAL_LINK="local-directory"
        private val executor=Executors.newSingleThreadExecutor()
        private val scans=HashMap<String,Long>()
        private val inFlight=HashSet<String>()
    }
}
