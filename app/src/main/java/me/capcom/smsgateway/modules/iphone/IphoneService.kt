package me.capcom.smsgateway.modules.iphone

import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.IBinder
import io.ktor.http.*
import io.ktor.serialization.gson.gson
import io.ktor.server.application.*
import io.ktor.server.engine.*
import io.ktor.server.netty.Netty
import io.ktor.server.plugins.contentnegotiation.ContentNegotiation
import io.ktor.server.plugins.statuspages.StatusPages
import io.ktor.server.request.*
import io.ktor.server.response.*
import io.ktor.server.routing.*
import io.ktor.utils.io.readAvailable
import kotlinx.coroutines.*
import me.capcom.smsgateway.modules.notifications.NotificationsService
import me.capcom.smsgateway.modules.messages.MessagesService
import me.capcom.smsgateway.modules.messages.data.*
import me.capcom.smsgateway.domain.EntitySource
import me.capcom.smsgateway.domain.MessageContent
import me.capcom.smsgateway.helpers.SubscriptionsHelper
import org.koin.android.ext.android.inject
import java.net.NetworkInterface
import java.net.Inet6Address
import java.util.Date

class IphoneService : Service() {
    private val messages: MessagesService by inject()
    private val notifications: NotificationsService by inject()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val directory by lazy { me.capcom.smsgateway.modules.directory.DirectoryService.get(this) }
    private var directoryJob: Job? = null
    private val phoneServer by lazy { PhoneServer(this,store,hub) }
    private var server: ApplicationEngine? = null
    private val starting = java.util.concurrent.atomic.AtomicBoolean(false)
    private val serverLock = Any()
    private val hub by lazy { PeerHub.get(this) }
    private val labels by lazy { PhoneLabels(this) }
    private var lastRecovery = 0L
    private var wakeLock: android.os.PowerManager.WakeLock? = null
    private var peerJob: Job? = null
    private val store by lazy { PrivateStore(this) }
    private val history by lazy { SmsHistory(this, store) }
    private val prefs by lazy { getSharedPreferences("iphone", 0) }
    private val pairingLimit = WindowLimit(10, 60_000)
    private val sendLimit = WindowLimit(6, 60_000)
    private val smsGrant=io.ktor.util.AttributeKey<PrivateStore.Install>("sms-install")
    private fun smsScope(c:ApplicationCall)=PrivateStore.smsScope(c.attributes[smsGrant].grants)
    private fun nodes(c:ApplicationCall)=c.attributes[smsGrant].nodes()
    private fun allows(c:ApplicationCall,id:String)=id in nodes(c)
    private fun visibleAddresses(c:ApplicationCall):Set<String> {
        val set=nodes(c)
        return hub.visibleAddresses(set) + (if("server" in set)history.addresses() else emptySet())
    }
    private fun visibleStates(c:ApplicationCall,states:List<ConversationState>):List<ConversationState>{
        if(states.isEmpty())return states
        val addresses=visibleAddresses(c)
        val keys=states.map { it.region }.distinct().associateWith { region->addresses.map { ConversationIdentity.key(it,region) }.toSet() }
        return states.filter { it.address in addresses || ConversationIdentity.key(it.address,it.region) in keys[it.region].orEmpty() }
    }
    private val apiLimit = WindowLimit(180, 60_000)
    override fun onBind(intent: Intent?): IBinder? = null
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        startForeground(101, notifications.makeNotification(this, 101, "iPhone 远程短信 HTTPS"))
        // Non-exported service: root deployment can refresh an existing enabled guard
        // without changing service preferences, copying credentials, or opening UI.
        if (intent?.action == ACTION_REFRESH_ROOT) RootBridge.refreshIfAuthorized(this, discoverExisting=true)
        if (getSharedPreferences("peer-client",0).getBoolean("enabled",false)) {
            directory.monitor.start()
            if(peerJob?.isActive!=true) peerJob=scope.launch {
                peerRunning=true
                try {
                messages.start(this@IphoneService)
                // Keep the paired phone's polling alive when its screen is off.
                // The service releases this lock in onDestroy, including stop-sharing.
                wakeLock = (getSystemService(Context.POWER_SERVICE) as android.os.PowerManager)
                    .newWakeLock(android.os.PowerManager.PARTIAL_WAKE_LOCK,"iphone:peer").apply { acquire() }
                PeerClient(this@IphoneService).run(history,store,::messageState,{messages.getMessage(it)!=null}){ id,address,body,slot,expires ->
                    messages.enqueueMessage(SendRequest(EntitySource.Local, Message(id,MessageContent.Text(body),listOf(address),false,Date()),SendParams(true,true,slot,expires?.let{Date(it)},null,null)))
                }
                } finally { peerRunning=false }
            }
            return START_STICKY
        }
        if (!prefs.getBoolean("enabled", false)) { stopSelf(); return START_NOT_STICKY }
        directory.monitor.start()
        if (starting.compareAndSet(false,true)) scope.launch {
            try {
                messages.start(this@IphoneService)
                synchronized(serverLock) { startServer() }
                retireBrowserVoice()
                directoryJob=scope.launch {
                    while(isActive) {
                        runCatching { directory.tickLocal("server") }
                        directory.monitor.awaitWork(10_000)
                    }
                }
                status= "HTTPS 已监听 [::]:8443；公网连通性未验证"
                wakeLock = (getSystemService(Context.POWER_SERVICE) as android.os.PowerManager).newWakeLock(android.os.PowerManager.PARTIAL_WAKE_LOCK,"iphone:https").apply { acquire() }
                while(isActive) { runCatching { hub.flushPush() }; delay(10_000); BridgeMonitor.check(this@IphoneService) }
            }
            catch (_: Exception) { status = "HTTPS 启动失败：请检查证书、私钥密码和端口"; stopSelf() }
        } else if (intent?.action == ACTION_RECOVER) scope.launch {
            synchronized(serverLock) {
                val now = android.os.SystemClock.elapsedRealtime()
                if (prefs.getBoolean("enabled",false) && (lastRecovery == 0L || now-lastRecovery >= 60_000)) {
                    lastRecovery=now
                    runCatching { server?.stop(500,1000); server=null; startServer(); status="HTTPS 已恢复；公网连通性未验证" }
                        .onFailure { status="HTTPS 恢复失败，请检查证书和端口" }
                }
            }
        }
        if(intent?.action=="me.capcom.smsgateway.iphone.PROVISION_GROUNDWIRE") scope.launch {
            val file=java.io.File(noBackupFilesDir,"commlink-groundwire-import.json")
            try {
                require(file.length() in 2..65536)
                val b=org.json.JSONObject(file.readText())
                val routeText=if(b.has("bindings")){
                    val bindings=b.getJSONArray("bindings")
                    (0 until bindings.length()).joinToString("\n"){i->
                        val binding=bindings.getJSONObject(i)
                        val line=hub.allLines().single{it["deviceId"]==binding.getString("device") && (it["slot"] as? Number)?.toInt()==binding.getInt("slot")}
                        require(line["lineOnline"]==true && line["present"]==true && line["confirmed"]==true && line["enabled"]==true)
                        listOf(line["lineId"],line["deviceId"],line["slot"],line["subscriptionId"],binding.getString("prefix")).joinToString(" ")
                    }
                }else b.getString("routes")
                me.capcom.smsgateway.modules.voice.GroundwireConfiguration(this@IphoneService).save(
                    b.getString("server"),b.getString("account"),routeText,b.optString("password"))
                java.io.File(noBackupFilesDir,"commlink-groundwire-import-result").writeText("ok")
            }catch(_:Exception) {
                java.io.File(noBackupFilesDir,"commlink-groundwire-import-result").writeText("failed")
            }finally{file.delete()}
        }
        if(intent?.action == ACTION_CHECK) scope.launch { BridgeMonitor.check(this@IphoneService,true) }
        return START_STICKY
    }
    private fun retireBrowserVoice() {
        getSharedPreferences("commlink-voice",0).edit().clear().commit()
        for(name in listOf("voice-web","voice-ari","voice-ice"))
            java.io.File(noBackupFilesDir,name+".secret").delete()
        // Keep the old journal as a read-only history archive, and keep the native SIP password.
    }
    private fun startServer() {
        val (keyStore, alias, password) = TlsIdentity(this).load()
        val host = prefs.getString("host", "sms.example.com")!!
        require(host.matches(Regex("[a-zA-Z0-9.-]+")))
        val origin = "https://$host:8443"
        server = embeddedServer(Netty, applicationEngineEnvironment {
            sslConnector(keyStore, alias, { password }, { password }) { this.host = "::"; port = 8443 }
            module {
                install(ContentNegotiation) { gson() }
                install(StatusPages) {
                    exception<SecurityException> { call, _ -> call.respond(HttpStatusCode.Forbidden, mapOf("error" to "安卓尚未授予所需权限")) }
                    exception<IllegalArgumentException> { call, _ -> call.respond(HttpStatusCode.BadRequest, mapOf("error" to "请求格式有误或请求标识冲突")) }
                    exception<Throwable> { call, _ -> call.respond(HttpStatusCode.InternalServerError, mapOf("error" to "网关操作失败，请检查安卓状态；不要重复新建发送请求")) }
                }
                intercept(ApplicationCallPipeline.Plugins) {
                    call.response.header("Cache-Control", "no-store")
                    call.response.header("X-Content-Type-Options", "nosniff")
                    call.response.header("Referrer-Policy", "no-referrer")
                    call.response.header("Strict-Transport-Security", "max-age=31536000")
                    call.response.header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'")
                    // HTTP/2 carries the destination in :authority, which Ktor
                    // exposes through local.serverHost/serverPort, not Host.
                    val hostHeader = call.request.header("Host")
                    val destinationAllowed = if (call.request.local.version == "HTTP/2") {
                        call.request.local.serverHost == host && call.request.local.serverPort == 8443 &&
                            (hostHeader == null || hostHeader == "$host:8443")
                    } else hostHeader == "$host:8443"
                    if (!destinationAllowed || (call.request.httpMethod != HttpMethod.Get && call.request.header("Origin") != origin)) {
                        call.respond(HttpStatusCode.Forbidden); finish(); return@intercept
                    }
                    if (call.request.path().startsWith("/api/")) {
                        if (!apiLimit.allow()) { call.respond(HttpStatusCode.TooManyRequests); finish(); return@intercept }
                        if (call.request.path() !in setOf("/api/pair","/api/pair/finish","/api/refresh")) {
                            val grant=store.install(call.request.cookies["__Host-iphone"].orEmpty(),"sms")
                            if(grant==null || !grant.allows("sms.read")) {call.respond(HttpStatusCode.Unauthorized); finish(); return@intercept}
                            call.attributes.put(smsGrant,grant)
                        }
                    }
                }
                routing {
                    post("/peer/link") {
                        if(!pairingLimit.allow())return@post call.respond(HttpStatusCode.TooManyRequests)
                        val bearer=call.request.header("Authorization")?.removePrefix("Bearer ").orEmpty()
                        val body=call.json()
                        val result=hub.requestLink(body["code"].orEmpty(),bearer,body["model"].orEmpty(),body["previous"].orEmpty())
                        when(result) {
                            "ok" -> call.respond(mapOf("status" to "ok","ok" to true))
                            "pending" -> call.respond(HttpStatusCode.Accepted,mapOf("status" to "pending"))
                            else -> call.respond(HttpStatusCode.Forbidden)
                        }
                    }
                    post("/peer/sync") {
                        val bearer=call.request.header("Authorization")?.removePrefix("Bearer ").orEmpty()
                        if(!hub.authorized(bearer))return@post call.respond(HttpStatusCode.Forbidden)
                        val data=org.json.JSONObject(call.limitedBody(2*1024*1024))
                        call.respondText(hub.sync(bearer,data).toString(),ContentType.Application.Json)
                    }
                    get("/healthz") { call.respond(mapOf("service" to "sms-bridge", "ok" to true)) }
                    post("/api/pair") {
                        if(!pairingLimit.allow()) return@post call.respond(HttpStatusCode.TooManyRequests)
                        val body = call.json()
                        val token = requestPair(body["code"] ?: "", body["name"] ?: "iPhone")
                            ?: return@post call.respond(HttpStatusCode.Forbidden)
                        call.response.header("Set-Cookie", "__Host-pair=$token; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=180")
                        call.respond(mapOf("status" to "pending"))
                    }
                    post("/api/pair/finish") {
                        val token = call.request.cookies["__Host-pair"] ?: ""
                        val name = consumeApproval(token) ?: return@post call.respond(HttpStatusCode.Accepted, mapOf("status" to "pending"))
                        val session = PrivateStore.token()
                        store.authorize(session, name)
                        call.response.header("Set-Cookie", "__Host-iphone=$session; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=43200")
                        call.response.headers.append("Set-Cookie", "__Host-refresh=${store.issueRefresh(session)}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=2592000")
                        call.respond(mapOf("status" to "ok"))
                    }
                    post("/api/refresh") {
                        val pair=store.rotate(call.request.cookies["__Host-refresh"] ?: "") ?: return@post call.respond(HttpStatusCode.Unauthorized)
                        call.response.headers.append("Set-Cookie", "__Host-iphone=${pair.first}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=43200")
                        call.response.headers.append("Set-Cookie", "__Host-refresh=${pair.second}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=2592000")
                        call.respond(mapOf("ok" to true))
                    }
                    get("/api/status") { call.respond(mapOf("status" to status, "publicConnectivity" to "unverified", "addresses" to addresses(), "webPush" to true, "devices" to store.devices())) }
                    get("/api/sims") { call.respond(hub.allLines().filter { allows(call,it["deviceId"].toString()) }.map { it-"subscriptionId" }) }
                    get("/api/phones") { call.respond(hub.devices().filter { allows(call,it["deviceId"].toString()) }) }
                    post("/api/phones") {
                        val b=call.json();if(!allows(call,b["id"].orEmpty()))return@post call.respond(HttpStatusCode.Forbidden);hub.renameDevice(b["id"]!!,b["name"]!!);call.respond(mapOf("ok" to true))
                    }
                    get("/api/contacts") {
                        if(!call.attributes[smsGrant].allows("contacts.read"))return@get call.respond(emptyList<Map<String,String>>())
                        val q=call.request.queryParameters["q"].orEmpty()
                        val merged=runCatching {
                            val items=directory.androidContacts(q,0,{allows(call,it)}).getJSONArray("items")
                            buildList { for(i in 0 until items.length()){
                                val c=items.getJSONObject(i);val numbers=c.getJSONArray("numbers")
                                for(j in 0 until numbers.length())add(mapOf("name" to c.getString("name"),"number" to numbers.getString(j)))
                            } }
                        }.getOrDefault(emptyList())
                        val local=if(allows(call,"server"))history.contacts(q) else emptyList()
                        call.respond((merged+local).distinctBy { PhoneIdentity.normalize(it["number"].orEmpty()) }.take(50)) }
                    get("/api/conversations") { call.respond(visibleStates(call,store.scopedStates(smsScope(call)))) }
                    post("/api/conversations") { val b=call.json(); val address=b["address"]!!; val region=b["region"]?:"CN"
                        if(visibleAddresses(call).none { ConversationIdentity.key(it,region)==ConversationIdentity.key(address,region) })return@post call.respond(HttpStatusCode.Forbidden)
                        call.respond(visibleStates(call,store.updateConversation(address,b["action"]!!,region,smsScope(call)))) }
                    post("/api/sims") {
                        val b=call.json();val id=b["id"]!!.toInt()
                        if(!allows(call,hub.deviceOfAlias(id).orEmpty()))return@post call.respond(HttpStatusCode.Forbidden)
                        hub.renameLine(id,b["name"]!!);call.respond(mapOf("ok" to true))
                    }
                    get("/api/history") {
                        val cursors=call.request.queryParameters["before"]?.split("_").orEmpty()
                        val local=if(!allows(call,"server"))emptyList() else history.page(cursors.getOrNull(0)?.toLong()?:Long.MAX_VALUE,200).map(hub::localHistory)
                        val remote=hub.page(cursors.getOrNull(1)?.toLong()?:Long.MAX_VALUE,nodes(call)).map { it.copy(read=it.read || it.date<=store.seen(it.address)) }
                        fun next(rows:List<SmsRow>, peer:Boolean=false)=if(rows.size!=200)"0" else if(peer)hub.pageCursor(rows.last().id).toString() else rows.last().id.substringAfter(':')
                        val cursor=if(local.size<200 && remote.size<200)null else next(local)+"_"+next(remote,true)
                        call.respond(mapOf("items" to (local+remote).let { rows ->
                            val marks=store.scopedReadTimes(smsScope(call))
                            val names=if(!call.attributes[smsGrant].allows("contacts.read"))emptyMap() else runCatching { directory.resolveNames(rows.map { it.address }){ d->allows(call,d) } }.getOrDefault(emptyMap())
                            rows.map { r->r.copy(name=if(call.attributes[smsGrant].allows("contacts.read"))names[r.address]?:r.name else null, read=r.read || r.date<=(marks[r.address]?:0L)) }
                        }, "next" to cursor))
                    }
                    get("/api/outgoing") {
                        call.respond((if(allows(call,"server"))store.recentRequests() else emptyList()).mapNotNull { id -> messages.getMessage(id)?.let {
                            val m=it.message
                            val address=it.recipients.firstOrNull()?.phoneNumber ?: return@let null
                            val result = messageState(id)
                            SmsRow(id.removePrefix("iphone:"),address,history.format(address),if(call.attributes[smsGrant].allows("contacts.read"))runCatching { directory.resolveName(address){d->allows(call,d)} }.getOrNull() ?: history.contact(address) else null,m.textContent?.text ?: "",m.createdAt,false,true,hub.localSendAlias(id,m.simNumber),result["state"]!!,error=result["error"])
                        } } + hub.outgoing(nodes(call)))
                    }
                    post("/api/read") { val b=call.json(); if(visibleAddresses(call).none {PhoneIdentity.normalize(it)==PhoneIdentity.normalize(b["address"].orEmpty())})return@post call.respond(HttpStatusCode.Forbidden); store.markScopedRead(smsScope(call),PhoneIdentity.normalize(b["address"]!!), minOf(b["time"]!!.toLong(), System.currentTimeMillis())); call.respond(mapOf("ok" to true)) }
                    post("/api/logout") { store.logout(call.request.cookies["__Host-iphone"] ?: ""); call.response.header("Set-Cookie", "__Host-iphone=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0"); call.respond(mapOf("ok" to true)) }
                    get("/api/push/key") { call.respond(mapOf("key" to WebPush(this@IphoneService).publicKey())) }
                    post("/api/push/preview/off") {
                        store.disablePreview(call.request.cookies["__Host-iphone"]!!)
                        call.respond(mapOf("ok" to true))
                    }
                    get("/api/push/preview") { call.respond(mapOf("enabled" to store.previewEnabled(call.request.cookies["__Host-iphone"]!!))) }
                    post("/api/push/subscribe") {
                        val b = call.json()
                        fun key(field: String) = if(b["preview"] == "true") android.util.Base64.decode(
                            requireNotNull(b[field]), android.util.Base64.URL_SAFE or android.util.Base64.NO_WRAP
                        ) else null
                        store.subscribe(requireNotNull(b["endpoint"]), call.request.cookies["__Host-iphone"]!!, key("p256dh"), key("auth"))
                        call.respond(mapOf("ok" to true))
                    }
                    post("/api/push/unsubscribe") { store.unsubscribe(call.request.cookies["__Host-iphone"]!!);call.respond(mapOf("ok" to true)) }
                    post("/api/push/test") { if(!pairingLimit.allow())return@post call.respond(HttpStatusCode.TooManyRequests);WebPushWorker.enqueueTest(this@IphoneService,call.attributes[smsGrant].installation);call.respond(mapOf("status" to "已排队；不代表已提交或设备已收到")) }
                    get("/api/push/status") { call.respond(mapOf("status" to (prefs.getString("push-status",null) ?: "尚无提交结果"))) }
                    post("/api/send") {
                        if(store.install(call.request.cookies["__Host-iphone"].orEmpty(),"sms")?.allows("sms.send")!=true)
                            return@post call.respond(HttpStatusCode.Forbidden)
                        val b = call.json()
                        val id = "iphone:${b["id"]}"
                        require(b["id"]?.matches(Regex("[a-fA-F0-9-]{36}")) == true)
                        val number = PhoneIdentity.normalize(b["address"] ?: "")
                        val body = b["body"] ?: ""
                        val lineId = b["lineId"]
                        val selected = lineId?.let { requireNotNull(hub.line(it)) { "线路不存在" } }
                        val sim = if(selected==null)b["sim"]?.toInt() else (selected["id"] as Number).toInt()
                        if(sim==null || !allows(call,hub.deviceOfAlias(sim).orEmpty()))return@post call.respond(HttpStatusCode.Forbidden)
                        require(selected==null || (selected["online"]==true && selected["confirmed"]==true))
                        require(number.matches(Regex("\\+?[0-9]{3,20}")) && body.isNotBlank() && body.length <= 2000)
                        if(sim!=null && hub.isRemote(sim)){
                            if(!sendLimit.allow())return@post call.respond(HttpStatusCode.TooManyRequests)
                            if(hub.sent(b["id"]!!)==null && hub.allLines().none{it["id"]==sim && it["online"]==true})return@post call.respond(HttpStatusCode.ServiceUnavailable,mapOf("error" to "共享手机或所选线路离线"))
                            store.reserve(id,PrivateStore.hash("$number\u0000$sim\u0000$body"))
                            val row=hub.queue(b["id"]!!,number,body,sim)
                            return@post call.respond(HttpStatusCode.Accepted,mapOf("id" to row.id,"state" to row.state))
                        }
                        require(sim != null)
                        val fingerprint = PrivateStore.hash("$number\u0000$sim\u0000$body")
                        if(!sendLimit.allow()) return@post call.respond(HttpStatusCode.TooManyRequests)
                        store.enqueueOnce(id,fingerprint,{messages.getMessage(id)!=null}) { val slot=hub.bindLocalSend(id,sim,lineId); messages.enqueueMessage(SendRequest(EntitySource.Local,
                            Message(id, MessageContent.Text(body), listOf(number), false, Date()),
                            SendParams(true, true, slot, null, null, null))) }
                        call.respond(HttpStatusCode.Accepted, messageState(id))
                    }
                    get("/api/send/{id}") { val id=call.parameters["id"]!!; require(id.matches(Regex("[a-fA-F0-9-]{36}"))); call.respond(hub.sent(id,nodes(call))?.let {mapOf("id" to id,"state" to it.state)} ?: if(allows(call,"server"))messageState("iphone:$id") else mapOf("id" to id,"state" to "unknown")) }
                    get("/{path...}") {
                        if(call.request.path()=="/phone" || call.request.path().startsWith("/phone/"))
                            return@get call.respondRedirect("https://$host:8444/phone/")
                        val path = call.parameters.getAll("path")?.joinToString("/").orEmpty().ifBlank { "index.html" }
                        if(path.contains("..") || path.contains('\\')) return@get call.respond(HttpStatusCode.NotFound)
                        val bytes = try { assets.open("iphone/$path").use { it.readBytes() } } catch (_: Exception) { return@get call.respond(HttpStatusCode.NotFound) }
                        val type = when(path.substringAfterLast('.')) { "html" -> ContentType.Text.Html; "js" -> ContentType.Application.JavaScript; "css" -> ContentType.Text.CSS; "json", "webmanifest" -> ContentType.Application.Json; "png" -> ContentType.Image.PNG; "svg" -> ContentType.parse("image/svg+xml"); else -> ContentType.Application.OctetStream }
                        call.respondBytes(bytes, type)
                    }
                }
            }
        }) { requestQueueLimit = 32; runningLimit = 16; maxInitialLineLength = 4096; maxHeaderSize = 8192 }.start(false)
        // The independent listener must never take down an already running SMS server.
        phoneServer.restart(host,keyStore,alias,password)
    }
    private fun messageState(id: String): Map<String, String> {
        if(store.rejected(id))return mapOf("id" to id.removePrefix("iphone:"),"state" to "failed")
        val record = messages.getMessage(id)
        val state = when(record?.message?.state?.name) {
            "Pending" -> "accepted"; "Sent" -> "sent"; "Delivered" -> "delivered"; "Failed", "Cancelled" -> "failed"; else -> "unknown"
        }
        val result = mutableMapOf("id" to id.removePrefix("iphone:"), "state" to state)
        if (state == "failed") {
            val detail = record?.recipients?.firstOrNull { it.error != null }?.error.orEmpty()
            result["error"] = when {
                "RESULT_ERROR_GENERIC_FAILURE" in detail -> "安卓短信接口返回通用发送失败；请检查手机短信权限和 SIM 线路。"
                "RADIO_OFF" in detail -> "手机通信功能已关闭，请检查飞行模式。"
                "NO_SERVICE" in detail -> "所选 SIM 暂无网络服务。"
                "SecurityException" in detail || "permission" in detail.lowercase() -> "安卓未允许本次短信操作，请检查短信权限。"
                else -> "安卓未能完成发送，请在手机查看发送诊断。"
            }
        }
        return result
    }
    override fun onDestroy() { scope.cancel(); directory.monitor.stop(); synchronized(serverLock) { phoneServer.stop(); server?.stop(500, 1000); server=null }; wakeLock?.let { if(it.isHeld) it.release() }; store.close(); status="已关闭"; super.onDestroy() }
    companion object {
        @Volatile var peerRunning=false
        const val ACTION_RECOVER = "me.capcom.smsgateway.iphone.RECOVER"
        const val ACTION_CHECK = "me.capcom.smsgateway.iphone.CHECK"
        const val ACTION_REFRESH_ROOT = "me.capcom.smsgateway.iphone.REFRESH_ROOT_GUARD"
        fun recover(context: Context) { val i=Intent(context,IphoneService::class.java).setAction(ACTION_RECOVER); if(android.os.Build.VERSION.SDK_INT>=26) context.startForegroundService(i) else context.startService(i) }
        @Volatile var status = "已关闭"
        private var code = ""
        private var expires = 0L
        private var pendingToken = ""
        private var pendingName = ""
        private var pendingApp = "sms"
        private var pendingInstall = ""
        private var approvedScopes = ""
        private var approved = false
        @Synchronized fun newCode(): String { code=PrivateStore.token().take(12); expires=System.currentTimeMillis()+180_000; pendingToken=""; approved=false; return code }
        @Synchronized fun requestPair(value: String, name: String, app: String = "sms"): String? {
            if(value != code || code.isBlank() || System.currentTimeMillis()>expires || pendingToken.isNotEmpty()) return null
            pendingToken=PrivateStore.token(); pendingName=name.take(60); pendingApp=app; pendingInstall=java.util.UUID.randomUUID().toString(); code=""; return pendingToken
        }
        @Synchronized fun pending(): String = if(pendingToken.isNotBlank() && System.currentTimeMillis()<expires) pendingName else ""
        @Synchronized fun requestedApp() = pendingApp
        @Synchronized fun ticket() = pendingInstall
        @Synchronized fun approve(installation: String, scopes: Set<String>) {
            if(pending().isNotEmpty() && installation==pendingInstall && scopes.isNotEmpty()) {
                approvedScopes=scopes.joinToString(","); approved=true
            }
        }
        @Synchronized fun consumeApproval(token: String, app: String = "sms"): PrivateStore.Install? {
            if(!approved || token != pendingToken || app != pendingApp || pending().isEmpty()) return null
            approved=false; pendingToken=""; return PrivateStore.Install(pendingName,pendingApp,pendingInstall,approvedScopes)
        }
        fun start(context: Context) { val i=Intent(context, IphoneService::class.java); if(android.os.Build.VERSION.SDK_INT >= 26) context.startForegroundService(i) else context.startService(i) }
        fun addresses(): List<Map<String,String>> = NetworkInterface.getNetworkInterfaces().toList().flatMap { it.inetAddresses.toList() }.filterNot { it.isLoopbackAddress }.map {
            mapOf("address" to (it.hostAddress ?: ""), "kind" to when { it !is Inet6Address -> "IPv4"; it.isLinkLocalAddress -> "link-local"; (it.address[0].toInt() and 0xfe)==0xfc -> "ULA"; (it.address[0].toInt() and 0xe0)==0x20 -> "global-unicast"; else -> "other" })
        }
    }
}

internal suspend fun ApplicationCall.json(): Map<String,String> {
    val value = com.google.gson.JsonParser.parseString(limitedBody(16384)).asJsonObject
    return value.entrySet().associate { it.key to it.value.asString }
}
internal suspend fun ApplicationCall.limitedBody(limit:Int):String {
    require(request.contentType().match(ContentType.Application.Json))
    val channel = receiveChannel()
    val out = java.io.ByteArrayOutputStream()
    val chunk = ByteArray(1024)
    withTimeout(10_000) { while(true) { val n=channel.readAvailable(chunk); if(n<0) break; require(out.size()+n<=limit); out.write(chunk,0,n) } }
    return out.toString("UTF-8")
}
