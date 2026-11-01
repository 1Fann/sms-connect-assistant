package me.capcom.smsgateway.modules.voice

import android.content.Context
import android.os.SystemClock
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit

/** The Android PBX controller owns both legs. Browser SIP INVITEs only redeem one short-lived ticket.
 * No request from the browser selects a trunk, supplies channel IDs or passes arbitrary ARI arguments.
 */
class VoiceRuntime internal constructor(context:Context,
    val config:VoiceConfiguration=VoiceConfiguration(context.applicationContext),
    private val journal:VoiceJournal=VoiceJournal(context.applicationContext),
    private val ari:AriClient=AriClient(config),
    private val now:()->Long=System::currentTimeMillis,
    private val dialGrant:(String,String,Long)->Boolean={owner,device,time->installationAllowed(context.applicationContext,owner,device,time)}
) {
    private val ctx=context.applicationContext
    private val worker=Executors.newSingleThreadScheduledExecutor()
    private var task:ScheduledFuture<*>?=null
    private var socket:WebSocket?=null
    private var nextConnect=0L
    @Volatile var lastProblem:String=""
        private set
    private var connected=false
    private var lastProbe=0L
    private var online:Set<String> = emptySet()
    private var occupied:Set<String> = emptySet()
    @Volatile private var snapshot:Map<String,Any> = emptyMap()
    @Volatile internal var liveLine:(String)->VoiceLine?={null}
    @Volatile internal var resolveName:(String)->String?={null}
    private val samples=mutableMapOf<String,Pair<RtpSample,RtpSample>>()
    private var testLeg:String?=null
    private var testDeadline=0L

    @Synchronized fun start(){
        if(task!=null)return
        task=worker.scheduleWithFixedDelay({runCatching{synchronized(this){tick()}}},0,2,TimeUnit.SECONDS)
    }
    @Synchronized fun stop(){
        task?.cancel(false);task=null;socket?.cancel();socket=null;connected=false;online=emptySet()
        snapshot=emptyMap()
    }
    @Synchronized fun hasActive()=journal.active().isNotEmpty()
    fun reconfigure(){stop();start()}
    private fun connect(){
        nextConnect=SystemClock.elapsedRealtime()+10_000
        socket=ari.ws(object:WebSocketListener(){
            override fun onOpen(webSocket:WebSocket,response:Response){synchronized(this@VoiceRuntime){
                if(socket!==webSocket){webSocket.cancel();return}
                connected=true;lastProbe=0
            }}
            override fun onMessage(webSocket:WebSocket,text:String){
                if(text.length>128*1024)return
                synchronized(this@VoiceRuntime){
                    if(webSocket===socket && connected)runCatching{handle(JSONObject(text))}
                }
            }
            override fun onFailure(webSocket:WebSocket,t:Throwable,response:Response?){
                lastProblem=if(response==null)"ARI 连接失败，请核对监听、模块与本机端口" else "ARI 未接受事件连接（HTTP "+response.code+"）"
                disconnected(webSocket)
            }
            override fun onClosing(webSocket:WebSocket,code:Int,reason:String){webSocket.close(code,null);disconnected(webSocket)}
        })
    }
    @Synchronized private fun disconnected(ws:WebSocket){
        if(socket!==ws)return
        socket=null;connected=false;online=emptySet()
    }
    @Synchronized internal fun tick(){
        if(!config.enabled)return
        val mono=SystemClock.elapsedRealtime()
        if(socket==null && mono>=nextConnect)connect()
        if(!connected)return
        testLeg?.let { if(now()>=testDeadline){ari.drop(it);testLeg=null} }
        if(lastProbe==0L||mono-lastProbe>10_000){
            val states=(config.bindings().map{it.endpoint}+config.nativeUser)
                .associateWith{runCatching{ari.endpoint(it)}.getOrDefault(EndpointState(false,-1))}
            online=states.filterValues{it.online}.keys
            occupied=states.filterValues{it.channels!=0}.keys
            lastProbe=mono
        }
        snapshot=status()
        for(call in journal.active()){
            runCatching{poll(call)}
        }
    }
    @Synchronized fun status(allowed:(String)->Boolean={true}):Map<String,Any>{
        val busy=journal.active().map{it.getString("device")}.toSet()
        val bindings=config.bindings().filter{allowed(it.device)}
        val ready=config.enabled && connected && bindings.any{it.endpoint in online}
        val reason=when {
            !config.enabled -> "主节点尚未启用语音，请在安卓的 SIP 服务设置完成配置"
            !connected -> "本机 Asterisk ARI / Stasis 事件连接未就绪"
            bindings.isEmpty() -> "尚未绑定已验证选卡能力的语音网关"
            !ready -> "语音网关未向 PBX 注册"
            else -> ""
        }
        return mapOf("ready" to ready,"reason" to reason,"groundwire" to mapOf("registered" to (config.nativeUser in online)),
            "gateways" to bindings.map{mapOf("deviceId" to it.device,"registered" to (it.endpoint in online),"busy" to (it.device in busy||it.endpoint in occupied))})
    }
    fun adminStatus():Map<String,Any> = snapshot.ifEmpty{
        mapOf("ready" to false,"reason" to if(config.enabled)"等待本机 ARI 状态" else "主节点尚未启用语音")
    }
    @Synchronized fun changeConfig(save:()->Unit){
        check(!hasActive()&&testLeg==null){"通话资源正在使用，请在结束后修改"}
        save();reconfigure()
    }
    @Synchronized fun session():Map<String,Any>{
        if(!connected||!config.enabled)throw VoiceFault(503,"语音后台未就绪")
        return mapOf("uri" to "sip:"+config.webUser+"@"+config.domain,"wss" to config.wss,"username" to config.webUser,
            "password" to config.secret("voice-web"),"iceServers" to config.iceServers())
    }
    @Synchronized fun testNative(){
        if(!connected||!ari.endpoint(config.nativeUser).let{it.online && it.channels==0})throw VoiceFault(503,"Groundwire 端点未就绪")
        if(testLeg!=null || journal.active().isNotEmpty())throw VoiceFault(409,"有通话正在进行")
        val ch="cl-test-"+uuid()
        testLeg=ch;testDeadline=now()+25_000
        try{
            ari.createLeg(ch,config.nativeUser,"test","diagnostic")
            ari.variable(ch,"TIMEOUT(absolute)","30")
            ari.variable(ch,"CALLERID(name)","CommLink Test")
            ari.dial(ch)
        }catch(_:Exception){runCatching{ari.drop(ch)};throw VoiceFault(503,"原生测试来电未确认")}
    }
    private fun binding(line:VoiceLine):GatewayBinding{
        if(!VoicePolicy.matchesBinding(line,liveLine(line.id)))throw VoiceFault(409,"线路离线、换卡或不支持明确选卡")
        val b=config.bindings().singleOrNull{it.device==line.deviceId}?:throw VoiceFault(409,"该设备没有已验证的语音网关")
        val state=ari.endpoint(b.endpoint)
        if(!state.online)throw VoiceFault(503,"该设备的语音网关离线")
        if(state.channels!=0)throw VoiceFault(409,"网关占线或忙闲状态未知")
        return b
    }
    // An installation may be revoked between HTTP ticket issuance and the actual SIP INVITE.
    private fun checkInstallation(c:JSONObject){
        val principal=c.optString("owner")
        if(principal.isEmpty() && c.optString("direction")=="incoming")return
        if(!dialGrant(principal,c.getString("device"),now()))throw VoiceFault(403,"该安装已失去拨号或线路授权")
    }
    @Synchronized fun create(owner:String,line:VoiceLine,number:String,requestId:String,auto:Boolean):Map<String,Any>{
        val id=canonicalCallId(requestId)
        val destination=VoicePolicy.number(number)
        if(!VoicePolicy.allowedNumber(destination,config.dialRules))throw VoiceFault(403,"号码未列入主节点允许拨号的范围")
        if(android.telephony.PhoneNumberUtils.isEmergencyNumber(destination) || destination in setOf("110","112","119","120","911"))
            throw VoiceFault(400,"不支持紧急呼叫")
        val previous=journal.get(id)
        if(previous!=null){
            if(previous.optString("owner")!=owner || previous.optString("number")!=destination || previous.optString("lineId")!=line.id)
                throw VoiceFault(409,"呼叫请求 ID 冲突")
            return reply(previous)
        }
        if(!connected||!config.enabled)throw VoiceFault(503,"语音后台未就绪")
        val route=binding(line)
        if(journal.active().any{it.getString("device")==line.deviceId})throw VoiceFault(409,"这台设备正在通话或接续")
        val call=record(id,owner,line,destination,"outgoing").put("endpoint",route.endpoint).put("ticket",uuid())
            .put("auto",auto).put("deadline",now()+30_000)
        journal.put(call);journal.event(call,"RESERVED")
        return reply(call)
    }
    private fun reply(c:JSONObject):Map<String,Any>{
        val map=c.visible().toMutableMap()
        if(c.phase==CallPhase.WAITING_WEB && c.has("ticket") && now()<c.getLong("deadline"))map["target"]="sip:cl-"+c.getString("ticket")+"@"+config.domain
        return map
    }
    private fun record(id:String,owner:String,line:VoiceLine,number:String,direction:String) = JSONObject()
        .put("id",id).put("owner",owner).put("device",line.deviceId).put("lineId",line.id).put("slot",line.slot)
        .put("sub",line.subscriptionId).put("number",number).put("direction",direction).put("state","WAITING_WEB")
        .put("created",now()).put("bridge","cl-"+id)
    private fun owned(id:String,owner:String):JSONObject{
        val c=journal.get(canonicalCallId(id))?:throw VoiceFault(404,"未找到通话")
        if(owner.isBlank()||c.getString("owner")!=owner)throw VoiceFault(403,"此通话不属于当前安装")
        return c
    }
    @Synchronized fun read(id:String,owner:String)=owned(id,owner).visible()
    @Synchronized fun history(owner:String,allowed:(String)->Boolean)=journal.history(owner).filter{allowed(it.optString("lineId"))}.map{it.visible()}
    @Synchronized fun hangup(id:String,owner:String):Map<String,Any>{
        val c=owned(id,owner);if(c.phase!=CallPhase.CALL_ENDED)finish(c,"用户挂断");return c.visible()
    }
    @Synchronized fun handoff(id:String,owner:String,request:String):Map<String,Any>{
        val c=owned(id,owner)
        if(journal.seenRequest(canonicalCallId(request),id))return c.visible()
        if(c.phase !in setOf(CallPhase.WEB_ACTIVE,CallPhase.HANDOFF_FAILED,CallPhase.RECOVERING)||c.optBoolean("finishing"))
            throw VoiceFault(409,"目前不能接续这通电话")
        beginNative(c,request);return c.visible()
    }
    private fun beginNative(c:JSONObject,request:String){
        checkInstallation(c)
        if(!connected||!ari.endpoint(config.nativeUser).let{it.online&&it.channels==0})throw VoiceFault(503,"Groundwire SIP 端点离线或忙碌")
        val leg="cl-native-"+uuid()
        c.put("state",CallPhase.HANDOFF_REQUESTED.name).put("native",leg).put("handoffAt",now()).put("deadline",now()+35_000)
        c.remove("reason")
        journal.beginTransfer(c,request)
        try{
            ari.createLeg(leg,config.nativeUser,"native",c.getString("id"))
            val name=runCatching{resolveName(c.getString("number"))}.getOrNull().orEmpty().filterNot{it.isISOControl()}.take(80)
            if(name.isNotEmpty())ari.variable(leg,"CALLERID(name)",name)
            ari.variable(leg,"CALLERID(num)",c.getString("number"))
            ari.dial(leg)
        }catch(e:Exception){
            rollbackNative(c,"原生通道建立失败");throw VoiceFault(503,"原生通道建立失败")
        }
    }
    private fun handle(event:JSONObject){
        val type=event.optString("type")
        if(type=="ApplicationReplaced"){stop();return}
        val channel=event.optJSONObject("channel") ?: return
        val ch=channel.optString("id"); if(ch.isEmpty())return
        if(ch==testLeg){
            if(type in setOf("StasisEnd","ChannelDestroyed"))testLeg=null
            else if(channel.optString("state")=="Up"){ari.drop(ch);testLeg=null}
            return
        }
        val active=journal.active()
        val record=active.firstOrNull{listOf("outside","web","native").any{key->it.channel(key)==ch}}
        if(record!=null){
            if(type in setOf("StasisStart","StasisEnd","ChannelDestroyed","ChannelStateChange","ChannelEnteredBridge","ChannelLeftBridge"))
                journal.event(record,type+":"+channel.optString("state"),ch)
            when(type){
                "StasisStart","ChannelStateChange" -> onChannel(record,ch,channel.optString("state"))
                "StasisEnd","ChannelDestroyed" -> lost(record,ch)
            }
            return
        }
        if(type!="StasisStart")return
        val args=event.optJSONArray("args")
        val endpoint=VoicePolicy.endpoint(channel.optString("name"))
        if(args?.optString(0)=="web" && endpoint==config.webUser){
            val target=channel.optJSONObject("dialplan")?.optString("exten").orEmpty()
            val c=active.singleOrNull{it.phase==CallPhase.WAITING_WEB && "cl-"+it.optString("ticket")==target && target.length==35 && now()-it.getLong("created") in 0..30_000}
            if(c!=null){webJoined(c,ch);return}
        }
        if(args?.optString(0)=="incoming" && endpoint!=null){
            val b=config.bindings().singleOrNull{it.endpoint==endpoint}
            if(b!=null && !active.any{it.optString("device")==b.device}){
                // Multi-slot incoming metadata must be supplied by a trusted route. An ambiguous slot never guesses.
                val lineId=args.optString(1).takeIf{it.isNotBlank()} ?: b.incomingLine
                val line=lineId?.let{liveLine(it)}
                if(line!=null && line.online && line.deviceId==b.device){
                    val caller=channel.optJSONObject("caller")?.optString("number").orEmpty().take(100)
                    val c=record(UUID.randomUUID().toString(),"",line,caller,"incoming").put("outside",ch)
                    journal.put(c);journal.event(c,"INCOMING",ch)
                    try{
                        ari.variable(ch,"TIMEOUT(absolute)","14400")
                        ari.createBridge(c.getString("bridge"))
                        beginNative(c,UUID.randomUUID().toString())
                    }catch(_:Exception){finish(c,"未能转入原生来电")}
                    return
                }
            }
        }
        // Fail closed for untrusted tickets or calls from an unrecognised endpoint.
        ari.drop(ch)
    }
    private fun webJoined(c:JSONObject,web:String){
        val line=VoiceLine(c.getString("lineId"),c.getString("device"),c.getInt("slot"),true,c.getInt("sub"))
        val external="cl-out-"+uuid()
        c.remove("ticket");c.put("web",web).put("outside",external).put("deadline",now()+45_000)
        phase(c,CallPhase.DIALING)
        try{
            checkInstallation(c)
            val b=binding(line);if(b.endpoint!=c.getString("endpoint"))throw VoiceFault(409,"线路绑定已变更")
            ari.createBridge(c.getString("bridge"))
            ari.createLeg(external,b.endpoint,"outside",c.getString("id"))
            ari.variable(external,"PJSIP_HEADER(add,X-VSA-Dial)",c.getString("number"))
            ari.variable(external,"PJSIP_HEADER(add,X-VSA-SIM)",line.slot.toString())
            ari.variable(external,"TIMEOUT(absolute)","14400")
            ari.send("POST",listOf("channels",web,"ring"))
            ari.dial(external) // Sole cellular origination site. Never repeated after a network failure.
        }catch(_:Exception){finish(c,"外线建立未确认，未重拨")}
    }
    private fun onChannel(c:JSONObject,ch:String,state:String){
        if(c.optBoolean("finishing"))return
        if(ch==c.channel("outside") && c.phase==CallPhase.DIALING && state=="Up"){
            try{
                val bridge=c.getString("bridge");val web=c.getString("web")
                ari.answer(web);ari.add(bridge,ch);ari.add(bridge,web)
                c.put("answeredAt",now()).remove("deadline");phase(c,CallPhase.WEB_ACTIVE)
            }catch(_:Exception){finish(c,"外线桥接失败")}
        }else if(ch==c.channel("native") && c.phase.handingOff){
            if(state in setOf("Ring","Ringing") && c.phase==CallPhase.HANDOFF_REQUESTED)phase(c,CallPhase.NATIVE_RINGING)
            if(state=="Up" && c.phase in setOf(CallPhase.HANDOFF_REQUESTED,CallPhase.NATIVE_RINGING)){
                phase(c,CallPhase.NATIVE_ANSWERED)
                try{
                    val bridge=c.getString("bridge")
                    val outside=c.getString("outside")
                    if(c.getString("direction")=="incoming"){
                        ari.answer(outside);ari.add(bridge,outside);c.put("answeredAt",now())
                    }
                    ari.mute(ch,true);ari.add(bridge,ch)
                    samples.remove(c.getString("id"));c.put("deadline",now()+12_000);phase(c,CallPhase.MEDIA_VERIFYING)
                }catch(_:Exception){rollbackNative(c,"原生媒体桥接失败")}
            }
        }
    }
    private fun phase(c:JSONObject,state:CallPhase){
        c.put("state",state.name);journal.put(c);journal.event(c,state.name)
    }
    private fun lost(c:JSONObject,ch:String){
        if(c.optBoolean("finishing"))return
        when(ch){
            c.channel("outside") -> finish(c,"外线已结束")
            c.channel("native") -> if(c.phase==CallPhase.NATIVE_ACTIVE)finish(c,"原生通话已结束") else rollbackNative(c,"原生端未接听或已断开")
            c.channel("web") -> {
                c.remove("web");journal.put(c)
                if(c.phase.handingOff || c.phase==CallPhase.NATIVE_ACTIVE)return
                if(c.phase!=CallPhase.WEB_ACTIVE && c.phase!=CallPhase.HANDOFF_FAILED){finish(c,"网页呼叫已取消");return}
                c.put("deadline",now()+25_000);phase(c,CallPhase.RECOVERING)
                if(c.optBoolean("auto"))runCatching{beginNative(c,UUID.randomUUID().toString())}
            }
        }
    }
    private fun rollbackNative(c:JSONObject,why:String){
        if(c.phase==CallPhase.NATIVE_ACTIVE)return
        c.put("reason",why)
        lastProblem=why
        val native=c.channel("native")
        // If deleting this leg fails, keep the ID in the journal for the next recovery attempt.
        if(native!=null)try{ari.drop(native)}catch(_:Exception){
            c.put("deadline",now()+4_000);journal.put(c);return
        }
        c.remove("native");samples.remove(c.getString("id"))
        val web=c.channel("web")
        if(web!=null){
            runCatching{ari.mute(web,false)}
            c.remove("deadline");phase(c,CallPhase.HANDOFF_FAILED)
        }else finish(c,why)
    }
    private fun poll(c:JSONObject){
        val deadline=c.optLong("deadline")
        if(c.optBoolean("finishing")){finish(c,c.optString("reason"));return}
        if(deadline>0 && now()>=deadline){
            if(c.phase.handingOff)rollbackNative(c,"接续超时") else finish(c,"呼叫等待超时")
            return
        }
        if(c.phase==CallPhase.WAITING_WEB)return
        val out=c.channel("outside")?:return
        val remote=ari.channel(out) ?: run{finish(c,"外线已结束");return}
        if(c.phase==CallPhase.DIALING){onChannel(c,out,remote.optString("state"));return}
        val web=c.channel("web")
        if(web!=null && ari.channel(web)==null){lost(c,web);return}
        val native=c.channel("native")?:return
        val info=ari.channel(native)?:run{lost(c,native);return}
        if(c.phase==CallPhase.NATIVE_ACTIVE && web!=null){ari.drop(web);return}
        if(c.phase!=CallPhase.MEDIA_VERIFYING){onChannel(c,native,info.optString("state"));return}
        val nc=ari.packets(native)?:return
        val oc=ari.packets(out)?:return
        val prev=samples.put(c.getString("id"),nc to oc)
        if(!VoicePolicy.mediaVerified(prev?.first,nc,prev?.second,oc))return
        MediaCutover.apply(out,native,web,ari::mute,ari::drop,commit={
            c.put("nativeAt",now());c.remove("deadline");c.remove("reason")
            phase(c,CallPhase.NATIVE_ACTIVE)
        },recover={
            c.put("state",CallPhase.MEDIA_VERIFYING.name)
            rollbackNative(c,"媒体切换失败")
        })
    }
    private fun finish(c:JSONObject,reason:String){
        if(c.phase==CallPhase.CALL_ENDED)return
        c.put("finishing",true).put("reason",reason);c.remove("ticket");phase(c,CallPhase.RECOVERING)
        val legs=listOfNotNull(c.channel("outside"),c.channel("native"),c.channel("web"))
        try{
            for(ch in legs)ari.drop(ch)
            if(legs.isNotEmpty())ari.closeBridge(c.getString("bridge"))
        }catch(_:Exception){return}
        c.remove("deadline");c.remove("finishing");c.put("endedAt",now());phase(c,CallPhase.CALL_ENDED)
        samples.remove(c.getString("id"))
        if(c.getString("direction")=="incoming" && !c.has("answeredAt")){
            runCatching{me.capcom.smsgateway.modules.iphone.PhoneAlert.enqueue(ctx,c.getString("device"),c.getString("id"))}
        }
    }
    companion object {
        @Volatile private var instance:VoiceRuntime?=null
        @JvmStatic fun get(context:Context):VoiceRuntime = instance ?: synchronized(this){instance ?: VoiceRuntime(context).also{instance=it}}
        private fun installationAllowed(ctx:Context,installation:String,device:String,time:Long)=
            me.capcom.smsgateway.modules.iphone.PrivateStore(ctx).use{store->
                store.readableDatabase.rawQuery("SELECT grants FROM sessions WHERE installation=? AND app='phone' AND expires>?",
                    arrayOf(installation,time.toString())).use{cursor->
                    cursor.moveToFirst() && cursor.getString(0).split(',').let{"calls.dial" in it && ("device:"+device) in it}
                }
            }
        private fun uuid()=UUID.randomUUID().toString().replace("-","")
    }
}
