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

/** Assistant database only: this fixture never requests real contacts or writes a ContactsProvider. */
@RunWith(AndroidJUnit4::class)
class DirectoryImportTest {
 private val ctx get()=InstrumentationRegistry.getInstrumentation().targetContext
 private val file="import-fixture-"+UUID.randomUUID()+".db"
 private lateinit var service:DirectoryService
 @Before fun open(){service=DirectoryService(ctx,DirectoryDb(ctx,file))}
 @After fun close(){service.database.close();ctx.deleteDatabase(file)}
 private fun contact(name:String="演示联系人",number:String="5550100")=JSONObject().put("name",name).put("numbers",JSONArray().put(number))
 private fun body(vararg rows:JSONObject)=JSONObject().put("requestId",newId()).put("contacts",JSONArray(rows.toList()))
 private fun count(table:String)=service.database.readableDatabase.rawQuery("SELECT count(*) FROM $table",null).use{it.moveToFirst();it.getInt(0)}
 @Test fun importsOnlyAssistantCardsAndReplaysTheSameCommittedBatch(){
  val request=body(contact().put("targets",JSONArray().put(JSONObject().put("deviceId","server").put("action","create"))))
  assertEquals(1,service.importContacts("owner",request){true}.getInt("added"))
  assertTrue(service.importContacts("owner",request){true}.getBoolean("replayed"))
  assertEquals(1,count("contacts"));assertEquals(0,count("sources"));assertEquals(0,count("jobs"))
  assertEquals("演示联系人",service.resolveName("5550100"))
  assertTrue(runCatching{service.importContacts("another-owner",request){true}}.exceptionOrNull() is SecurityException)
 }
 @Test fun skipsExactDuplicatesWithoutOverwritingDifferentNamesOnTheSameNumber(){
  service.importContacts("owner",body(contact())){true}
  val duplicate=service.importContacts("owner",body(contact(number="555 0100"))){true}
  assertEquals(0,duplicate.getInt("added"));assertEquals(1,duplicate.getInt("skipped"))
  service.importContacts("owner",body(contact(name="另一姓名"))){true}
  assertEquals(2,count("contacts"));assertNull(service.resolveName("5550100"))
 }
 @Test fun invalidBatchAndChangedRequestCannotPartiallyCommit(){
  val invalid=body(contact(),contact(name="x".repeat(201)))
  assertTrue(runCatching{service.importContacts("owner",invalid){true}}.isFailure)
  assertEquals(0,count("contacts"));assertEquals(0,count("contact_imports"))
  val valid=body(contact());service.importContacts("owner",valid){true}
  valid.getJSONArray("contacts").getJSONObject(0).put("name","changed")
  assertTrue(runCatching{service.importContacts("owner",valid){true}}.isFailure);assertEquals(1,count("contacts"))
 }
 @Test fun duplicateDetectionDoesNotRevealAnUnauthorizedSource(){
  val event=JSONObject().put("kind","contact").put("raw","1").put("seq",1).put("record",contact().put("rawId","1").put("contactId","1").put("revision","1").put("readOnly",false))
  service.sync("hidden",JSONObject().put("contacts",true).put("write",false).put("calls",false).put("events",JSONArray().put(event)))
  val result=service.importContacts("owner",body(contact())){false}
  assertEquals(1,result.getInt("added"));assertEquals(0,result.getInt("skipped"))
  assertEquals(1,service.contacts("",0,{false}).getJSONArray("items").length())
 }
 @Test fun v2MigrationPreservesContactsAndMissedCallViewReceipts(){
  service.mutate("owner","create",contact().put("requestId",newId()).put("targets",JSONArray())){true}
  val db=service.database.writableDatabase
  db.execSQL("INSERT INTO call_seen VALUES('fixture','source','1',100)")
  db.execSQL("DROP TABLE contact_imports");db.version=2;service.database.close()
  service=DirectoryService(ctx,DirectoryDb(ctx,file))
  assertEquals(1,service.contacts("",0,{true}).getJSONArray("items").length())
  assertEquals(1,count("call_seen"));assertEquals(3,service.database.readableDatabase.version)
  assertEquals(1,service.importContacts("owner",body(contact(name="New",number="5550101"))){true}.getInt("added"))
 }
}
