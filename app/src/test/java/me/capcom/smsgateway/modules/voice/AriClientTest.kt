package me.capcom.smsgateway.modules.voice

import java.net.InetAddress
import java.net.ServerSocket
import java.net.URLDecoder
import java.util.concurrent.CopyOnWriteArrayList
import org.junit.Assert.*
import org.junit.Test

/** Real OkHttp requests against a loopback fixture; no SIP server, dialplan or cellular modem. */
class AriClientTest {
    @Test fun pbxHeadersTargetTheNewGatewayLegBeforeSingleDial(){
        val calls=CopyOnWriteArrayList<String>()
        val http=ServerSocket(0,8,InetAddress.getByName("127.0.0.1"))
        val server=kotlin.concurrent.thread(isDaemon=true){
            try{while(!http.isClosed)http.accept().use {client->
                val input=client.getInputStream().bufferedReader()
                val req=URLDecoder.decode(input.readLine().substringBeforeLast(" HTTP/"),"UTF-8")
                while(!input.readLine().isNullOrEmpty()) { /* consume request headers */ }
                calls.add(req)
                val status=if(req.contains("/dial?"))"503 Busy" else if(req.endsWith("/gone"))"404 Gone" else "204 No Content"
                client.getOutputStream().write(("HTTP/1.1 "+status+"\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").toByteArray())
            }}catch(e:java.net.SocketException){if(!http.isClosed)throw e}
        }
        try {
            val ari=AriClient{AriAccess(http.localPort,"local-test","fixture")}
            ari.createLeg("ext-1","approved-gateway","outside","call-1")
            ari.variable("ext-1","PJSIP_HEADER(add,X-VSA-SIM)","2")
            ari.variable("ext-1","PJSIP_HEADER(add,X-VSA-Dial)","5550100")
            assertTrue(runCatching{ari.dial("ext-1")}.isFailure)
            ari.drop("gone")
            assertEquals(5,calls.size)
            assertTrue(calls[0].contains("endpoint=PJSIP/approved-gateway"))
            assertTrue(calls[1].contains("X-VSA-SIM)")&&calls[1].endsWith("value=2"))
            assertTrue(calls[2].contains("X-VSA-Dial)"))
            assertEquals(1,calls.count{it.contains("/dial?")})
            assertEquals("DELETE /ari/channels/gone",calls.last())
        }finally{http.close();server.join(1000)}
    }
}
