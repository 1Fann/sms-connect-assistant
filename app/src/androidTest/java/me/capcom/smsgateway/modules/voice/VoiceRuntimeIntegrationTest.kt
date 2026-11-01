package me.capcom.smsgateway.modules.voice

import android.content.Context
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import okhttp3.Protocol
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString
import org.json.JSONArray
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import java.util.UUID

/** Real controller, state journal and ARI command builders. Only the transport, wall clock and grant
 * authority are fixtures. The fake's credential provider throws if a real network request is attempted. */
@RunWith(AndroidJUnit4::class)
class VoiceRuntimeIntegrationTest {
    private val ctx:Context get()=InstrumentationRegistry.getInstrumentation().targetContext
    private val suite="voice-fixture-"+UUID.randomUUID()
    private val dbFile="$suite.db"
    private val line=VoiceLine("line-b","node-b",2,true,72)
    private val owner="test-install"
    private val id=UUID.randomUUID().toString()
    private var time=System.currentTimeMillis()
    private var permission=true
    private var current:VoiceLine?=line
    private val pbx=FixturePbx()
    private lateinit var journal:VoiceJournal
    private lateinit var config:VoiceConfiguration
    private lateinit var engine:VoiceRuntime
    @Before fun setup(){
        ctx.getSharedPreferences(suite,0).edit().putBoolean("enabled",true).putString("bindings","node-b fixture-trunk")
            .putString("web","fixture-web").putString("native","fixture-native").putString("domain","example.invalid")
            .putString("dial-rules","55501*").commit()
        config=VoiceConfiguration(ctx,suite);openEngine()
    }
    private fun openEngine(){
        journal=VoiceJournal(ctx,dbFile)
        engine=VoiceRuntime(ctx,config,journal,pbx,{time},{install,device,_->permission && install==owner && device==line.deviceId})
        engine.liveLine={if(it==line.id)current else null}
        engine.tick();pbx.open();engine.tick()
    }
    @After fun cleanup(){
        engine.stop();journal.close()
        ctx.deleteDatabase(dbFile);ctx.getSharedPreferences(suite,0).edit().clear().commit()
    }
    private fun phase()=engine.read(id,owner)["state"]
    private fun allocate() = engine.create(owner,line,"5550101",id,false).getValue("target").toString().substringAfter("sip:").substringBefore("@")
    private fun webStart():String {
        val target=allocate()
        assertEquals(target,allocate())
        pbx.joinWeb("web-1",target)
        assertEquals("DIALING",phase())
        val outside=pbx.legsByRole.getValue("outside").single()
        assertEquals("PJSIP/fixture-trunk",pbx.origins[outside])
        assertEquals("2",pbx.variables[outside to "PJSIP_HEADER(add,X-VSA-SIM)"])
        assertEquals("5550101",pbx.variables[outside to "PJSIP_HEADER(add,X-VSA-Dial)"])
        pbx.joinWeb("replay",target)
        assertFalse("replay" in pbx.channels)
        pbx.state(outside,"Up");assertEquals("WEB_ACTIVE",phase())
        return outside
    }
    private fun offer():String{
        val request=UUID.randomUUID().toString()
        engine.handoff(id,owner,request);engine.handoff(id,owner,request)
        val n=pbx.legsByRole.getValue("native").single()
        assertEquals(1,pbx.dials.count{it==n})
        pbx.state(n,"Ringing");assertEquals("NATIVE_RINGING",phase())
        pbx.state(n,"Up");assertEquals("MEDIA_VERIFYING",phase())
        val events=journal.readableDatabase.rawQuery("SELECT event FROM events WHERE call_id=? ORDER BY seq",arrayOf(id))
            .use { cur->buildList{while(cur.moveToNext())add(cur.getString(0))} }
        assertTrue(events.indexOf("NATIVE_ANSWERED") in 0 until events.indexOf("MEDIA_VERIFYING"))
        assertTrue(n in pbx.muted);return n
    }
    @Test fun retainsOneExternalDuringMediaProofAndJournalRecovery(){
        val outside=webStart();val native=offer()
        val bridge=pbx.bridges.getValue("cl-"+id)
        assertEquals(setOf(outside,native,"web-1"),bridge.toSet())
        val busy=runCatching{engine.create(owner,line,"5550101",UUID.randomUUID().toString(),false)}.exceptionOrNull()
        assertEquals(409,(busy as VoiceFault).code)
        // Replace the process controller, keeping the SQLite file and PBX channels.
        engine.stop();journal.close();openEngine()
        pbx.stats[native]=RtpSample(100,100);pbx.stats[outside]=RtpSample(200,200);engine.tick()
        pbx.stats[native]=RtpSample(100,101);pbx.stats[outside]=RtpSample(201,201);engine.tick()
        assertEquals("MEDIA_VERIFYING",phase());assertTrue("web-1" in bridge)
        pbx.stats[native]=RtpSample(101,102);pbx.stats[outside]=RtpSample(202,202);engine.tick()
        assertEquals("NATIVE_ACTIVE",phase());assertEquals(setOf(outside,native),bridge.toSet())
        assertFalse(native in pbx.muted)
        assertEquals(1,pbx.dials.count{it==outside});assertFalse(outside in pbx.deleted)
        assertEquals(1,engine.history(owner){true}.size)
        engine.hangup(id,owner);assertEquals("CALL_ENDED",phase());assertFalse(engine.hasActive())
        assertTrue(pbx.channels.isEmpty())
    }
    @Test fun failedNativeMediaPreservesExistingWebAndSimAndAllowsNewTransfer(){
        val outside=webStart();val native=offer()
        pbx.stats[native]=RtpSample(0,7);pbx.stats[outside]=RtpSample(1,2);engine.tick()
        time+=13_000;engine.tick()
        assertEquals("HANDOFF_FAILED",phase())
        assertEquals(setOf(outside,"web-1"),pbx.bridges.getValue("cl-"+id).toSet())
        assertFalse("web-1" in pbx.muted);assertTrue(native in pbx.deleted)
        assertTrue(engine.hasActive());assertEquals(1,pbx.dials.count{it==outside})
        engine.handoff(id,owner,UUID.randomUUID().toString())
        assertEquals("HANDOFF_REQUESTED",phase());assertEquals(2,pbx.legsByRole.getValue("native").size)
    }
    @Test fun expiredReservationAndRevokedOrReboundTicketsCannotDial(){
        allocate();time+=31_000;engine.tick()
        assertEquals("CALL_ENDED",phase());assertFalse(engine.hasActive())
        repeat(2){index->
            val another=UUID.randomUUID().toString()
            val response=engine.create(owner,line,"5550101",another,false)
            val target=response.getValue("target").toString().substringAfter("sip:").substringBefore("@")
            if(index==0)permission=false else current=line.copy(subscriptionId=19)
            pbx.joinWeb("web-"+index,target)
            assertEquals("CALL_ENDED",engine.read(another,owner)["state"])
            permission=true
        }
        assertTrue(pbx.dials.isEmpty())
    }
    @Test fun ambiguousDialIsNeverReplayedAfterReopen(){
        val target=allocate();pbx.failDialAfterSubmission=true
        pbx.joinWeb("web-1",target)
        assertEquals("CALL_ENDED",phase());assertEquals(1,pbx.dials.size)
        engine.stop();journal.close();openEngine()
        val retry=engine.create(owner,line,"5550101",id,false)
        assertEquals("CALL_ENDED",retry["state"]);assertNull(retry["target"])
        assertEquals(1,pbx.dials.size)
    }
}

private class FixturePbx:AriClient({error("Network access is forbidden in this fixture")}) {
    val channels=mutableMapOf<String,JSONObject>()
    val origins=mutableMapOf<String,String>()
    val legsByRole=mutableMapOf<String,MutableList<String>>()
    val variables=mutableMapOf<Pair<String,String>,String>()
    val bridges=mutableMapOf<String,MutableSet<String>>()
    val stats=mutableMapOf<String,RtpSample>()
    val dials=mutableListOf<String>()
    val deleted=mutableSetOf<String>()
    val muted=mutableSetOf<String>()
    var failDialAfterSubmission=false
    private val wsRequest=Request.Builder().url("http://example.invalid/unused").build()
    private lateinit var listener:WebSocketListener
    private lateinit var socket:WebSocket
    override fun ws(listener:WebSocketListener):WebSocket{
        this.listener=listener
        socket=object:WebSocket{
            override fun request()=wsRequest
            override fun queueSize()=0L
            override fun send(text:String)=false
            override fun send(bytes:ByteString)=false
            override fun close(code:Int,reason:String?)=true
            override fun cancel(){}
        }
        return socket
    }
    fun open(){
        val response=Response.Builder().request(wsRequest).protocol(Protocol.HTTP_1_1).code(101).message("Switching Protocols").build()
        listener.onOpen(socket,response)
    }
    private fun channel(id:String,endpoint:String,state:String)=JSONObject().put("id",id)
        .put("name","PJSIP/"+endpoint+"-00000001").put("state",state)
    fun joinWeb(id:String,ticket:String){
        val web=channel(id,"fixture-web","Down").put("dialplan",JSONObject().put("exten",ticket))
        channels[id]=web
        listener.onMessage(socket,JSONObject().put("type","StasisStart").put("args",JSONArray().put("web")).put("channel",web).toString())
    }
    fun state(id:String,state:String){
        val ch=channels.getValue(id).put("state",state)
        listener.onMessage(socket,JSONObject().put("type","ChannelStateChange").put("channel",ch).toString())
    }
    override fun send(method:String,path:List<String>,args:Map<String,String>,missingOk:Boolean):String{
        val group=path[0];val id=path[1];val op=path.getOrNull(2)
        if(group=="endpoints"){
            val live=origins.filter{(ch,endpoint)->ch in channels && endpoint=="PJSIP/"+path.last()}.keys
            return JSONObject().put("state","online").put("channel_ids",JSONArray(live.toList())).toString()
        }
        if(group=="bridges"){
            when{
                method=="DELETE"->bridges.remove(id)
                op=="addChannel"->bridges.getValue(id).add(args.getValue("channel"))
                op==null->bridges[id]=mutableSetOf()
                else->error("Unexpected bridge command $method $path")
            };return ""
        }
        check(group=="channels")
        if(id=="create"){
            val leg=args.getValue("channelId");val endpoint=args.getValue("endpoint")
            channels[leg]=channel(leg,endpoint.removePrefix("PJSIP/"),"Down")
            origins[leg]=endpoint;legsByRole.getOrPut(args.getValue("appArgs").substringBefore(',')){mutableListOf()}.add(leg)
            return channels.getValue(leg).toString()
        }
        if(method=="DELETE" && op==null){
            deleted.add(id);channels.remove(id);bridges.values.forEach{it.remove(id)};muted.remove(id);return ""
        }
        if(id !in channels){check(missingOk);return ""}
        return when(op){
            null->channels.getValue(id).toString()
            "rtp_statistics"->stats[id]?.let{JSONObject().put("rxcount",it.received).put("txcount",it.transmitted).toString()}.orEmpty()
            "variable"->{variables[id to args.getValue("variable")]=args.getValue("value");""}
            "dial"->{dials.add(id);if(failDialAfterSubmission)throw VoiceFault(503,"Lost ARI response");""}
            "mute"->{if(method=="POST")muted.add(id)else muted.remove(id);""}
            "answer"->{channels.getValue(id).put("state","Up");""}
            "ring"->""
            else->error("Unexpected channel command $method $path")
        }
    }
}
