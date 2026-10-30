package me.capcom.smsgateway.modules.defaultsms

/** Part callbacks can be duplicated and arrive out of order. Failure is sticky. */
data class SmsPartState(val sent: Set<Int>, val delivered: Set<Int>, val sendFailed: Boolean, val deliveryFailed: Boolean) {
    fun providerState(parts: Int, report: Boolean): Pair<Int, Int> = when {
        sendFailed -> 5 to 64
        sent.size < parts && delivered.size < parts -> 4 to if (report) 32 else -1
        deliveryFailed -> 2 to 64
        delivered.size >= parts -> 2 to 0
        else -> 2 to if (report) 32 else -1
    }
}
