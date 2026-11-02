package me.capcom.smsgateway.modules.directory

import android.Manifest
import android.content.ContentProviderOperation as Op
import android.content.ContentProviderResult
import android.content.ContentUris
import android.database.Cursor
import android.database.sqlite.SQLiteBlobTooBigException
import android.database.sqlite.SQLiteException
import android.content.ContentResolver
import android.content.Context
import android.content.OperationApplicationException
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.CallLog
import android.provider.ContactsContract
import android.provider.ContactsContract.CommonDataKinds.Phone
import android.provider.ContactsContract.CommonDataKinds.Photo
import android.provider.ContactsContract.CommonDataKinds.StructuredName
import android.provider.ContactsContract.Contacts
import android.provider.ContactsContract.Data
import android.provider.ContactsContract.RawContacts
import android.telecom.PhoneAccountHandle
import android.telephony.TelephonyManager
import android.util.Base64
import androidx.core.content.ContextCompat
import me.capcom.smsgateway.helpers.SubscriptionsHelper
import me.capcom.smsgateway.modules.iphone.PrivateStore
import org.json.JSONArray
import org.json.JSONObject

internal interface DirectoryContent {
    fun query(uri:Uri,columns:Array<String>,where:String?,args:Array<String>?,sortOrder:String?=null):Cursor?
    fun applyBatch(authority:String,ops:ArrayList<Op>):Array<ContentProviderResult>
}
internal class ResolverDirectoryContent(private val resolver:ContentResolver):DirectoryContent {
    override fun query(uri:Uri,columns:Array<String>,where:String?,args:Array<String>?,sortOrder:String?)=resolver.query(uri,columns,where,args,sortOrder)
    override fun applyBatch(authority:String,ops:ArrayList<Op>)=resolver.applyBatch(authority,ops)
}
internal class DirectoryProvider(private val ctx: Context,private val content:DirectoryContent=ResolverDirectoryContent(ctx.contentResolver)) {
    private val consent get() = ctx.getSharedPreferences("directory-consent",0)

    fun allowed(kind: String): Boolean {
        val permission = when(kind) {
            "contacts.read" -> Manifest.permission.READ_CONTACTS
            "contacts.write" -> Manifest.permission.WRITE_CONTACTS
            "calls.read" -> Manifest.permission.READ_CALL_LOG
            else -> return false
        }
        return consent.getBoolean(kind,false) &&
            ContextCompat.checkSelfPermission(ctx,permission) == PackageManager.PERMISSION_GRANTED &&
            (kind != "contacts.write" || allowed("contacts.read"))
    }

    private fun query(uri: Uri, columns: Array<String>, where: String?, args: Array<String>?, sortOrder:String?=null) =
        checkNotNull(content.query(uri, columns, where, args, sortOrder)) { "系统数据源不可用" }

    @Volatile private var dataReadOnlyColumn=true
    @Volatile private var supportsEntityOrder=true
    /** Some OEM providers reject this optional projection. Never impersonate a sync adapter:
     * retain raw-account guards and exact affected-row checks so Provider-enforced read-only
     * fields still roll back the entire write batch. */
    private fun queryData(columns:Array<String>,where:String,args:Array<String>,sortOrder:String?=null):Cursor {
        val wanted=if(dataReadOnlyColumn)columns else columns.filter{it!=Data.IS_READ_ONLY}.toTypedArray()
        return try { query(Data.CONTENT_URI,wanted,where,args,sortOrder) }
        catch(error:IllegalArgumentException){
            if(Data.IS_READ_ONLY !in wanted || !error.message.orEmpty().contains(Data.IS_READ_ONLY,true))throw error
            val fallback=query(Data.CONTENT_URI,wanted.filter{it!=Data.IS_READ_ONLY}.toTypedArray(),where,args,sortOrder)
            dataReadOnlyColumn=false
            fallback
        }
    }
    private fun fieldReadOnly(cursor:Cursor):Boolean =
        cursor.getColumnIndex(Data.IS_READ_ONLY).let{it>=0&&!cursor.isNull(it)&&cursor.getInt(it)!=0}

    private fun aggregateName(contactId:String):Pair<String,String> =
        query(ContactsContract.Contacts.CONTENT_URI,arrayOf(ContactsContract.Contacts.DISPLAY_NAME_PRIMARY,ContactsContract.Contacts.NAME_RAW_CONTACT_ID),
            "_id=?",arrayOf(contactId)).use { c ->
            check(c.moveToFirst()){"系统联系人正在改变"}
            c.getString(0).orEmpty() to c.getString(1).orEmpty()
        }
    private fun nativeRevision(version:String,values:List<String>,name:Pair<String,String>) =
        version+"."+PrivateStore.hash("android-native-v1\u0000"+(values+name.first+name.second).joinToString("\u0000"))

    private data class PhoneField(val id:Long,val number:String,val superPrimary:Boolean)
    private class ChangedRaw(val id:String,val aggregate:String,val version:String,val stamp:String,val record:JSONObject) {
        val phones=mutableListOf<PhoneField>()
    }

    /** Keep the provider write precondition stable. Only the local scan stamp changes
     * when the representation needs to be republished to an existing peer. */
    fun scanContacts(previous: Map<String,String>, observe: (String,String,JSONObject?) -> Unit) {
        val displays=query(Contacts.CONTENT_URI,arrayOf(Contacts._ID,Contacts.DISPLAY_NAME_PRIMARY,Contacts.NAME_RAW_CONTACT_ID),null,null).use { rows ->
            buildMap { while(rows.moveToNext())put(rows.getString(0),rows.getString(1).orEmpty() to rows.getString(2).orEmpty()) }
        }
        val columns = arrayOf(RawContacts._ID, RawContacts.VERSION, RawContacts.CONTACT_ID,
            RawContacts.RAW_CONTACT_IS_READ_ONLY, RawContacts.ACCOUNT_TYPE, RawContacts.ACCOUNT_NAME,
            RawContacts.SOURCE_ID)
        val batch=ArrayList<ChangedRaw>(128)
        fun flush() {
            if(batch.isEmpty())return
            loadChanged(batch)
            for(raw in batch)observe(raw.id,raw.stamp,raw.record)
            batch.clear()
        }
        query(RawContacts.CONTENT_URI, columns, "deleted=0", null).use { raw ->
            while (raw.moveToNext()) {
                val id = raw.getString(0)
                val version = raw.getString(1)
                val aggregate=raw.getString(2)
                val display=checkNotNull(displays[aggregate]) { "系统联系人正在改变" }
                val revision=nativeRevision(version,(1..6).map{raw.getString(it).orEmpty()},display)
                val stamp="phone-order-v2:"+revision
                if (stamp == previous[id]) { observe(id, stamp, null); continue }
                val record=JSONObject().put("rawId",id).put("contactId",aggregate).put("revision",revision)
                    .put("readOnly",raw.getInt(3)!=0).put("name","").put("displayName",display.first).put("nameRawId",display.second)
                batch.add(ChangedRaw(id,aggregate,version,stamp,record))
                if(batch.size==128)flush()
            }
        }
        flush()
    }

    private fun loadChanged(batch:List<ChangedRaw>) {
        val byId=batch.associateBy { it.id }
        val ids=byId.keys.toTypedArray()
        val placeholders=ids.joinToString(",") { "?" }
        val columns=arrayOf(Data.RAW_CONTACT_ID,Data.MIMETYPE,Data.DATA1,Data.IS_SUPER_PRIMARY,Data._ID,Data.IS_READ_ONLY)
        queryData(columns,"raw_contact_id IN ($placeholders) AND mimetype IN (?,?)",
            ids+arrayOf(Phone.CONTENT_ITEM_TYPE,StructuredName.CONTENT_ITEM_TYPE),"raw_contact_id ASC, _id ASC").use { fields ->
            while(fields.moveToNext()){
                val raw=byId.getValue(fields.getString(0))
                val value=fields.getString(2).orEmpty()
                if(fieldReadOnly(fields))raw.record.put("readOnly",true)
                when(fields.getString(1)){
                    StructuredName.CONTENT_ITEM_TYPE -> raw.record.put("name",value)
                    Phone.CONTENT_ITEM_TYPE -> if(value.isNotBlank())raw.phones.add(PhoneField(fields.getLong(4),value,fields.getInt(3)!=0))
                }
            }
        }
        // MIUI's details screen walks the aggregate's entity cursor. A filtered Data
        // query can pick a different index and return the same rows in another order.
        for((aggregate,raws) in batch.filter { it.phones.size>1 }.groupBy { it.aggregate }){
            val positions=entityPositions(aggregate) ?: break
            for(raw in raws)raw.phones.sortBy { checkNotNull(positions[it.id]) { "系统联系人正在改变" } }
        }
        for(raw in batch){
            // The native detail view prepends each super-primary row and appends
            // every other row. IS_PRIMARY is account-local and does not affect order.
            val (preferred,ordinary)=raw.phones.partition { it.superPrimary }
            val numbers=linkedSetOf<String>()
            for(field in preferred.asReversed())numbers.add(field.number)
            raw.record.put("superPrimaryCount",numbers.size)
            for(field in ordinary)numbers.add(field.number)
            raw.record.put("numbers",JSONArray(numbers.toList()))
        }
        loadPhotos(byId,ids)
        val verified=query(RawContacts.CONTENT_URI,arrayOf(RawContacts._ID,RawContacts.VERSION),"_id IN ($placeholders) AND deleted=0",ids).use { rows ->
            buildMap { while(rows.moveToNext())put(rows.getString(0),rows.getString(1)) }
        }
        check(batch.all { verified[it.id]==it.version }) { "通讯录正在改变，等待下一次完整扫描" }
    }

    /** An OEM that explicitly rejects this endpoint still has the ordered Data rows.
     * A failed/missing cursor on a supported provider must instead retry the scan. */
    private fun entityPositions(aggregate:String):Map<Long,Int>? {
        if(!supportsEntityOrder)return null
        val uri=ContentUris.withAppendedId(Contacts.CONTENT_URI,aggregate.toLong())
            .buildUpon().appendPath(Contacts.Entity.CONTENT_DIRECTORY).build()
        try {
            return query(uri,arrayOf(Contacts.Entity.DATA_ID,Data.MIMETYPE),null,null,Data.RAW_CONTACT_ID).use { rows ->
                buildMap { while(rows.moveToNext())if(rows.getString(1)==Phone.CONTENT_ITEM_TYPE)put(rows.getLong(0),rows.position) }
            }
        } catch(_:UnsupportedOperationException) {
            supportsEntityOrder=false
        } catch(error:IllegalArgumentException) {
            val reason=error.message.orEmpty().lowercase(java.util.Locale.ROOT)
            if(listOf("unknown uri","unknown url","unsupported uri","invalid column data_id").none { it in reason })throw error
            supportsEntityOrder=false
        }
        return null
    }

    private fun loadPhotos(byId:Map<String,ChangedRaw>,ids:Array<String>){
        val selection="raw_contact_id IN ("+ids.joinToString(",") { "?" }+") AND mimetype=?"
        try {
            query(Data.CONTENT_URI,arrayOf(Data.RAW_CONTACT_ID,Photo.PHOTO),selection,ids+Photo.CONTENT_ITEM_TYPE).use { photos ->
                while(photos.moveToNext()){
                    val record=byId.getValue(photos.getString(0)).record
                    if(!record.has("photo")&&!photos.isNull(1)){
                        val bytes=photos.getBlob(1)
                        if(bytes!=null&&bytes.size in 1..16384)record.put("photo",Base64.encodeToString(bytes,Base64.NO_WRAP))
                    }
                }
            }
        } catch(error:SQLiteException) {
            // Binder may deliver a provider's BlobTooBig as plain SQLiteException.
            if(error !is SQLiteBlobTooBigException && !error.message.orEmpty().contains("row too big",true))throw error
            if(ids.size>1){
                val middle=ids.size/2
                loadPhotos(byId,ids.copyOfRange(0,middle))
                loadPhotos(byId,ids.copyOfRange(middle,ids.size))
            }
        }
    }

    fun scanCalls(observe: (String,String,JSONObject?) -> Unit) {
        val columns = arrayOf(CallLog.Calls._ID,CallLog.Calls.NUMBER,CallLog.Calls.DATE,
            CallLog.Calls.DURATION,CallLog.Calls.TYPE,CallLog.Calls.CACHED_NAME,
            CallLog.Calls.PHONE_ACCOUNT_ID,CallLog.Calls.PHONE_ACCOUNT_COMPONENT_NAME,CallLog.Calls.NUMBER_PRESENTATION)
        val slots = mutableMapOf<Pair<String,String>,Int?>()
        query(CallLog.Calls.CONTENT_URI, columns,null,null).use { c ->
            while(c.moveToNext()) {
                val id = c.getString(0)
                val permitted = c.getInt(8) == CallLog.Calls.PRESENTATION_ALLOWED
                val account = c.getString(6).orEmpty()
                val component = c.getString(7).orEmpty()
                val slot = slots.getOrPut(component to account) {
                    if(Build.VERSION.SDK_INT < 30) null else runCatching {
                        val name = android.content.ComponentName.unflattenFromString(component) ?: return@runCatching null
                        val tm = ctx.getSystemService(Context.TELEPHONY_SERVICE) as TelephonyManager
                        val sub = tm.createForPhoneAccountHandle(PhoneAccountHandle(name,account))?.subscriptionId
                        sub?.let { SubscriptionsHelper.getSimSlotIndex(ctx,it)?.plus(1) }
                    }.getOrNull()
                }
                val data = JSONObject().put("rawId",id).put("date",c.getLong(2)).put("duration",c.getLong(3))
                    .put("type",when(c.getInt(4)){1->"incoming";2->"outgoing";3->"missed";5->"rejected";6->"blocked";else->"other"})
                    .put("number",if (permitted) c.getString(1).orEmpty() else "")
                    .put("name",if (permitted) c.getString(5).orEmpty() else "")
                    .put("presentation",c.getInt(8)).put("accountId",if(account.isEmpty())"" else PrivateStore.hash(component+":"+account)).put("slot",slot)
                observe(id,PrivateStore.hash(data.toString()),data)
            }
        }
    }

    /** Android retains explicit aggregate deletion events for a limited time.
     * Only IDs with newer tombstones can be retired from an otherwise empty scan. */
    fun deletedContacts(): Map<String,Long> {
        return query(ContactsContract.DeletedContacts.CONTENT_URI,
            arrayOf(ContactsContract.DeletedContacts.CONTACT_ID,ContactsContract.DeletedContacts.CONTACT_DELETED_TIMESTAMP),
            null,null).use { c ->
            buildMap { while(c.moveToNext())put(c.getString(0),c.getLong(1)) }
        }
    }

    private val markerMime = "vnd.android.cursor.item/vnd.me.capcom.commlink.operation"

    /** The op marker and data mutation share one ContactsProvider transaction. A process
     * death before writing our local receipt cannot create a second contact on retry. */
    fun apply(link:String, job:JSONObject, ready:()->Boolean, claim:()->Boolean):JSONObject {
        val id=job.getString("id")
        require(validId(id))
        fun result(state:String,detail:String="",raw:String?=null)=JSONObject().put("id",id)
            .put("state",state).put("detail",detail).put("rawId",raw)
        if(!allowed("contacts.write"))return result("denied","目标设备未授权通讯录写回")
        val marker=PrivateStore.hash(link + ":" + id)
        return try {
            query(Data.CONTENT_URI,arrayOf(Data.RAW_CONTACT_ID),"mimetype=? AND data1=?",arrayOf(markerMime,marker)).use {
                if(it.moveToFirst())return result("done",raw=it.getString(0))
            }
            val action=job.getString("action")
            val raw=job.optString("rawId")
            val create=action=="create"
            val ops=ArrayList<Op>()
            if(create) {
                ops.add(Op.newInsert(RawContacts.CONTENT_URI)
                    .withValue(RawContacts.ACCOUNT_NAME,null).withValue(RawContacts.ACCOUNT_TYPE,null).build())
            } else {
                require(raw.toLong()>0)
                val expected=job.getString("expected")
                // Include account binding in the comparison as well as the Provider VERSION.
                val columns=arrayOf(RawContacts.VERSION,RawContacts.CONTACT_ID,RawContacts.RAW_CONTACT_IS_READ_ONLY,
                    RawContacts.ACCOUNT_TYPE,RawContacts.ACCOUNT_NAME,RawContacts.SOURCE_ID)
                query(RawContacts.CONTENT_URI,columns,"_id=? AND deleted=0",arrayOf(raw)).use { r ->
                    if(!r.moveToFirst())return result("conflict","来源已删除，或之前的删除结果待核实")
                    if(r.getInt(2)!=0)return result("denied","此来源是只读账号")
                    val revision=nativeRevision(r.getString(0),(0..5).map{r.getString(it).orEmpty()},aggregateName(r.getString(1)))
                    if(revision!=expected)return result("conflict","来源已被修改，请刷新后重新确认")
                }
                ops.add(Op.newAssertQuery(RawContacts.CONTENT_URI)
                    .withSelection("_id=? AND version=? AND deleted=0 AND raw_contact_is_read_only=0",arrayOf(raw,expected.substringBefore('.')))
                    .withExpectedCount(1).build())
            }
            if(action=="delete") {
                queryData(arrayOf(Data._ID,Data.IS_READ_ONLY),"raw_contact_id=?",arrayOf(raw)).use{c->
                    if(c.getColumnIndex(Data.IS_READ_ONLY)<0)return result("denied","系统不支持核实字段只读状态，不能安全删除来源")
                    while(c.moveToNext())if(fieldReadOnly(c))return result("denied","此来源包含只读字段")
                }
                ops.add(Op.newAssertQuery(Data.CONTENT_URI)
                    .withSelection("raw_contact_id=? AND is_read_only=1",arrayOf(raw))
                    .withExpectedCount(0).build())
                ops.add(Op.newDelete(RawContacts.CONTENT_URI).withSelection("_id=?",arrayOf(raw)).withExpectedCount(1).build())
                if(!ready()||!allowed("contacts.write"))return result("denied","配对或写回授权已变更，请重新确认")
                if(!claim())return result("conflict","上次删除结果未知，请在来源设备核实")
                content.applyBatch(ContactsContract.AUTHORITY,ops)
                return result("done",raw=raw)
            }
            require(create || action=="update")
            fun insert(mime:String,value:String): Op {
                val b=Op.newInsert(Data.CONTENT_URI).withValue(Data.MIMETYPE,mime).withValue(Data.DATA1,value)
                if(create)b.withValueBackReference(Data.RAW_CONTACT_ID,0) else b.withValue(Data.RAW_CONTACT_ID,raw)
                return b.build()
            }
            val payload=job.getJSONObject("payload")
            if(payload.has("name")) {
                val name=payload.getString("name")
                if(!create){
                    queryData(arrayOf(Data._ID,Data.IS_READ_ONLY),"raw_contact_id=? AND mimetype=?",
                        arrayOf(raw,StructuredName.CONTENT_ITEM_TYPE)).use { c->
                        if(c.moveToFirst()){
                            if(fieldReadOnly(c))return result("denied","姓名字段只读")
                            ops.add(Op.newUpdate(Data.CONTENT_URI).withSelection("_id=?",arrayOf(c.getString(0))).withValue(StructuredName.DISPLAY_NAME,name).withExpectedCount(1).build())
                        } else ops.add(insert(StructuredName.CONTENT_ITEM_TYPE,name))
                    }
                } else ops.add(insert(StructuredName.CONTENT_ITEM_TYPE,name))
            }
            if(payload.has("numbers")){
                val desired=payload.getJSONArray("numbers").strings().toSet()
                val missing=desired.toMutableSet()
                if(!create)queryData(arrayOf(Data._ID,Phone.NUMBER,Data.IS_READ_ONLY),"raw_contact_id=? AND mimetype=?",
                    arrayOf(raw,Phone.CONTENT_ITEM_TYPE)).use { c->
                    while(c.moveToNext()){
                        if(c.getString(1) in desired)missing.remove(c.getString(1))
                        else {
                            if(fieldReadOnly(c))return result("denied","号码字段只读")
                            ops.add(Op.newDelete(Data.CONTENT_URI).withSelection("_id=?",arrayOf(c.getString(0))).withExpectedCount(1).build())
                        }
                    }
                }
                missing.forEach { ops.add(insert(Phone.CONTENT_ITEM_TYPE,it)) }
            }
            ops.add(insert(markerMime,marker))
            if(!ready()||!allowed("contacts.write"))return result("denied","配对或写回授权已变更，请重新确认")
            if(!claim())return result("conflict","上次写回已开始但无法确认结果，请在来源设备核实")
            val changes=content.applyBatch(ContactsContract.AUTHORITY,ops)
            result("done",raw=if(create)requireNotNull(changes.first().uri?.lastPathSegment) else raw)
        }catch(_:SecurityException){result("denied","系统拒绝写入该账号")}
        catch(_:OperationApplicationException){result("conflict","来源版本或写入条件已改变")}
        // Other Provider failures have unknown outcome. The caller retains the job and
        // checks the atomic marker on the next retry instead of creating a new request.
    }
}
