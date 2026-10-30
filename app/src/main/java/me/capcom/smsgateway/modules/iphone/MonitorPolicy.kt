package me.capcom.smsgateway.modules.iphone

object MonitorPolicy {
    fun minutes(value: String): Int {
        require(value.matches(Regex("[0-9]{1,4}"))) { "请输入 1–1440 分钟" }
        return value.toInt().also { require(it in 1..1440) { "请输入 1–1440 分钟" } }
    }
    fun due(now: Long, last: Long, minutes: Int) = last == 0L || now < last || now - last >= minutes * 60_000L
    fun mayRepair(wanted: Boolean, certificateValid: Boolean, healthy: Boolean, failures: Int, now: Long, attempts: List<Long>): Boolean {
        val recent = attempts.filter { it > now || now - it < 3_600_000L }
        return wanted && certificateValid && !healthy && failures >= 2 && recent.size < 3 &&
            recent.none { it > now || now - it < 60_000L }
    }
}
