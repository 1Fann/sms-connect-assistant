package me.capcom.smsgateway.modules.voice

import org.junit.Assert.*
import org.junit.Test

class MediaCutoverTest {
    @Test fun switchesOnlyUserLegsAfterPersistingOwnership(){
        val events=mutableListOf<String>()
        MediaCutover.apply("gsm","gw","web",{id,on-> events.add("mute:$id:$on")},{id->events.add("drop:$id")},
            commit={events.add("persist")},recover={fail("unexpected failure")})
        assertEquals(listOf("mute:web:true","mute:gw:false","persist","drop:web"),events)
    }
    @Test fun preservesWebAndExternalLegWhenNativeOrJournalFails(){
        for(cause in listOf("unmute","journal")){
            val deleted=mutableListOf<String>();var recovered=false
            MediaCutover.apply("gsm","gw","web",{ch,_->if(ch=="gw" && cause=="unmute")error("fault")},
                deleted::add,{if(cause=="journal")error("fault")},{recovered=true})
            assertTrue(recovered);assertTrue(deleted.isEmpty())
        }
    }
    @Test fun rejectsAccidentalExternalLegAliasWithoutAnyPbxCommand(){
        var commands=0
        val failed=runCatching{MediaCutover.apply("gsm","native","gsm",{_,_->commands++},{commands++},{commands++},{commands++})}
        assertTrue(failed.isFailure);assertEquals(0,commands)
    }
}
