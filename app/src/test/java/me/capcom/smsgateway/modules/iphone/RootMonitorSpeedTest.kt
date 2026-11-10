package me.capcom.smsgateway.modules.iphone

import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File

class RootMonitorSpeedTest {
    @get:Rule val folder=TemporaryFolder()
    private fun stat(start:Long,state:String="S")="123 (name with ) spaces) $state "+List(18){"0"}.joinToString(" ")+" $start 0"
    @Test fun cachedIdentityRejectsReusedPidAndZombie() {
        val proc=folder.newFolder("proc")
        val pid=File(proc,"123").apply{mkdir()}
        File(pid,"cmdline").writeBytes("me.example.app\u0000".toByteArray())
        File(pid,"stat").writeText(stat(50))
        val identity=ProcessIdentity.capture(proc,123,"me.example.app")!!
        assertTrue(identity.alive())
        File(pid,"stat").writeText(stat(51))
        assertFalse("a reused PID is not the original process",identity.alive())
        File(pid,"stat").writeText(stat(50,"Z"))
        assertFalse("zombie cannot provide HTTPS",identity.alive())
    }
    @Test fun processCaptureRequiresExactPackageName() {
        val proc=folder.newFolder("proc")
        val pid=File(proc,"123").apply{mkdir()}
        File(pid,"cmdline").writeBytes("me.example.app:other\u0000".toByteArray())
        File(pid,"stat").writeText(stat(50))
        assertNull(ProcessIdentity.capture(proc,123,"me.example.app"))
    }
    @Test fun oneSecondPollingDoesNotTurnIntoOneSecondTlsProbing() {
        for(now in listOf(11000L,12000L,19000L)) {
            assertFalse(RootMonitorPolicy.probeDue(now,10000,1,false,false,0,false))
        }
        assertFalse(RootMonitorPolicy.probeDue(19000,10000,1,false,false,1,false))
        assertTrue(RootMonitorPolicy.probeDue(20000,10000,1,false,false,1,false))
        assertTrue(RootMonitorPolicy.probeDue(70000,10000,1,false,false,0,false))
    }
    @Test fun confirmedDeathCanRecoverWithoutWaitingForSecondTlsProbe() {
        assertTrue(RootMonitorPolicy.probeDue(11000,10000,1,false,true,0,false))
        assertFalse(RootMonitorPolicy.recoveryNeeded(false,1,1))
        assertTrue(RootMonitorPolicy.recoveryNeeded(false,1,2))
        assertFalse(RootMonitorPolicy.recoveryNeeded(true,2,2))
        assertFalse(RootMonitorPolicy.recoveryNeeded(false,1,0))
    }
    @Test fun observedDeathAndEmptyRediscoveryRecoverOnTheFirstTick() {
        val confirmed=RootMonitorPolicy.missingSamples(false,true,0)
        assertEquals(2,confirmed)
        assertTrue(RootMonitorPolicy.recoveryNeeded(false,1,confirmed))
        assertEquals(0,RootMonitorPolicy.missingSamples(true,true,0))
        assertEquals(1,RootMonitorPolicy.missingSamples(false,false,0))
        assertFalse(RootMonitorPolicy.recoveryNeeded(false,1,1))
        assertEquals(2,RootMonitorPolicy.missingSamples(false,false,1))
    }
    @Test fun recoveryGetsOneEarlyConfirmationThenReturnsToNormalCadence() {
        assertFalse(RootMonitorPolicy.probeDue(11000,10000,1,false,false,1,true))
        assertTrue(RootMonitorPolicy.probeDue(12000,10000,1,false,false,1,true))
        assertFalse(RootMonitorPolicy.probeDue(13000,12000,1,false,false,0,false))
    }
    @Test fun peerGuardChecksProcessWithoutRequiringALocalHttpsServer() {
        // Null cannot be used as an HTTPS hostname: a peer must never probe it.
        assertTrue(RootMonitorMain.serviceHealthy(true,true,null))
        assertFalse(RootMonitorMain.serviceHealthy(true,false,null))
        assertFalse(RootMonitorMain.serviceHealthy(false,true,"invalid host"))
    }
    @Test fun initialUnlockWaitIsFastThenRelaxesWithoutAccessingCredentials() {
        assertEquals(1000L,RootMonitorPolicy.waitForState(5000,6000))
        assertEquals(5000L,RootMonitorPolicy.waitForState(5000,125000))
    }
}
