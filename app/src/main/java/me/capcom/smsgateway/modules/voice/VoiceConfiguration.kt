package me.capcom.smsgateway.modules.voice

import android.content.Context
import me.capcom.smsgateway.modules.iphone.SecretVault
import org.json.JSONObject
import java.net.URI
import java.util.UUID

data class VoiceLine(val id:String, val deviceId:String, val slot:Int, val online:Boolean, val subscriptionId:Int?=null)
data class GatewayBinding(val device:String,val endpoint:String,val incomingLine:String?)

internal fun validEndpoint(value:String) = value.matches(Regex("[A-Za-z][A-Za-z0-9_-]{1,62}"))

/** Separate credentials and mappings from SMS preferences. No PBX configuration is applied by this class. */
class VoiceConfiguration(context:Context,preferencesName:String="commlink-voice") {
    private val prefs=context.getSharedPreferences(preferencesName,0)
    private val vault=SecretVault(context.applicationContext)
    val enabled get()=prefs.getBoolean("enabled",false)
    val ariPort get()=prefs.getInt("port",8088)
    val ariUser get()=prefs.getString("ari-user","commlink")!!
    val wss get()=prefs.getString("wss","")!!
    val domain get()=prefs.getString("domain","")!!
    val webUser get()=prefs.getString("web","cl-web")!!
    val nativeUser get()=prefs.getString("native","cl-native")!!
    val bindingsText get()=prefs.getString("bindings","")!!
    val dialRules get()=prefs.getString("dial-rules","")!!
    val iceText get()=secret("voice-ice")
    fun secret(key:String):String=vault.get(key)?.toString(Charsets.UTF_8).orEmpty()
    fun wssOrigin():String?=if(enabled && wss.isNotBlank()) URI(wss).let {"wss://"+it.rawAuthority} else null
    internal fun bindings(text:String=bindingsText):List<GatewayBinding> = text.lineSequence().filter{it.isNotBlank()}.map { row->
        val part=row.trim().split(Regex("\\s+"))
        require(part.size in 2..3 && validEndpoint(part[1]) && part[0].matches(Regex("[A-Za-z0-9:_-]{1,128}"))){"每行填写设备 ID、PJSIP 端点、可选的唯一入站线路 ID"}
        GatewayBinding(part[0],part[1],part.getOrNull(2))
    }.toList()
    fun save(enable:Boolean,port:Int,ariUser:String,ariPassword:String,wss:String,domain:String,
             web:String,webPassword:String,native:String,nativePassword:String,bindings:String,ice:String,allowed:String){
        if(!enable && wss.isBlank()){prefs.edit().putBoolean("enabled",false).commit();return}
        val url=URI(wss)
        require(url.scheme=="wss" && url.host!=null && url.userInfo==null && url.rawQuery==null && url.fragment==null && url.path.startsWith("/")){"请输入受信任的 wss:// 地址"}
        require(domain.matches(Regex("[A-Za-z0-9.-]{1,253}")) && port in 1..65535 && listOf(ariUser,web,native).all(::validEndpoint)){"域名、端口或账户名称无效"}
        val gatewayList=bindings(bindings)
        val identities=gatewayList.map{it.endpoint}+listOf(web,native)
        require(identities.distinct().size==identities.size && gatewayList.map{it.device}.distinct().size==gatewayList.size){"设备和端点必须一一对应，各角色端点不得重复"}
        val keys=mapOf("voice-ari" to ariPassword,"voice-web" to webPassword,"voice-native" to nativePassword)
        require(!enable || keys.all{(k,v)->v.isNotBlank()||secret(k).isNotBlank()}){"缺少所需凭据"}
        iceServers(ice)
        require(allowed.split(',').map{it.trim()}.filter{it.isNotEmpty()}.all{it.matches(Regex("\\+?[0-9]{1,20}\\*?"))}){"允许号码必须为精确号码或数字前缀加 *"}
        keys.filterValues{it.isNotBlank()}.forEach{(k,v)->vault.put(k,v.toByteArray())}
        vault.put("voice-ice",ice.toByteArray())
        check(prefs.edit().putBoolean("enabled",enable).putInt("port",port).putString("ari-user",ariUser)
            .putString("wss",wss).putString("domain",domain).putString("web",web).putString("native",native)
            .putString("bindings",bindings).putString("dial-rules",allowed).commit())
    }
    internal fun iceServers(value:String=iceText):List<Map<String,Any>> {
        if(value.isBlank())return emptyList()
        val array=org.json.JSONArray(value)
        require(array.length()<=8)
        return (0 until array.length()).map {i->
            val o=array.getJSONObject(i)
            val urls=when(val v=o.get("urls")){
                is String -> listOf(v)
                is org.json.JSONArray -> (0 until v.length()).map{v.getString(it)}
                else -> throw IllegalArgumentException("ICE urls 格式无效")
            }
            require(urls.isNotEmpty()&&urls.all{it.matches(Regex("(stun|turn|turns):[^\\s@]+"))}){"ICE 地址无效"}
            mutableMapOf<String,Any>("urls" to urls).apply{
                for(key in listOf("username","credential")) if(o.has(key))put(key,o.getString(key))
            }
        }
    }
}

internal class VoiceFault(val code:Int, override val message:String):RuntimeException(message)

internal fun canonicalCallId(text:String):String{
    val id=runCatching{UUID.fromString(text).toString()}.getOrNull()
    if(id!=text)throw VoiceFault(400,"请求 ID 无效")
    return id
}
