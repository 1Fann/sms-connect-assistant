package me.capcom.smsgateway.modules.defaultsms

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.provider.Telephony
import androidx.work.*
import me.capcom.smsgateway.helpers.SubscriptionsHelper
import java.security.MessageDigest

/** Always enabled: receiving must not depend on the remote gateway's on/off switch. */
open class SmsDeliverReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (!DefaultSms.isDefault(context)) return
        val sub = SubscriptionsHelper.extractSubscriptionId(context, intent)
        try {
            DefaultSmsStore(context).use { store ->
                when (intent.action) {
                    Telephony.Sms.Intents.SMS_DELIVER_ACTION -> {
                        val messages = Telephony.Sms.Intents.getMessagesFromIntent(intent)?.takeIf { it.isNotEmpty() } ?: return
                        val pdus = intent.extras?.get("pdus") as? Array<*> ?: return
                        val digest = MessageDigest.getInstance("SHA-256")
                        digest.update("$sub:${intent.getStringExtra("format")}:".toByteArray())
                        pdus.forEach { digest.update(it as ByteArray) }
                        val key = digest.digest().joinToString("") { "%02x".format(it) }
                        store.stageIncoming(key, messages.first().displayOriginatingAddress ?: "",
                            messages.joinToString("") { it.displayMessageBody ?: "" }, messages.first().timestampMillis, sub)
                        InboxRecoveryWorker.enqueue(context)
                    }
                    Telephony.Sms.Intents.WAP_PUSH_DELIVER_ACTION -> {
                        val pdu = intent.getByteArrayExtra("data") ?: intent.getByteArrayExtra("pdu") ?: return
                        val digest = MessageDigest.getInstance("SHA-256").apply { update("$sub:".toByteArray()); update(pdu) }
                        store.saveMms(digest.digest().joinToString("") { "%02x".format(it) }, pdu, sub)
                        DefaultSms.notify(context, "收到彩信通知；当前版本不支持下载附件，请打开查看说明", 4702)
                    }
                }
            }
            resultCode = android.app.Activity.RESULT_OK
        } catch (_: Exception) {
            DefaultSms.notify(context, "收件保存遇到问题，请立即检查短信权限和可用存储空间", 4703)
        }
    }
}

class WapPushDeliverReceiver : SmsDeliverReceiver()

class InboxRecoveryWorker(context: Context, params: WorkerParameters) : Worker(context, params) {
    override fun doWork(): Result = try {
        DefaultSmsStore(applicationContext).use { it.drain() }
        Result.success()
    } catch (_: Exception) {
        DefaultSms.notify(applicationContext, "有短信等待写入系统收件箱，将自动重试", 4703)
        Result.retry()
    }
    companion object {
        fun enqueue(context: Context) {
            // APPEND_OR_REPLACE prevents a new receipt being lost while a prior worker is completing.
            WorkManager.getInstance(context).enqueueUniqueWork("default-sms-inbox", ExistingWorkPolicy.APPEND_OR_REPLACE,
                OneTimeWorkRequestBuilder<InboxRecoveryWorker>().build())
        }
    }
}
