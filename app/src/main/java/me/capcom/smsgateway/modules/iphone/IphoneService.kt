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
    private var server: ApplicationEngine? = null
    private val starting = java.util.concurrent.atomic.AtomicBoolean(false)
    private val serverLock = Any()
    private var lastRecovery = 0L
    private var wakeLock: android.os.PowerManager.WakeLock? = null
    private val store by lazy { PrivateStore(this) }
    private val history by lazy { SmsHistory(this, store) }
    private val prefs by lazy { getSharedPreferences("iphone", 0) }
    private val pairingLimit = WindowLimit(10, 60_000)
    private val sendLimit = WindowLimit(6, 60_000)
    private val apiLimit = WindowLimit(180, 60_000)
    override fun onBind(intent: Intent?): IBinder? = null
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        startForeground(101, notifications.makeNotification(this, 101, "iPhone 远程短信 HTTPS"))
        if (!prefs.getBoolean("enabled", false)) { stopSelf(); return START_NOT_STICKY }
        if (starting.compareAndSet(false,true)) scope.launch {
            try {
                synchronized(serverLock) { startServer() }; status = "HTTPS 已监听 [::]:8443；公网连通性未验证"
                wakeLock = (getSystemService(Context.POWER_SERVICE) as android.os.PowerManager).newWakeLock(android.os.PowerManager.PARTIAL_WAKE_LOCK,"iphone:https").apply { acquire() }
                while(isActive) { delay(10_000); BridgeMonitor.check(this@IphoneService) }
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
        if(intent?.action == ACTION_CHECK) scope.launch { BridgeMonitor.check(this@IphoneService,true) }
        return START_STICKY
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
                        if (call.request.path() !in setOf("/api/pair","/api/pair/finish","/api/refresh") && !store.session(call.request.cookies["__Host-iphone"] ?: "")) {
                            call.respond(HttpStatusCode.Unauthorized); finish(); return@intercept
                        }
                    }
                }
                routing {
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
                    get("/api/sims") { call.respond(SubscriptionsHelper.getActiveSimCards(this@IphoneService).map { mapOf("id" to it.simNumber, "name" to (prefs.getString("sim.${it.simNumber}", null) ?: it.carrierName ?: "SIM ${it.simNumber}")) }) }
                    get("/api/contacts") { call.respond(history.contacts(call.request.queryParameters["q"] ?: "")) }
                    get("/api/conversations") { call.respond(store.conversations()) }
                    post("/api/conversations") { val b=call.json(); call.respond(store.updateConversation(b["address"]!!,b["action"]!!)) }
                    post("/api/sims") { val b=call.json(); val id=b["id"]!!.toInt(); require(id in 1..3); prefs.edit().putString("sim.$id", b["name"]!!.take(30)).apply(); call.respond(mapOf("ok" to true)) }
                    get("/api/history") {
                        val before = call.request.queryParameters["before"]?.toLong() ?: Long.MAX_VALUE
                        val rows = history.page(before, 200)
                        call.respond(mapOf("items" to rows, "next" to if(rows.size == 200) rows.last().id.substringAfter(':') else null))
                    }
                    get("/api/outgoing") {
                        call.respond(store.recentRequests().mapNotNull { id -> messages.getMessage(id)?.let {
                            val m=it.message
                            val address=it.recipients.firstOrNull()?.phoneNumber ?: return@let null
                            val result = messageState(id)
                            SmsRow(id.removePrefix("iphone:"),address,history.format(address),history.contact(address),m.textContent?.text ?: "",m.createdAt,false,true,m.simNumber,result["state"]!!,error=result["error"])
                        } })
                    }
                    post("/api/read") { val b=call.json(); store.markRead(PhoneIdentity.normalize(b["address"]!!), minOf(b["time"]!!.toLong(), System.currentTimeMillis())); call.respond(mapOf("ok" to true)) }
                    post("/api/logout") { store.logout(call.request.cookies["__Host-iphone"] ?: ""); call.response.header("Set-Cookie", "__Host-iphone=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0"); call.respond(mapOf("ok" to true)) }
                    get("/api/push/key") { call.respond(mapOf("key" to WebPush(this@IphoneService).publicKey())) }
                    post("/api/push/subscribe") { val b=call.json();store.subscribe(b["endpoint"]!!,call.request.cookies["__Host-iphone"]!!);call.respond(mapOf("ok" to true)) }
                    post("/api/push/unsubscribe") { store.unsubscribe(call.request.cookies["__Host-iphone"]!!);call.respond(mapOf("ok" to true)) }
                    post("/api/push/test") { if(!pairingLimit.allow())return@post call.respond(HttpStatusCode.TooManyRequests);WebPushWorker.enqueue(this@IphoneService);call.respond(mapOf("status" to "已排队；不代表已提交或设备已收到")) }
                    get("/api/push/status") { call.respond(mapOf("status" to (prefs.getString("push-status",null) ?: "尚无提交结果"))) }
                    post("/api/send") {
                        val b = call.json()
                        val id = "iphone:${b["id"]}"
                        require(b["id"]?.matches(Regex("[a-fA-F0-9-]{36}")) == true)
                        val number = PhoneIdentity.normalize(b["address"] ?: "")
                        val body = b["body"] ?: ""
                        val sim = b["sim"]?.toInt()
                        require(number.matches(Regex("\\+?[0-9]{3,20}")) && body.isNotBlank() && body.length <= 2000)
                        require(sim != null && SubscriptionsHelper.getActiveSimCards(this@IphoneService).any { it.simNumber == sim })
                        val fingerprint = PrivateStore.hash("$number\u0000$sim\u0000$body")
                        if(!sendLimit.allow()) return@post call.respond(HttpStatusCode.TooManyRequests)
                        if(store.reserve(id, fingerprint)) messages.enqueueMessage(SendRequest(EntitySource.Local,
                            Message(id, MessageContent.Text(body), listOf(number), false, Date()),
                            SendParams(true, true, sim, null, null, null)))
                        call.respond(HttpStatusCode.Accepted, messageState(id))
                    }
                    get("/api/send/{id}") { val id=call.parameters["id"]!!; require(id.matches(Regex("[a-fA-F0-9-]{36}"))); call.respond(messageState("iphone:$id")) }
                    get("/{path...}") {
                        val path = call.parameters.getAll("path")?.joinToString("/").orEmpty().ifBlank { "index.html" }
                        if(path.contains("..") || path.contains('\\')) return@get call.respond(HttpStatusCode.NotFound)
                        val bytes = try { assets.open("iphone/$path").use { it.readBytes() } } catch (_: Exception) { return@get call.respond(HttpStatusCode.NotFound) }
                        val type = when(path.substringAfterLast('.')) { "html" -> ContentType.Text.Html; "js" -> ContentType.Application.JavaScript; "css" -> ContentType.Text.CSS; "json", "webmanifest" -> ContentType.Application.Json; "png" -> ContentType.Image.PNG; "svg" -> ContentType.parse("image/svg+xml"); else -> ContentType.Application.OctetStream }
                        call.respondBytes(bytes, type)
                    }
                }
            }
        }) { requestQueueLimit = 32; runningLimit = 16; maxInitialLineLength = 4096; maxHeaderSize = 8192 }.start(false)
    }
    private fun messageState(id: String): Map<String, String> {
        val record = messages.getMessage(id)
        val state = when(record?.message?.state?.name) {
            "Pending", "Processed" -> "accepted"; "Sent" -> "sent"; "Delivered" -> "delivered"; "Failed", "Cancelled" -> "failed"; else -> "unknown"
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
    override fun onDestroy() { scope.cancel(); synchronized(serverLock) { server?.stop(500, 1000); server=null }; wakeLock?.let { if(it.isHeld) it.release() }; store.close(); status="已关闭"; super.onDestroy() }
    companion object {
        const val ACTION_RECOVER = "me.capcom.smsgateway.iphone.RECOVER"
        const val ACTION_CHECK = "me.capcom.smsgateway.iphone.CHECK"
        fun recover(context: Context) { val i=Intent(context,IphoneService::class.java).setAction(ACTION_RECOVER); if(android.os.Build.VERSION.SDK_INT>=26) context.startForegroundService(i) else context.startService(i) }
        @Volatile var status = "已关闭"
        private var code = ""
        private var expires = 0L
        private var pendingToken = ""
        private var pendingName = ""
        private var approved = false
        @Synchronized fun newCode(): String { code=PrivateStore.token().take(12); expires=System.currentTimeMillis()+180_000; pendingToken=""; approved=false; return code }
        @Synchronized fun requestPair(value: String, name: String): String? {
            if(value != code || code.isBlank() || System.currentTimeMillis()>expires || pendingToken.isNotEmpty()) return null
            pendingToken=PrivateStore.token(); pendingName=name.take(60); code=""; return pendingToken
        }
        @Synchronized fun pending(): String = if(pendingToken.isNotBlank() && System.currentTimeMillis()<expires) pendingName else ""
        @Synchronized fun approve() { if(pending().isNotEmpty()) approved=true }
        @Synchronized fun consumeApproval(token: String): String? {
            if(!approved || token != pendingToken || pending().isEmpty()) return null
            approved=false; pendingToken=""; return pendingName
        }
        fun start(context: Context) { val i=Intent(context, IphoneService::class.java); if(android.os.Build.VERSION.SDK_INT >= 26) context.startForegroundService(i) else context.startService(i) }
        fun addresses(): List<Map<String,String>> = NetworkInterface.getNetworkInterfaces().toList().flatMap { it.inetAddresses.toList() }.filterNot { it.isLoopbackAddress }.map {
            mapOf("address" to (it.hostAddress ?: ""), "kind" to when { it !is Inet6Address -> "IPv4"; it.isLinkLocalAddress -> "link-local"; (it.address[0].toInt() and 0xfe)==0xfc -> "ULA"; (it.address[0].toInt() and 0xe0)==0x20 -> "global-unicast"; else -> "other" })
        }
    }
}

private suspend fun ApplicationCall.json(): Map<String,String> {
    require(request.contentType().match(ContentType.Application.Json))
    val channel = receiveChannel()
    val out = java.io.ByteArrayOutputStream()
    val chunk = ByteArray(1024)
    withTimeout(10_000) { while(true) { val n=channel.readAvailable(chunk); if(n<0) break; require(out.size()+n<=16384); out.write(chunk,0,n) } }
    val value = com.google.gson.JsonParser.parseString(out.toString("UTF-8")).asJsonObject
    return value.entrySet().associate { it.key to it.value.asString }
}
