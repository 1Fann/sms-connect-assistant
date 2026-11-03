package me.capcom.smsgateway.modules.iphone

import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.coroutines.withTimeoutOrNull

/** A new default network can shorten the existing retry, without starting another worker. */
internal class PeerRetry {
    private val networkChanges = Channel<Unit>(Channel.CONFLATED)

    fun beginAttempt() { networkChanges.tryReceive() }
    fun networkAvailable() { networkChanges.trySend(Unit) }

    suspend fun waitAfterFailure(failures: Int) {
        val timeout = 2_000L * (1 shl failures.coerceIn(1, 4))
        // Coalesce unstable Wi-Fi events and keep at least a one-second retry interval.
        delay(1_000)
        withTimeoutOrNull(timeout - 1_000) { networkChanges.receive() }
    }
}
