package me.capcom.smsgateway.modules.iphone

import org.junit.Assert.*
import org.junit.Test

class PushPolicyTest {
    @Test fun muteOnlyTheChosenConversation() {
        val states=listOf(ConversationState("+12025550123",muted=true,region="US"))
        assertFalse(PushPolicy.allowed("(202) 555-0123",states))
        assertTrue(PushPolicy.allowed("+12025550124",states))
        assertTrue(PushPolicy.allowed("10086",states))
    }
    @Test fun countryAwareIdentityMatchesIncomingAliases() {
        for((region,local,international) in listOf(Triple("CN","13800138000","+8613800138000"),Triple("GB","020 7946 0018","+442079460018"),Triple("FR","01 42 68 53 00","+33142685300"),Triple("DE","030 123456","+4930123456"))) {
            assertEquals(international,ConversationIdentity.key(local,region))
            assertFalse(PushPolicy.allowed(local,listOf(ConversationState(international,muted=true,region=region))))
        }
        assertEquals("+8613800138000",ConversationIdentity.key("8613800138000","CN"))
    }
    @Test fun noSuffixOrAlphanumericMatching() {
        val states=listOf(ConversationState("10086",muted=true),ConversationState("BANK",muted=true))
        assertFalse(PushPolicy.allowed("10086",states));assertFalse(PushPolicy.allowed("BANK",states))
        assertTrue(PushPolicy.allowed("10610086",states));assertTrue(PushPolicy.allowed("BANK2",states))
    }
    @Test fun queuedNotificationUsesTheLatestMuteState() {
        val state=ConversationState("+12025550123",region="US")
        assertTrue(PushPolicy.allowed("2025550123",listOf(state)))
        val muted=ConversationRules.change(state,"mute",100,0)
        assertFalse(PushPolicy.allowed("2025550123",listOf(muted)))
        assertTrue(PushPolicy.allowed("2025550123",listOf(ConversationRules.change(muted,"unmute",200,0))))
    }
    @Test fun manualTestAndLegacyJobsAreDistinct() {
        assertFalse(PushPolicy.allowed(null,emptyList()))
        assertFalse(PushPolicy.allowed("",emptyList()))
        assertTrue(PushPolicy.allowed(null,emptyList(),test=true))
    }
    @Test fun muteDoesNotReadRemoveOrUnpinAndSurvivesRecovery() {
        val original=ConversationState("10086",pinned=30,unread=true)
        val muted=ConversationRules.change(original,"mute",100,1)
        assertEquals(original.copy(muted=true),muted)
        val recovered=ConversationRules.change(ConversationRules.change(muted,"remove",200,1),"restore",300,0)
        assertTrue(recovered.muted)
        assertFalse(ConversationRules.change(recovered,"unmute",400,0).muted)
    }
}
