package me.capcom.smsgateway.modules.iphone

import android.content.Context
import android.content.ContextWrapper
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import me.capcom.smsgateway.modules.directory.DirectoryDb
import me.capcom.smsgateway.modules.directory.DirectoryService
import org.json.JSONArray
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import java.util.UUID

/** Test-owned databases, preferences and synthetic subscriptions. No modem, network or Provider. */
@RunWith(AndroidJUnit4::class)
class MultiPeerHubTest {
    private val prefix="peer-fixture-"+UUID.randomUUID().toString()+"-"
    private val localSlots=mutableMapOf(1 to 31, 2 to 32)
    private lateinit var ctx:Context
    private lateinit var hub:PeerHub
    private lateinit var directory:DirectoryService

    @Before fun setup(){
        val target=InstrumentationRegistry.getInstrumentation().targetContext
        ctx=object:ContextWrapper(target){
            override fun getSharedPreferences(name:String,mode:Int)=baseContext.getSharedPreferences(prefix+name,mode)
        }
        directory=DirectoryService(ctx,DirectoryDb(ctx,prefix+"directory"))
        hub=PeerHub(ctx,prefix+"peers",DeviceRegistry(ctx,{true}){localSlots.toMap()}){directory}
    }
    @After fun close(){
        hub.close()
        directory.database.close()
        ctx.deleteDatabase(prefix+"directory")
        ctx.deleteDatabase(prefix+"peers")
        for(name in listOf("iphone","peer-hub"))ctx.getSharedPreferences(name,0).edit().clear().commit()
    }
    private fun enroll(token:String,previous:String?=null):String {
        val invite=hub.invite()
        assertEquals("pending",hub.requestLink(invite,token,"测试设备",previous))
        assertNull(hub.deviceForToken(token))
        hub.approve(hub.pending()!!.first)
        assertEquals("ok",hub.requestLink(invite,token,"测试设备"))
        return requireNotNull(hub.deviceForToken(token))
    }
    private fun packet(slots:Map<Int,Int> = mapOf(1 to 41,2 to 42))=JSONObject()
        .put("protocol",3).put("slots",JSONObject().apply {slots.forEach{(s,sub)->put(s.toString(),sub)}})
        .put("states",JSONObject()).put("receipts",JSONArray()).put("rows",JSONArray())
    private fun historyPacket(body:String):JSONObject {
        val row=JSONObject().put("id","sms:1").put("address","fixture").put("display","fixture").put("body",body)
            .put("date",1).put("incoming",true).put("read",true).put("sim",1).put("state","received")
        return packet().put("rows",JSONArray().put(row))
    }

    @Test fun invalidWireRecordDoesNotPartiallyCommitEarlierRows() {
        val token=PrivateStore.token()
        enroll(token)
        val data=historyPacket("valid first row")
        data.getJSONArray("rows").put(JSONObject().put("id","sms:2"))
        assertTrue(runCatching{hub.sync(token,data)}.exceptionOrNull() is IllegalArgumentException)
        assertTrue(hub.page(Long.MAX_VALUE).isEmpty())
    }

    @Test fun excessiveWireSnapshotCannotReplaceLastValidLineBindings(){
        val token=PrivateStore.token()
        enroll(token)
        hub.sync(token,packet())
        val tooLarge=(1..257).associateWith { it }
        assertTrue(runCatching { hub.sync(token,packet(tooLarge)) }.isFailure)
        assertEquals(setOf(41,42),hub.lines().map{it["subscriptionId"]}.toSet())
        assertTrue(runCatching { hub.sync(token,packet(mapOf(Int.MAX_VALUE to 55))) }.isFailure)
    }

    @Test fun v2DatabaseAndCredentialsUpgradeWithoutRepairingOrReplayingUnknown() {
        val token=PrivateStore.token()
        ctx.getSharedPreferences("peer-hub",0).edit()
            .putString("auth",PrivateStore.hash(token)).putString("slots","{\"1\":41,\"2\":42}")
            .putString("sim.1","旧卡").commit()
        val id=UUID.randomUUID().toString()
        val history=historyPacket("old").getJSONArray("rows").getJSONObject(0).put("id","xia:7").put("sim",101)
        val send=JSONObject(history.toString()).put("id",id).put("incoming",false).put("state","unknown")
        ctx.openOrCreateDatabase(prefix+"peers",Context.MODE_PRIVATE,null).use { old->
            old.execSQL("CREATE TABLE history(id INTEGER PRIMARY KEY,row TEXT NOT NULL)")
            old.execSQL("CREATE TABLE sends(id TEXT PRIMARY KEY,row TEXT NOT NULL,sub INTEGER NOT NULL,phase TEXT NOT NULL,checked INTEGER NOT NULL DEFAULT 0)")
            old.execSQL("CREATE TABLE push_events(id TEXT PRIMARY KEY,address TEXT NOT NULL)")
            old.execSQL("INSERT INTO history VALUES(7,?)",arrayOf(history.toString()))
            old.execSQL("INSERT INTO sends VALUES(?,?,41,'handed',0)",arrayOf(id,send.toString()))
            old.execSQL("INSERT INTO push_events VALUES('7','fixture')")
            old.version=2
        }
        assertEquals("peer",hub.deviceForToken(token))
        assertEquals("xia:7",hub.page(Long.MAX_VALUE).single().id)
        assertEquals(7L,hub.pageCursor("xia:7"))
        val reply=hub.sync(token,packet().put("protocol",2))
        assertFalse(reply.has("job"))
        assertEquals(id,reply.getJSONArray("inspect").getString(0))
        assertEquals("unknown",hub.sent(id)!!.state)
        assertEquals("旧卡",hub.lines().single{it["id"]==101}["simName"])
    }

    @Test fun overlappingProviderIdsAndSlotsDoNotCrossDevices() {
        val first=PrivateStore.token(); val a=enroll(first)
        hub.sync(first,historyPacket("fixture A"))
        assertEquals(4,hub.allLines().size)
        val second=PrivateStore.token(); val b=enroll(second)
        hub.sync(second,historyPacket("fixture B"))
        val all=hub.allLines()
        assertEquals(6,all.size)
        assertEquals(6,all.map{it["lineId"]}.distinct().size)
        assertEquals(listOf("fixture B"),hub.page(Long.MAX_VALUE,setOf(b)).map{it.body})
        assertEquals(setOf(a+":1",b+":1"),hub.page(Long.MAX_VALUE).map{it.id}.toSet())
        val id=UUID.randomUUID().toString()
        val alias=all.single{it["deviceId"]==a && it["slot"]==1}["id"] as Int
        hub.queue(id,"fixture","test",alias)
        val spoof=packet().put("receipts",JSONArray().put(id)).put("states",JSONObject().put(id,"delivered"))
        assertFalse(hub.sync(second,spoof).has("job"))
        assertNull(hub.sent(id,setOf(b)))
        val firstOffer=hub.sync(first,packet()).getJSONObject("job")
        assertEquals(1,firstOffer.getInt("slot"));assertEquals(41,firstOffer.getInt("sub"))
        assertEquals(id,hub.sync(first,packet()).getJSONObject("job").getString("id"))
        hub.sync(second,spoof)
        assertEquals("unknown",hub.sent(id)!!.state)
        val received=hub.sync(first,packet().put("receipts",JSONArray().put(id)))
        assertFalse(received.has("job"))
    }

    @Test fun changedSubscriptionRequiresOperatorAndCannotReuseDraftAlias() {
        val token=PrivateStore.token();val id=enroll(token)
        hub.sync(token,packet())
        val old=hub.lines().single{it["deviceId"]==id && it["slot"]==1}
        hub.sync(token,packet(mapOf(1 to 99)))
        assertFalse(hub.line(old["lineId"] as String)!!["smsAvailable"] as Boolean)
        val replacement=hub.lines().single{it["subscriptionId"]==99}
        assertNotEquals(old["lineId"],replacement["lineId"])
        assertEquals(false,replacement["confirmed"])
        assertTrue(runCatching{hub.queue(UUID.randomUUID().toString(),"x","y",replacement["id"] as Int)}.isFailure)
        hub.confirmLine(replacement["lineId"] as String)
        assertEquals(true,hub.line(replacement["lineId"] as String)!!["smsAvailable"])
        val local=hub.allLines().single{it["deviceId"]=="server"&&it["slot"]==1}
        hub.bindLocalSend("iphone:fixture",local["id"] as Int,local["lineId"] as String)
        localSlots[1]=88
        hub.allLines()
        assertEquals(31,hub.expectedSub("iphone:fixture",1))
        assertTrue(runCatching{hub.bindLocalSend("iphone:fixture",local["id"] as Int)}.isFailure)
    }

    @Test fun revokeAndRejoinRotatesCredentialWithoutDroppingHistory() {
        val old=PrivateStore.token(); val id=enroll(old)
        hub.sync(old,historyPacket("original"))
        hub.revoke(id)
        assertNull(hub.deviceForToken(old))
        assertTrue(runCatching{hub.sync(old,packet())}.isFailure)
        val fresh=PrivateStore.token()
        assertEquals(id,enroll(fresh,old))
        assertNull(hub.deviceForToken(old))
        assertEquals("original",hub.page(Long.MAX_VALUE,setOf(id)).single().body)
        assertEquals("forbidden",hub.requestLink(hub.invite(),old,"旧凭证"))
    }
}
