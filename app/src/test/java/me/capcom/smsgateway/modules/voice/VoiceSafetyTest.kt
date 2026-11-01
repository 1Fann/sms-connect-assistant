package me.capcom.smsgateway.modules.voice

import org.junit.Assert.*
import org.junit.Test

class VoiceSafetyTest {
    private val line=VoiceLine("line-a","device-a",1,true,9)
    @Test fun existingNumericPjsipEndpointsAreSafeBindings(){
        for(value in listOf("2001","cl-web","cl-native"))assertTrue(validEndpoint(value))
        for(value in listOf("", "2001/other", "2001@host", "2001\ncontext=evil", ";2001"))assertFalse(validEndpoint(value))
    }
    @Test fun rejectsSimReplacementAndCrossDevice(){
        assertTrue(VoicePolicy.matchesBinding(line,line))
        for(changed in listOf(line.copy(id="other"),line.copy(deviceId="peer"),line.copy(slot=2),
            line.copy(subscriptionId=10),line.copy(subscriptionId=null),line.copy(online=false))){
            assertFalse(VoicePolicy.matchesBinding(line,changed))
        }
        assertFalse(VoicePolicy.matchesBinding(line.copy(slot=3),line.copy(slot=3)))
    }
    @Test fun mediaVerificationRequiresBothDirectionsOnBothLegs(){
        val baseline=RtpSample(100,100)
        val good=RtpSample(101,102)
        assertTrue(VoicePolicy.mediaVerified(baseline,good,baseline,good))
        for(stalled in listOf(RtpSample(100,101),RtpSample(101,100),null,RtpSample(0,0))){
            assertFalse(VoicePolicy.mediaVerified(baseline,stalled,baseline,good))
            assertFalse(VoicePolicy.mediaVerified(baseline,good,baseline,stalled))
        }
    }
    @Test fun policyOnlyPermitsExplicitNumbersAndPrefixes(){
        val rules="55501*,+15550*,1234"
        for(n in listOf("1234","5550199","+15550100"))assertTrue(VoicePolicy.allowedNumber(n,rules))
        for(n in listOf("123456","55199","5550","0015550100"))assertFalse(VoicePolicy.allowedNumber(n,rules))
        assertFalse(VoicePolicy.allowedNumber("5550100",""))
        for(n in listOf("tel:test","*123#","123;ext=99","123@other"))assertTrue(runCatching{VoicePolicy.number(n)}.isFailure)
    }
    @Test fun offlineTemplateHasNoRouteFromBrowserToDial(){
        val config=VoiceProvisioning.render("cl-web","cl-native",listOf("node-a" to "cl-a","node-b" to "cl-b"))
        assertTrue(config.contains("context=cl-web-in"))
        assertTrue(config.contains("Stasis(commlink,web)"))
        assertFalse(config.contains("Dial("))
        assertTrue(config.contains("password=<GROUNDWIRE_PASSWORD>"))
        assertTrue(runCatching{VoiceProvisioning.render("web","native",listOf("node" to "web"))}.isFailure)
        assertTrue(runCatching{VoiceProvisioning.render("web\ncontext=evil","native",emptyList())}.isFailure)
    }
}
