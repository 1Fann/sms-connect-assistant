package me.capcom.smsgateway.modules.iphone

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import java.security.MessageDigest
import java.security.SecureRandom

/** Only hashes and metadata are stored here, never SMS bodies or raw session keys. */
class PrivateStore(context: Context) : SQLiteOpenHelper(context, "iphone.db", null, 5) {
    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL("CREATE TABLE sessions (hash TEXT PRIMARY KEY, name TEXT NOT NULL, expires INTEGER NOT NULL)")
        db.execSQL("CREATE TABLE requests (id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, created INTEGER NOT NULL)")
        db.execSQL("CREATE TABLE reads (address TEXT PRIMARY KEY, seen INTEGER NOT NULL)")
        db.execSQL("CREATE TABLE subscriptions (endpoint TEXT PRIMARY KEY, owner TEXT NOT NULL)")
        db.execSQL("CREATE TABLE refresh (hash TEXT PRIMARY KEY, owner TEXT NOT NULL, expires INTEGER NOT NULL)")
        createConversations(db)
    }
    override fun onUpgrade(db: SQLiteDatabase, old: Int, new: Int) {
        if(old<2) db.execSQL("CREATE TABLE subscriptions (endpoint TEXT PRIMARY KEY, owner TEXT NOT NULL)")
        if(old<3) db.execSQL("CREATE TABLE refresh (hash TEXT PRIMARY KEY, owner TEXT NOT NULL, expires INTEGER NOT NULL)")
        if(old<4) createConversations(db)
        if(old==4) {
            db.execSQL("ALTER TABLE conversations ADD COLUMN muted INTEGER NOT NULL DEFAULT 0")
            db.execSQL("ALTER TABLE conversations ADD COLUMN region TEXT NOT NULL DEFAULT 'CN'")
        }
    }
    private fun createConversations(db: SQLiteDatabase) = db.execSQL("CREATE TABLE conversations (address TEXT PRIMARY KEY, pinned INTEGER NOT NULL, removed_before INTEGER NOT NULL, unread INTEGER NOT NULL, muted INTEGER NOT NULL DEFAULT 0, region TEXT NOT NULL DEFAULT 'CN')")
    fun conversations(): List<ConversationState> = readableDatabase.rawQuery("SELECT address,pinned,removed_before,unread,muted,region FROM conversations",null).use { c ->
        buildList { while(c.moveToNext()) add(ConversationState(c.getString(0),c.getLong(1),c.getLong(2),c.getInt(3)!=0,c.getInt(4)!=0,c.getString(5))) }
    }
    @Synchronized fun updateConversation(address: String, action: String, region: String = "CN"): List<ConversationState> {
        require(address.isNotBlank() && address.length<=100 && address.none { it.isISOControl() })
        require(region in com.google.i18n.phonenumbers.PhoneNumberUtil.getInstance().supportedRegions)
        val db=writableDatabase
        db.beginTransaction()
        try {
            val states=conversations()
            val current=states.find { it.address==address } ?: ConversationState(address,region=region)
            val next=ConversationRules.change(current,action,System.currentTimeMillis(),states.count { it.pinned>0 })
            db.execSQL("INSERT OR REPLACE INTO conversations VALUES(?,?,?,?,?,?)",arrayOf(next.address,next.pinned,next.removedBefore,if(next.unread) 1 else 0,if(next.muted) 1 else 0,if(action=="mute")region else next.region))
            val result=conversations()
            db.setTransactionSuccessful()
            return result
        } finally { db.endTransaction() }
    }
    fun subscribe(endpoint: String,token: String) {
        require(WebPush.validEndpoint(endpoint))
        writableDatabase.execSQL("DELETE FROM subscriptions WHERE owner=?",arrayOf(hash(token)))
        writableDatabase.execSQL("INSERT OR REPLACE INTO subscriptions VALUES(?,?)",arrayOf(endpoint,hash(token)))
    }
    fun subscriptions(): List<String> = readableDatabase.rawQuery("SELECT endpoint FROM subscriptions JOIN sessions ON owner=hash",null).use { c->buildList { while(c.moveToNext())add(c.getString(0)) } }
    fun removeSubscription(endpoint: String) = writableDatabase.execSQL("DELETE FROM subscriptions WHERE endpoint=?",arrayOf(endpoint))
    fun unsubscribe(token: String) = writableDatabase.execSQL("DELETE FROM subscriptions WHERE owner=?",arrayOf(hash(token)))
    fun session(token: String): Boolean = readableDatabase.rawQuery(
        "SELECT 1 FROM sessions WHERE hash=? AND expires>?", arrayOf(hash(token), System.currentTimeMillis().toString())
    ).use { it.moveToFirst() }
    fun authorize(token: String, name: String) {
        writableDatabase.execSQL("INSERT INTO sessions VALUES(?,?,?)", arrayOf(hash(token), name.take(60), System.currentTimeMillis() + 12 * 3600_000L))
    }
    fun issueRefresh(access: String): String = token().also { writableDatabase.execSQL("INSERT INTO refresh VALUES(?,?,?)",arrayOf(hash(it),hash(access),System.currentTimeMillis()+30L*86400_000)) }
    @Synchronized fun rotate(refreshToken: String): Pair<String,String>? {
        val db=writableDatabase
        db.beginTransaction()
        try {
            val row=db.rawQuery("SELECT owner,name FROM refresh JOIN sessions ON owner=sessions.hash WHERE refresh.hash=? AND refresh.expires>?",arrayOf(hash(refreshToken),System.currentTimeMillis().toString())).use { if(it.moveToFirst())it.getString(0) to it.getString(1) else null } ?: return null
            val access=token();authorize(access,row.second)
            db.execSQL("UPDATE subscriptions SET owner=? WHERE owner=?",arrayOf(hash(access),row.first))
            db.execSQL("DELETE FROM sessions WHERE hash=?",arrayOf(row.first))
            db.execSQL("DELETE FROM refresh WHERE owner=?",arrayOf(row.first))
            val next=issueRefresh(access);db.setTransactionSuccessful();return access to next
        } finally { db.endTransaction() }
    }
    fun revoke() { writableDatabase.execSQL("DELETE FROM sessions");writableDatabase.execSQL("DELETE FROM refresh");writableDatabase.execSQL("DELETE FROM subscriptions") }
    fun recentRequests(): List<String> = readableDatabase.rawQuery("SELECT id FROM requests ORDER BY created DESC LIMIT 200", null).use { c ->
        buildList { while(c.moveToNext()) add(c.getString(0)) }
    }
    fun logout(token: String) { unsubscribe(token);writableDatabase.execSQL("DELETE FROM refresh WHERE owner=?",arrayOf(hash(token)));writableDatabase.execSQL("DELETE FROM sessions WHERE hash=?", arrayOf(hash(token))) }
    fun devices(): List<String> = readableDatabase.rawQuery("SELECT name FROM sessions WHERE expires>?", arrayOf(System.currentTimeMillis().toString())).use { c ->
        buildList { while(c.moveToNext()) add(c.getString(0)) }
    }
    // A durable tombstone precedes enqueue. A crash in between must remain UNKNOWN, never auto-resend.
    @Synchronized fun reserve(id: String, fingerprint: String): Boolean {
        readableDatabase.rawQuery("SELECT fingerprint FROM requests WHERE id=?", arrayOf(id)).use {
            if (it.moveToFirst()) { require(it.getString(0) == fingerprint) { "请求标识已被其他内容使用" }; return false }
        }
        writableDatabase.execSQL("INSERT INTO requests VALUES(?,?,?)", arrayOf(id, fingerprint, System.currentTimeMillis()))
        return true
    }
    fun seen(address: String): Long = readableDatabase.rawQuery("SELECT seen FROM reads WHERE address=?", arrayOf(address)).use { if(it.moveToFirst()) it.getLong(0) else 0L }
    fun markRead(address: String, time: Long) = writableDatabase.execSQL("INSERT OR REPLACE INTO reads VALUES(?,?)", arrayOf(address, time))
    companion object {
        fun token(): String = ByteArray(32).also { SecureRandom().nextBytes(it) }.joinToString("") { "%02x".format(it) }
        fun hash(s: String): String = MessageDigest.getInstance("SHA-256").digest(s.toByteArray()).joinToString("") { "%02x".format(it) }
    }
}

object PhoneIdentity {
    fun normalize(raw: String): String {
        val n = raw.replace(Regex("[\\s()\\-]"), "")
        return when {
            n.matches(Regex("\\+861[3-9][0-9]{9}")) -> n.substring(3)
            n.matches(Regex("861[3-9][0-9]{9}")) -> n.substring(2)
            else -> n
        }
    }
}

/** Global bounded buckets avoid attacker-controlled map growth. */
class WindowLimit(private val count: Int, private val window: Long) {
    private var start = 0L
    private var used = 0
    @Synchronized fun allow(now: Long = android.os.SystemClock.elapsedRealtime()): Boolean {
        if (now - start >= window) { start = now; used = 0 }
        if (used >= count) return false
        used++
        return true
    }
}
