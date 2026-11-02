package me.capcom.smsgateway.modules.directory

import android.content.Context
import android.content.ContextWrapper
import android.content.ContentProviderOperation
import android.content.ContentProviderResult
import android.content.pm.PackageManager
import android.database.Cursor
import android.database.MatrixCursor
import android.net.Uri
import android.provider.ContactsContract
import android.provider.ContactsContract.CommonDataKinds.Phone
import android.provider.ContactsContract.CommonDataKinds.StructuredName
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONArray
import org.json.JSONObject
import org.junit.*
import org.junit.Assert.*
import org.junit.runner.RunWith
import java.util.UUID

/** Provider seam is an in-memory fake; no operation can reach the real device address book. */
@RunWith(AndroidJUnit4::class)
class NativeProviderTest {
 private lateinit var provider:DirectoryProvider
 private lateinit var fake:Fake
 private val base get()=InstrumentationRegistry.getInstrumentation().targetContext
 private val prefsName="provider-fixture-"+UUID.randomUUID()
 @Before fun setup(){
  check(base.packageName.endsWith(".commlinkfixture"))
  val prefs=base.getSharedPreferences(prefsName,0);prefs.edit().putBoolean("contacts.read",true).putBoolean("contacts.write",true).commit()
  val ctx=object:ContextWrapper(base){
   override fun getSharedPreferences(name:String,mode:Int)=if(name=="directory-consent")prefs else super.getSharedPreferences(name,mode)
   override fun checkPermission(permission:String,pid:Int,uid:Int)=PackageManager.PERMISSION_GRANTED
  }
  fake=Fake();provider=DirectoryProvider(ctx,fake)
 }
 @After fun cleanup(){base.getSharedPreferences(prefsName,0).edit().clear().commit()}
 private fun snapshot():JSONObject {val values=ArrayList<JSONObject>();provider.scanContacts(emptyMap()){_,_,data->if(data!=null)values.add(data)};return values.single()}
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
  val snapshot=snapshot();val operation=job(snapshot);fake.marker=true;fake.version="9"
  assertEquals("done",provider.apply("isolated",operation,{true},{false}).getString("state"));assertEquals(0,fake.batches)
  fake.marker=false;fake.version="1"
  assertEquals("denied",provider.apply("isolated",operation,{false},{true}).getString("state"));assertEquals(0,fake.batches)
 }
 private class Fake:DirectoryContent {
  var display="Android Display";var version="1";var marker=false;var batches=0
  var last:List<ContentProviderOperation> = emptyList()
  override fun query(uri:Uri,columns:Array<String>,where:String?,args:Array<String>?):Cursor {
   val cursor=MatrixCursor(columns)
   fun row(values:Map<String,Any?>){cursor.addRow(columns.map{values[it]}.toTypedArray())}
   when(uri.path){
    "/contacts"->row(mapOf("display_name" to display,"name_raw_contact_id" to "1"))
    "/raw_contacts"->if(where?.contains("version=?")!=true||args?.last()==version)row(mapOf("_id" to "1","version" to version,"contact_id" to "5","raw_contact_is_read_only" to 0,"account_type" to null,"account_name" to null,"sourceid" to null))
    "/data"->when {
     args?.firstOrNull()?.startsWith("vnd.android.cursor.item/vnd.me.capcom.commlink.operation")==true->{if(marker)row(mapOf("raw_contact_id" to "1"))}
     columns.contentEquals(arrayOf("data15"))->{}
     where?.contains(" IN ")==true->{
      row(mapOf("mimetype" to StructuredName.CONTENT_ITEM_TYPE,"data1" to "Raw Display","is_read_only" to 0))
      row(mapOf("mimetype" to Phone.CONTENT_ITEM_TYPE,"data1" to "+16502530000","is_read_only" to 0))
     }
     args?.lastOrNull()==StructuredName.CONTENT_ITEM_TYPE->row(mapOf("_id" to "10","is_read_only" to 0))
     args?.lastOrNull()==Phone.CONTENT_ITEM_TYPE->row(mapOf("_id" to "11","data1" to "+16502530000","is_read_only" to 0))
    }
    else->error("Unexpected fake URI")
   }
   return cursor
  }
  override fun applyBatch(authority:String,ops:ArrayList<ContentProviderOperation>):Array<ContentProviderResult>{
   assertEquals(ContactsContract.AUTHORITY,authority);batches++;last=ops.toList()
   return ops.map{ContentProviderResult(1)}.toTypedArray()
  }
 }
}
