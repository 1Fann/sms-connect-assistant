package me.capcom.smsgateway.modules.iphone

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** Fallback entry for the privileged watchdog when Android refuses a direct service start. */
class RootRecoveryReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != IphoneService.ACTION_RECOVER || !BridgeMonitor.enabled(context)) return
        val sharing = context.getSharedPreferences("peer-client", 0).getBoolean("enabled", false)
        val hosting = context.getSharedPreferences("iphone", 0).getBoolean("enabled", false)
        if (!sharing && !hosting) return
        runCatching { IphoneService.recover(context) }.onFailure {
            android.util.Log.w("CommLink", "System rejected watchdog recovery", it)
        }
    }
}
