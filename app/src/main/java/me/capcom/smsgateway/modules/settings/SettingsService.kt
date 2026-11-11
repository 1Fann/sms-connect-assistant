package me.capcom.smsgateway.modules.settings

import android.content.Context
import me.capcom.smsgateway.R
import me.capcom.smsgateway.modules.device.DeviceSettings
import me.capcom.smsgateway.modules.encryption.EncryptionSettings
import me.capcom.smsgateway.modules.incoming.IncomingMessagesSettings
import me.capcom.smsgateway.modules.logs.LogsSettings
import me.capcom.smsgateway.modules.messages.MessagesSettings
import me.capcom.smsgateway.modules.notifications.NotificationsService

class SettingsService(
    private val context: Context,
    private val notificationsService: NotificationsService,
    encryptionSettings: EncryptionSettings,
    incomingMessagesSettings: IncomingMessagesSettings,
    messagesSettings: MessagesSettings,
    logsSettings: LogsSettings,
    deviceSettings: DeviceSettings,
) {
    private val settings = mapOf(
        "encryption" to encryptionSettings,
        "incoming" to incomingMessagesSettings,
        "messages" to messagesSettings,
        "logs" to logsSettings,
        "device" to deviceSettings,
    )

    fun getAll(): Map<String, *> {
        return settings.mapValues { (it.value as? Exporter)?.export() }
    }

    fun update(data: Map<String, *>) {
        if (data.isEmpty()) {
            return
        }

        val changed = data.map { (key, value) ->
            try {
                settings[key]?.let {
                    (it as? Importer)?.import(value as Map<String, *>)
                }
            } catch (e: IllegalArgumentException) {
                throw IllegalArgumentException("Failed to import $key: ${e.message}", e)
            }
        }

        if (changed.none { it == true }) {
            return
        }

        notificationsService.notify(
            context,
            NotificationsService.NOTIFICATION_ID_SETTINGS_CHANGED,
            context.getString(R.string.settings_changed_via_api_restart_the_app_to_apply_changes)
        )
    }
}