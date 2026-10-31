package me.capcom.smsgateway.modules.iphone

import android.content.Context

/** Display aliases only. Routing continues to use the physical phone/slot IDs. */
class PhoneLabels(ctx: Context) {
    private val local=ctx.getSharedPreferences("iphone",0)
    private val peer=ctx.getSharedPreferences("peer-hub",0)
    private fun checked(value:String):String = value.trim().also {
        require(it.length<=30 && it.none { c->c.isISOControl() }) { "名称最多 30 个字符，不能包含换行或控制字符" }
    }
    fun phoneName(id:String):String {
        require(id in setOf("server","peer"))
        return (if(id=="server")local else peer).getString("phone-name",null)
            ?.takeIf { it.isNotBlank() } ?: if(id=="server")"服务器手机" else "共享手机"
    }
    fun renamePhone(id:String,name:String) {
        require(id in setOf("server","peer"))
        val value=checked(name)
        val edit=(if(id=="server")local else peer).edit()
        if(value.isEmpty())edit.remove("phone-name") else edit.putString("phone-name",value)
        check(edit.commit())
    }
    fun simName(id:Int):String {
        require(id in 1..4 || id in 101..104)
        val slot=if(id>100)id-100 else id
        return (if(id>100)peer else local).getString("sim.$slot",null)
            ?.takeIf { it.isNotBlank() } ?: "卡 $slot"
    }
    fun renameSim(id:Int,name:String) {
        require(id in 1..4 || id in 101..104)
        val value=checked(name);val slot=if(id>100)id-100 else id
        val edit=(if(id>100)peer else local).edit()
        if(value.isEmpty())edit.remove("sim.$slot") else edit.putString("sim.$slot",value)
        check(edit.commit())
    }
    fun line(id:Int,online:Boolean):Map<String,Any> {
        val phone=if(id>100)"peer" else "server"
        val device=phoneName(phone);val sim=simName(id)
        return mapOf("id" to id,"phoneId" to phone,"phoneName" to device,
            "slot" to if(id>100)id-100 else id,"simName" to sim,
            "name" to "$device · $sim"+(if(online)"" else "（离线）"),"online" to online)
    }
}
