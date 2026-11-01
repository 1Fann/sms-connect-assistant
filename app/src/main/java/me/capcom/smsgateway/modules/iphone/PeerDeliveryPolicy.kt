package me.capcom.smsgateway.modules.iphone

/** Sent is still tracked because a delivery receipt can arrive much later. */
object PeerDeliveryPolicy {
    fun phase(state:String)=when(state) { "delivered","failed"->"done";"sent"->"sent";else->"handed" }
    fun acceptState(phase:String,state:String)=state in setOf("accepted","unknown","sent","delivered","failed") && !(phase=="offered" && state=="unknown")
}
