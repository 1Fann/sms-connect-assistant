package me.capcom.smsgateway.modules.iphone

/** Metadata only: badge counting does not need message bodies or contact lookups. */
data class SmsBadgeRow(val address:String, val date:Long, val incoming:Boolean, val read:Boolean)

class SmsBadgeCounter(
    private val region:String,
    states:List<ConversationState>,
    private val reads:Map<String,Long>,
    private val legacyReads:Map<String,Long>
) {
    private val states=states.associateBy { it.address }
    private val keys=mutableMapOf<String,String>()
    private val unread=mutableSetOf<String>()
    val count:Int get()=unread.size

    fun add(row:SmsBadgeRow) {
        val key=keys.getOrPut(row.address){ConversationIdentity.key(row.address,region)}
        val state=states[key]
        if(state!=null && state.removedBefore>0 && row.date<=state.removedBefore)return
        // Match the inbox's unread CONVERSATIONS, including manual unread marks.
        // Muting hides notifications, not the conversation's unread status.
        if(state?.unread==true || (row.incoming && !row.read &&
                row.date>maxOf(reads[row.address]?:0L,legacyReads[row.address]?:0L)))unread.add(key)
    }
}
