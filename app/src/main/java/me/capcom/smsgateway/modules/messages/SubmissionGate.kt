package me.capcom.smsgateway.modules.messages

import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/** Serializes overlapping replacement workers across durable claim and submission. */
object SubmissionGate {
    private val lock=Mutex()
    suspend fun submit(claim:()->Boolean,mark:suspend ()->Boolean,send:()->Unit) = lock.withLock {
        val owned=claim()
        val ready=mark()
        if(owned && ready)send()
    }
}
