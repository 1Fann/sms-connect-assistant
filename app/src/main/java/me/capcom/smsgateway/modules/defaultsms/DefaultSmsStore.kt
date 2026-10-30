package me.capcom.smsgateway.modules.defaultsms

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import android.net.Uri
import android.provider.Telephony
import me.capcom.smsgateway.modules.iphone.WebPushWorker
import me.capcom.smsgateway.modules.receiver.ReceiverService
import me.capcom.smsgateway.modules.receiver.data.InboxMessage
import org.koin.core.component.KoinComponent
import org.koin.core.component.inject
import java.util.Date

/** Private recovery journal. SMS contents are removed after committing to the system inbox. */
class DefaultSmsStore(private val context: Context) : SQLiteOpenHelper(context, "default-sms.db", null, 1), KoinComponent {
    private val receiver: ReceiverService by inject()
    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL("CREATE TABLE incoming (id TEXT PRIMARY KEY, address TEXT, body TEXT, received INTEGER, sent INTEGER, sub INTEGER, done INTEGER NOT NULL DEFAULT 0)")
        db.execSQL("CREATE TABLE mms_notice (id TEXT PRIMARY KEY, pdu BLOB NOT NULL, received INTEGER, sub INTEGER)")
        db.execSQL("CREATE TABLE outgoing (id TEXT, phone TEXT, uri TEXT, parts INTEGER, report INTEGER, PRIMARY KEY(id,phone))")
        db.execSQL("CREATE TABLE callbacks (id TEXT, phone TEXT, kind TEXT, part INTEGER, failed INTEGER, PRIMARY KEY(id,phone,kind,part))")
    }
    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) = Unit

    fun stageIncoming(key: String, address: String, body: String, sent: Long, sub: Int?) = synchronized(lock) {
        writableDatabase.insertWithOnConflict("incoming", null, ContentValues().apply {
            put("id", key); put("address", address); put("body", body); put("sent", sent)
            put("received", System.currentTimeMillis()); put("sub", sub ?: -1)
        }, SQLiteDatabase.CONFLICT_IGNORE)
    }

    fun saveMms(key: String, bytes: ByteArray, sub: Int?) = synchronized(lock) {
        writableDatabase.insertWithOnConflict("mms_notice", null, ContentValues().apply {
            put("id", key); put("pdu", bytes); put("received", System.currentTimeMillis()); put("sub", sub ?: -1)
        }, SQLiteDatabase.CONFLICT_IGNORE)
    }
    fun mmsCount(): Int = readableDatabase.rawQuery("SELECT count(*) FROM mms_notice", null).use { it.moveToFirst(); it.getInt(0) }

    fun drain() = synchronized(lock) {
        if (!DefaultSms.isDefault(context)) return@synchronized
        readableDatabase.rawQuery("SELECT id,address,body,received,sent,sub FROM incoming WHERE done=0", null).use { c ->
            while (c.moveToNext()) {
                val key = c.getString(0); val address = c.getString(1); val body = c.getString(2)
                val received = c.getLong(3); val sent = c.getLong(4); val sub = c.getInt(5)
                // Recover the crash window between provider insert and journal commit.
                val exists = context.contentResolver.query(Telephony.Sms.Inbox.CONTENT_URI, arrayOf("_id"),
                    "address=? AND body=? AND date=? AND date_sent=? AND sub_id=? AND creator=?",
                    arrayOf(address, body, received.toString(), sent.toString(), sub.toString(), context.packageName), null)
                    ?.use { it.moveToFirst() } == true
                if (!exists) checkNotNull(context.contentResolver.insert(Telephony.Sms.Inbox.CONTENT_URI, ContentValues().apply {
                    put("address", address); put("body", body); put("date", received); put("date_sent", sent)
                    put("sub_id", sub); put("read", 0); put("seen", 0); put("creator", context.packageName)
                    if (address.isNotBlank()) put("thread_id", Telephony.Threads.getOrCreateThreadId(context, address))
                }))
                // The gateway's incoming store already deduplicates webhook events.
                receiver.process(context, InboxMessage.Text(body, address, Date(sent), sub.takeIf { it >= 0 }), true)
                WebPushWorker.enqueue(context,address)
                DefaultSms.notify(context, "收到新短信，点按查看")
                writableDatabase.update("incoming", ContentValues().apply {
                    put("done", 1); putNull("body"); putNull("address")
                }, "id=?", arrayOf(key))
            }
        }
    }

    fun outgoing(id: String, phone: String, address: String, body: String, date: Long, sub: Int?, parts: Int, report: Boolean) = synchronized(lock) {
        val isDefault = DefaultSms.isDefault(context)
        DefaultSms.note(context, "准备发件；默认角色=$isDefault；系统短信包匹配=${Telephony.Sms.getDefaultSmsPackage(context) == context.packageName}")
        if (!isDefault) return@synchronized
        if (uri(id, phone) != null) return@synchronized
        val existing = context.contentResolver.query(Telephony.Sms.CONTENT_URI, arrayOf("_id"),
            "address=? AND body=? AND date=? AND creator=? AND type<>1",
            arrayOf(address, body, date.toString(), context.packageName), null)?.use {
            if (it.moveToFirst()) Uri.withAppendedPath(Telephony.Sms.CONTENT_URI, it.getLong(0).toString()) else null
        }
        val uri = existing ?: checkNotNull(context.contentResolver.insert(Telephony.Sms.Outbox.CONTENT_URI, ContentValues().apply {
            put("address", address); put("body", body); put("date", date); put("read", 1); put("seen", 1)
            put("sub_id", sub ?: -1); put("status", if (report) 32 else -1); put("creator", context.packageName)
            put("thread_id", Telephony.Threads.getOrCreateThreadId(context, address))
        }))
        writableDatabase.insertOrThrow("outgoing", null, ContentValues().apply {
            put("id", id); put("phone", phone); put("uri", uri.toString()); put("parts", parts); put("report", if (report) 1 else 0)
        })
        DefaultSms.note(context, "已保存系统发件记录；短信分段数=$parts")
    }

    private fun uri(id: String, phone: String): String? = readableDatabase.rawQuery(
        "SELECT uri FROM outgoing WHERE id=? AND phone=?", arrayOf(id, phone)).use { if (it.moveToFirst()) it.getString(0) else null }

    fun callback(id: String, phone: String, kind: String, part: Int, failed: Boolean): Pair<Int, Int>? = synchronized(lock) {
        val target = uri(id, phone) ?: return@synchronized null
        if (part < 0) return@synchronized null
        writableDatabase.execSQL("INSERT OR IGNORE INTO callbacks VALUES (?,?,?,?,?)", arrayOf(id, phone, kind, part, if (failed) 1 else 0))
        if (failed) writableDatabase.execSQL("UPDATE callbacks SET failed=1 WHERE id=? AND phone=? AND kind=? AND part=?", arrayOf(id, phone, kind, part))
        val sent = mutableSetOf<Int>(); val delivered = mutableSetOf<Int>(); var sf = false; var df = false
        readableDatabase.rawQuery("SELECT kind,part,failed FROM callbacks WHERE id=? AND phone=?", arrayOf(id, phone)).use {
            while (it.moveToNext()) {
                if (it.getString(0) == "sent") { if (it.getInt(2) == 1) sf = true else sent.add(it.getInt(1)) }
                else { if (it.getInt(2) == 1) df = true else delivered.add(it.getInt(1)) }
            }
        }
        readableDatabase.rawQuery("SELECT parts,report FROM outgoing WHERE id=? AND phone=?", arrayOf(id, phone)).use {
            it.moveToFirst()
            val (type, status) = SmsPartState(sent, delivered, sf, df).providerState(it.getInt(0), it.getInt(1) == 1)
            // Keep the journal if the role was changed while the modem was sending.
            if (DefaultSms.isDefault(context)) context.contentResolver.update(Uri.parse(target), ContentValues().apply {
                put("type", type); put("status", status)
            }, null, null)
            type to status
        }
    }
    companion object { private val lock = Any() }
}
