package me.capcom.smsgateway.modules.iphone

import android.content.Context
import io.ktor.http.*
import io.ktor.serialization.gson.*
import io.ktor.server.application.*
import io.ktor.server.engine.*
import io.ktor.server.netty.*
import io.ktor.server.plugins.contentnegotiation.*
import io.ktor.server.plugins.statuspages.*
import io.ktor.server.request.*
import io.ktor.server.response.*
import io.ktor.server.routing.*
import io.ktor.util.AttributeKey
import kotlinx.coroutines.*
import java.security.KeyStore
import me.capcom.smsgateway.modules.directory.*
import me.capcom.smsgateway.modules.voice.*

/** Separate origin and listener: phone errors or an occupied port cannot stop SMS. */
class PhoneServer(private val androidContext:Context, private val store:PrivateStore, private val hub:PeerHub, private val port:Int=8444, private val bindAddress:String="::") {
    companion object {
        @Volatile var status="电话服务尚未启动"
        private val installKey=AttributeKey<PrivateStore.Install>("phone-install")
    }
    private var engine:ApplicationEngine?=null
    private var connections:io.netty.channel.group.ChannelGroup?=null
    private val directory by lazy { DirectoryService.get(androidContext) }
    private val limit=WindowLimit(600,60_000)
    private val pairLimit=WindowLimit(10,60_000)
    private fun owner(call:ApplicationCall) = call.attributes[installKey]
    private fun deviceAllowed(call:ApplicationCall,id:String) =
        owner(call).allows("device:"+id) && hub.devices().any { it["deviceId"]==id }
    private suspend fun requireScope(call:ApplicationCall,scope:String):Boolean {
        if(owner(call).allows(scope))return true
        call.respond(HttpStatusCode.Forbidden, mapOf("error" to "此安装未获该功能授权"))
        return false
    }
    fun stop() {
        // Ktor 2.2 stops the worker event loops before closing idle HTTP/2 child
        // sockets. Closing accepted sockets first lets pending stream jobs finish.
        connections?.close()?.awaitUninterruptibly(2000)
        connections=null
        engine?.stop(500,1800)
        engine=null
        status="电话服务已关闭"
    }
    fun restart(host:String, keys:KeyStore, alias:String, password:CharArray) {
        runCatching {
            stop()
            val origin="https://"+host+":"+port
            val sockets=io.netty.channel.group.DefaultChannelGroup(io.netty.util.concurrent.GlobalEventExecutor.INSTANCE,true)
            connections=sockets
            val server=embeddedServer(Netty, applicationEngineEnvironment {
                sslConnector(keys,alias,{password},{password}) { this.host=bindAddress; this.port=this@PhoneServer.port }
                module {
                    install(ContentNegotiation) { gson() }
                    compressWebAssets()
                    install(StatusPages) {
                        exception<IllegalArgumentException> { call,_->call.respond(HttpStatusCode.BadRequest,mapOf("error" to "请求字段或当前操作无效")) }
                        exception<SecurityException> {call,_->call.respond(HttpStatusCode.Forbidden,mapOf("error" to "缺少设备或系统授权"))}
                        exception<IllegalStateException> {call,_->call.respond(HttpStatusCode.Conflict,mapOf("error" to "记录已变更或服务未就绪，请刷新"))}
                        exception<Throwable> {call,_->call.respond(HttpStatusCode.InternalServerError,mapOf("error" to "电话服务暂不可用"))}
                    }
                    intercept(ApplicationCallPipeline.Plugins) {
                        val authority=call.request.header("Host")
                        val valid=if(call.request.local.version=="HTTP/2")
                            call.request.local.serverHost==host && call.request.local.serverPort==port && (authority==null||authority=="$host:$port")
                        else authority=="$host:$port"
                        val path=call.request.path()
                        if(!valid || (call.request.httpMethod!=HttpMethod.Get && call.request.header("Origin")!=origin)) {
                            call.respond(HttpStatusCode.Forbidden); finish(); return@intercept
                        }
                        call.response.header("Cache-Control","no-store")
                        call.response.header("Referrer-Policy","no-referrer")
                        call.response.header("X-Content-Type-Options","nosniff")
                        call.response.header("Strict-Transport-Security","max-age=31536000")
                        call.response.header("Permissions-Policy","microphone=(), camera=()")
                        call.response.header("Content-Security-Policy","default-src 'self'; script-src 'self' 'sha256-$WEB_STARTUP_SCRIPT_HASH'; style-src 'self'; connect-src 'self'; img-src 'self' data:; media-src 'none'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
                        if(path.startsWith("/api/")) {
                            if(!limit.allow()){call.respond(HttpStatusCode.TooManyRequests);finish();return@intercept}
                            if(path !in setOf("/api/pair","/api/pair/finish","/api/refresh")){
                                val grant=store.install(call.request.cookies["__Host-phone"].orEmpty(),"phone")
                                if(grant==null){call.respond(HttpStatusCode.Unauthorized);finish();return@intercept}
                                call.attributes.put(installKey,grant)
                            }
                        }
                    }
                    routing {
                        post("/api/pair") {
                            if(!pairLimit.allow())return@post call.respond(HttpStatusCode.TooManyRequests)
                            val input=call.json()
                            val ticket=IphoneService.requestPair(input["code"].orEmpty(),"互联电话","phone") ?: return@post call.respond(HttpStatusCode.Forbidden)
                            call.response.header("Set-Cookie","__Host-phone-pair=$ticket; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=180")
                            call.respond(mapOf("status" to "pending"))
                        }
                        post("/api/pair/finish") {
                            val approved=IphoneService.consumeApproval(call.request.cookies["__Host-phone-pair"].orEmpty(),"phone")
                                ?: return@post call.respond(HttpStatusCode.Accepted,mapOf("status" to "pending"))
                            val access=PrivateStore.token()
                            store.authorize(access,approved)
                            credentials(call,access,store.issueRefresh(access))
                            call.respond(mapOf("status" to "ok"))
                        }
                        post("/api/refresh") {
                            val pair=store.rotate(call.request.cookies["__Host-phone-refresh"].orEmpty(),"phone")
                                ?: return@post call.respond(HttpStatusCode.Unauthorized)
                            credentials(call,pair.first,pair.second)
                            call.respond(mapOf("ok" to true))
                        }
                        post("/api/logout") {
                            store.logout(call.request.cookies["__Host-phone"].orEmpty())
                            call.respond(mapOf("ok" to true))
                        }
                        route("/api/v2") {
                            get("session") {
                                val grant=owner(call)
                                call.respond(mapOf("installationId" to grant.installation,"permissions" to grant.grants.split(',').filterNot { it.startsWith("device:") }))
                            }
                            get("startup") {
                                val grant=owner(call)
                                val devices=visibleDevices(call)
                                val allowed=devices.map { it["deviceId"] }.toSet()
                                val lines=hub.allLines().filter { it["deviceId"] in allowed }
                                call.respond(mapOf(
                                    "session" to mapOf("installationId" to grant.installation,
                                        "permissions" to grant.grants.split(',').filterNot { it.startsWith("device:") }),
                                    "devices" to devices,
                                    "lines" to lines.map { it-"subscriptionId" },
                                    "routes" to if(grant.allows("calls.dial"))
                                        availableGroundwireRoutes(androidContext,lines) { it in allowed } else emptyList()
                                ))
                            }
                            get("devices") { call.respond(visibleDevices(call)) }
                            get("lines") { call.respond(visibleLines(call)) }
                            get("push/key"){call.respond(mapOf("key" to WebPush(androidContext).publicKey()))}
                            post("push/subscribe"){
                                if(!requireScope(call,"calls.read"))return@post
                                store.subscribe(call.json()["endpoint"].orEmpty(),call.request.cookies["__Host-phone"]!!,null,null)
                                call.respond(mapOf("ok" to true))
                            }
                            post("push/unsubscribe"){store.unsubscribe(call.request.cookies["__Host-phone"]!!);call.respond(mapOf("ok" to true))}
                            directoryRoutes(directory,::requireScope,::deviceAllowed,{ owner(it).installation },{ owner(it).allows("contacts.read") })
                            groundwireRoutes(androidContext,{ owner(it).installation },::requireScope,hub::allLines,::deviceAllowed)
                        }
                        get("/") { call.respondRedirect("/phone/") }
                        get("/phone") { asset(call,"phone/index.html") }
                        get("/phone/") { asset(call,"phone/index.html") }
                        get("/phone/{file}") { asset(call,"phone/"+call.parameters["file"].orEmpty()) }
                        get("/assets/{file}") { asset(call,"assets/"+call.parameters["file"].orEmpty()) }
                    }
                }
            }) {
                // HTTP/2 stream teardown dispatches through Ktor's call event loop.
                // Keep it alive with the socket worker while draining the listener.
                configureBootstrap={
                    handler(object:io.netty.channel.ChannelInboundHandlerAdapter(){
                        override fun channelRead(ctx:io.netty.channel.ChannelHandlerContext,msg:Any) {
                            if(msg is io.netty.channel.Channel)sockets.add(msg)
                            ctx.fireChannelRead(msg)
                        }
                    })
                }
                shareWorkGroup=true
                connectionGroupSize=1
                workerGroupSize=2
                callGroupSize=2
                runningLimit=12
                requestQueueLimit=24
            }
            engine=server
            server.start(false)
            status="电话服务已启动"
        }.onFailure {
            runCatching { stop() }
            status="电话服务启动失败，请检查端口与证书"
        }
    }
    private fun visibleDevices(call: ApplicationCall) =
        hub.devices().filter { owner(call).allows("device:"+it["deviceId"]) }.map {
            it+("contactsWrite" to directory.deviceAccess(it["deviceId"].toString()).optBoolean("contactsWrite"))
        }

    private fun visibleLines(call: ApplicationCall) =
        hub.allLines().filter { deviceAllowed(call,it["deviceId"].toString()) }.map { it-"subscriptionId" }

    private suspend fun asset(call:ApplicationCall,path:String) {
        if(!path.matches(Regex("(?:phone|assets)/[A-Za-z0-9_-]+[.][A-Za-z0-9]+"))) {
            call.respond(HttpStatusCode.NotFound);return
        }
        val bytes=try {androidContext.assets.open("iphone/"+path).use { it.readBytes() }} catch(_:java.io.FileNotFoundException) {
            call.respond(HttpStatusCode.NotFound);return
        }
        val type=when(path.substringAfterLast('.')){
            "html"->ContentType.Text.Html; "js"->ContentType.Application.JavaScript
            "css"->ContentType.Text.CSS; "png"->ContentType.Image.PNG; "webmanifest"->ContentType.Application.Json
            else->ContentType.Application.OctetStream
        }
        call.respondBytes(bytes,type)
    }
    private fun credentials(call:ApplicationCall,access:String,refresh:String){
        call.response.headers.append("Set-Cookie","__Host-phone=$access; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=43200")
        call.response.headers.append("Set-Cookie","__Host-phone-refresh=$refresh; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=2592000")
    }
}
