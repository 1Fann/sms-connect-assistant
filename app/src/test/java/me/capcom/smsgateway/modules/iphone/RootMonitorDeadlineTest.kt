package me.capcom.smsgateway.modules.iphone

import org.junit.Assert.*
import org.junit.Test
import java.net.SocketTimeoutException
import java.net.Socket
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

class RootMonitorDeadlineTest {
    @Test fun expiredTotalDeadlineCannotBecomeAnInfiniteSocketTimeout() {
        try {
            RootMonitorMain.remainingMillis(System.nanoTime() - 1)
            fail("Expired deadline must abort the probe")
        } catch (_: SocketTimeoutException) { }
    }
    @Test fun shortRemainingDeadlineCapsTheNextRead() {
        val millis = RootMonitorMain.remainingMillis(System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(100))
        assertTrue(millis in 1..100)
    }
    @Test fun longDeadlineStillLimitsIndividualReads() {
        assertEquals(4000,RootMonitorMain.remainingMillis(System.nanoTime() + TimeUnit.SECONDS.toNanos(30)))
    }
    @Test fun hardDeadlineClosesEvenWithoutAnIndividualReadTimeout() {
        val closed=CountDownLatch(1)
        val socket=object: Socket() { override fun close() { super.close(); closed.countDown() } }
        SocketDeadline(socket,20).use {
            assertTrue("deadline must actively close the transport",closed.await(2,TimeUnit.SECONDS))
            assertTrue(socket.isClosed)
        }
    }
    @Test fun cancellingOneProbeDoesNotCancelAnotherProbeDeadline() {
        val first=Socket()
        val closed=CountDownLatch(1)
        val second=object: Socket() { override fun close() { super.close(); closed.countDown() } }
        SocketDeadline(first,1000).close()
        SocketDeadline(second,60).use {
            assertTrue(closed.await(2,TimeUnit.SECONDS))
            assertFalse("completed probe's deadline must be removed",first.isClosed)
        }
        first.close()
    }
}
