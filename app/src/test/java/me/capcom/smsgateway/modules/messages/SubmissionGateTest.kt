package me.capcom.smsgateway.modules.messages

import kotlinx.coroutines.*
import kotlinx.coroutines.test.runTest
import org.junit.Assert.*
import org.junit.Test

@OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
class SubmissionGateTest {
    @Test fun crashAfterClaimNeverResubmits()=runTest {
        var claimed=false;var submissions=0
        val claim={if(claimed)false else {claimed=true;true}}
        try { SubmissionGate.submit(claim,{error("process exits after durable claim")},{submissions++}) }catch(_:IllegalStateException){}
        SubmissionGate.submit(claim,{true},{submissions++})
        assertTrue(claimed);assertEquals(0,submissions)
    }
    @Test fun ambiguousModemExceptionDoesNotRetry()=runTest {
        var claimed=false;var submissions=0
        val claim={if(claimed)false else {claimed=true;true}}
        try { SubmissionGate.submit(claim,{true},{submissions++;error("reply lost after modem accepts")}) }catch(_:IllegalStateException){}
        SubmissionGate.submit(claim,{true},{submissions++})
        assertEquals(1,submissions)
    }
    @Test fun overlappingReplacementWorkersSubmitOnce()=runTest {
        var claimed=false;var state=false;var submissions=0
        val claim={if(claimed)false else {claimed=true;true}}
        coroutineScope { repeat(30) { launch { SubmissionGate.submit(claim,{yield();if(state)false else {state=true;true}},{submissions++}) } } }
        assertEquals(1,submissions)
    }
    @Test fun cancelledRecipientDoesNotSubmit()=runTest {
        var submissions=0
        SubmissionGate.submit({true},{false},{submissions++})
        assertEquals(0,submissions)
    }
}
