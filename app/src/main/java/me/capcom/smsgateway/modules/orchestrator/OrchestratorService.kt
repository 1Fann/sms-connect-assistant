package me.capcom.smsgateway.modules.orchestrator

import android.content.Context
import me.capcom.smsgateway.helpers.SettingsHelper
import me.capcom.smsgateway.modules.device.DeviceService
import me.capcom.smsgateway.modules.incoming.IncomingMessagesService
import me.capcom.smsgateway.modules.localserver.LocalServerService
import me.capcom.smsgateway.modules.logs.LogsService
import me.capcom.smsgateway.modules.logs.db.LogEntry
import me.capcom.smsgateway.modules.messages.MessagesService
import me.capcom.smsgateway.modules.receiver.ReceiverService

class OrchestratorService(
    private val messagesSvc: MessagesService,
    private val incomingSvc: IncomingMessagesService,
    private val localServerSvc: LocalServerService,
    private val receiverService: ReceiverService,
    private val logsSvc: LogsService,
    private val deviceService: DeviceService,
    private val settings: SettingsHelper,
) {
    fun start(context: Context, autostart: Boolean) {
        if (autostart && !settings.autostart) {
            return
        }

        logsSvc.start(context)
        messagesSvc.start(context)
        incomingSvc.start(context)
        deviceService.start(context)

        try {
            localServerSvc.start(context)
        } catch (e: Throwable) {
            logsSvc.insert(
                LogEntry.Priority.WARN,
                MODULE_NAME,
                "Can't start foreground services while the app is running in the background"
            )
        }

        try {
            receiverService.start(context)
        } catch (e: Throwable) {
            logsSvc.insert(
                LogEntry.Priority.WARN,
                MODULE_NAME,
                "Can't register receiver"
            )
        }

    }

    fun stop(context: Context) {
        receiverService.stop(context)
        localServerSvc.stop(context)

        messagesSvc.stop(context)
        incomingSvc.stop(context)
        logsSvc.stop(context)
        deviceService.stop(context)
    }
}