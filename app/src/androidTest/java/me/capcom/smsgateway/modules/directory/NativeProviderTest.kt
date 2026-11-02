package me.capcom.smsgateway.modules.directory

import android.content.Context
import android.content.ContextWrapper
import android.content.ContentProviderOperation
import android.content.ContentProviderResult
import android.content.pm.PackageManager
import android.database.Cursor
import android.database.MatrixCursor
import android.database.sqlite.SQLiteBlobTooBigException
import android.net.Uri
import android.os.Bundle
import android.os.SystemClock
import android.provider.ContactsContract
import android.provider.ContactsContract.CommonDataKinds.Phone
import android.provider.ContactsContract.CommonDataKinds.StructuredName
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.*
import org.json.JSONArray
import org.json.JSONObject
import org.junit.*
import org.junit.Assert.*
import org.junit.runner.RunWith
import java.util.UUID
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/** Provider seam is an in-memory fake; no operation can reach the real device address book. */
@RunWith(AndroidJUnit4::class)
class NativeProviderTest {
 private lateinit var provider:DirectoryProvider
 private lateinit var fake:Fake
 private lateinit var fixtureContext:Context
 private val base get()=InstrumentationRegistry.getInstrumentation().targetContext
 private val prefsName="provider-fixture-"+UUID.randomUUID()
 @Before fun setup(){
  check(base.packageName.endsWith(".commlinkfixture"))
  val prefs=base.getSharedPreferences(prefsName,0);prefs.edit().putBoolean("contacts.read",true).putBoolean("contacts.write",true).commit()
  fixtureContext=object:ContextWrapper(base){
   override fun getApplicationContext():Context=this
   override fun getSharedPreferences(name:String,mode:Int)=if(name in setOf("directory-consent","directory-sync","iphone"))prefs else super.getSharedPreferences(name,mode)
   override fun checkPermission(permission:String,pid:Int,uid:Int)=PackageManager.PERMISSION_GRANTED
  }
  fake=Fake();provider=DirectoryProvider(fixtureContext,fake)
 }
 @After fun cleanup(){base.getSharedPreferences(prefsName,0).edit().clear().commit()}
 private fun snapshot():JSONObject {val values=ArrayList<JSONObject>();provider.scanContacts(emptyMap()){_,_,data->if(data!=null)values.add(data)};return values.single()}
 private fun scan(previous:Map<String,String> = emptyMap()):Map<String,Pair<String,JSONObject?>> {
  val rows=mutableMapOf<String,Pair<String,JSONObject?>>()
  provider.scanContacts(previous){id,stamp,record->rows[id]=stamp to record}
  return rows
 }
 private fun job(snapshot:JSONObject)=JSONObject().put("id",newId()).put("action","update").put("rawId","1").put("expected",snapshot.getString("revision"))
  .put("payload",JSONObject().put("name","New Display").put("numbers",JSONArray().put("+16502530000")))
 @Test fun scannerAndWriterUseTheSameRevisionIncludingAndroidAggregateDisplayName(){
  val snapshot=snapshot();assertEquals("Android Display",snapshot.getString("displayName"));assertEquals("1",snapshot.getString("nameRawId"))
  val result=provider.apply("isolated",job(snapshot),{true},{true})
  assertEquals("done",result.getString("state"));assertEquals(1,fake.batches);assertTrue(fake.last.any{it.isAssertQuery});assertTrue(fake.last.any{it.isUpdate})
 }
 @Test fun changedAggregateNameWithUnchangedRawVersionRejectsWriteBeforeBatch(){
  val snapshot=snapshot();fake.display="Changed outside"
  assertEquals("conflict",provider.apply("isolated",job(snapshot),{true},{true}).getString("state"));assertEquals(0,fake.batches)
 }
 @Test fun replayMarkerReturnsReceiptWithoutASecondBatchAndRevocationBlocksAWrite(){
  val snapshot=snapshot();val operation=job(snapshot);fake.marker=true;fake.versions["1"]="9"
  assertEquals("done",provider.apply("isolated",operation,{true},{false}).getString("state"));assertEquals(0,fake.batches)
  fake.marker=false;fake.versions["1"]="1"
  assertEquals("denied",provider.apply("isolated",operation,{false},{true}).getString("state"));assertEquals(0,fake.batches)
 }

 /** Enters at the same service call as the iPhone edit POST. Only the address book is fake. */
 @Test fun localEditReachesProviderAndReturnsReceiptWhileContactScanIsBlocked() = runBlocking {
  fixtureContext.getSharedPreferences("iphone",0).edit().putBoolean("enabled",true).commit()
  val file="write-latency-"+newId()+".db"
  val service=DirectoryService(fixtureContext,DirectoryDb(fixtureContext,file),provider)
  val allow:(String)->Boolean={it=="server"}
  val target="Changed in fixture"
  val gate=ScanGate()
  var cardId:String?=null
  service.monitor.invalidateContacts()
  val loop=launch(Dispatchers.IO){
   while(isActive){service.tickLocal();service.monitor.awaitWork(10_000)}
  }
  try {
   // Use the normal initial import so both sides start with matching journal sequence numbers.
   val card=withTimeout(8_000){
    var rows=service.androidContacts("",0,allow).getJSONArray("items")
    while(rows.length()==0){
     service.monitor.invalidateContacts()
     delay(225)
     rows=service.androidContacts("",0,allow).getJSONArray("items")
    }
    rows.getJSONObject(0)
   }
   val id=card.getString("id")
   cardId=id
   val source=card.getJSONArray("sources").getJSONObject(0)
   val request=JSONObject().put("destination","android").put("deviceId","server").put("id",id)
    .put("revision",card.getLong("revision")).put("sourceRevision",source.getString("revision"))
    .put("rawId","1").put("requestId",newId()).put("name",target)
   fake.scanGate=gate
   service.monitor.invalidateContacts()
   assertTrue("Background scan did not reach fixture",gate.started.await(6,TimeUnit.SECONDS))
   val started=SystemClock.elapsedRealtime()
   val receipt=service.androidMutate("synthetic-installation","edit",request,allow)
   assertTrue("Local write waited for the blocked contact scan",fake.committed.await(5,TimeUnit.SECONDS))
   val persisted=fake.query(ContactsContract.Contacts.CONTENT_URI,arrayOf(ContactsContract.Contacts.DISPLAY_NAME_PRIMARY),
    "_id=?",arrayOf("5"),null).use { cursor->check(cursor.moveToFirst());cursor.getString(0) }
   val readableMs=SystemClock.elapsedRealtime()-started
   assertEquals(target,persisted)
   withTimeout(5_000){
    while(service.jobs(id,allow).getJSONArray("items").objects().none{it.getString("id")==receipt.getString("jobId") && it.getString("state")=="done"})delay(20)
   }
   val acknowledgedMs=SystemClock.elapsedRealtime()-started
   assertEquals("Scan should still be blocked when the write is acknowledged",1L,gate.release.count)
   assertEquals(1,fake.completedBatches)
   assertTrue(service.androidMutate("synthetic-installation","edit",request,allow).getBoolean("replayed"))
   InstrumentationRegistry.getInstrumentation().sendStatus(0,Bundle().apply {
    putLong("serviceToFixtureProviderReadMs",readableMs)
    putLong("serviceToDoneReceiptMs",acknowledgedMs)
   })
  } finally {
   gate.release.countDown()
   // Drain the pending scan before the private database and fixture preferences disappear.
   withTimeoutOrNull(6_000){
    val id=cardId
    if(id!=null && fake.committed.count==0L){
     while(service.androidContact(id,allow)?.optString("name")!=target)delay(25)
    }
   }
   loop.cancelAndJoin()
   service.database.close()
   fixtureContext.deleteDatabase(file)
  }
 }

 @Test fun putsAndroidDefaultFirstAndKeepsNativeEntityOrderForOtherPhones(){
  fake.phones["1"]=listOf(
   FakePhone(100,"5550102"),FakePhone(7,"5550199"),FakePhone(19,"5550110",true),
   FakePhone(13,"5550181"),FakePhone(31,"5550110"))
  fake.entityOrder["1"]=listOf(13L,100L,7L,31L,19L)
  val row=snapshot()
  assertEquals(listOf("5550110","5550181","5550102","5550199"),row.getJSONArray("numbers").strings())
  assertEquals(1,row.getInt("superPrimaryCount"))
  assertEquals(1,fake.queryCounts["/contacts/5/entities"])
 }
 @Test fun unsupportedEntitiesKeepDefaultFirstAndUseOrderedDataRows(){
  fake.entitiesUnsupported=true
  fake.phones["1"]=listOf(FakePhone(20,"5550105"),FakePhone(3,"5550199"),FakePhone(30,"5550111",true))
  val expected=listOf("5550111","5550199","5550105")
  assertEquals(expected,snapshot().getJSONArray("numbers").strings())
  assertEquals(expected,snapshot().getJSONArray("numbers").strings())
  assertEquals(1,fake.queryCounts["/contacts/5/entities"])
 }

 @Test fun oversizedThumbnailOnlySkipsTheAffectedPhoto(){
  fake.versions["2"]="1";fake.versions["3"]="1"
  fake.oversizedPhotoId="2"
  fake.photos["1"]=byteArrayOf(1,2,3)
  fake.photos["3"]=byteArrayOf(4,5,6)
  val rows=scan().mapValues{it.value.second!!}
  assertEquals(setOf("1","2","3"),rows.keys)
  assertTrue(rows.values.all{it.getString("name")=="Raw Display" && it.getJSONArray("numbers").length()==1})
  assertEquals("AQID",rows.getValue("1").getString("photo"))
  assertFalse(rows.getValue("2").has("photo"))
  assertEquals("BAUG",rows.getValue("3").getString("photo"))
 }

 @Test fun stableScanReadsOnlyMetadataAndChangedSourcesAreReadInBatches(){
  for(id in 2..130)fake.versions[id.toString()]="1"
  val first=scan()
  assertEquals(130,first.size)
  assertTrue(first.values.all{it.second!=null})
  assertEquals(2,fake.fieldRequests.size)
  assertEquals(2,fake.photoRequests.size)
  assertEquals(fake.versions.keys,fake.fieldRequests.flatten().toSet())
  assertEquals(fake.versions.keys,fake.photoRequests.flatten().toSet())
  val previous=first.mapValues{it.value.first}
  fake.resetQueryCounts()
  val stable=scan(previous)
  assertTrue(stable.values.all{it.second==null})
  assertEquals(mapOf("/contacts" to 1,"/raw_contacts" to 1),fake.queryCounts)
  fake.versions["42"]="2"
  val changed=scan(previous)
  assertEquals(listOf("42"),changed.filterValues{it.second!=null}.keys.toList())
  assertEquals(listOf(listOf("42")),fake.fieldRequests)
  assertEquals(listOf(listOf("42")),fake.photoRequests)
 }

 @Test fun oldScanStampRefreshesOrderOnceWithoutInvalidatingPendingEdits(){
  val first=scan().getValue("1")
  val wireRevision=first.second!!.getString("revision")
  val upgraded=scan(mapOf("1" to wireRevision)).getValue("1")
  assertEquals(wireRevision,upgraded.second!!.getString("revision"))
  assertEquals(first.first,upgraded.first)
  assertNull(scan(mapOf("1" to upgraded.first)).getValue("1").second)
 }

 @Test fun unsupportedReadOnlyProjectionFallsBackWithoutLosingContactRows(){
  fake.rejectReadOnlyProjection=true
  val row=snapshot();assertEquals("Android Display",row.getString("displayName"));assertEquals(1,row.getJSONArray("numbers").length())
  assertEquals("done",provider.apply("isolated",job(row),{true},{true}).getString("state"))
  assertEquals(1,fake.rejectedProjections);assertEquals(1,fake.completedBatches)
 }
 @Test fun fallbackDoesNotBypassReadonlyRawAccountsOrProviderEnforcedReadonlyFields(){
  fake.rejectReadOnlyProjection=true;fake.rawReadOnly=1
  val row=snapshot();assertTrue(row.getBoolean("readOnly"))
  assertEquals("denied",provider.apply("isolated",job(row),{true},{true}).getString("state"));assertEquals(0,fake.batches)
  fake.rawReadOnly=0;val fresh=snapshot();fake.rejectBatch=true
  assertEquals("conflict",provider.apply("isolated",job(fresh),{true},{true}).getString("state"));assertEquals(0,fake.completedBatches)
 }
 @Test fun supportedReadonlyFieldsRemainProtectedAndUnrelatedErrorsAreNotSwallowed(){
  fake.dataReadOnly=1;val row=snapshot();assertTrue(row.getBoolean("readOnly"))
  assertEquals("denied",provider.apply("isolated",job(row),{true},{true}).getString("state"));assertEquals(0,fake.batches)
  fake.failOtherProjection=true
  assertTrue(runCatching{snapshot()}.exceptionOrNull() is IllegalArgumentException);assertEquals(0,fake.rejectedProjections)
 }
 private data class FakePhone(val id:Long,val number:String,val isDefault:Boolean=false)
 private class ScanGate {
  val started=CountDownLatch(1)
  val release=CountDownLatch(1)
 }
 private class Fake:DirectoryContent {
  var display="Android Display";val versions=linkedMapOf("1" to "1");var marker=false;var batches=0;var completedBatches=0
  val phones=mutableMapOf<String,List<FakePhone>>()
  val entityOrder=mutableMapOf<String,List<Long>>()
  var entitiesUnsupported=false
  var oversizedPhotoId:String?=null
  val photos=mutableMapOf<String,ByteArray>()
  val queryCounts=java.util.concurrent.ConcurrentHashMap<String,Int>()
  @Volatile var scanGate:ScanGate?=null
  val committed=CountDownLatch(1)
  val fieldRequests=mutableListOf<List<String>>()
  val photoRequests=mutableListOf<List<String>>()
  fun resetQueryCounts(){queryCounts.clear();fieldRequests.clear();photoRequests.clear()}
  var rejectReadOnlyProjection=false;var rejectedProjections=0;var failOtherProjection=false;var dataReadOnly=0;var rawReadOnly=0;var rejectBatch=false
  var last:List<ContentProviderOperation> = emptyList()
  override fun query(uri:Uri,columns:Array<String>,where:String?,args:Array<String>?,sortOrder:String?):Cursor {
   val path=uri.path!!
   queryCounts[path]=(queryCounts[path]?:0)+1
   if(path=="/raw_contacts" && where=="deleted=0")scanGate?.let{gate->
    gate.started.countDown()
    check(gate.release.await(30,TimeUnit.SECONDS)){"Timed out waiting for synthetic scan release"}
   }
   if(uri.path=="/data"){
    if(failOtherProjection)throw IllegalArgumentException("Invalid column unrelated_field")
    if(rejectReadOnlyProjection&&"is_read_only" in columns){rejectedProjections++;throw IllegalArgumentException("Invalid column is_read_only")}
   }
   val cursor=MatrixCursor(columns)
   fun row(values:Map<String,Any?>){cursor.addRow(columns.map{values[it]}.toTypedArray())}
   val ids=args.orEmpty().takeWhile{it.toLongOrNull()!=null}
   when(uri.path){
    "/contacts"->for(id in versions.keys){
     val aggregate=(id.toLong()+4).toString()
     if(ids.isEmpty()||aggregate in ids)row(mapOf("_id" to aggregate,"display_name" to display,"name_raw_contact_id" to id))
    }
    "/raw_contacts"->for((id,version) in versions){
     if(ids.isEmpty()||id in ids)row(mapOf("_id" to id,"version" to version,"contact_id" to (id.toLong()+4).toString(),"raw_contact_is_read_only" to rawReadOnly,"account_type" to null,"account_name" to null,"sourceid" to null))
    }
    "/data"->when {
     args?.firstOrNull()?.startsWith("vnd.android.cursor.item/vnd.me.capcom.commlink.operation")==true->{if(marker)row(mapOf("raw_contact_id" to "1"))}
     "data15" in columns->{
      photoRequests.add(ids)
      if(ids.any{it==oversizedPhotoId})throw SQLiteBlobTooBigException("Synthetic oversized thumbnail")
      for(id in ids)photos[id]?.let{photo->row(mapOf("raw_contact_id" to id,"data15" to photo))}
     }
     "mimetype" in columns->{
      fieldRequests.add(ids)
      for(id in ids){
       row(mapOf("raw_contact_id" to id,"mimetype" to StructuredName.CONTENT_ITEM_TYPE,"data1" to "Raw Display","is_read_only" to dataReadOnly))
       val stored=phones[id]?:listOf(FakePhone(11,"+16502530000"))
       val ordered=if(sortOrder.orEmpty().split(',').any{it.trim().equals("_id ASC",true)})stored.sortedBy{it.id} else stored
       ordered.forEach{phone->row(mapOf("_id" to phone.id,"raw_contact_id" to id,"mimetype" to Phone.CONTENT_ITEM_TYPE,"data1" to phone.number,"is_super_primary" to if(phone.isDefault)1 else 0,"is_read_only" to dataReadOnly))}
      }
     }
     args?.lastOrNull()==StructuredName.CONTENT_ITEM_TYPE->row(mapOf("_id" to "10","is_read_only" to dataReadOnly))
     args?.lastOrNull()==Phone.CONTENT_ITEM_TYPE->row(mapOf("_id" to "11","data1" to "+16502530000","is_read_only" to dataReadOnly))
    }
    else->{
     check(path.endsWith("/entities"))
     if(entitiesUnsupported)throw UnsupportedOperationException("Synthetic unsupported entity URI")
     val aggregate=uri.pathSegments[1].toLong()
     val raw=(aggregate-4).toString()
     val ordered=entityOrder[raw]?:phones[raw].orEmpty().map{it.id}
     ordered.forEach{id->row(mapOf("data_id" to id,"mimetype" to Phone.CONTENT_ITEM_TYPE))}
    }
   }
   return cursor
  }
  override fun applyBatch(authority:String,ops:ArrayList<ContentProviderOperation>):Array<ContentProviderResult>{
   assertEquals(ContactsContract.AUTHORITY,authority);batches++;last=ops.toList()
   if(rejectBatch)throw android.content.OperationApplicationException("Expected one writable row")
   if(scanGate!=null){
    val update=ops.single{it.isUpdate}
    val values=checkNotNull(update.resolveValueBackReferences(emptyArray(),0))
    display=checkNotNull(values.getAsString(StructuredName.DISPLAY_NAME));versions["1"]="2";marker=true
   }
   completedBatches++
   committed.countDown()
   return ops.map{ContentProviderResult(1)}.toTypedArray()
  }
 }
}
