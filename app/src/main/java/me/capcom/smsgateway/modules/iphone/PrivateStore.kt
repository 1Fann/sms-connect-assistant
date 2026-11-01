package me.capcom.smsgateway.modules.iphone

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import java.security.MessageDigest
import java.security.SecureRandom

/** Only hashes and metadata are stored here, never SMS bodies or raw session keys. */
class PrivateStore(context: Context, databaseName:String="iphone.db") : SQLiteOpenHelper(context, databaseName, null, 8) {
    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL("CREATE TABLE sessions (hash TEXT PRIMARY KEY, name TEXT NOT NULL, expires INTEGER NOT NULL)")
        db.execSQL("CREATE TABLE requests (id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, created INTEGER NOT NULL, generation INTEGER NOT NULL DEFAULT 1, rejected INTEGER NOT NULL DEFAULT 0)")
        createSubmissionJournal(db)
        db.execSQL("CREATE TABLE reads (address TEXT PRIMARY KEY, seen INTEGER NOT NULL)")
        db.execSQL("CREATE TABLE subscriptions (endpoint TEXT PRIMARY KEY, owner TEXT NOT NULL)")
        db.execSQL("CREATE TABLE refresh (hash TEXT PRIMARY KEY, owner TEXT NOT NULL, expires INTEGER NOT NULL)")
        createConversations(db)
        addPreviewKeys(db)
        migrateInstallations(db)
    }
    override fun onUpgrade(db: SQLiteDatabase, old: Int, new: Int) {
        if(old<6) {
            db.execSQL("ALTER TABLE requests ADD COLUMN generation INTEGER NOT NULL DEFAULT 1")
            db.execSQL("ALTER TABLE requests ADD COLUMN rejected INTEGER NOT NULL DEFAULT 0")
            createSubmissionJournal(db)
        }
        if(old<2) db.execSQL("CREATE TABLE subscriptions (endpoint TEXT PRIMARY KEY, owner TEXT NOT NULL)")
        if(old<3) db.execSQL("CREATE TABLE refresh (hash TEXT PRIMARY KEY, owner TEXT NOT NULL, expires INTEGER NOT NULL)")
        if(old<4) createConversations(db)
        if(old<7) addPreviewKeys(db)
        if(old<8) migrateInstallations(db)
        if(old==4) {
            db.execSQL("ALTER TABLE conversations ADD COLUMN muted INTEGER NOT NULL DEFAULT 0")
            db.execSQL("ALTER TABLE conversations ADD COLUMN region TEXT NOT NULL DEFAULT 'CN'")
        }
    }
    private fun createSubmissionJournal(db:SQLiteDatabase) {
        db.execSQL("CREATE TABLE submissions(id TEXT NOT NULL, phone TEXT NOT NULL, PRIMARY KEY(id,phone))")
        db.execSQL("CREATE TABLE peer_receipts(id TEXT PRIMARY KEY)")
    }
    /** A durable claim precedes the modem call. Never erase it when message logs expire. */
    fun claimSubmission(id:String,phone:String):Boolean = synchronized(REQUEST_LOCK) {
        val values=android.content.ContentValues().apply { put("id",id);put("phone",phone) }
        writableDatabase.insertWithOnConflict("submissions",null,values,SQLiteDatabase.CONFLICT_IGNORE)!=-1L
    }
    fun rejected(id:String):Boolean = readableDatabase.rawQuery("SELECT rejected FROM requests WHERE id=?",arrayOf(id)).use { it.moveToFirst() && it.getInt(0)!=0 }
    /** Generation 2 can repair reserve-before-enqueue crashes; modem claims make replay safe. */
    fun enqueueOnce(id:String,fingerprint:String,present:()->Boolean,enqueue:()->Unit) = synchronized(REQUEST_LOCK) {
        val generation=readableDatabase.rawQuery("SELECT fingerprint,generation,rejected FROM requests WHERE id=?",arrayOf(id)).use {
            if(!it.moveToFirst())null else { require(it.getString(0)==fingerprint); if(it.getInt(2)!=0)return@synchronized;it.getInt(1) }
        }
        if(generation==1 || present())return@synchronized // Legacy ambiguity remains non-retryable.
        if(generation==null)writableDatabase.execSQL("INSERT INTO requests(id,fingerprint,created,generation) VALUES(?,?,?,2)",arrayOf(id,fingerprint,System.currentTimeMillis()))
        enqueue()
    }
    fun rejectPeer(id:String,fingerprint:String) = synchronized(REQUEST_LOCK) {
        enqueueOnce(id,fingerprint,{false}) { writableDatabase.execSQL("UPDATE requests SET rejected=1 WHERE id=?",arrayOf(id)) }
    }
    fun receipt(id:String) { writableDatabase.execSQL("INSERT OR IGNORE INTO peer_receipts VALUES(?)",arrayOf(id)) }
    fun receipts():List<String> = readableDatabase.rawQuery("SELECT id FROM peer_receipts ORDER BY rowid LIMIT 100",null).use { c->buildList { while(c.moveToNext())add(c.getString(0)) } }
    fun acknowledgeReceipts(ids:List<String>) { val db=writableDatabase;db.beginTransaction();try { ids.forEach { db.delete("peer_receipts","id=?",arrayOf(it)) };db.setTransactionSuccessful() }finally{db.endTransaction()} }
    private fun createConversations(db: SQLiteDatabase) = db.execSQL("CREATE TABLE conversations (address TEXT PRIMARY KEY, pinned INTEGER NOT NULL, removed_before INTEGER NOT NULL, unread INTEGER NOT NULL, muted INTEGER NOT NULL DEFAULT 0, region TEXT NOT NULL DEFAULT 'CN')")
    fun conversations(): List<ConversationState> = readableDatabase.rawQuery("SELECT address,pinned,removed_before,unread,muted,region FROM conversations",null).use { c ->
        buildList { while(c.moveToNext()) add(ConversationState(c.getString(0),c.getLong(1),c.getLong(2),c.getInt(3)!=0,c.getInt(4)!=0,c.getString(5))) }
    }
    // Legacy global rows form the upgrade baseline. New writes belong only to
    // the same authorised device set (including across a token rotation).
    fun scopedStates(scope:String):List<ConversationState> {
        val rows=conversations().associateByTo(mutableMapOf()){it.address}
        readableDatabase.rawQuery("SELECT address,pinned,removed_before,unread,muted,region FROM scope_conversations WHERE scope=?",arrayOf(scope)).use { c->
            while(c.moveToNext())rows[c.getString(0)]=ConversationState(c.getString(0),c.getLong(1),c.getLong(2),c.getInt(3)!=0,c.getInt(4)!=0,c.getString(5))
        }
        return rows.values.toList()
    }
    @Synchronized fun updateConversation(address: String, action: String, region: String = "CN", scope:String?=null): List<ConversationState> {
        require(address.isNotBlank() && address.length<=100 && address.none { it.isISOControl() })
        require(region in com.google.i18n.phonenumbers.PhoneNumberUtil.getInstance().supportedRegions)
        val db=writableDatabase
        db.beginTransaction()
        try {
            val states=if(scope==null)conversations() else scopedStates(scope)
            val current=states.find { it.address==address } ?: ConversationState(address,region=region)
            val next=ConversationRules.change(current,action,System.currentTimeMillis(),states.count { it.pinned>0 })
            val values=arrayOf<Any>(next.address,next.pinned,next.removedBefore,if(next.unread)1 else 0,if(next.muted)1 else 0,if(action=="mute")region else next.region)
            if(scope==null)db.execSQL("INSERT OR REPLACE INTO conversations VALUES(?,?,?,?,?,?)",values)
            else db.execSQL("INSERT OR REPLACE INTO scope_conversations VALUES(?,?,?,?,?,?,?)",arrayOf<Any>(scope,*values))
            val result=if(scope==null)conversations() else scopedStates(scope)
            db.setTransactionSuccessful()
            return result
        } finally { db.endTransaction() }
    }
    private fun migrateInstallations(db: SQLiteDatabase) {
        db.execSQL("CREATE TABLE scope_conversations(scope TEXT NOT NULL,address TEXT NOT NULL,pinned INTEGER NOT NULL,removed_before INTEGER NOT NULL,unread INTEGER NOT NULL,muted INTEGER NOT NULL,region TEXT NOT NULL,PRIMARY KEY(scope,address))")
        db.execSQL("CREATE TABLE scope_reads(scope TEXT NOT NULL,address TEXT NOT NULL,seen INTEGER NOT NULL,PRIMARY KEY(scope,address))")
        db.execSQL("ALTER TABLE sessions ADD COLUMN app TEXT NOT NULL DEFAULT 'sms'")
        db.execSQL("ALTER TABLE sessions ADD COLUMN installation TEXT NOT NULL DEFAULT ''")
        db.execSQL("ALTER TABLE sessions ADD COLUMN grants TEXT NOT NULL DEFAULT 'sms.read,sms.send,contacts.read,device:server,device:peer'")
        db.execSQL("UPDATE sessions SET installation=lower(hex(randomblob(16))) WHERE installation=''")
    }

    private fun addPreviewKeys(db: SQLiteDatabase) {
        db.execSQL("ALTER TABLE subscriptions ADD COLUMN public_key BLOB")
        db.execSQL("ALTER TABLE subscriptions ADD COLUMN auth_key BLOB")
    }
    data class Subscription(val endpoint: String, val publicKey: ByteArray?, val auth: ByteArray?, val grants:String="", val installation:String="")
    fun subscribe(endpoint: String, token: String, publicKey: ByteArray?, auth: ByteArray?) {
        require(WebPush.validEndpoint(endpoint))
        if(publicKey != null) PushEncryption.publicKey(publicKey)
        require((publicKey == null && auth == null) || (publicKey != null && auth?.size == 16))
        val db = writableDatabase
        db.beginTransaction()
        try {
            require(!db.rawQuery("SELECT 1 FROM subscriptions WHERE endpoint=? AND owner<>?",arrayOf(endpoint,hash(token))).use { it.moveToFirst() }) { "通知订阅已关联另一实例" }
            unsubscribe(token)
            db.execSQL("INSERT OR REPLACE INTO subscriptions(endpoint,owner,public_key,auth_key) VALUES(?,?,?,?)",
                arrayOf(endpoint,hash(token),publicKey,auth))
            db.setTransactionSuccessful()
        } finally { db.endTransaction() }
    }
    fun disablePreview(token: String) = writableDatabase.execSQL(
        "UPDATE subscriptions SET public_key=NULL, auth_key=NULL WHERE owner=?", arrayOf(hash(token))
    )
    fun previewEnabled(token: String) = readableDatabase.rawQuery(
        "SELECT 1 FROM subscriptions WHERE owner=? AND public_key IS NOT NULL", arrayOf(hash(token))
    ).use { it.moveToFirst() }
    fun subscriptions(app: String = "sms", device: String = ""): List<Subscription> = readableDatabase.rawQuery(
        "SELECT endpoint,public_key,auth_key,grants,installation FROM subscriptions JOIN sessions ON owner=hash WHERE app=? AND ((app='sms' OR instr(','||grants||',',',calls.read,')>0) AND (?='' OR instr(','||grants||',', ',device:' || ? || ',')>0)) AND (expires>? OR EXISTS(SELECT 1 FROM refresh WHERE refresh.owner=sessions.hash AND refresh.expires>?))",
        arrayOf(app,device,device,System.currentTimeMillis().toString(),System.currentTimeMillis().toString())
    ).use { c -> buildList {
        while(c.moveToNext()) add(Subscription(c.getString(0), if(c.isNull(1)) null else c.getBlob(1), if(c.isNull(2)) null else c.getBlob(2),c.getString(3),c.getString(4)))
    } }
    fun removeSubscription(endpoint: String) = writableDatabase.execSQL("DELETE FROM subscriptions WHERE endpoint=?",arrayOf(endpoint))
    fun unsubscribe(token: String) = writableDatabase.execSQL("DELETE FROM subscriptions WHERE owner=?",arrayOf(hash(token)))
    data class Install(val name: String, val app: String, val installation: String, val grants: String) {
        fun allows(scope: String) = scope in grants.split(',')
        fun nodes() = grants.split(',').filter { it.startsWith("device:") }.map { it.removePrefix("device:") }.toSet()
    }
    fun install(token: String, app: String): Install? = readableDatabase.rawQuery(
        "SELECT name,app,installation,grants FROM sessions WHERE hash=? AND app=? AND expires>?",
        arrayOf(hash(token),app,System.currentTimeMillis().toString())
    ).use { if(it.moveToFirst()) Install(it.getString(0),it.getString(1),it.getString(2),it.getString(3)) else null }

    fun session(token: String) = install(token, "sms") != null
    fun authorize(token: String, grant: Install) {
        writableDatabase.execSQL("INSERT INTO sessions(hash,name,expires,app,installation,grants) VALUES(?,?,?,?,?,?)",
            arrayOf(hash(token),grant.name.take(60),System.currentTimeMillis()+12*3600_000L,grant.app,grant.installation,grant.grants))
    }
    fun issueRefresh(access: String): String = token().also { writableDatabase.execSQL("INSERT INTO refresh VALUES(?,?,?)",arrayOf(hash(it),hash(access),System.currentTimeMillis()+30L*86400_000)) }
    @Synchronized fun rotate(refreshToken: String, app: String = "sms"): Pair<String,String>? {
        val db=writableDatabase
        db.beginTransaction()
        try {
            val row=db.rawQuery("SELECT owner,name,app,installation,grants FROM refresh JOIN sessions ON owner=sessions.hash WHERE refresh.hash=? AND refresh.expires>? AND app=?",arrayOf(hash(refreshToken),System.currentTimeMillis().toString(),app)).use { if(it.moveToFirst())it.getString(0) to Install(it.getString(1),it.getString(2),it.getString(3),it.getString(4)) else null } ?: return null
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
    fun installations(): List<Install> = readableDatabase.rawQuery(
        "SELECT name,app,installation,grants FROM sessions ORDER BY name",null).use { c->
        buildList { while(c.moveToNext())add(Install(c.getString(0),c.getString(1),c.getString(2),c.getString(3))) }
    }
    fun updateGrants(installation:String,scopes:Set<String>) {
        writableDatabase.execSQL("UPDATE sessions SET grants=? WHERE installation=?",arrayOf(scopes.joinToString(","),installation))
    }
    fun revokeInstallation(id:String) {
        val db=writableDatabase
        db.beginTransaction()
        try {
            for(table in listOf("subscriptions","refresh"))
                db.execSQL("DELETE FROM $table WHERE owner IN (SELECT hash FROM sessions WHERE installation=?)",arrayOf(id))
            db.execSQL("DELETE FROM sessions WHERE installation=?",arrayOf(id))
            db.setTransactionSuccessful()
        } finally { db.endTransaction() }
    }

    fun devices(): List<String> = readableDatabase.rawQuery("SELECT name FROM sessions WHERE expires>?", arrayOf(System.currentTimeMillis().toString())).use { c ->
        buildList { while(c.moveToNext()) add(c.getString(0)) }
    }
    // A durable tombstone precedes enqueue. A crash in between must remain UNKNOWN, never auto-resend.
    @Synchronized fun reserve(id: String, fingerprint: String): Boolean {
        readableDatabase.rawQuery("SELECT fingerprint FROM requests WHERE id=?", arrayOf(id)).use {
            if (it.moveToFirst()) { require(it.getString(0) == fingerprint) { "请求标识已被其他内容使用" }; return false }
        }
        writableDatabase.execSQL("INSERT INTO requests(id,fingerprint,created) VALUES(?,?,?)", arrayOf(id, fingerprint, System.currentTimeMillis()))
        return true
    }
    fun scopedReadTimes(scope:String):Map<String,Long> = readableDatabase.rawQuery("SELECT address,seen FROM scope_reads WHERE scope=?",arrayOf(scope)).use {
        buildMap { while(it.moveToNext())put(it.getString(0),it.getLong(1)) }
    }
    fun markScopedRead(scope:String,address:String,time:Long)=writableDatabase.execSQL(
        "INSERT OR REPLACE INTO scope_reads VALUES(?,?,max(?,coalesce((SELECT seen FROM scope_reads WHERE scope=? AND address=?),0)))",
        arrayOf(scope,address,time,scope,address))
    fun seen(address: String): Long = readableDatabase.rawQuery("SELECT seen FROM reads WHERE address=?", arrayOf(address)).use { if(it.moveToFirst()) it.getLong(0) else 0L }
    fun markRead(address: String, time: Long) = writableDatabase.execSQL("INSERT OR REPLACE INTO reads VALUES(?,max(?,coalesce((SELECT seen FROM reads WHERE address=?),0)))", arrayOf(address, time,address))
    companion object {
        fun smsScope(grants:String)=hash(grants.split(',').filter { it.startsWith("device:") }.sorted().joinToString(","))
        private val REQUEST_LOCK=Any()
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
