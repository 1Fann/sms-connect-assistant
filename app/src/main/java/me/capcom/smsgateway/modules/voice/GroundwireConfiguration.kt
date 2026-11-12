package me.capcom.smsgateway.modules.voice

import android.content.Context
import me.capcom.smsgateway.modules.iphone.SecretVault

/** Explicit stable-line mappings. A replaced SIM or an unconfigured peer must never inherit a route. */
data class GroundwireRoute(val lineId:String,val deviceId:String,val slot:Int,val subscriptionId:Int,val prefix:String)
class GroundwireConfiguration(context:Context,preferencesName:String="commlink-groundwire") {
    private val prefs=context.getSharedPreferences(preferencesName,0)
    private val vault=SecretVault(context.applicationContext)
    val server get()=prefs.getString("server","").orEmpty()
    val account get()=prefs.getString("account","1001").orEmpty()
    val routesText get()=prefs.getString("routes","").orEmpty()
    fun password()=vault.get("voice-native")?.toString(Charsets.UTF_8).orEmpty()
    fun routes()=parse(routesText)
    fun save(server:String,account:String,routes:String,password:String="") {
        require(server.matches(Regex("[A-Za-z0-9.-]+(:[0-9]{1,5})?"))){"SIP 服务器格式无效"}
        require(account.matches(Regex("[A-Za-z0-9_-]{1,63}"))){"账号格式无效"}
        parse(routes)
        if(password.isNotEmpty())vault.put("voice-native",password.toByteArray())
        check(prefs.edit().putString("server",server).putString("account",account).putString("routes",routes).commit())
    }
    companion object {
        fun parse(text:String):List<GroundwireRoute> {
            val routes=text.lineSequence().filter{it.isNotBlank()}.map { row->
                val p=row.trim().split(Regex("\\s+"))
                require(p.size==5){"每行填写线路 ID、设备 ID、卡槽、订阅 ID、拨号前缀"}
                require(p.take(2).all{it.matches(Regex("[A-Za-z0-9:_-]{1,128}"))}){"线路或设备 ID 无效"}
                val slot=p[2].toInt();val sub=p[3].toInt()
                require(slot in 1..2 && sub>=0 && p[4].matches(Regex("\\*[0-9]{2,8}\\*"))){"卡槽、订阅或前缀无效"}
                GroundwireRoute(p[0],p[1],slot,sub,p[4])
            }.toList()
            require(routes.map{it.lineId}.distinct().size==routes.size && routes.map{it.prefix}.distinct().size==routes.size){"线路和拨号前缀不能重复"}
            return routes
        }
        fun matchesBinding(route:GroundwireRoute,row:Map<String,Any>) =
            row["deviceId"]==route.deviceId && (row["slot"] as? Number)?.toInt()==route.slot &&
                (row["followSlot"]==true || (row["lineId"]==route.lineId &&
                    (row["subscriptionId"] as? Number)?.toInt()==route.subscriptionId)) &&
                row["present"]==true && row["confirmed"]==true

        fun matches(route:GroundwireRoute,row:Map<String,Any>) =
            matchesBinding(route,row) && row["lineOnline"]==true && row["enabled"]==true
    }
}
