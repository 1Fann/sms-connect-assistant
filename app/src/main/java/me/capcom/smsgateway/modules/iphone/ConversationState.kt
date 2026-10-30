package me.capcom.smsgateway.modules.iphone

/** Assistant-only metadata. SMS provider records and send idempotency are untouched. */
data class ConversationState(val address: String, val pinned: Long = 0, val removedBefore: Long = 0, val unread: Boolean = false)

object ConversationRules {
    fun change(current: ConversationState, action: String, now: Long, pinCount: Int): ConversationState = when(action) {
        "pin" -> { require(current.pinned > 0 || pinCount < 9) { "最多置顶九个对话" }; current.copy(pinned = current.pinned.takeIf { it > 0 } ?: now) }
        "unpin" -> current.copy(pinned = 0)
        "remove" -> current.copy(pinned = 0, removedBefore = maxOf(current.removedBefore, now), unread = false)
        "restore" -> current.copy(removedBefore = 0)
        "unread" -> current.copy(unread = true)
        "read" -> current.copy(unread = false)
        else -> throw IllegalArgumentException("不支持的会话操作")
    }
}
