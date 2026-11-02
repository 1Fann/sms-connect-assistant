package me.capcom.smsgateway.modules.directory

import android.content.Context
import android.database.Cursor
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import me.capcom.smsgateway.modules.iphone.ConversationIdentity
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

internal class DirectoryDb(ctx: Context, name:String="commlink-directory.db") : SQLiteOpenHelper(ctx, name, null, 3) {
    override fun onConfigure(db: SQLiteDatabase) { db.setForeignKeyConstraintsEnabled(true) }

    // Separate directory schema. None of the four SMS
    // databases are renamed or rewritten when a phone enables directory sharing.
    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL("""CREATE TABLE contacts (
            id TEXT PRIMARY KEY, alias TEXT, phones TEXT, revision INTEGER NOT NULL DEFAULT 1,
            favorite INTEGER NOT NULL DEFAULT 0, preferred TEXT, deleted INTEGER NOT NULL DEFAULT 0,
            manual INTEGER NOT NULL DEFAULT 0)""")
        db.execSQL("""CREATE TABLE sources (
            device TEXT NOT NULL, raw TEXT NOT NULL, contact TEXT NOT NULL REFERENCES contacts(id),
            revision TEXT NOT NULL, payload TEXT NOT NULL, deleted INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY(device,raw))""")
        db.execSQL("CREATE INDEX sources_contact ON sources(contact,deleted)")
        db.execSQL("""CREATE TABLE identities (
            device TEXT NOT NULL, raw TEXT NOT NULL, number TEXT NOT NULL, PRIMARY KEY(device,raw,number),
            FOREIGN KEY(device,raw) REFERENCES sources(device,raw) ON DELETE CASCADE)""")
        db.execSQL("CREATE INDEX identity_number ON identities(number)")
        db.execSQL("CREATE TABLE alias_identity(contact TEXT NOT NULL REFERENCES contacts(id), number TEXT NOT NULL, PRIMARY KEY(contact,number))")
        db.execSQL("CREATE INDEX alias_number ON alias_identity(number)")
        db.execSQL("""CREATE TABLE jobs (
            id TEXT PRIMARY KEY, contact TEXT NOT NULL, device TEXT NOT NULL, raw TEXT, expected TEXT,
            action TEXT NOT NULL, payload TEXT NOT NULL, state TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '',
            created INTEGER NOT NULL, finished INTEGER)""")
        db.execSQL("CREATE INDEX jobs_pending ON jobs(device,state,created)")
        db.execSQL("CREATE TABLE changes(id TEXT PRIMARY KEY, owner TEXT NOT NULL, action TEXT NOT NULL, fingerprint TEXT NOT NULL, contact TEXT NOT NULL, time INTEGER NOT NULL)")
        db.execSQL("CREATE TABLE calls(device TEXT NOT NULL, raw TEXT NOT NULL, date INTEGER NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(device,raw))")
        db.execSQL("CREATE INDEX call_date ON calls(date)")
        // Per-link, local outgoing journal: ACK only the exact revision offered. A concurrent
        // Provider edit therefore survives a late network response.
        db.execSQL("""CREATE TABLE observed (link TEXT NOT NULL, kind TEXT NOT NULL, raw TEXT NOT NULL,
            version TEXT NOT NULL, payload TEXT NOT NULL, serial INTEGER NOT NULL, dirty INTEGER NOT NULL, gone INTEGER NOT NULL,
            PRIMARY KEY(link,kind,raw))""")
        db.execSQL("CREATE INDEX observed_dirty ON observed(link,dirty)")
        db.execSQL("CREATE TABLE sequences(link TEXT PRIMARY KEY, seq INTEGER NOT NULL)")
        db.execSQL("CREATE TABLE call_baselines(link TEXT PRIMARY KEY, started INTEGER NOT NULL)")
        db.execSQL("CREATE TABLE missed_alerts(device TEXT NOT NULL, event TEXT NOT NULL, PRIMARY KEY(device,event))")
        db.execSQL("CREATE TABLE seen(device TEXT NOT NULL,kind TEXT NOT NULL,raw TEXT NOT NULL,seq INTEGER NOT NULL,PRIMARY KEY(device,kind,raw))")
        db.execSQL("CREATE TABLE grants(device TEXT PRIMARY KEY,contacts INTEGER NOT NULL,writing INTEGER NOT NULL,calls INTEGER NOT NULL)")
        db.execSQL("CREATE TABLE applied(link TEXT NOT NULL,id TEXT NOT NULL,result TEXT NOT NULL,acked INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(link,id))")
        db.execSQL("CREATE TABLE attempts(link TEXT NOT NULL,id TEXT NOT NULL, PRIMARY KEY(link,id))")
        createCallSeen(db)
        createImports(db)
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
        check(oldVersion in 1..2 && newVersion==3){"Unsupported CommLink directory schema upgrade"}
        if(oldVersion<2)createCallSeen(db)
        createImports(db)
    }
    private fun createCallSeen(db:SQLiteDatabase){
        db.execSQL("CREATE TABLE call_seen(installation TEXT NOT NULL,device TEXT NOT NULL,raw TEXT NOT NULL,date INTEGER NOT NULL,PRIMARY KEY(installation,device,raw,date))")
    }
    private fun createImports(db:SQLiteDatabase){
        db.execSQL("CREATE TABLE contact_imports(id TEXT PRIMARY KEY,owner TEXT NOT NULL,fingerprint TEXT NOT NULL,result TEXT NOT NULL,created INTEGER NOT NULL)")
    }
}

internal fun <T> SQLiteDatabase.atomic(block: () -> T): T {
    beginTransaction()
    return try { val result = block(); setTransactionSuccessful(); result } finally { endTransaction() }
}

internal fun <T> SQLiteDatabase.rows(sql: String, vararg args: String, read: (Cursor) -> T): List<T> =
    rawQuery(sql, args).use { cursor -> buildList { while (cursor.moveToNext()) add(read(cursor)) } }

internal fun SQLiteDatabase.scalar(sql: String, vararg args: String): String? =
    rawQuery(sql, args).use { if (it.moveToFirst()) it.getString(0) else null }

internal fun JSONArray.strings(): List<String> = (0 until length()).map { getString(it) }
internal fun JSONArray.objects(): List<JSONObject> = (0 until length()).map { getJSONObject(it) }

internal fun newId() = UUID.randomUUID().toString()
internal fun validId(id: String) = UUID.fromString(id).toString() == id
internal fun sourceKey(region: String, number: String): String? {
    val key = ConversationIdentity.key(number, region)
    // Never collapse two names just because of a short code, an extension, a hidden
    // caller, an alphanumeric sender or the suffix of a national number.
    return key.takeIf { it.matches(Regex("\\+[1-9][0-9]{6,14}")) &&
        runCatching {
            val util = com.google.i18n.phonenumbers.PhoneNumberUtil.getInstance()
            util.isValidNumber(util.parse(it, region))
        }.getOrDefault(false) }
}

/** A user may deliberately label a short code or alphanumeric sender. Only match
 * that exact address in the same region; it never participates in auto-merge. */
internal fun lookupKey(region:String,number:String):String? {
    sourceKey(region,number)?.let{return it}
    val raw=number.trim()
    if(raw.isEmpty() || raw.length>96 || raw.any{it.isISOControl()} ||
        raw.lowercase() in setOf("anonymous","unknown","private","restricted","withheld","未知号码","匿名","-1","-2","-3"))return null
    return "raw:"+region+":"+raw
}
