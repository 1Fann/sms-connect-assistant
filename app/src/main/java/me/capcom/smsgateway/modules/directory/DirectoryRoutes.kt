package me.capcom.smsgateway.modules.directory

import io.ktor.http.ContentType
import io.ktor.http.HttpStatusCode
import io.ktor.server.application.ApplicationCall
import io.ktor.server.application.call
import io.ktor.server.response.respondText
import io.ktor.server.routing.Route
import io.ktor.server.routing.get
import io.ktor.server.routing.post
import me.capcom.smsgateway.modules.iphone.limitedBody
import org.json.JSONException
import org.json.JSONObject

/** Mount beneath /api/v2, behind the phone installation auth/origin checks. */
fun Route.directoryRoutes(directory:DirectoryService,
    requireScope:suspend(ApplicationCall,String)->Boolean,
    allowedDevice:(ApplicationCall,String)->Boolean,
    installation:(ApplicationCall)->String, canResolve:(ApplicationCall)->Boolean
) {
    fun devices(call:ApplicationCall):(String)->Boolean {
        val cache=HashMap<String,Boolean>()
        return { id -> cache.getOrPut(id){allowedDevice(call,id)} }
    }
    fun offset(call:ApplicationCall):Int {
        val value=call.request.queryParameters["offset"]?:return 0
        return value.toInt().also{require(it>=0)}
    }
    get("contacts"){
        if(!requireScope(call,"contacts.read"))return@get
        if(call.request.queryParameters["deleted"]!=null){
            call.respondText(JSONObject().put("error","助手最近删除功能已移除，请重新打开网页").toString(),ContentType.Application.Json,HttpStatusCode.Gone)
            return@get
        }
        call.directoryAnswer {
            val allowed=devices(call)
            // Capture before reading the cards so a concurrent commit is detected on the next check.
            val version=directory.androidContactsVersion(allowed)
            directory.androidContacts(call.request.queryParameters["q"].orEmpty().take(160),offset(call),allowed,call.request.queryParameters["favorite"]=="true")
                .put("version",version)
        }
    }
    get("contacts/version"){
        if(!requireScope(call,"contacts.read"))return@get
        call.directoryAnswer { JSONObject().put("version",directory.androidContactsVersion(devices(call))) }
    }
    get("contacts/{id}"){
        if(!requireScope(call,"contacts.read"))return@get
        call.directoryAnswer { directory.androidContact(call.parameters["id"].orEmpty(),devices(call))?:throw NoSuchElementException() }
    }
    post("contacts/native/{action}"){
        if(!requireScope(call,"contacts.write")||!requireScope(call,"contacts.read"))return@post
        call.directoryAnswer {
            directory.androidMutate(installation(call),call.parameters["action"].orEmpty(),JSONObject(call.limitedBody(65536)),devices(call))
        }
    }
    // Do not reinterpret a cached PWA's old assistant-only save as a system-contact write.
    post("contacts/{action}"){
        if(!requireScope(call,"contacts.write")||!requireScope(call,"contacts.read"))return@post
        call.respondText(JSONObject().put("error","旧联系人功能已移除，请关闭并重新打开互联电话").toString(),ContentType.Application.Json,HttpStatusCode.Gone)
    }
    get("contact-sync/jobs"){
        if(!requireScope(call,"contacts.write")||!requireScope(call,"contacts.read"))return@get
        call.directoryAnswer { directory.jobs(call.request.queryParameters["contactId"],devices(call),call.request.queryParameters["jobId"]) }
    }
    get("call-history"){
        if(!requireScope(call,"calls.read"))return@get
        call.directoryAnswer {
            directory.history(call.request.queryParameters["deviceId"],offset(call),devices(call),canResolve(call))
        }
    }
    get("call-history/missed"){
        if(!requireScope(call,"calls.read"))return@get
        call.directoryAnswer{directory.missed(installation(call),devices(call))}
    }
    post("call-history/seen"){
        if(!requireScope(call,"calls.read"))return@post
        call.directoryAnswer{
            val body=JSONObject(call.limitedBody(65536))
            directory.seenCalls(installation(call),body.getJSONArray("records"),devices(call))
        }
    }
}

private suspend inline fun ApplicationCall.directoryAnswer(block:()->JSONObject){
    val (status,data)=try { HttpStatusCode.OK to block() }
    catch(_:StaleContact){HttpStatusCode.Conflict to JSONObject().put("error","来源或联系人版本已改变，请刷新并重新确认")}
    catch(_:SecurityException){HttpStatusCode.Forbidden to JSONObject().put("error","没有目标设备的权限")}
    catch(_:NoSuchElementException){HttpStatusCode.NotFound to JSONObject().put("error","联系人不存在或不可见")}
    catch(_:JSONException){HttpStatusCode.BadRequest to JSONObject().put("error","联系人字段格式不正确")}
    catch(_:IllegalArgumentException){HttpStatusCode.BadRequest to JSONObject().put("error","请求无效，请检查目标、权限与版本")}
    respondText(data.toString(),ContentType.Application.Json,status)
}
