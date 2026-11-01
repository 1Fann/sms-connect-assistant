package me.capcom.smsgateway.modules.directory

import android.content.Context
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONArray
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import java.util.UUID

/** Uses a per-test private database. Never reads or writes a real ContactsProvider,
 * CallLog, SMS store or Asterisk instance. */
@RunWith(AndroidJUnit4::class)
class DirectoryServiceTest {
    private lateinit var ctx:Context
    private val databaseName="directory-fixture-"+UUID.randomUUID()+".db"
    private lateinit var service:DirectoryService
    private val all:(String)->Boolean={true}
    private val phone="+16502530000"
    @Before fun setUp(){
        ctx=InstrumentationRegistry.getInstrumentation().targetContext
        service=DirectoryService(ctx,DirectoryDb(ctx,databaseName))
    }
    @After fun tearDown(){service.database.close();ctx.deleteDatabase(databaseName)}
    private fun packet(contacts:Boolean=true,events:List<JSONObject> = emptyList())=JSONObject()
        .put("events",JSONArray(events)).put("contacts",contacts).put("write",contacts).put("calls",true)
    private fun contact(name:String,seq:Int=1,raw:String="1",number:String=phone)=JSONObject().put("kind","contact")
        .put("raw",raw).put("seq",seq).put("record",JSONObject().put("rawId",raw).put("contactId","5")
            .put("revision","rev"+seq).put("name",name).put("numbers",JSONArray().put(number)).put("readOnly",false))
    private fun list(allowed:(String)->Boolean=all,trash:Boolean=false)=service.contacts("",0,allowed,trash).getJSONArray("items").objects()
    private fun body(row:JSONObject)=JSONObject().put("id",row.getString("id")).put("revision",row.getLong("revision")).put("requestId",newId())
    private fun edit(action:String,b:JSONObject,allowed:(String)->Boolean=all)=service.mutate("fixture-install",action,b,allowed)

    @Test fun sourcesMergeConflictSplitAndPermissions(){
        service.sync("A",packet(events=listOf(contact("Alice"))))
        service.sync("B",packet(events=listOf(contact("Alice"))))
        val first=list().single()
        assertEquals(2,first.getJSONArray("sources").length())
        service.sync("C",packet(events=listOf(contact("Unrelated"))))
        assertEquals(2,list().size)
        assertTrue(list().all{it.getBoolean("conflict")})
        assertNull(service.resolveName(phone))
        val visible=list({it=="C"}).single()
        assertEquals("Unrelated",visible.getString("name"))
        assertEquals(1,visible.getJSONArray("sources").length())
        edit("split",body(first).put("deviceId","B").put("rawId","1"))
        assertEquals(3,list().size)
        val cards=list()
        val a=cards.first{it.getJSONArray("sources").getJSONObject(0).getString("deviceId")=="A"}
        val b=cards.first{it.getJSONArray("sources").getJSONObject(0).getString("deviceId")=="B"}
        edit("merge",body(a).put("otherId",b.getString("id")).put("otherRevision",b.getLong("revision")))
        assertEquals(2,list().size)
    }

    @Test fun targetBoundQueueReplayConflictAndFailedBatchRollback(){
        service.sync("A",packet(events=listOf(contact("Alice"))))
        service.sync("B",packet(events=listOf(contact("Alice"))))
        val row=list().single()
        val target=JSONObject().put("deviceId","B").put("rawId","1").put("revision","rev1").put("action","update")
        val change=body(row).put("targets",JSONArray().put(target)).put("name","Updated B")
        edit("edit",change)
        assertTrue(edit("edit",change).getBoolean("replayed"))
        val job=service.sync("B",packet()).getJSONObject("job")
        assertFalse(service.sync("A",packet()).has("job"))
        assertEquals(job.getString("id"),service.sync("B",packet()).getJSONObject("job").getString("id"))
        service.sync("A",packet().put("results",JSONArray().put(JSONObject().put("id",job.getString("id")).put("state","done").put("rawId","1"))))
        assertTrue(service.sync("B",packet()).has("job"))
        service.sync("B",packet().put("results",JSONArray().put(JSONObject().put("id",job.getString("id")).put("state","conflict").put("detail","外部编辑"))))
        assertFalse(service.sync("B",packet()).has("job"))
        assertEquals("conflict",service.jobs(row.getString("id"),all).getJSONArray("items").getJSONObject(0).getString("state"))
        val before=list().single()
        val invalid=body(before).put("targets",JSONArray().put(target).put(JSONObject().put("deviceId","C").put("action","create"))).put("name","bad batch")
        assertTrue(runCatching{edit("edit",invalid)}.isFailure)
        assertEquals(before.getLong("revision"),list().single().getLong("revision"))
        assertFalse(service.sync("B",packet()).has("job"))
    }

    @Test fun deletionIsRevisionedRestorableAndPermissionFailureIsNotDeletion(){
        val first=contact("Alice")
        service.sync("A",packet(events=listOf(first)))
        service.sync("A",packet(contacts=false))
        assertTrue(list().isEmpty())
        service.sync("A",packet())
        assertEquals(1,list().size)
        val before=list().single()
        service.sync("A",packet(events=listOf(contact("New name",seq=2))))
        service.sync("A",packet(events=listOf(first)))
        assertEquals("New name",list().single().getString("name"))
        assertTrue(runCatching{edit("delete",body(before).put("confirm",true))}.exceptionOrNull() is StaleContact)
        service.sync("A",packet(events=listOf(JSONObject().put("raw","1").put("seq",3).put("kind","contact"))))
        assertTrue(list().isEmpty())
        val removed=list(trash=true).single()
        edit("restore",body(removed))
        assertEquals("New name",list().single().getString("name"))
        assertFalse(service.sync("A",packet()).has("job"))
    }

    @Test fun deviceScopedCallIdentityAndPermissions(){
        fun row()=JSONObject().put("kind","call").put("seq",1).put("raw","7").put("record",
            JSONObject().put("rawId","7").put("number",phone).put("date",1000).put("duration",10).put("type","incoming"))
        service.sync("A",packet(events=listOf(row())))
        service.sync("B",packet(events=listOf(row())))
        val calls=service.history(null,0,all,false).getJSONArray("items").objects()
        assertEquals(2,calls.map{it.getString("id")}.toSet().size)
        assertEquals(1,service.history(null,0,{it=="A"},false).getJSONArray("items").length())
        service.revoke("A")
        assertEquals(1,service.history(null,0,all,false).getJSONArray("items").length())
    }

    @Test fun revokedMergedSourceCannotLeaveItsNumbersInTheGlobalCard(){
        service.sync("A",packet(events=listOf(contact("A",number="+15550100001"))))
        service.sync("B",packet(events=listOf(contact("B",number="+15550100002"))))
        val cards=list()
        val a=cards.single{it.getString("name")=="A"}
        val b=cards.single{it.getString("name")=="B"}
        edit("merge",body(a).put("otherId",b.getString("id")).put("otherRevision",b.getLong("revision")))
        assertEquals(2,list().single().getJSONArray("numbers").length())
        assertEquals(listOf("+15550100001"),list({it=="A"}).single().getJSONArray("numbers").strings())
        service.revoke("B")
        assertEquals(listOf("+15550100001"),list().single().getJSONArray("numbers").strings())
    }
}
