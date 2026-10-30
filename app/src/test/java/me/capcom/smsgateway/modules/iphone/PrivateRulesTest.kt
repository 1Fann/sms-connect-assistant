package me.capcom.smsgateway.modules.iphone

import org.junit.Assert.*
import org.junit.Test

class PrivateRulesTest {
    @Test fun chinaAliasesAndServiceNumbers() {
        assertEquals("13800138000", PhoneIdentity.normalize("+86 138 0013 8000"))
        assertEquals("13800138000", PhoneIdentity.normalize("8613800138000"))
        assertEquals("10010", PhoneIdentity.normalize("10010"))
        assertEquals("106900123456", PhoneIdentity.normalize("106900123456"))
    }
    @Test fun limitIsBoundedAndResets() {
        val limit=WindowLimit(2,1000)
        assertTrue(limit.allow(1000));assertTrue(limit.allow(1001));assertFalse(limit.allow(1002));assertTrue(limit.allow(2000))
    }
    @Test fun randomCredentialsAreIndependentAndHashed() {
        val a=PrivateStore.token();val b=PrivateStore.token()
        assertEquals(64,a.length);assertNotEquals(a,b);assertNotEquals(a,PrivateStore.hash(a))
    }
    @Test fun rejectPushEndpointsOutsideApple() {
        assertTrue(WebPush.validEndpoint("https://web.push.apple.com/example"))
        for(endpoint in listOf("http://web.push.apple.com/example","https://127.0.0.1/a","https://web.push.apple.com.evil.test/a","https://evilpush.apple.com/a","https://web.push.apple.com:8443/a","https://user:pass@web.push.apple.com/a")) {
            assertFalse(endpoint,WebPush.validEndpoint(endpoint))
        }
    }
}
