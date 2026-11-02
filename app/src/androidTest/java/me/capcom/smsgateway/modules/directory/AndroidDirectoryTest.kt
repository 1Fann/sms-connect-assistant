package me.capcom.smsgateway.modules.directory

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONArray
import org.json.JSONObject
import org.junit.*
import org.junit.Assert.*
import org.junit.runner.RunWith
import java.util.UUID

/** Synthetic snapshots and isolated SQLite only. Never touches a real address book. */
@RunWith(AndroidJUnit4::class)
class AndroidDirectoryTest {
 private val ctx get()=InstrumentationRegistry.getInstrumentation().targetContext
 private val file="native-directory-fixture-"+UUID.randomUUID()+".db"
 private lateinit var s:DirectoryService
 private val all:(String)->Boolean={true}
 private val phone="+16502530000"
 @Before fun open(){check(ctx.packageName.endsWith(".commlinkfixture"));s=DirectoryService(ctx,DirectoryDb(ctx,file))}
 @After fun close(){s.database.close();ctx.deleteDatabase(file)}
 private fun packet(events:List<JSONObject> = emptyList(),read:Boolean=true,write:Boolean=true)=JSONObject()
  .put("contacts",read).put("write",write).put("calls",true).put("events",JSONArray(events))
 private fun event(raw:String="1",aggregate:String="5",name:String="Raw",display:String="Android Name",seq:Int=1,readOnly:Boolean=false,number:String=phone)=JSONObject()
  .put("kind","contact").put("raw",raw).put("seq",seq).put("record",JSONObject().put("rawId",raw).put("contactId",aggregate)
   .put("revision","revision-"+seq).put("name",name).put("displayName",display).put("nameRawId","1")
   .put("numbers",JSONArray().put(number)).put("readOnly",readOnly).put("observedAt",seq))
 private fun cards(allowed:(String)->Boolean=all)=s.androidContacts("",0,allowed).getJSONArray("items").objects()
 private fun body(card:JSONObject)=JSONObject().put("destination","android").put("requestId",newId()).put("id",card.getString("id"))
  .put("revision",card.getLong("revision")).put("deviceId",card.getString("deviceId"))
 private fun change(card:JSONObject)=body(card).put("rawId","1").put("sourceRevision","revision-1").put("name","New Android")
 private fun mutate(action:String,b:JSONObject,owner:String="owner",allowed:(String)->Boolean=all)=s.androidMutate(owner,action,b,allowed)
 private fun count(table:String)=s.database.readableDatabase.scalar("SELECT count(*) FROM "+table)!!.toInt()

 @Test fun legacyImportedCardsAreArchivedAndNeverDisplayedOrUsedForNames(){
  s.mutate("legacy","create",JSONObject().put("requestId",newId()).put("name","Legacy").put("numbers",JSONArray().put(phone)).put("targets",JSONArray()),all)
  assertEquals(1,count("contacts"));assertTrue(cards().isEmpty());assertNull(s.resolveName(phone))
  s.sync("A",packet(listOf(event())))
  assertEquals("Android Name",cards().single().getString("name"));assertEquals("Android Name",s.resolveName(phone))
  assertTrue(cards().none{it.getBoolean("conflict")});assertEquals(2,count("contacts"))
 }
 @Test fun aggregatesFollowAndroidIdsInsteadOfMergingByNumberOrPromptingForReview(){
  s.sync("A",packet(listOf(event(),event(raw="2",name="Other account",seq=2))))
  val a=cards().single();assertEquals(2,a.getJSONArray("sources").length());assertEquals("Android Name",a.getString("name"))
  s.sync("A",packet(listOf(event(raw="3",aggregate="8",display="Different person"))))
  s.sync("B",packet(listOf(event(display="Second phone"))))
  assertEquals(3,cards().size);assertEquals(1,cards{it=="B"}.size);assertNull(s.resolveName(phone))
  assertEquals("Second phone",s.resolveName(phone){it=="B"})
  assertEquals(a.getString("id"),cards{it=="A"}.first{it.getString("nativeContactId")=="5"}.getString("id"))
 }
 @Test fun pageNameLookupPreservesExactMatchesAmbiguityAndDeviceRevocations(){
  s.sync("A",packet(listOf(event(display="First phone"),event(raw="2",number="10086",display="Service"),
   event(raw="3",number="Bank",display="Bank sender"))))
  s.sync("B",packet(listOf(event(display="Other phone"),event(raw="2",number="10086",display="Other service"))))
  s.sync("C",packet(listOf(event(display="Revoked")),read=false))
  val requested=listOf(phone,"+1 (650) 253-0000","10086","Bank","bank","unknown","+442079460000",phone)
  val scoped=s.resolveNames(requested){it=="A"}
  assertEquals(requested.toSet(),scoped.keys)
  assertEquals("First phone",scoped[phone]);assertEquals("First phone",scoped["+1 (650) 253-0000"])
  assertEquals("Service",scoped["10086"]);assertEquals("Bank sender",scoped["Bank"])
  assertNull(scoped["bank"]);assertNull(scoped["unknown"]);assertNull(scoped["+442079460000"])
  val mixed=s.resolveNames(requested)
  assertNull(mixed[phone]);assertNull(mixed["10086"]);assertEquals("Bank sender",mixed["Bank"])
  s.sync("A",packet(read=false,write=false))
  assertTrue(s.resolveNames(requested){it=="A"}.values.all{it==null})
  val indexed=s.resolveNames(listOf(phone,"+442079460000")){it=="B"}
  assertEquals("Other phone",indexed[phone]);assertNull(indexed["+442079460000"])
  assertTrue(s.resolveNames(emptyList()).isEmpty())
 }
 @Test fun nativeNumbersKeepAndroidOrderAcrossAccountsAndLegacySnapshots(){
  val first=listOf("5550188","5550101","5550166")
  val second=listOf("5550177","5550188","5550102")
  fun source(raw:String,numbers:List<String>,seq:Int,defaults:Int?)=event(raw=raw,seq=seq).apply{
   getJSONObject("record").apply{
    put("numbers",JSONArray(numbers))
    if(defaults!=null)put("superPrimaryCount",defaults)
   }
  }
  s.sync("A",packet(listOf(source("10",second,1,null),source("2",first,2,null))))
  val legacy=cards().single()
  assertEquals(listOf("5550188","5550101","5550166","5550177","5550102"),legacy.getJSONArray("numbers").strings())
  s.sync("A",packet(listOf(source("2",first,3,1),source("10",second,4,1))))
  val current=cards().single()
  assertEquals(legacy.getString("id"),current.getString("id"))
  assertEquals(listOf("5550177","5550188","5550101","5550166","5550102"),current.getJSONArray("numbers").strings())
  val sources=current.getJSONArray("sources").objects().associateBy{it.getString("rawId")}
  assertEquals(first,sources.getValue("2").getJSONArray("numbers").strings())
  assertEquals(second,sources.getValue("10").getJSONArray("numbers").strings())
 }
 @Test fun aggregatedThumbnailIsScopedAndReturnedOnce(){
  val photo="iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB"
  val photographed=event(raw="2").apply{getJSONObject("record").put("photo",photo)}
  s.sync("A",packet(listOf(event(),photographed)))
  s.sync("B",packet(listOf(event())))
  val a=cards{it=="A"}.single()
  assertEquals(photo,a.getString("photo"))
  assertTrue(a.getJSONArray("sources").objects().none{it.has("photo")})
  assertFalse(cards{it=="B"}.single().has("photo"))
 }
 @Test fun nativeEditsAreSourceBoundAndOnlyProviderSnapshotsChangeTheReadModel(){
  s.sync("A",packet(listOf(event())))
  val card=cards().single();val request=change(card)
  val first=mutate("edit",request);assertEquals("queued",first.getString("state"))
  assertTrue(mutate("edit",request).getBoolean("replayed"));assertEquals(1,count("jobs"))
  val job=s.sync("A",packet()).getJSONObject("job");assertEquals(request.getString("requestId"),job.getString("id"))
  assertEquals("1",job.getString("rawId"));assertEquals("revision-1",job.getString("expected"))
  assertEquals("New Android",job.getJSONObject("payload").getString("name"))
  assertEquals("Android Name",cards().single().getString("name"))
  val result=JSONObject().put("results",JSONArray().put(JSONObject().put("id",job.getString("id")).put("state","done").put("rawId","1")))
  s.sync("A",packet().put("results",result.getJSONArray("results")))
  assertEquals("done",mutate("edit",request).getString("state"))
  assertEquals("Android Name",cards().single().getString("name"))
  s.sync("A",packet(listOf(event(name="New Android",display="New Android",seq=2))))
  assertEquals("New Android",cards().single().getString("name"))
 }
 @Test fun staleReadonlyUnauthorizedAndMixedTargetRequestsDoNotQueue(){
  s.sync("A",packet(listOf(event())))
  val card=cards().single()
  val invalid=listOf(change(card).put("deviceId","B"),change(card).put("rawId","999"),change(card).put("sourceRevision","stale"),
   change(card).put("revision",0),change(card).put("targets",JSONArray()),change(card).put("destination","assistant"))
  invalid.forEach{assertTrue(runCatching{mutate("edit",it)}.isFailure)}
  assertTrue(runCatching{mutate("edit",change(card),allowed={false})}.isFailure);assertEquals(0,count("jobs"))
  s.sync("A",packet(listOf(event(seq=2,readOnly=true))))
  assertTrue(runCatching{mutate("edit",change(cards().single()).put("sourceRevision","revision-2"))}.isFailure)
  assertEquals(0,count("jobs"))
 }
 @Test fun explicitCreationHasStableJobAndNeverFallsBackToAnotherDevice(){
  s.sync("A",packet());s.sync("B",packet(write=false))
  val b=JSONObject().put("destination","android").put("requestId",newId()).put("deviceId","A").put("name","New").put("numbers",JSONArray().put(phone))
  val result=mutate("create",b)
  val job=result.getString("jobId");val contact=result.getString("id")
  assertEquals(1,s.jobs(contact,all,job).getJSONArray("items").length())
  assertEquals(0,s.jobs(newId(),all,job).getJSONArray("items").length())
  assertEquals(0,s.jobs(contact,{false},job).getJSONArray("items").length())
  assertTrue(cards().isEmpty());assertEquals("A",result.getString("deviceId"));assertTrue(mutate("create",b).getBoolean("replayed"))
  assertEquals(1,count("jobs"));assertTrue(s.sync("A",packet()).has("job"));assertFalse(s.sync("B",packet(write=false)).has("job"))
  assertTrue(runCatching{mutate("create",JSONObject(b.toString()).put("requestId",newId()).put("deviceId","B"))}.isFailure)
  assertTrue(runCatching{mutate("create",b,owner="other")}.isFailure);assertEquals(1,count("jobs"))
 }
 @Test fun pendingUpdatesCannotBeOverwrittenAndAppendsKeepOtherSourcesUntouched(){
  s.sync("A",packet(listOf(event(),event(raw="2",seq=2,number="+442079460000"))))
  val card=cards().single()
  val b=body(card).put("rawId","1").put("sourceRevision","revision-1").put("numbers",JSONArray().put(phone).put("+81312345678"))
  mutate("edit",b)
  assertTrue(runCatching{mutate("edit",change(card))}.exceptionOrNull() is StaleContact)
  val job=s.sync("A",packet()).getJSONObject("job")
  assertEquals("1",job.getString("rawId"));assertFalse(job.getJSONObject("payload").has("name"))
  assertFalse(job.getJSONObject("payload").getJSONArray("numbers").strings().contains("+442079460000"))
  assertEquals(1,count("jobs"))
 }
 @Test fun legacyAliasesRemovalAndFavoritesDoNotRewriteNativePhoneData(){
  s.sync("A",packet(listOf(event())))
  val native=cards().single();val legacy=s.contacts("",0,all).getJSONArray("items").getJSONObject(0)
  s.mutate("old","edit",JSONObject().put("requestId",newId()).put("id",legacy.getString("id")).put("revision",legacy.getLong("revision"))
   .put("name","Old alias").put("targets",JSONArray()),all)
  assertEquals("Android Name",cards().single().getString("name"))
  mutate("favorite",body(native).put("favorite",true))
  assertTrue(cards().single().getBoolean("favorite"));assertEquals(0,count("jobs"))
  assertEquals("Android Name",s.resolveName(phone))
  s.sync("A",packet(read=false,write=false));assertTrue(cards().isEmpty());assertNull(s.resolveName(phone))
 }
 @Test fun retiringOldPendingWritesPreservesCardsReceiptsAndNewNativeJobs(){
  s.sync("A",packet())
  val legacy=s.mutate("old","create",JSONObject().put("requestId",newId()).put("name","Legacy")
   .put("numbers",JSONArray().put(phone)).put("targets",JSONArray().put(JSONObject().put("deviceId","A").put("action","create"))),all)
  val native=mutate("create",JSONObject().put("destination","android").put("requestId",newId()).put("deviceId","A")
   .put("name","Native").put("numbers",JSONArray().put(phone)))
  val prior=count("contacts");s.retireLegacyWrites()
  assertEquals(prior,count("contacts"));assertEquals(2,count("jobs"))
  assertEquals("revoked",s.jobs(legacy.getString("id"),all).getJSONArray("items").getJSONObject(0).getString("state"))
  assertEquals("queued",s.jobs(native.getString("id"),all).getJSONArray("items").getJSONObject(0).getString("state"))
  assertEquals(native.getString("jobId"),s.sync("A",packet()).getJSONObject("job").getString("id"))
 }

}
