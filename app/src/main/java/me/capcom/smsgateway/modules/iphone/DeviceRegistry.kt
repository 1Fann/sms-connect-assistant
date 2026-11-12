package me.capcom.smsgateway.modules.iphone

import android.content.Context
import android.Manifest
import android.content.pm.PackageManager
import androidx.core.content.ContextCompat
import me.capcom.smsgateway.modules.directory.DirectoryProvider
import me.capcom.smsgateway.modules.voice.VoiceGatewayProbe
import android.database.sqlite.SQLiteDatabase
import android.os.SystemClock
import android.os.Build
import me.capcom.smsgateway.helpers.SubscriptionsHelper
import org.json.JSONObject
import java.util.UUID

/**
 * Stable device / line identities are separate from the integer aliases exposed to old
 * browsers. Never recycle an alias: an old draft must not silently switch SIM cards.
 * Android only grants subscription IDs on ordinary phones. Slot/sub changes require
 * confirmation, not an inference from a phone number or carrier display name.
 */
internal class DeviceRegistry(private val ctx: Context,
    private val allowed:(String)->Boolean={ContextCompat.checkSelfPermission(ctx,it)==PackageManager.PERMISSION_GRANTED},
    private val localSlots:()->Map<Int,Int> = { SubscriptionsHelper.activeSubscriptionIdsBySlot(ctx) }
) {
    private data class Presence(val elapsed: Long, val wallTime: Long)
    private val heartbeats = mutableMapOf<String, Presence>()
    private val legacyLabels = PhoneLabels(ctx)
    private var localSnapshot: Map<Int,Int>? = null

    private data class SlotPolicy(val slot:Int,val lineId:String,val name:String,val enabled:Int,val sort:Int)
    private fun slotPolicies(db:SQLiteDatabase,device:String):List<SlotPolicy> = db.rawQuery(
        "SELECT cast(substr(p.name,length(?)+1) AS INTEGER),l.line_id,l.name,l.enabled,l.sort_order FROM line_preferences p JOIN lines l ON l.line_id=p.line_id WHERE instr(p.name,?)=1",
        arrayOf("takeover:$device:","takeover:$device:")
    ).use { c -> buildList { while(c.moveToNext())add(SlotPolicy(c.getInt(0),c.getString(1),c.getString(2),c.getInt(3),c.getInt(4))) } }

    fun setSlotTakeover(db:SQLiteDatabase,device:String,slot:Int,lineId:String,enabled:Boolean) {
        val key="takeover:$device:$slot"
        if(!enabled){db.execSQL("DELETE FROM line_preferences WHERE name=?",arrayOf(key));return}
        db.beginTransaction()
        try {
            db.execSQL("INSERT OR REPLACE INTO line_preferences(name,line_id) VALUES(?,?)",arrayOf(key,lineId))
            db.execSQL("UPDATE lines SET confirmed=1 WHERE line_id=? AND present=1",arrayOf(lineId))
            db.setTransactionSuccessful()
        } finally {db.endTransaction()}
    }


    fun create(db: SQLiteDatabase) {
        db.execSQL("CREATE TABLE devices(device TEXT PRIMARY KEY,auth TEXT UNIQUE,label TEXT NOT NULL,model TEXT NOT NULL DEFAULT '',os TEXT NOT NULL DEFAULT '',last_seen INTEGER NOT NULL DEFAULT 0,protocol INTEGER NOT NULL DEFAULT 1,sms_read INTEGER NOT NULL DEFAULT 1,sms_send INTEGER NOT NULL DEFAULT 1,contacts_read INTEGER NOT NULL DEFAULT 0,contacts_write INTEGER NOT NULL DEFAULT 0,calls_read INTEGER NOT NULL DEFAULT 0,voice_version TEXT NOT NULL DEFAULT '',push_after INTEGER NOT NULL,revoked INTEGER NOT NULL DEFAULT 0)")
        db.execSQL("CREATE TABLE lines(line_id TEXT PRIMARY KEY,alias INTEGER NOT NULL UNIQUE,device TEXT NOT NULL,slot INTEGER NOT NULL,sub INTEGER NOT NULL,name TEXT NOT NULL,present INTEGER NOT NULL,confirmed INTEGER NOT NULL,enabled INTEGER NOT NULL DEFAULT 1,sort_order INTEGER NOT NULL DEFAULT 0,UNIQUE(device,sub))")
        db.execSQL("CREATE INDEX line_slot ON lines(device,slot)")
        db.execSQL("CREATE TABLE line_preferences(name TEXT PRIMARY KEY,line_id TEXT NOT NULL)")
        db.execSQL("CREATE TABLE sms_bindings(request_id TEXT PRIMARY KEY,slot INTEGER NOT NULL,sub INTEGER NOT NULL)")
        db.execSQL("CREATE TABLE invitations(code_hash TEXT PRIMARY KEY,expires INTEGER NOT NULL,pending_auth TEXT,model TEXT,restore_device TEXT)")
        db.execSQL("CREATE TABLE retired_tokens(digest TEXT PRIMARY KEY)")
        db.execSQL("CREATE TABLE client_receipts(scope TEXT NOT NULL,id TEXT NOT NULL,PRIMARY KEY(scope,id))")
        db.execSQL("INSERT INTO devices(device,label,model,os,protocol,push_after) VALUES('server',?,?,?,3,0)",
            arrayOf(legacyLabels.phoneName("server"),Build.MODEL,Build.VERSION.RELEASE))
        val prefs = ctx.getSharedPreferences("peer-hub",0)
        val digest = prefs.getString("auth",null)
        if (digest != null) {
            db.execSQL("INSERT INTO devices(device,auth,label,protocol,push_after) VALUES('peer',?,?,2,?)",
                arrayOf(digest,legacyLabels.phoneName("peer"),prefs.getLong("push-after",System.currentTimeMillis())))
            observe(db,"peer",slotMap(JSONObject(prefs.getString("slots","{}")!!)))
        }
        val invite = prefs.getString("invite",null)
        if (invite != null) db.execSQL("INSERT INTO invitations(code_hash,expires) VALUES(?,?)",arrayOf(invite,prefs.getLong("expiry",0)))
    }

    fun refreshLocal(db:SQLiteDatabase) {
        val slots = localSlots()
        if (localSnapshot == slots) return
        db.beginTransaction()
        try {
            observe(db,"server",slots)
            db.setTransactionSuccessful()
        } finally { db.endTransaction() }
        localSnapshot=slots
    }

    fun observe(db: SQLiteDatabase,device:String,slots:Map<Int,Int>) {
        val prior = db.rawQuery("SELECT alias,slot,sub,present FROM lines WHERE device=?",arrayOf(device)).use { c ->
            buildList { while(c.moveToNext()) add(listOf(c.getInt(0),c.getInt(1),c.getInt(2),c.getInt(3))) }
        }
        if (prior.filter {it[3]==1}.associate {it[1] to it[2]} == slots) return
        val policies=slotPolicies(db,device)
        val preferred=db.rawQuery("SELECT line_id FROM line_preferences WHERE name='default'",null).use { if(it.moveToFirst())it.getString(0) else null }
        db.execSQL("UPDATE lines SET present=0 WHERE device=? AND present=1",arrayOf(device))
        for ((slot,sub) in slots) {
            // Brief absence is common during modem startup. Revoke approval only when
            // a different subscription occupies the slot, or this one moves slots.
            db.execSQL("UPDATE lines SET confirmed=0 WHERE device=? AND slot=? AND sub<>? AND confirmed=1",
                arrayOf(device,slot,sub))
            val existing = prior.firstOrNull { it[2]==sub }
            if (existing != null) {
                db.execSQL("UPDATE lines SET present=1,confirmed=CASE WHEN slot=? THEN confirmed ELSE 0 END,slot=? WHERE device=? AND sub=?",
                    arrayOf(slot,slot,device,sub))
            } else {
                val oldSlot=prior.any { it[1]==slot }
                val legacyAlias=when {
                    device=="server" && slot in 1..4 -> slot
                    device=="peer" && slot in 1..4 -> slot+100
                    else -> null
                }
                val freeLegacy = legacyAlias != null && prior.none { it[0]==legacyAlias }
                val alias=if(freeLegacy) legacyAlias!! else db.rawQuery("SELECT max(9999,coalesce(max(alias),0))+1 FROM lines",null).use{it.moveToFirst();it.getInt(0)}
                val name=if(freeLegacy) legacyLabels.simName(alias) else "卡 "+slot
                db.execSQL("INSERT INTO lines(line_id,alias,device,slot,sub,name,present,confirmed) VALUES(?,?,?,?,?,?,1,?)",
                    arrayOf(UUID.randomUUID().toString(),alias,device,slot,sub,name,if(oldSlot)0 else 1))
            }
        }
        for(policy in policies) {
            val sub=slots[policy.slot] ?: continue
            val line=db.rawQuery("SELECT line_id FROM lines WHERE device=? AND sub=? AND present=1",arrayOf(device,sub.toString())).use {
                check(it.moveToFirst());it.getString(0)
            }
            db.execSQL("UPDATE lines SET name=?,enabled=?,sort_order=?,confirmed=1 WHERE line_id=?",
                arrayOf(policy.name,policy.enabled,policy.sort,line))
            db.execSQL("UPDATE line_preferences SET line_id=? WHERE name=?",arrayOf(line,"takeover:$device:${policy.slot}"))
            if(preferred==policy.lineId)db.execSQL("UPDATE line_preferences SET line_id=? WHERE name='default'",arrayOf(line))
        }
    }

    fun seen(device: String, wallTime: Long) {
        heartbeats[device] = Presence(SystemClock.elapsedRealtime(), wallTime)
    }
    fun offline(device:String) { heartbeats.remove(device) }
    fun online(device:String):Boolean = device=="server" || heartbeats[device]?.let { SystemClock.elapsedRealtime()-it.elapsed in 0..15000 } == true

    fun devices(db:SQLiteDatabase):List<Map<String,Any>> = db.rawQuery("SELECT device,label,model,os,last_seen,protocol,sms_read,sms_send,contacts_read,contacts_write,calls_read,voice_version FROM devices WHERE revoked=0 ORDER BY rowid",null).use{ c->
        buildList { while(c.moveToNext()) {
            val id=c.getString(0)
            val features=listOf("sms.read","sms.send","contacts.read","contacts.write","calls.read")
            val capabilities=if(id=="server"){
                val directory=DirectoryProvider(ctx)
                features.filter{ when(it){
                    "sms.read"->allowed(Manifest.permission.READ_SMS)
                    "sms.send"->allowed(Manifest.permission.SEND_SMS)
                    else->directory.allowed(it)
                }}
            }else features.filterIndexed { index,_-> c.getInt(index+6)!=0 }
            val version=if(id=="server")runCatching{VoiceGatewayProbe.detect(ctx)["version"] as? String}.getOrNull().orEmpty() else c.getString(11)
            add(mapOf("id" to id,"deviceId" to id,"name" to c.getString(1),"model" to c.getString(2),"androidVersion" to c.getString(3),
                "voiceAgentVersion" to version,"lastSeen" to (if(id=="server") System.currentTimeMillis() else heartbeats[id]?.wallTime ?: c.getLong(4)),"protocol" to c.getInt(5),"online" to online(id),
                "role" to if(id=="server")"server" else "peer","capabilities" to capabilities))
        }}
    }

    fun lines(db:SQLiteDatabase):List<Map<String,Any>> = db.rawQuery(
        "SELECT l.alias,l.line_id,l.device,d.label,l.slot,l.sub,l.name,l.present,l.confirmed,d.sms_send,l.enabled,l.sort_order,EXISTS(SELECT 1 FROM line_preferences p WHERE p.name='default' AND p.line_id=l.line_id),EXISTS(SELECT 1 FROM line_preferences p WHERE p.name='takeover:' || l.device || ':' || l.slot) FROM lines l JOIN devices d ON d.device=l.device WHERE d.revoked=0 OR EXISTS(SELECT 1 FROM line_preferences p WHERE p.name='default' AND p.line_id=l.line_id) ORDER BY l.sort_order,d.rowid,l.slot,l.alias",null
    ).use{ c-> buildList {while(c.moveToNext()){
        val device=c.getString(2)
        val confirmed=c.getInt(8)!=0
        val enabled=c.getInt(10)!=0
        val lineOnline=online(device)&&c.getInt(7)!=0&&confirmed&&enabled
        val available=lineOnline&& (if(device=="server")allowed(Manifest.permission.SEND_SMS) else c.getInt(9)!=0)
        val name=c.getString(3)+" · "+c.getString(6)
        add(mapOf("id" to c.getInt(0),"lineId" to c.getString(1),"phoneId" to device,"deviceId" to device,"phoneName" to c.getString(3),
            "slot" to c.getInt(4),"subscriptionId" to c.getInt(5),"simName" to c.getString(6),"name" to name,
            "deviceOnline" to online(device),"lineOnline" to lineOnline,"enabled" to enabled,"sortOrder" to c.getInt(11),"isDefault" to (c.getInt(12)!=0),
            "followSlot" to (c.getInt(13)!=0),"confirmed" to confirmed,"present" to (c.getInt(7)!=0),"online" to available,"smsAvailable" to available,"voiceAvailable" to false))
    }} }

    companion object {
        fun slotMap(slots:JSONObject):Map<Int,Int> {
            // This is a wire-resource ceiling for one radio's heartbeat, not a limit on registered devices.
            require(slots.length()<=256) { "单次 SIM 心跳超过上限" }
            val result = slots.keys().asSequence().associate { key ->
                val slot=key.toInt()
                val sub=slots.opt(key)?.toString()?.toIntOrNull()
                require(slot in 1..65535 && sub!=null && sub>=0 && key==slot.toString())
                slot to sub
            }
            require(result.values.distinct().size == result.size)
            return result
        }
    }
}
