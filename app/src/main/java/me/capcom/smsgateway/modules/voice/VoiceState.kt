package me.capcom.smsgateway.modules.voice

internal data class RtpSample(val received:Long,val transmitted:Long) {
    fun progressedFrom(old:RtpSample?)=old!=null && received>old.received && transmitted>old.transmitted
}
internal enum class CallPhase {
    WAITING_WEB, DIALING, WEB_ACTIVE, HANDOFF_REQUESTED, NATIVE_RINGING, NATIVE_ANSWERED,
    MEDIA_VERIFYING, NATIVE_ACTIVE, RECOVERING, HANDOFF_FAILED, CALL_ENDED;
    val handingOff get()=this in setOf(HANDOFF_REQUESTED,NATIVE_RINGING,NATIVE_ANSWERED,MEDIA_VERIFYING)
}
internal object VoicePolicy {
    fun allowedNumber(n:String,rules:String)=rules.split(',').map{it.trim()}.filter{it.isNotEmpty()}.any{
        if(it.endsWith('*'))it.length>1 && n.startsWith(it.dropLast(1)) else n==it
    }
    fun number(raw:String):String {
        val n=raw.trim().replace(Regex("[ ()-]"),"")
        if(!n.matches(Regex("\\+?[0-9]{3,20}")))throw VoiceFault(400,"号码格式不受支持")
        return n
    }
    fun matchesBinding(a:VoiceLine,b:VoiceLine?):Boolean =
        b!=null && a.online && b.online && a.id==b.id && a.deviceId==b.deviceId &&
            a.slot==b.slot && a.slot in 1..2 && a.subscriptionId!=null && a.subscriptionId==b.subscriptionId
    fun endpoint(name:String)=name.takeIf{it.startsWith("PJSIP/") && '-' in it}
        ?.removePrefix("PJSIP/")?.substringBeforeLast('-')
    fun mediaVerified(nativePrevious:RtpSample?,nativeCurrent:RtpSample?,outsidePrevious:RtpSample?,outsideCurrent:RtpSample?)=
        nativeCurrent?.progressedFrom(nativePrevious)==true && outsideCurrent?.progressedFrom(outsidePrevious)==true
}

/** Only the two user legs can be changed after RTP on the outside and native legs has advanced.
 * Saving the durable commit precedes releasing WebRTC. A failed cleanup is retried by the journal poller.
 */
internal object MediaCutover {
    fun apply(outside:String,native:String,web:String?,mute:(String,Boolean)->Unit,drop:(String)->Unit,
              commit:()->Unit,recover:()->Unit){
        require(native!=outside && web!=outside && web!=native){"通道身份重叠"}
        try{
            if(web!=null)mute(web,true)
            mute(native,false)
            commit()
        }catch(_:Exception){
            recover()
            return
        }
        if(web!=null)runCatching{drop(web)}
    }
}
