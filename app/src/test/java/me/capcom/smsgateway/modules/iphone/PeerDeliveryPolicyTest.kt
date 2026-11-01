package me.capcom.smsgateway.modules.iphone
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
class PeerDeliveryPolicyTest {
    @Test fun sentRemainsTrackedUntilDeliveryOrFailure() {
        assertEquals("sent",PeerDeliveryPolicy.phase("sent"))
        assertEquals("done",PeerDeliveryPolicy.phase("delivered"))
        assertEquals("done",PeerDeliveryPolicy.phase("failed"))
        assertEquals("handed",PeerDeliveryPolicy.phase("unknown"))
    }
    @Test fun lostOfferReplyRemainsReplayableUntilDurableEvidence() {
        assertFalse(PeerDeliveryPolicy.acceptState("offered","unknown"))
        assertTrue(PeerDeliveryPolicy.acceptState("offered","accepted"))
        assertTrue(PeerDeliveryPolicy.acceptState("handed","unknown"))
        assertTrue(PeerDeliveryPolicy.acceptState("offered","failed"))
    }
}
