package me.capcom.smsgateway.modules.iphone

/** Assistant-only metadata. SMS provider records and send idempotency are untouched. */
data class ConversationState(val address: String, val pinned: Long = 0, val removedBefore: Long = 0, val unread: Boolean = false, val muted: Boolean = false, val region: String = "CN")

object ConversationRules {
    fun change(current: ConversationState, action: String, now: Long, pinCount: Int): ConversationState = when(action) {
        "pin" -> { require(current.pinned > 0 || pinCount < 9) { "最多置顶九个对话" }; current.copy(pinned = current.pinned.takeIf { it > 0 } ?: now) }
        "unpin" -> current.copy(pinned = 0)
        "remove" -> current.copy(pinned = 0, removedBefore = maxOf(current.removedBefore, now), unread = false)
        "restore" -> current.copy(removedBefore = 0)
        "unread" -> current.copy(unread = true)
        "read" -> current.copy(unread = false)
        "mute" -> current.copy(muted = true)
        "unmute" -> current.copy(muted = false)
        else -> throw IllegalArgumentException("不支持的会话操作")
    }
}

/** Match the web client's country-aware identity, without suffix matching that
 * could accidentally silence a different sender or a service short code. */
object ConversationIdentity {
    fun key(raw: String, region: String): String {
        var value=raw.replace(Regex("[\\s().-]"), "")
        if(region=="CN" && value.matches(Regex("86(1[3-9]\\d{9})"))) value="+$value"
        if(!value.matches(Regex("\\+?[0-9]+")))return value
        return runCatching {
            val util=com.google.i18n.phonenumbers.PhoneNumberUtil.getInstance()
            val parsed=util.parse(value,region)
            if(util.isValidNumber(parsed))util.format(parsed,com.google.i18n.phonenumbers.PhoneNumberUtil.PhoneNumberFormat.E164) else value
        }.getOrDefault(value)
    }
}

object PushPolicy {
    fun allowed(address: String?, states: List<ConversationState>, test: Boolean = false): Boolean {
        if(test)return true
        // Old jobs with no sender cannot safely be assigned to an unmuted thread.
        if(address.isNullOrBlank())return false
        return states.none { it.muted && ConversationIdentity.key(address,it.region)==ConversationIdentity.key(it.address,it.region) }
    }
}
