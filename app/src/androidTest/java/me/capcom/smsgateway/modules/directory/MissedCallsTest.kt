package me.capcom.smsgateway.modules.directory

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

/** Isolated SQLite only. Never opens the system call log or initiates a call. */
@RunWith(AndroidJUnit4::class)
class MissedCallsTest {
 private val ctx get()=InstrumentationRegistry.getInstrumentation().targetContext
 private val file="missed-fixture-"+UUID.randomUUID()+".db"
 private lateinit var service:DirectoryService
 @Before fun open(){service=DirectoryService(ctx,DirectoryDb(ctx,file))}
 @After fun close(){service.database.close();ctx.deleteDatabase(file)}
 private fun add(device:String,raw:String="1",date:Long=100,seq:Int=1,type:String="missed"){
  service.sync(device,JSONObject().put("contacts",false).put("write",false).put("calls",true).put("events",JSONArray().put(
   JSONObject().put("kind","call").put("raw",raw).put("seq",seq).put("record",JSONObject().put("rawId",raw).put("number","5550100").put("date",date).put("type",type).put("duration",0)))))
 }
 private fun receipt(device:String,raw:String="1",date:Long=100)=JSONObject().put("id","android:$device:$raw").put("date",date)
 private fun count(install:String="p",allowed:(String)->Boolean={true})=service.missed(install,allowed).getInt("count")
 @Test fun viewsArePerInstallationAndDeviceAndNeverTouchAndroidHistory(){
  add("A");add("B");add("A","2",type="outgoing")
  assertEquals(2,count());assertEquals(1,count(allowed={it=="A"}))
  service.seenCalls("p",JSONArray().put(receipt("A"))){it=="A"}
  assertEquals(1,count());assertEquals(2,count("other"))
  assertEquals(3,service.history(null,0,{true},false).getJSONArray("items").length())
  service.seenCalls("p",JSONArray().put(receipt("A"))){true};assertEquals(1,count())
 }
 @Test fun forbiddenBatchRollsBackAndSourceRevocationRemovesItsViews(){
  add("A");add("B")
  assertTrue(runCatching{service.seenCalls("p",JSONArray().put(receipt("A")).put(receipt("B"))){it=="A"}}.exceptionOrNull() is SecurityException)
  assertEquals(2,count())
  service.seenCalls("p",JSONArray().put(receipt("A"))){true};service.revoke("A");add("A")
  assertEquals(2,count())
 }
 @Test fun aReusedProviderIdCannotMakeANewMissedCallLookViewed(){
  add("A");service.seenCalls("p",JSONArray().put(receipt("A"))){true};assertEquals(0,count())
  add("A",date=200,seq=2);assertEquals(1,count())
  service.seenCalls("p",JSONArray().put(receipt("A",date=100))){true};assertEquals(1,count())
  service.seenCalls("p",JSONArray().put(receipt("A",date=200))){true};assertEquals(0,count())
 }
 @Test fun directoryV1MigrationOnlyAddsViewReceiptsAndPreservesRecords(){
  add("A")
  val db=service.database.writableDatabase
  db.execSQL("DROP TABLE call_seen");db.execSQL("DROP TABLE contact_imports");db.execSQL("DROP TABLE directory_versions");db.version=1;service.database.close()
  service=DirectoryService(ctx,DirectoryDb(ctx,file))
  assertEquals(1,count());assertEquals(4,service.database.readableDatabase.version)
  assertEquals(1,service.history(null,0,{true},false).getJSONArray("items").length())
 }
}
