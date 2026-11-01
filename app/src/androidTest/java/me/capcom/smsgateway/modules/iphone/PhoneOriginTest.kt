package me.capcom.smsgateway.modules.iphone

import io.ktor.server.application.*
import io.ktor.server.engine.*
import io.ktor.server.netty.*
import io.ktor.server.routing.*
import io.ktor.server.websocket.*
import io.ktor.websocket.*
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.bouncycastle.asn1.x500.X500Name
import org.bouncycastle.asn1.x509.Extension
import org.bouncycastle.asn1.x509.GeneralName
import org.bouncycastle.asn1.x509.GeneralNames
import org.bouncycastle.cert.jcajce.JcaX509v3CertificateBuilder
import org.bouncycastle.cert.jcajce.JcaX509CertificateConverter
import org.bouncycastle.operator.jcajce.JcaContentSignerBuilder
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.math.BigInteger
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.util.Date
import javax.net.ssl.SSLContext
import javax.net.ssl.TrustManagerFactory
import javax.net.ssl.X509TrustManager

@RunWith(AndroidJUnit4::class)
class PhoneOriginTest {
    @Test fun phoneUsesApprovedInstallAndIsolatedCookiesOverRealLoopbackTls() {
        val ctx=InstrumentationRegistry.getInstrumentation().targetContext
        check(ctx.packageName.endsWith(".commlinkfixture"))
        val keys=KeyPairGenerator.getInstance("RSA").apply { initialize(2048) }.generateKeyPair()
        val name=X500Name("CN=localhost")
        val cert=JcaX509CertificateConverter().getCertificate(JcaX509v3CertificateBuilder(name,BigInteger.ONE,
            Date(System.currentTimeMillis()-60000),Date(System.currentTimeMillis()+3600000),name,keys.public)
            .addExtension(Extension.subjectAlternativeName,false,GeneralNames(GeneralName(GeneralName.iPAddress,"127.0.0.1")))
            .build(JcaContentSignerBuilder("SHA256WithRSA").build(keys.private)))
        val pwd=PrivateStore.token().toCharArray()
        val tls=KeyStore.getInstance("PKCS12").apply{load(null,null);setKeyEntry("fixture",keys.private,pwd,arrayOf(cert))}
        val trusted=KeyStore.getInstance(KeyStore.getDefaultType()).apply{load(null,null);setCertificateEntry("loopback",cert)}
        val trust=TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm()).apply{init(trusted)}.trustManagers.filterIsInstance<X509TrustManager>().first()
        val socket=SSLContext.getInstance("TLS").apply{init(null,arrayOf(trust),null)}
        val client=OkHttpClient.Builder().sslSocketFactory(socket.socketFactory,trust).build()
        val port=java.net.ServerSocket(0,1,java.net.InetAddress.getByName("127.0.0.1")).use{it.localPort}
        val origin="https://127.0.0.1:"+port
        val db=PrivateStore(ctx,"origin-fixture.db")
        val hub=PeerHub(ctx,"origin-peer-fixture.db")
        val phone=PhoneServer(ctx,db,hub,port,"127.0.0.1")
        fun response(path:String,cookie:String="",verbOrigin:String?=null):Int{
            val request=Request.Builder().url(origin+path)
            if(cookie.isNotEmpty())request.header("Cookie",cookie)
            if(verbOrigin!=null)request.header("Origin",verbOrigin).post("{}".toRequestBody())
            return client.newCall(request.build()).execute().use{it.code}
        }
        try{
            phone.restart("127.0.0.1",tls,"fixture",pwd)
            assertEquals(200,response("/phone/"))
            val sms=PrivateStore.token();db.authorize(sms,PrivateStore.Install("SMS","sms","s","sms.read,sms.send"))
            assertEquals(401,response("/api/v2/session","__Host-phone="+sms))
            val token=PrivateStore.token();db.authorize(token,PrivateStore.Install("Phone","phone","p","calls.read,device:server"))
            val cookie="__Host-phone="+token
            assertEquals(200,response("/api/v2/session",cookie))
            assertEquals(403,response("/api/v2/contacts",cookie))
            assertEquals(403,response("/api/v2/voice/web-session",cookie,origin))
            assertEquals(403,response("/api/logout",cookie,"https://untrusted.invalid"))
            assertEquals(200,response("/api/v2/session",cookie))
            assertTrue(response("/api/send",cookie,origin) in setOf(404,405))
            // Real WSS -> loopback WS, with per-install authorization and live revocation.
            val backendPort=java.net.ServerSocket(0,1,java.net.InetAddress.getByName("127.0.0.1")).use{it.localPort}
            val forwarded=java.util.concurrent.atomic.AtomicInteger()
            val backend=embeddedServer(Netty,port=backendPort,host="127.0.0.1"){
                install(WebSockets)
                routing{webSocket("/ws","sip"){
                    forwarded.incrementAndGet()
                    for(frame in incoming)if(frame is Frame.Text)send(Frame.Text(frame.readText()))
                }}
            }.start(false)
            val config=ctx.getSharedPreferences("commlink-voice",0)
            config.edit().putBoolean("enabled",true).putInt("port",backendPort).commit()
            fun connect(cookie:String,from:String,received:java.util.concurrent.CompletableFuture<String>,closed:java.util.concurrent.CountDownLatch):okhttp3.WebSocket {
                return client.newWebSocket(Request.Builder().url(origin.replace("https:","wss:")+"/ws")
                    .header("Sec-WebSocket-Protocol","sip").header("Cookie",cookie).header("Origin",from).build(),object:okhttp3.WebSocketListener(){
                    override fun onOpen(ws:okhttp3.WebSocket,r:okhttp3.Response){ws.send("OPTIONS sip:fixture.invalid SIP/2.0")}
                    override fun onMessage(ws:okhttp3.WebSocket,text:String){received.complete(text)}
                    override fun onClosing(ws:okhttp3.WebSocket,code:Int,reason:String){ws.close(code,null);closed.countDown()}
                    override fun onFailure(ws:okhttp3.WebSocket,t:Throwable,r:okhttp3.Response?){received.completeExceptionally(t);closed.countDown()}
                })
            }
            try{
                val dial=PrivateStore.token();db.authorize(dial,PrivateStore.Install("Dial","phone","dial","calls.read,calls.dial,device:server"))
                for((badCookie,badOrigin) in listOf(cookie to origin,("__Host-phone="+dial) to "https://untrusted.invalid")){
                    val closed=java.util.concurrent.CountDownLatch(1)
                    val ws=connect(badCookie,badOrigin,java.util.concurrent.CompletableFuture(),closed)
                    assertTrue(closed.await(8,java.util.concurrent.TimeUnit.SECONDS));ws.cancel()
                    assertEquals(0,forwarded.get())
                }
                val received=java.util.concurrent.CompletableFuture<String>()
                val closed=java.util.concurrent.CountDownLatch(1)
                val ws=connect("__Host-phone="+dial,origin,received,closed)
                try{
                    assertEquals("OPTIONS sip:fixture.invalid SIP/2.0",received.get(8,java.util.concurrent.TimeUnit.SECONDS))
                    assertEquals(1,forwarded.get())
                    db.revokeInstallation("dial")
                    assertTrue("Revoked WSS must close",closed.await(8,java.util.concurrent.TimeUnit.SECONDS))
                }finally{ws.cancel()}
            }finally{config.edit().clear().commit();backend.stop(300,1500)}
            db.revokeInstallation("p")
            assertEquals(401,response("/api/v2/session",cookie))
        } finally {phone.stop();db.close();hub.close();client.connectionPool.evictAll();ctx.deleteDatabase("origin-fixture.db");ctx.deleteDatabase("origin-peer-fixture.db")}
    }
}
