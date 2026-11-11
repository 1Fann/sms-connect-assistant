package me.capcom.smsgateway.modules.receiver

import android.content.Context
import android.os.Build
import android.provider.Telephony
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import me.capcom.smsgateway.modules.incoming.IncomingMessagesService
import me.capcom.smsgateway.modules.incoming.db.IncomingMessageType
import me.capcom.smsgateway.modules.logs.LogsService
import me.capcom.smsgateway.modules.logs.db.LogEntry
import me.capcom.smsgateway.modules.receiver.data.InboxMessage
import org.koin.core.component.KoinComponent
import org.koin.core.component.inject
import java.util.Date

class ReceiverService : KoinComponent {
    private val logsService: LogsService by inject()
    private val incomingMessagesService: IncomingMessagesService by inject()
    private val receiverSettings: ReceiverSettings by inject()

    private val mmsContentObserver by lazy { MmsContentObserver() }
    private val smsContentObserver by lazy { SmsContentObserver() }

    fun start(context: Context) {
        MessagesReceiver.start(context)
        MmsReceiver.start(context)
        mmsContentObserver.start()
        if (receiverSettings.contentProviderEnabled) {
            smsContentObserver.start()
        }
    }

    fun stop(context: Context) {
        smsContentObserver.stop()
        mmsContentObserver.stop()
        MmsReceiver.stop(context)
        MessagesReceiver.stop(context)
    }

    suspend fun export(
        context: Context,
        period: Pair<Date, Date>,
        messageTypes: Set<IncomingMessageType>,
    ) = withContext(Dispatchers.IO) {
        select(context, period, messageTypes).forEach(::process)
    }

    fun process(message: InboxMessage) {
        if (!incomingMessagesService.isMessageProcessed(message)) {
            incomingMessagesService.save(message)
        }
    }

    fun select(
        context: Context,
        period: Pair<Date, Date>,
        messageTypes: Set<IncomingMessageType>
    ): List<InboxMessage> {
        logsService.insert(
            LogEntry.Priority.DEBUG,
            MODULE_NAME,
            "ReceiverService::select - start",
            mapOf("period" to period, "messageTypes" to messageTypes)
        )

        val messages = buildList {
            if (IncomingMessageType.SMS in messageTypes) {
                addAll(selectSms(context, period))
            }
            if (IncomingMessageType.MMS in messageTypes) {
                addAll(selectMms(context, period))
            }
        }.sortedBy { it.date.time }

        logsService.insert(
            LogEntry.Priority.DEBUG,
            MODULE_NAME,
            "ReceiverService::select - end",
            mapOf("messages" to messages.size, "messageTypes" to messageTypes)
        )

        return messages
    }

    private fun selectSms(context: Context, period: Pair<Date, Date>): List<InboxMessage> {
        val projection = mutableListOf(
            Telephony.Sms._ID,
            Telephony.Sms.ADDRESS,
            Telephony.Sms.DATE_SENT,
            Telephony.Sms.BODY,
        )
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP_MR1) {
            projection += Telephony.Sms.SUBSCRIPTION_ID
        }

        val selection = "${Telephony.Sms.DATE_SENT} >= ? AND ${Telephony.Sms.DATE_SENT} <= ?"
        val selectionArgs = arrayOf(
            period.first.time.toString(),
            period.second.time.toString()
        )
        val sortOrder = Telephony.Sms.DATE_SENT

        val contentResolver = context.contentResolver
        val cursor = contentResolver.query(
            Telephony.Sms.Inbox.CONTENT_URI,
            projection.toTypedArray(),
            selection,
            selectionArgs,
            sortOrder
        )

        val messages = mutableListOf<InboxMessage>()

        cursor?.use { cursor ->
            while (cursor.moveToNext()) {
                messages.add(
                    InboxMessage.Text(
                        address = cursor.getString(1),
                        date = Date(cursor.getLong(2)),
                        text = cursor.getString(3),
                        subscriptionId = when {
                            projection.size > 4 -> cursor.getInt(4).takeIf { it >= 0 }
                            else -> null
                        }
                    )
                )
            }
        }

        return messages
    }

    private fun selectMms(context: Context, period: Pair<Date, Date>): List<InboxMessage> {
        val startSeconds = period.first.time / 1000
        val endSeconds = period.second.time / 1000

        val projection = arrayOf(Telephony.Mms._ID)
        // m_type 132 = retrieve-conf (fully downloaded MMS); date is in seconds
        val selection = "${Telephony.Mms.MESSAGE_TYPE} = 132 AND " +
                "${Telephony.Mms.DATE} >= ? AND ${Telephony.Mms.DATE} <= ?"
        val selectionArgs = arrayOf(startSeconds.toString(), endSeconds.toString())

        val cursor = context.contentResolver.query(
            Telephony.Mms.Inbox.CONTENT_URI,
            projection,
            selection,
            selectionArgs,
            "${Telephony.Mms.DATE} ASC, ${Telephony.Mms._ID} ASC"
        ) ?: return emptyList()

        val messages = mutableListOf<InboxMessage>()
        cursor.use { c ->
            while (c.moveToNext()) {
                val mmsId = c.getLong(0)
                val message = MmsContentReader.read(context, mmsId) ?: continue
                messages.add(
                    InboxMessage.MMS(
                        messageId = mmsId.toString(),
                        body = message.body,
                        subject = message.subject,
                        attachments = message.attachments.map {
                            InboxMessage.MMS.Attachment(
                                partId = it.partId,
                                contentType = it.contentType,
                                name = it.name,
                                size = it.size,
                                data = it.data
                            )
                        },
                        address = message.sender,
                        date = message.date,
                        subscriptionId = message.subscriptionId
                    )
                )
            }
        }

        return messages
    }

}
