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
class PeerHub(val ctx: Context): SQLiteOpenHelper(ctx,"paired-phone.db",null,1) {
    private val gson=Gson()
    private val prefs=ctx.getSharedPreferences("peer-hub",0)
    private var lastSeen=-60000L
    private var active=JSONObject()
    val paired get()=prefs.contains("auth")
    override fun onCreate(db:SQLiteDatabase) {
        db.execSQL("CREATE TABLE history(id INTEGER PRIMARY KEY, row TEXT NOT NULL)")
        db.execSQL("CREATE TABLE sends(id TEXT PRIMARY KEY, row TEXT NOT NULL, sub INTEGER NOT NULL, phase TEXT NOT NULL)")
    }
    override fun onUpgrade(db:SQLiteDatabase,old:Int,new:Int)=Unit

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
        return prefs.edit().remove("invite").remove("expiry").putString("auth",digest).commit()
    }
    fun authorized(token:String):Boolean = token.length==64 && MessageDigest.isEqual(PrivateStore.hash(token).toByteArray(),prefs.getString("auth","")!!.toByteArray())
    @Synchronized fun forget(){
        prefs.edit().clear().commit()
        writableDatabase.delete("history",null,null); writableDatabase.delete("sends",null,null)
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
        writableDatabase.execSQL("INSERT INTO sends VALUES(?,?,?,?)",arrayOf(id,gson.toJson(row),active.getInt((sim-100).toString()),"queued"))
        return row
    }
    private fun finish(id:String,state:String) {
        val old=sent(id)?:return
        if(old.state in setOf("failed","delivered") || (old.state=="sent" && state !in setOf("sent","delivered")))return
        writableDatabase.execSQL("UPDATE sends SET row=?,phase=? WHERE id=? AND phase!='queued'",arrayOf(gson.toJson(old.copy(state=state)),if(state in setOf("delivered","failed","sent")) "done" else "handed",id))
    }
    @Synchronized fun sync(token:String,b:JSONObject):JSONObject {
        check(authorized(token))
        val slots=b.getJSONObject("slots");require(slots.keys().asSequence().all {it in setOf("1","2","3","4") && slots.getInt(it)>=0})
        val list=b.getJSONArray("rows");require(list.length()<=40)
        val db=writableDatabase;db.beginTransaction()
        try{
            for(i in 0 until list.length()){
                val r=gson.fromJson(list.getJSONObject(i).toString(),SmsRow::class.java)
                val id=r.id.removePrefix("sms:").toLong();require(id>0 && r.address.length<=256 && r.body.length<=200000)
                // Keep the original opaque ID prefix so existing clients retain message identity.
                // It identifies the paired peer, regardless of manufacturer or model.
                db.execSQL("INSERT OR REPLACE INTO history VALUES(?,?)",arrayOf(id,gson.toJson(r.copy(id="xia:"+id,sim=r.sim?.plus(100)))))
            }
            val states=b.getJSONObject("states");states.keys().forEach {id->val s=states.getString(id);if(s in setOf("accepted","unknown","sent","delivered","failed"))finish(id,s)}
            val response=JSONObject()
            val now=System.currentTimeMillis()
            val queued=rows("SELECT row FROM sends WHERE phase='queued' ORDER BY rowid LIMIT 1").firstOrNull()
            if(queued!=null){
                val sub=db.rawQuery("SELECT sub FROM sends WHERE id=?",arrayOf(queued.id)).use{it.moveToFirst();it.getInt(0)}
                db.execSQL("UPDATE sends SET phase='handed' WHERE id=?",arrayOf(queued.id))
                if(now-queued.date !in 0..20000 || slots.optInt((queued.sim!!-100).toString(),-1)!=sub)finish(queued.id,"failed")
                else {finish(queued.id,"unknown");response.put("job",JSONObject(gson.toJson(queued)).put("sub",sub))}
            }
            response.put("inspect",JSONArray(rows("SELECT row FROM sends WHERE phase='handed' ORDER BY rowid DESC LIMIT 100").map{it.id}))
            db.setTransactionSuccessful()
            if(slots.toString()!=prefs.getString("slots",null))prefs.edit().putString("slots",slots.toString()).apply()
            active=slots;lastSeen=SystemClock.elapsedRealtime()
            return response
        }finally{db.endTransaction()}
    }
    companion object {
        @Volatile private var instance:PeerHub?=null
        @Synchronized fun get(ctx:Context)=instance?:PeerHub(ctx.applicationContext).also{instance=it}
    }
}
