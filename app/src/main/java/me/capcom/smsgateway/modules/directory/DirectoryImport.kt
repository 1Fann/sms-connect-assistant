package me.capcom.smsgateway.modules.directory

import me.capcom.smsgateway.modules.iphone.PrivateStore
import org.json.JSONArray
import org.json.JSONObject
import java.text.Normalizer

/** Only creates assistant overlays. No ContactsProvider or Android writeback job is used. */
internal class DirectoryImport(private val service:DirectoryService,private val allowed:(String)->Boolean) {
 private val db get()=service.database.writableDatabase
 private fun key(name:String,numbers:List<String>)=Normalizer.normalize(name,Normalizer.Form.NFC)+"\u0000"+
     numbers.map{it.replace(Regex("[ ()-]"),"").lowercase()}.distinct().sorted().joinToString("\u0000")
 fun run(owner:String,body:JSONObject):JSONObject {
  val request=body.getString("requestId");require(owner.isNotBlank()&&validId(request))
  val input=body.getJSONArray("contacts").objects();require(input.size in 1..100)
  val entries=input.map{row->
   val name=row.getString("name").trim();val numbers=row.getJSONArray("numbers").strings().map{it.trim()}.distinct()
   require(name.length<=200&&name.none{it.isISOControl()}&&numbers.size in 1..32)
   require(numbers.all{it.length in 1..96&&it.none{ch->ch.isISOControl()}&&it.any{ch->ch.isDigit()}})
   JSONObject().put("name",name).put("numbers",JSONArray(numbers))
  }
  val fingerprint=PrivateStore.hash(JSONArray(entries).toString())
  return db.atomic {
   db.rows("SELECT owner,fingerprint,result FROM contact_imports WHERE id=?",request){Triple(it.getString(0),it.getString(1),it.getString(2))}.firstOrNull()?.let{
    if(it.first!=owner)throw SecurityException()
    require(it.second==fingerprint){"导入请求内容已改变，请重新选择文件"}
    return@atomic JSONObject(it.third).put("replayed",true)
   }
   val known=HashSet<String>()
   for(id in db.rows("SELECT id FROM contacts WHERE deleted=0"){it.getString(0)}){
    val card=service.view(id,allowed,includeConflict=false)?:continue
    known.add(key(card.getString("name"),card.getJSONArray("numbers").strings()))
   }
   var added=0;var skipped=0
   for(entry in entries){
    val signature=key(entry.getString("name"),entry.getJSONArray("numbers").strings())
    if(!known.add(signature)){skipped++;continue}
    service.mutate(owner,"create",JSONObject(entry.toString()).put("requestId",newId()).put("targets",JSONArray()),allowed)
    added++
   }
   val result=JSONObject().put("added",added).put("skipped",skipped)
   db.execSQL("INSERT INTO contact_imports VALUES(?,?,?,?,?)",arrayOf(request,owner,fingerprint,result.toString(),System.currentTimeMillis()))
   result
  }
 }
}
