package me.capcom.smsgateway.modules.defaultsms

import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.IBinder
import android.telephony.SubscriptionManager
import kotlinx.coroutines.*
import me.capcom.smsgateway.domain.EntitySource
import me.capcom.smsgateway.domain.MessageContent
import me.capcom.smsgateway.helpers.SubscriptionsHelper
import me.capcom.smsgateway.modules.messages.MessagesService
import me.capcom.smsgateway.modules.messages.data.*
import org.koin.core.component.KoinComponent
import org.koin.core.component.inject
import java.util.Date
import java.util.UUID

object LocalSmsSend : KoinComponent {
    private val messages: MessagesService by inject()
    fun valid(to: String, body: String) = to.matches(Regex("[+0-9][0-9 ()-]{1,29}")) && body.isNotBlank() && body.length <= 2000
    fun enqueue(context: Context, to: String, body: String, sim: Int) {
        require(valid(to, body))
        require(SubscriptionsHelper.getActiveSimCards(context).any { it.simNumber == sim })
        messages.enqueueMessage(SendRequest(EntitySource.Local, Message(UUID.randomUUID().toString(), MessageContent.Text(body),
            listOf(to.replace(Regex("[ ()-]"), "")), false, Date()), SendParams(true, true, sim, null, null, null)))
    }
}

/** Only the system/phone app holding SEND_RESPOND_VIA_MESSAGE can invoke quick reply. */
class RespondViaMessageService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    override fun onBind(intent: Intent?): IBinder? = null
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action != "android.intent.action.RESPOND_VIA_MESSAGE" || !DefaultSms.isDefault(this)) { stopSelf(startId); return START_NOT_STICKY }
        scope.launch {
            try {
                val to = intent.data?.schemeSpecificPart?.substringBefore('?') ?: error("No recipient")
                val body = intent.getCharSequenceExtra(Intent.EXTRA_TEXT)?.toString() ?: error("No message")
                val sub = SubscriptionsHelper.extractSubscriptionId(this@RespondViaMessageService, intent)
                    ?: if (android.os.Build.VERSION.SDK_INT >= 24) SubscriptionManager.getDefaultSmsSubscriptionId() else -1
                val sim = SubscriptionsHelper.getSimSlotIndex(this@RespondViaMessageService, sub)?.plus(1) ?: error("Choose SIM")
                LocalSmsSend.enqueue(this@RespondViaMessageService, to, body, sim)
            } catch (_: Exception) { DefaultSms.notify(this@RespondViaMessageService, "快捷回复未发送，请打开短信互联助手选择 SIM 后发送", 4704) }
            finally { stopSelf(startId) }
        }
        return START_NOT_STICKY
    }
    override fun onDestroy() { scope.cancel(); super.onDestroy() }
}
