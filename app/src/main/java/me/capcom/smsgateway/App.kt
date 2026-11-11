package me.capcom.smsgateway

import android.app.Application
import android.content.Context
import androidx.work.WorkManager
import androidx.work.Operation
import androidx.lifecycle.Observer
import healthModule
import me.capcom.smsgateway.data.dbModule
import me.capcom.smsgateway.helpers.LocaleHelper
import me.capcom.smsgateway.modules.connection.connectionModule
import me.capcom.smsgateway.modules.device.deviceModule
import me.capcom.smsgateway.modules.encryption.encryptionModule
import me.capcom.smsgateway.modules.events.eventBusModule
import me.capcom.smsgateway.modules.incoming.incomingModule
import me.capcom.smsgateway.modules.localserver.localserverModule
import me.capcom.smsgateway.modules.logs.logsModule
import me.capcom.smsgateway.modules.messages.messagesModule
import me.capcom.smsgateway.modules.mms.mmsModule
import me.capcom.smsgateway.modules.notifications.notificationsModule
import me.capcom.smsgateway.modules.orchestrator.OrchestratorService
import me.capcom.smsgateway.modules.orchestrator.orchestratorModule
import me.capcom.smsgateway.modules.receiver.receiverModule
import me.capcom.smsgateway.modules.settings.settingsModule
import me.capcom.smsgateway.receivers.EventsReceiver
import org.koin.android.ext.android.get
import org.koin.android.ext.android.inject
import org.koin.android.ext.koin.androidContext
import org.koin.android.ext.koin.androidLogger
import org.koin.core.context.startKoin

class App: Application() {
    override fun attachBaseContext(base: Context?) {
        super.attachBaseContext(base?.let { LocaleHelper.onAttach(it) })
    }

    override fun onCreate() {
        super.onCreate()
        // Netty must use its supported Conscrypt ALPN adapter, not Android's
        // partial Java 9 SSLEngine API (which can return null protocol values).
        if (org.conscrypt.Conscrypt.isAvailable()) {
            java.security.Security.insertProviderAt(org.conscrypt.Conscrypt.newProvider(), 1)
        }

        startKoin {
            androidLogger()
            androidContext(this@App)
            modules(
                eventBusModule,
                settingsModule,
                dbModule,
                logsModule,
                notificationsModule,
                mmsModule,
                messagesModule,
                incomingModule,
                receiverModule,
                encryptionModule,
                healthModule,
                localserverModule,
                connectionModule,
                orchestratorModule,
                deviceModule,
            )
        }

        Thread.setDefaultUncaughtExceptionHandler(
            GlobalExceptionHandler(
                Thread.getDefaultUncaughtExceptionHandler()!!,
                get()
            )
        )

        instance = this

        // Isolated instrumentation uses synthetic private databases only. Never
        // register modem callbacks, start the gateway or schedule the Root guard.
        if (BuildConfig.DEBUG && packageName.endsWith(".commlinkfixture")) return
        retireLegacyIntegrationWork()
        EventsReceiver.register(this)
        me.capcom.smsgateway.modules.iphone.BridgeMonitor.initialize(this)
        me.capcom.smsgateway.modules.defaultsms.InboxRecoveryWorker.enqueue(this)

        get<OrchestratorService>().start(this, true)
        if (android.os.Build.VERSION.SDK_INT >= 23 && (getSharedPreferences("iphone",0).getBoolean("enabled",false) || getSharedPreferences("peer-client",0).getBoolean("enabled",false))) {
            runCatching { me.capcom.smsgateway.modules.iphone.IphoneService.start(this) }
        }
    }


    private fun retireLegacyIntegrationWork() {
        val state = getSharedPreferences("commlink-upgrades", MODE_PRIVATE)
        if (state.getBoolean("legacy-integration-work-retired", false)) return
        val manager = WorkManager.getInstance(this)
        // WorkManager tags requests with the worker's fully qualified class name.
        val oldWorkers = listOf(
            "gateway.workers.PullMessagesWorker",
            "gateway.workers.SettingsUpdateWorker",
            "gateway.workers.WebhooksUpdateWorker",
            "gateway.workers.RegistrationWorker",
            "gateway.workers.SendStateWorker",
            "gateway.inbox.InboxUploadWorker",
            "webhooks.workers.ReviewWebhooksWorker",
            "webhooks.workers.SendWebhookWorker",
            "webhooks.workers.WebhookQueueProcessorWorker",
        )
        var remaining = oldWorkers.size
        var failed = false
        for (worker in oldWorkers) {
            val operation = manager.cancelAllWorkByTag("me.capcom.smsgateway.modules.$worker")
            operation.state.observeForever(object : Observer<Operation.State> {
                override fun onChanged(status: Operation.State) {
                    if (status is Operation.State.IN_PROGRESS) return
                    operation.state.removeObserver(this)
                    if (status !is Operation.State.SUCCESS) failed = true
                    remaining--
                    if (remaining == 0 && !failed) {
                        state.edit().putBoolean("legacy-integration-work-retired", true).apply()
                    }
                }
            })
        }
    }

    companion object {
        lateinit var instance: App
            private set
    }
}
