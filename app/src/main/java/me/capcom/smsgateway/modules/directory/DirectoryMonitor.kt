package me.capcom.smsgateway.modules.directory

import android.content.Context
import android.content.SharedPreferences
import android.database.ContentObserver
import android.provider.ContactsContract
import android.provider.Telephony
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.selects.select
import kotlinx.coroutines.withTimeoutOrNull
import java.util.concurrent.atomic.AtomicLong

/** A single foreground-service observer wakes the existing authenticated sync loop.
 * The generation also remembers a notification arriving during a Provider scan. */
internal class DirectoryMonitor(private val ctx:Context) {
    private val signals = Channel<Unit>(Channel.CONFLATED)
    private val writes = Channel<Unit>(Channel.CONFLATED)
    private val sequence = AtomicLong()
    val generation:Long get() = sequence.get()
    private var running = false
    private var registered = false
    private var smsRegistered = false
    private val smsObserver = object : ContentObserver(null) {
        override fun onChange(selfChange: Boolean) = wake()
    }
    private val consent = ctx.getSharedPreferences("directory-consent",0)
    private val provider = DirectoryProvider(ctx)
    private val observer = object:ContentObserver(null) {
        override fun onChange(selfChange:Boolean) = invalidateContacts()
    }
    private val consentListener = SharedPreferences.OnSharedPreferenceChangeListener { _, _ ->
        updateAccess(provider.allowed("contacts.read"))
        wake()
    }

    @Synchronized fun start() {
        if(running)return
        running = true
        consent.registerOnSharedPreferenceChangeListener(consentListener)
        updateAccess(provider.allowed("contacts.read"))
    }

    @Synchronized fun updateAccess(canRead:Boolean) {
        if(!running || canRead==registered)return
        if(canRead) {
            try {
                ctx.contentResolver.registerContentObserver(ContactsContract.AUTHORITY_URI,true,observer)
                registered = true
                invalidateContacts()
            } catch (_:SecurityException) { /* Periodic sync still checks permission. */ }
        } else {
            ctx.contentResolver.unregisterContentObserver(observer)
            registered = false
            invalidateContacts()
        }
    }

    @Synchronized fun updateSmsAccess(canRead: Boolean) {
        if (!running || canRead == smsRegistered) return
        if (canRead) {
            try {
                ctx.contentResolver.registerContentObserver(Telephony.Sms.CONTENT_URI, true, smsObserver)
                smsRegistered = true
            } catch (_: SecurityException) { /* The timed sync still works. */ }
        } else {
            ctx.contentResolver.unregisterContentObserver(smsObserver)
            smsRegistered = false
        }
    }

    @Synchronized fun stop() {
        if(!running)return
        running = false
        consent.unregisterOnSharedPreferenceChangeListener(consentListener)
        if(registered)ctx.contentResolver.unregisterContentObserver(observer)
        registered = false
        if (smsRegistered) ctx.contentResolver.unregisterContentObserver(smsObserver)
        smsRegistered = false
    }

    fun invalidateContacts() { sequence.incrementAndGet(); wake() }
    fun wake() { signals.trySend(Unit) }
    fun wakeWrite() { writes.trySend(Unit) }

    suspend fun awaitWork(fallbackMs:Long) {
        val immediate=withTimeoutOrNull(fallbackMs) {
            select<Boolean> {
                writes.onReceive { true }
                signals.onReceive { false }
            }
        }
        if(immediate==false) {
            // Observer bursts share one refresh. A durable write receipt can interrupt the wait.
            withTimeoutOrNull(200) { writes.receive() }
            signals.tryReceive()
        }
    }
}
