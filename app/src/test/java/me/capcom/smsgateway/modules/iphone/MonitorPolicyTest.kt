package me.capcom.smsgateway.modules.iphone

import org.junit.Assert.*
import org.junit.Test

class MonitorPolicyTest {
    @Test fun intervalBounds() {
        assertEquals(1,MonitorPolicy.minutes("1"));assertEquals(1440,MonitorPolicy.minutes("1440"))
        for(value in listOf("0","1441","-1","1.5","1;id","")) assertTrue(runCatching { MonitorPolicy.minutes(value) }.isFailure)
    }
    @Test fun dueAndClockRollback() {
        assertTrue(MonitorPolicy.due(300001,1,5));assertFalse(MonitorPolicy.due(300000,1,5));assertTrue(MonitorPolicy.due(1,2,5))
    }
    @Test fun manualStopInvalidCertificateAndFirstFailureNeverRepair() {
        assertFalse(MonitorPolicy.mayRepair(false,true,false,2,100000,emptyList()))
        assertFalse(MonitorPolicy.mayRepair(true,false,false,2,100000,emptyList()))
        assertFalse(MonitorPolicy.mayRepair(true,true,false,1,100000,emptyList()))
        assertFalse(MonitorPolicy.mayRepair(true,true,true,2,100000,emptyList()))
        assertTrue(MonitorPolicy.mayRepair(true,true,false,2,100000,emptyList()))
    }
    @Test fun recoveryCooldownAndHourlyCap() {
        assertFalse(MonitorPolicy.mayRepair(true,true,false,2,100000,listOf(50000)))
        assertFalse(MonitorPolicy.mayRepair(true,true,false,2,100000,listOf(1,2,3)))
        assertFalse(MonitorPolicy.mayRepair(true,true,false,2,100000,listOf(100001)))
        assertTrue(MonitorPolicy.mayRepair(true,true,false,2,4000000,listOf(1,2,3)))
    }
}
