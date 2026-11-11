package me.capcom.smsgateway.modules.settings

import androidx.preference.PreferenceManager
import me.capcom.smsgateway.helpers.SettingsHelper
import me.capcom.smsgateway.modules.device.DeviceSettings
import me.capcom.smsgateway.modules.encryption.EncryptionSettings
import me.capcom.smsgateway.modules.incoming.IncomingMessagesSettings
import me.capcom.smsgateway.modules.localserver.LocalServerSettings
import me.capcom.smsgateway.modules.logs.LogsSettings
import me.capcom.smsgateway.modules.messages.MessagesSettings
import me.capcom.smsgateway.modules.receiver.ReceiverSettings
import me.capcom.smsgateway.modules.receiver.StateStorage
import org.koin.core.module.dsl.singleOf
import org.koin.dsl.module


val settingsModule = module {
    singleOf(::SettingsService)
    factory { PreferenceManager.getDefaultSharedPreferences(get()) }
    factory { SettingsHelper(get()) }

    factory {
        EncryptionSettings(
            PreferencesStorage(get(), "encryption")
        )
    }
    factory {
        MessagesSettings(
            PreferencesStorage(get(), "messages")
        )
    }
    factory {
        LocalServerSettings(
            PreferencesStorage(get(), "localserver")
        )
    }
    factory {
        IncomingMessagesSettings(
            PreferencesStorage(get(), "incoming")
        )
    }
    factory {
        LogsSettings(
            PreferencesStorage(get(), "logs")
        )
    }
    factory {
        ReceiverSettings(
            PreferencesStorage(get(), "receiver")
        )
    }
    factory {
        DeviceSettings(
            PreferencesStorage(get(), "device")
        )
    }
    //
    single {
        StateStorage(
            PreferencesStorage(get(), "receiver")
        )
    }
}