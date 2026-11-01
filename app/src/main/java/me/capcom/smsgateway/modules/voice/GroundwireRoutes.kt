package me.capcom.smsgateway.modules.voice

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import io.ktor.server.application.*
import io.ktor.server.response.*
import io.ktor.server.routing.*
import org.json.JSONObject

fun Route.groundwireRoutes(context:Context,owner:(ApplicationCall)->String,
    requireScope:suspend(ApplicationCall,String)->Boolean,lines:()->List<Map<String,Any>>,
    deviceAllowed:(ApplicationCall,String)->Boolean) {
    get("groundwire/routes") {
        if(!requireScope(call,"calls.dial"))return@get
        val config=GroundwireConfiguration(context)
        val live=lines().associateBy{it["lineId"]}
        val routes=config.routes().filter{deviceAllowed(call,it.deviceId) && live[it.lineId]?.let{row->GroundwireConfiguration.matches(it,row)}==true}
        call.respond(mapOf("routes" to routes.map{mapOf("lineId" to it.lineId,"prefix" to it.prefix)}))
    }
    // Read-only archive from older browser calling releases. Never creates a controller or migrates data.
    get("voice/history") {
        if(!requireScope(call,"calls.read"))return@get
        val file=context.getDatabasePath("commlink-voice.db")
        val rows=if(!file.exists())emptyList() else SQLiteDatabase.openDatabase(file.path,null,SQLiteDatabase.OPEN_READONLY).use{db->
            db.rawQuery("SELECT record FROM calls WHERE owner=? OR owner='' ORDER BY created DESC LIMIT 500",arrayOf(owner(call))).use{cursor->
                buildList {while(cursor.moveToNext()){
                    val record=JSONObject(cursor.getString(0))
                    if(deviceAllowed(call,record.optString("device")))add(listOf("id","lineId","device","slot","number","state","created","endedAt","answeredAt","direction")
                        .filter(record::has).associateWith{record.get(it)})
                }}
            }
        }
        call.respond(rows)
    }
    // Retired clients receive a clear response and cannot originate or control calls.
    suspend fun ApplicationCall.retired(){respond(io.ktor.http.HttpStatusCode.Gone,mapOf("error" to "网页通话已停用，请重新打开互联电话，使用 Groundwire 拨号"))}
    post("voice/web-session"){call.retired()}
    post("calls"){call.retired()}
    get("calls/{id}/state"){call.retired()}
    post("calls/{id}/{action}"){call.retired()}
}
