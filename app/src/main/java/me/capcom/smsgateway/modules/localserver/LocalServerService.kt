package me.capcom.smsgateway.modules.localserver

import android.content.Context
import android.os.Build
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import me.capcom.smsgateway.modules.events.EventBus
import me.capcom.smsgateway.modules.localserver.events.IPReceivedEvent
import me.capcom.smsgateway.providers.LocalIPProvider

class LocalServerService(
    private val settings: LocalServerSettings,
    private val events: EventBus,
) {

    private fun getDeviceId(context: Context): String {
        val firstInstallTime = context.packageManager.getPackageInfo(
            context.packageName,
            0
        ).firstInstallTime
        val deviceName = "${Build.MANUFACTURER}/${Build.PRODUCT}"

        return deviceName.hashCode().toULong()
            .toString(16).padStart(16, '0') + firstInstallTime.toULong()
            .toString(16).padStart(16, '0')
    }

    fun start(context: Context) {
        if (!settings.enabled) return
        settings.deviceId = settings.deviceId ?: getDeviceId(context)

        WebService.start(context)

        scope.launch(Dispatchers.IO) {
            val localIP = LocalIPProvider(context).getIP()

            events.emit(IPReceivedEvent(localIP, null))
        }
    }

    fun stop(context: Context) {
        WebService.stop(context)
    }

    fun isActiveLiveData(context: Context) = WebService.STATUS

    companion object {
        private val job = SupervisorJob()
        private val scope = CoroutineScope(job)
    }
}