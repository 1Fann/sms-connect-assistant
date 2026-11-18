package me.capcom.smsgateway.modules.iphone

import com.google.gson.JsonObject
import java.net.URLEncoder

/** Complete encrypted notifications. No network fetch is needed on the receiving phone. */
object PushPayload {
    fun sms(origin:String,count:Int?,preview:JsonObject?,previewEnabled:Boolean,test:Boolean=false):ByteArray {
        val address=if(previewEnabled && !test)preview?.get("address")?.asString?.take(100).orEmpty() else ""
        val title=if(previewEnabled)preview?.get("title")?.asString?.take(100)?.takeIf{it.isNotBlank()}?:"互联信息" else "互联信息"
        val body=if(previewEnabled)preview?.get("body")?.asString?.take(200)?:"收到一条新短信" else if(test)"通知测试成功" else "收到一条新短信"
        val path=if(address.isEmpty())"/" else "/#conversation="+URLEncoder.encode(address,"UTF-8").replace("+","%20")
        return envelope(origin,title,body,path,if(address.isEmpty())"sms" else "sms-$address","/icon-192.png",if(test)null else count,address,test)
    }
    fun phone(origin:String,count:Int?):ByteArray = envelope(origin,"互联电话","有新的未接来电","/phone/#missed","phone-missed","/phone/icon-192.png",count,"",false)

    private fun envelope(origin:String,title:String,body:String,path:String,tag:String,icon:String,count:Int?,address:String,test:Boolean):ByteArray {
        require(count==null || count>=0)
        val notification=JsonObject().apply {
            addProperty("title",title);addProperty("body",body);addProperty("navigate",origin+path)
            addProperty("icon",origin+icon);addProperty("tag",tag)
            addProperty("mutable",false)
            add("data",JsonObject().apply{addProperty("address",address)})
            // The initial iOS 18.4 implementation read app_badge here.
            if(count!=null)addProperty("app_badge",count)
        }
        val bytes=JsonObject().apply {
            addProperty("web_push",8030);addProperty("mutable",false);add("notification",notification)
            // Current WebKit reads app_badge at the top level.
            if(count!=null)addProperty("app_badge",count)
            // Older installed workers can still display a valid notification.
            addProperty("title",title);addProperty("body",body);addProperty("address",address)
            if(test)addProperty("badge",false)
        }.toString().toByteArray(Charsets.UTF_8)
        // JSON escaping and international sender labels can grow the envelope.
        // Fall back to a generic notification instead of exceeding RFC 8291's record limit.
        if(bytes.size>3993)return envelope(origin,"互联信息",if(test)"通知测试成功" else "收到一条新短信","/","sms",icon,count,"",test)
        return bytes
    }
}

object PushSubscriptionKeys {
    fun decode(body:Map<String,String>):Pair<ByteArray?,ByteArray?> {
        val key=body["p256dh"];val auth=body["auth"]
        require((key==null)==(auth==null))
        fun decode(value:String?)=value?.let {android.util.Base64.decode(it,android.util.Base64.URL_SAFE or android.util.Base64.NO_WRAP)}
        return decode(key) to decode(auth)
    }
}
