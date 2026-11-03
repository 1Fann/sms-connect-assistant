package me.capcom.smsgateway.modules.iphone

import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.async
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class PeerRetryTest {
    @Test fun offlineBackoffStillReachesThirtyTwoSeconds() = runTest {
        val retry = PeerRetry()
        retry.waitAfterFailure(4)
        assertEquals(32_000L, testScheduler.currentTime)
    }

    @Test fun multipleNewNetworkEventsWakeOneAttemptAndRespectRetryFloor() = runTest {
        val retry = PeerRetry()
        val attempt = async { retry.waitAfterFailure(4) }
        testScheduler.runCurrent()
        testScheduler.advanceTimeBy(200)
        repeat(12) { retry.networkAvailable() }
        attempt.await()
        assertEquals(1_000L, testScheduler.currentTime)
        retry.beginAttempt()
        retry.waitAfterFailure(4)
        assertEquals(33_000L, testScheduler.currentTime)
    }

    @Test fun networkChangeDuringFailedRequestIsRememberedButOldHintsExpire() = runTest {
        val retry = PeerRetry()
        retry.networkAvailable()
        retry.beginAttempt()
        retry.waitAfterFailure(1)
        assertEquals(4_000L, testScheduler.currentTime)
        retry.beginAttempt()
        retry.networkAvailable()
        retry.waitAfterFailure(4)
        assertEquals(5_000L, testScheduler.currentTime)
    }
}
