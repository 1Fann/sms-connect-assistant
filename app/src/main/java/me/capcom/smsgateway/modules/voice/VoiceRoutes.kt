package me.capcom.smsgateway.modules.voice

import android.content.Context
import io.ktor.http.*
import io.ktor.server.application.*
import io.ktor.server.request.*
import io.ktor.server.response.*
import io.ktor.server.routing.*
import io.ktor.utils.io.readAvailable
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import org.json.JSONObject
import java.io.ByteArrayOutputStream

private suspend fun ApplicationCall.voiceBody():JSONObject{
    if(!request.contentType().match(ContentType.Application.Json))throw VoiceFault(415,"请提交 JSON")
    val channel=receiveChannel()
    val out=ByteArrayOutputStream()
    val buf=ByteArray(512)
    withTimeout(5000){while(true){
        val n=channel.readAvailable(buf,0,buf.size)
        if(n<0)break
        if(out.size()+n>4096)throw VoiceFault(413,"请求过大")
        out.write(buf,0,n)
    }}
    return try{JSONObject(out.toString("UTF-8"))}catch(_:Exception){throw VoiceFault(400,"请求格式有误")}
}
private suspend fun ApplicationCall.replyVoice(action:suspend ()->Any){
    try{respond(withContext(Dispatchers.IO){action()})}
    catch(e:VoiceFault){respond(HttpStatusCode.fromValue(e.code),mapOf("error" to e.message))}
}

fun Route.voiceRoutes(context:Context,owner:(ApplicationCall)->String,
                      requireScope:suspend (ApplicationCall,String)->Boolean,
                      resolveLine:(ApplicationCall,String)->VoiceLine?,displayName:(String)->String?,
                      liveLine:(String)->VoiceLine?={null},
                      deviceAllowed:(ApplicationCall,String)->Boolean={_,_->false}){
    val runtime=VoiceRuntime.get(context)
    runtime.liveLine=liveLine
    runtime.resolveName=displayName
    suspend fun authorizedCall(c:ApplicationCall):Pair<String,String>{
        val id=c.parameters["id"].orEmpty()
        val installation=owner(c)
        val record=runtime.read(id,installation)
        if(resolveLine(c,record["lineId"].toString())==null)throw VoiceFault(403,"该线路未获授权")
        return id to installation
    }
    get("voice/status"){
        if(requireScope(call,"calls.dial"))call.replyVoice{
            runtime.status { device->deviceAllowed(call,device) }
        }
    }
    post("voice/web-session"){
        if(requireScope(call,"calls.dial"))call.replyVoice{runtime.session()}
    }
    get("voice/history"){
        if(requireScope(call,"calls.read"))call.replyVoice{runtime.history(owner(call)){line->resolveLine(call,line)!=null}}
    }
    post("calls"){
        if(requireScope(call,"calls.dial"))call.replyVoice{
            val b=call.voiceBody()
            val line=resolveLine(call,b.optString("lineId"))?:throw VoiceFault(403,"该线路不可用或未获授权")
            runtime.create(owner(call),line,b.optString("number"),b.optString("id"),b.optBoolean("autoHandoff",false))
        }
    }
    get("calls/{id}/state"){
        if(requireScope(call,"calls.dial"))call.replyVoice{val (id,o)=authorizedCall(call);runtime.read(id,o)}
    }
    post("calls/{id}/hangup"){
        if(requireScope(call,"calls.dial"))call.replyVoice{val (id,o)=authorizedCall(call);runtime.hangup(id,o)}
    }
    post("calls/{id}/handoff"){
        if(requireScope(call,"calls.dial"))call.replyVoice{
            val (id,o)=authorizedCall(call)
            runtime.handoff(id,o,call.voiceBody().optString("requestId"))
        }
    }
    post("calls/{id}/resume"){
        if(requireScope(call,"calls.dial"))call.replyVoice{
            val (id,o)=authorizedCall(call)
            runtime.resumeWeb(id,o)
        }
    }
}
