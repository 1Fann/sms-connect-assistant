package me.capcom.smsgateway.modules.voice

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import org.json.JSONObject

/** Dedicated, additive journal; it never opens or migrates an SMS database. */
internal class VoiceJournal(context:Context,database:String="commlink-voice.db"):SQLiteOpenHelper(context,database,null,1){
    override fun onCreate(db:SQLiteDatabase){
        db.execSQL("CREATE TABLE calls(id TEXT PRIMARY KEY, device TEXT NOT NULL, owner TEXT NOT NULL, active INTEGER NOT NULL, created INTEGER NOT NULL, record TEXT NOT NULL)")
        db.execSQL("CREATE UNIQUE INDEX live_gateway ON calls(device) WHERE active=1")
        db.execSQL("CREATE TABLE events(seq INTEGER PRIMARY KEY AUTOINCREMENT,call_id TEXT NOT NULL,at INTEGER NOT NULL,event TEXT NOT NULL,channel TEXT NOT NULL)")
        db.execSQL("CREATE TABLE transfers(id TEXT PRIMARY KEY,call_id TEXT NOT NULL,at INTEGER NOT NULL)")
    }
    override fun onUpgrade(db:SQLiteDatabase,old:Int,new:Int){error("不支持的语音日志版本")}
    fun put(c:JSONObject){
        val db=writableDatabase
        val cv=ContentValues().apply {
            put("id",c.getString("id"));put("device",c.getString("device"));put("owner",c.getString("owner"))
            put("active",if(c.phase==CallPhase.CALL_ENDED)0 else 1);put("created",c.getLong("created"));put("record",c.toString())
        }
        if(db.update("calls",cv,"id=?",arrayOf(c.getString("id")))==0)db.insertOrThrow("calls",null,cv)
    }
    private fun list(sql:String,args:Array<String>?=null)=readableDatabase.rawQuery(sql,args).use{
        buildList {while(it.moveToNext())add(JSONObject(it.getString(0)))}
    }
    fun get(id:String)=list("SELECT record FROM calls WHERE id=?",arrayOf(id)).firstOrNull()
    fun active()=list("SELECT record FROM calls WHERE active=1")
    fun history(owner:String)=list("SELECT record FROM calls WHERE owner=? OR owner='' ORDER BY created DESC LIMIT 500",arrayOf(owner))
    fun event(c:JSONObject,type:String,channel:String=""){
        writableDatabase.execSQL("INSERT INTO events(call_id,at,event,channel) VALUES(?,?,?,?)",arrayOf(c.getString("id"),System.currentTimeMillis(),type,channel))
    }
    fun seenRequest(id:String,call:String):Boolean {
        val existing=readableDatabase.rawQuery("SELECT call_id FROM transfers WHERE id=?",arrayOf(id)).use{if(it.moveToFirst())it.getString(0)else null}
        if(existing!=null && existing!=call)throw VoiceFault(409,"接续请求 ID 冲突")
        return existing!=null
    }
    fun beginTransfer(c:JSONObject,id:String){
        val db=writableDatabase;db.beginTransaction()
        try{
            db.execSQL("INSERT INTO transfers(id,call_id,at) VALUES(?,?,?)",arrayOf(id,c.getString("id"),System.currentTimeMillis()))
            put(c);event(c,"HANDOFF_REQUESTED");db.setTransactionSuccessful()
        }finally{db.endTransaction()}
    }
}
internal val JSONObject.phase get()=CallPhase.valueOf(getString("state"))
internal fun JSONObject.channel(role:String):String?=optString(role).takeIf{it.isNotBlank()}
internal fun JSONObject.visible():Map<String,Any> = listOf("id","lineId","device","number","state","reason","created","endedAt","answeredAt","direction","handoffAt","nativeAt").filter(::has).associateWith{get(it)}
