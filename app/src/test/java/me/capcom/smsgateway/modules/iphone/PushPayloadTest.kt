package me.capcom.smsgateway.modules.iphone

import com.google.gson.JsonObject
import com.google.gson.JsonParser
import org.junit.Assert.*
import org.junit.Test

class PushPayloadTest {
    private val origin="https://sms.example.com:8443"
    private fun parse(bytes:ByteArray)=JsonParser.parseString(String(bytes,Charsets.UTF_8)).asJsonObject
    private fun preview()=JsonObject().apply {addProperty("title","Fixture Name");addProperty("body","private fixture text");addProperty("address","+12025550123")}
    @Test fun bothIosSchemasHaveTheSameCountAndCompleteNotification() {
        val p=parse(PushPayload.sms(origin,23,preview(),true));val n=p.getAsJsonObject("notification")
        assertEquals(8030,p["web_push"].asInt);assertFalse(p["mutable"].asBoolean);assertFalse(n["mutable"].asBoolean)
        assertEquals(23,p["app_badge"].asInt);assertEquals(23,n["app_badge"].asInt)
        assertEquals("Fixture Name",n["title"].asString)
        assertEquals(origin+"/#conversation=%2B12025550123",n["navigate"].asString)
        assertEquals(origin+"/icon-192.png",n["icon"].asString)
        assertEquals(n["title"],p["title"]);assertEquals(n["body"],p["body"])
    }
    @Test fun previewOffStripsSensitiveFieldsEvenFromAnAlreadyQueuedSnapshot() {
        val bytes=PushPayload.sms(origin,7,preview(),false);val text=String(bytes);val p=parse(bytes)
        for(secret in listOf("Fixture Name","private fixture text","12025550123"))assertFalse(text.contains(secret))
        assertEquals(7,p["app_badge"].asInt);assertEquals(origin+"/",p.getAsJsonObject("notification")["navigate"].asString)
    }
    @Test fun testsAndUnknownCountsNeverInventOrClearBadge() {
        for(p in listOf(parse(PushPayload.sms(origin,null,null,false)),parse(PushPayload.sms(origin,99,preview(),true,true)),parse(PushPayload.phone(origin,null)))) {
            assertFalse(p.has("app_badge"));assertFalse(p.getAsJsonObject("notification").has("app_badge"))
        }
        assertFalse(parse(PushPayload.sms(origin,3,preview(),true,true))["badge"].asBoolean)
        assertEquals(0,parse(PushPayload.phone(origin,0))["app_badge"].asInt)
        assertEquals(origin+"/phone/#missed",parse(PushPayload.phone(origin,6)).getAsJsonObject("notification")["navigate"].asString)
    }
    @Test fun escapedUnicodePayloadAlwaysFitsEncryptedRecord() {
        val malicious=JsonObject().apply {addProperty("title","\u0001".repeat(100));addProperty("body","\u0002".repeat(200));addProperty("address","\u0003".repeat(100))}
        val data=PushPayload.sms(origin,45,malicious,true)
        assertTrue(data.size<=3993);assertEquals(45,parse(data)["app_badge"].asInt)
    }
}
