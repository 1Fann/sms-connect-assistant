package me.capcom.smsgateway.modules.directory

import me.capcom.smsgateway.modules.iphone.PrivateStore
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

/** Public address book: Android aggregate identity, never imported/merged assistant overlays. */
internal class AndroidDirectory(private val service:DirectoryService) {
 private val db get()=service.database.writableDatabase
 private fun id(device:String,contact:String)=UUID.nameUUIDFromBytes(("android-contact-v1\u0000"+device+"\u0000"+contact).toByteArray()).toString()
 fun cards(allowed:(String)->Boolean):List<JSONObject>{
  val groups=linkedMapOf<Pair<String,String>,MutableList<JSONObject>>()
  db.rows("SELECT s.device,s.raw,s.payload FROM sources s JOIN grants g ON g.device=s.device WHERE s.deleted=0 AND g.contacts=1 ORDER BY s.device,s.raw"){
   Triple(it.getString(0),it.getString(1),it.getString(2))
  }.forEach { (device,raw,json)->
   if(!allowed(device))return@forEach
   val payload=JSONObject(json)
   val aggregate=payload.optString("contactId").takeIf{it.toLongOrNull()?.let{v->v>0}==true}?:raw
   groups.getOrPut(device to aggregate){arrayListOf()}.add(JSONObject().put("deviceId",device).put("rawId",raw)
    .put("contactId",aggregate).put("revision",payload.getString("revision")).put("name",payload.optString("name"))
    .put("numbers",payload.getJSONArray("numbers")).put("readOnly",payload.optBoolean("readOnly"))
    .put("displayName",payload.optString("displayName",payload.optString("name"))).put("nameRawId",payload.optString("nameRawId"))
    .put("observedAt",payload.optLong("observedAt")))
  }
  val favorites=db.rows("SELECT id,favorite FROM contacts WHERE favorite<>0"){it.getString(0)}.toSet()
  return groups.map{(identity,sources)->
   val cardId=id(identity.first,identity.second)
   val newest=sources.maxByOrNull{it.optLong("observedAt")}!!
   val primary=sources.firstOrNull{it.getString("rawId")==newest.optString("nameRawId")}
    ?:sources.firstOrNull{!it.getBoolean("readOnly")}?:sources.first()
   val snapshot=JSONArray(sources.map{JSONObject(it.toString()).apply{remove("observedAt")}}).toString()
   JSONObject().put("id",cardId).put("deviceId",identity.first).put("nativeContactId",identity.second)
    .put("name",newest.getString("displayName")).put("numbers",JSONArray(sources.flatMap{it.getJSONArray("numbers").strings()}.distinct()))
    .put("sources",JSONArray(sources)).put("primaryRawId",primary.getString("rawId"))
    .put("revision",PrivateStore.hash(snapshot).take(12).toLong(16)).put("favorite",cardId in favorites).put("conflict",false)
  }
 }
 fun view(id:String,allowed:(String)->Boolean)=cards(allowed).firstOrNull{it.getString("id")==id}
 fun list(query:String,offset:Int,allowed:(String)->Boolean,favorite:Boolean=false):JSONObject {
  require(offset>=0);val q=query.trim()
  val items=cards(allowed).asSequence().filter{!favorite||it.getBoolean("favorite")}
   .filter{q.isEmpty()||it.getString("name").contains(q,true)||it.getJSONArray("numbers").strings().any{n->n.contains(q)}}
   .sortedBy{it.getString("id")}.drop(offset).take(51).toList()
  return JSONObject().put("items",JSONArray(items.take(50))).put("next",if(items.size>50)offset+50 else JSONObject.NULL).put("syncError",service.contactReadError(allowed))
 }
 fun resolve(number:String,allowed:(String)->Boolean):String? {
  val key=lookupKey(service.regionCode(),number)?:return null
  val rows=if(key.startsWith("+"))db.rows("""SELECT DISTINCT s.device,s.payload FROM sources s
   JOIN grants g ON g.device=s.device JOIN identities i ON i.device=s.device AND i.raw=s.raw
   WHERE s.deleted=0 AND g.contacts=1 AND i.number=?""",key){it.getString(0) to it.getString(1)}
   else db.rows("SELECT s.device,s.payload FROM sources s JOIN grants g ON g.device=s.device WHERE s.deleted=0 AND g.contacts=1"){it.getString(0) to it.getString(1)}
  val names=rows.filter{allowed(it.first)}.map{JSONObject(it.second)}
   .filter{it.getJSONArray("numbers").strings().any{n->lookupKey(service.regionCode(),n)==key}}
   .map{it.optString("displayName",it.optString("name"))}.filter{it.isNotBlank()}.distinct()
  return names.singleOrNull()
 }
 fun mutate(owner:String,action:String,body:JSONObject,allowed:(String)->Boolean):JSONObject = db.atomic {
  require(owner.isNotBlank()&&action in setOf("create","edit","favorite")&&body.optString("destination")=="android")
  require(!body.has("targets"))
  val request=body.getString("requestId");require(validId(request))
  val fingerprint=PrivateStore.hash("android-v1:"+owner+":"+action+":"+body.toString())
  fun result(contact:String,replayed:Boolean=false):JSONObject{
   val job=db.rows("SELECT device,state FROM jobs WHERE id=?",request){it.getString(0) to it.getString(1)}.singleOrNull()
   val device=job?.first?:view(contact,allowed)?.getString("deviceId")?:throw NoSuchElementException()
   if(!allowed(device))throw SecurityException()
   return JSONObject().put("id",contact).put("deviceId",device).put("jobId",if(job==null)JSONObject.NULL else request)
    .put("state",job?.second?:"done").put("replayed",replayed)
  }
  db.rows("SELECT fingerprint,contact FROM changes WHERE id=?",request){it.getString(0) to it.getString(1)}.singleOrNull()?.let{
   require(it.first==fingerprint);return@atomic result(it.second,true)
  }
  val before=if(action=="create")null else view(body.getString("id"),allowed)?:throw NoSuchElementException()
  if(before!=null&&before.getLong("revision")!=body.getLong("revision"))throw StaleContact()
  val device=if(before==null)body.getString("deviceId") else before.getString("deviceId")
  if(!allowed(device)||!service.deviceAccess(device).optBoolean("contactsRead"))throw SecurityException()
  val contact=before?.getString("id")?:newId()
  if(action=="favorite"){
   db.execSQL("INSERT OR IGNORE INTO contacts(id) VALUES(?)",arrayOf(contact))
   db.execSQL("UPDATE contacts SET favorite=? WHERE id=?",arrayOf(if(body.getBoolean("favorite"))1 else 0,contact))
  }else{
   if(!service.deviceAccess(device).optBoolean("contactsWrite"))throw SecurityException()
   if(body.getString("deviceId")!=device)throw SecurityException()
   val payload=JSONObject()
   if(body.has("name")){
    val name=body.getString("name").trim();require(name.length<=200&&name.none{it.isISOControl()});payload.put("name",name)
   }
   if(body.has("numbers")){
    val numbers=body.getJSONArray("numbers").strings().map{it.trim()}.distinct()
    require(numbers.size<=32&&numbers.all{it.length in 1..96&&it.none{ch->ch.isISOControl()}})
    payload.put("numbers",JSONArray(numbers))
   }
   require(payload.length()>0)
   val raw:String?;val expected:String?
   if(action=="create"){
    require(payload.optString("name").isNotBlank()||(payload.optJSONArray("numbers")?.length()?:0)>0)
    raw=null;expected=null
   }else{
    val source=before!!.getJSONArray("sources").objects().singleOrNull{it.getString("rawId")==body.getString("rawId")}?:throw SecurityException()
    if(source.getBoolean("readOnly"))throw SecurityException()
    raw=source.getString("rawId");expected=source.getString("revision")
    if(body.getString("sourceRevision")!=expected)throw StaleContact()
    if(db.scalar("SELECT 1 FROM jobs WHERE device=? AND raw=? AND state='queued'",device,raw)!=null)throw StaleContact()
   }
   db.execSQL("INSERT OR IGNORE INTO contacts(id) VALUES(?)",arrayOf(contact))
   db.execSQL("INSERT INTO jobs(id,contact,device,raw,expected,action,payload,state,created) VALUES(?,?,?,?,?,?,?,'queued',?)",
    arrayOf(request,contact,device,raw,expected,if(action=="create")"create" else "update",payload.toString(),System.currentTimeMillis()))
  }
  db.execSQL("INSERT INTO changes VALUES(?,?,?,?,?,?)",arrayOf(request,owner,"android-"+action,fingerprint,contact,System.currentTimeMillis()))
  result(contact)
 }
}
