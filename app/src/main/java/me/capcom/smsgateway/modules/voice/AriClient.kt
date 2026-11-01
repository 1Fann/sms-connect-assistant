package me.capcom.smsgateway.modules.voice

import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import org.json.JSONArray
import java.util.concurrent.TimeUnit

/** Only the local Asterisk REST interface. Redirects and implicit POST retries are disabled. */
internal data class AriAccess(val port:Int,val user:String,val password:String)
internal open class AriClient(private val access:()->AriAccess) {
    constructor(config:VoiceConfiguration):this({AriAccess(config.ariPort,config.ariUser,config.secret("voice-ari"))})
    private val http=OkHttpClient.Builder().followRedirects(false).followSslRedirects(false)
        .proxy(java.net.Proxy.NO_PROXY).retryOnConnectionFailure(false)
        .callTimeout(4,TimeUnit.SECONDS).pingInterval(15,TimeUnit.SECONDS).build()
    private fun request(path:List<String>,query:Map<String,String> = emptyMap()):Request.Builder{
        val credentials=access()
        val url=HttpUrl.Builder().scheme("http").host("127.0.0.1").port(credentials.port).addPathSegment("ari")
        path.forEach(url::addPathSegment);query.forEach(url::addQueryParameter)
        return Request.Builder().url(url.build()).header("Authorization",Credentials.basic(credentials.user,credentials.password))
    }
    open fun ws(listener:WebSocketListener):WebSocket=http.newWebSocket(request(listOf("events"),mapOf("app" to APP)).build(),listener)
    open fun send(method:String,path:List<String>,args:Map<String,String> = emptyMap(),missingOk:Boolean=false):String {
        val body=if(method in setOf("POST","PUT")) byteArrayOf().toRequestBody("application/json".toMediaType()) else null
        return http.newCall(request(path,args).method(method,body).build()).execute().use {
            if(it.code==404 && missingOk)return ""
            if(!it.isSuccessful)throw VoiceFault(503,"Asterisk 操作未确认（HTTP "+it.code+"）")
            it.body?.string().orEmpty()
        }
    }
    fun endpoint(name:String):EndpointState{
        val data=send("GET",listOf("endpoints","PJSIP",name),missingOk=true)
        val obj=JSONObject(data.ifBlank{"{}"})
        return EndpointState(obj.optString("state")=="online",obj.optJSONArray("channel_ids")?.length() ?: -1)
    }
    fun createBridge(id:String){send("POST",listOf("bridges",id),mapOf("type" to "mixing,proxy_media"))}
    fun add(id:String,ch:String){send("POST",listOf("bridges",id,"addChannel"),mapOf("channel" to ch))}
    fun remove(id:String,ch:String){send("POST",listOf("bridges",id,"removeChannel"),mapOf("channel" to ch),true)}
    fun closeBridge(id:String){send("DELETE",listOf("bridges",id),missingOk=true)}
    fun drop(ch:String){send("DELETE",listOf("channels",ch),missingOk=true)}
    fun channel(ch:String):JSONObject?=send("GET",listOf("channels",ch),missingOk=true).takeIf{it.isNotBlank()}?.let(::JSONObject)
    fun answer(ch:String){send("POST",listOf("channels",ch,"answer"))}
    fun mute(ch:String,enabled:Boolean){send(if(enabled)"POST" else "DELETE",listOf("channels",ch,"mute"),mapOf("direction" to "in"))}
    fun createLeg(ch:String,endpoint:String,role:String,id:String){
        send("POST",listOf("channels","create"),mapOf("channelId" to ch,"endpoint" to "PJSIP/"+endpoint,"app" to APP,"appArgs" to role+","+id))
    }
    fun variable(ch:String,key:String,value:String){send("POST",listOf("channels",ch,"variable"),mapOf("variable" to key,"value" to value))}
    fun dial(ch:String){send("POST",listOf("channels",ch,"dial"),mapOf("timeout" to "30"))}
    fun packets(ch:String):RtpSample? {
        val r=JSONObject(send("GET",listOf("channels",ch,"rtp_statistics"),missingOk=true).ifBlank{"{}"})
        val incoming=r.optLong("rxcount",-1); val outgoing=r.optLong("txcount",-1)
        return if(incoming>=0 && outgoing>=0)RtpSample(incoming,outgoing) else null
    }
    companion object {const val APP="commlink"}
}
internal data class EndpointState(val online:Boolean,val channels:Int)
