package me.capcom.smsgateway.modules.iphone

import org.junit.Assert.*
import org.junit.Test

class ConversationRulesTest {
    @Test fun pinLimitAndRepeatedPin() {
        val empty=ConversationState("+12025550123")
        assertTrue(runCatching { ConversationRules.change(empty,"pin",100,9) }.isFailure)
        val pinned=ConversationRules.change(empty,"pin",100,8)
        assertEquals(100L,ConversationRules.change(pinned,"pin",200,9).pinned)
        assertEquals(0L,ConversationRules.change(pinned,"unpin",200,9).pinned)
    }
    @Test fun removalAndRestorePreserveReadSemantics() {
        val removed=ConversationRules.change(ConversationState("10086",50,0,true),"remove",100,1)
        assertEquals(100L,removed.removedBefore)
        assertEquals(0L,removed.pinned)
        assertFalse(removed.unread)
        // Clock rollback or a duplicate older request must not expose deleted history.
        assertEquals(100L,ConversationRules.change(removed,"remove",90,0).removedBefore)
        val unread=ConversationRules.change(removed,"unread",110,0)
        assertEquals(100L,unread.removedBefore)
        assertTrue(unread.unread)
        assertEquals(0L,ConversationRules.change(unread,"restore",120,0).removedBefore)
        assertFalse(ConversationRules.change(unread,"read",120,0).unread)
    }
    @Test fun rejectUnknownAction() {
        assertTrue(runCatching { ConversationRules.change(ConversationState("10086"),"delete-provider",100,0) }.isFailure)
    }
}
