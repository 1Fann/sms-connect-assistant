package me.capcom.smsgateway.modules.iphone

import android.content.Context

object SmsBadges {
    fun count(context:Context,store:PrivateStore,grants:String,installation:String):Int {
        val nodes=grants.split(',').filter{it.startsWith("device:")}.map{it.removePrefix("device:")}.toSet()
        val scope=PrivateStore.smsScope(grants)
        val region=context.getSharedPreferences("iphone",0).getString("badge-region-$installation","CN")!!
        val counter=SmsBadgeCounter(region,store.scopedStates(scope),store.scopedReadTimes(scope),store.legacyReadTimes())
        if("server" in nodes)SmsHistory(context,store).forEachBadgeRow(counter::add)
        PeerHub.get(context).forEachBadgeRow(nodes,counter::add)
        return counter.count
    }
}
