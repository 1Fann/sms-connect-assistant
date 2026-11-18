package me.capcom.smsgateway.modules.iphone

import org.junit.Assert.assertEquals
import org.junit.Test

class SmsBadgeCounterTest {
    private fun row(address:String="10086",date:Long=100,read:Boolean=false,incoming:Boolean=true)=SmsBadgeRow(address,date,incoming,read)
    @Test fun countsConversationsAcrossDevicesWithoutPaginationOrDuplicateInflation() {
        val counter=SmsBadgeCounter("CN",emptyList(),emptyMap(),emptyMap())
        repeat(300){counter.add(row("service$it"))}
        repeat(20){counter.add(row("10086"))}
        counter.add(row("13800138000"));counter.add(row("+8613800138000"))
        counter.add(row("outgoing",incoming=false))
        assertEquals(302,counter.count)
    }
    @Test fun readWatermarksRemovalAndManualUnreadMatchInbox() {
        val counter=SmsBadgeCounter("CN",listOf(
            ConversationState("removed",removedBefore=100),
            ConversationState("manual",unread=true),
            ConversationState("missing",unread=true),
            ConversationState("muted",muted=true)
        ),mapOf("seen" to 100L),mapOf("legacy" to 100L))
        for(address in listOf("removed","seen","legacy"))counter.add(row(address))
        counter.add(row("provider-read",read=true))
        assertEquals(0,counter.count)
        counter.add(row("manual",read=true,incoming=false));counter.add(row("muted"))
        assertEquals(2,counter.count)
        counter.add(row("removed",date=101));counter.add(row("seen",date=101))
        assertEquals(4,counter.count)
    }
    @Test fun countrySettingAndScopedMarksAreIndependent() {
        val first=SmsBadgeCounter("US",emptyList(),mapOf("+12025550123" to 100L),emptyMap())
        val second=SmsBadgeCounter("US",emptyList(),emptyMap(),emptyMap())
        val message=row("+12025550123")
        first.add(message);second.add(message);second.add(row("(202) 555-0123"))
        assertEquals(0,first.count);assertEquals(1,second.count)
    }
}
