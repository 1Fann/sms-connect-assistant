package me.capcom.smsgateway.modules.defaultsms

import org.junit.Assert.assertEquals
import org.junit.Test

class SmsPartStateTest {
    @Test fun oneOfThreeSentIsNotWholeMessageSent() {
        assertEquals(4 to 32, SmsPartState(setOf(0), emptySet(), false, false).providerState(3, true))
    }
    @Test fun duplicateCallbackCannotCompleteMultipart() {
        assertEquals(4 to 32, SmsPartState(setOf(0, 0), emptySet(), false, false).providerState(2, true))
    }
    @Test fun allSentWaitForDelivery() {
        assertEquals(2 to 32, SmsPartState(setOf(0, 1), setOf(1), false, false).providerState(2, true))
    }
    @Test fun allDeliveredBeforeSentCallbacksStillDelivered() {
        assertEquals(2 to 0, SmsPartState(emptySet(), setOf(0, 1), false, false).providerState(2, true))
    }
    @Test fun sendFailureCannotBeOverwrittenByLateSuccess() {
        assertEquals(5 to 64, SmsPartState(setOf(0, 1), setOf(0, 1), true, false).providerState(2, true))
    }
    @Test fun deliveryFailurePreservesSentFolder() {
        assertEquals(2 to 64, SmsPartState(setOf(0, 1), setOf(0), false, true).providerState(2, true))
    }
    @Test fun withoutReportsSentIsNotDelivered() {
        assertEquals(2 to -1, SmsPartState(setOf(0), emptySet(), false, false).providerState(1, false))
    }
}
