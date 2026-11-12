package me.capcom.smsgateway.modules.voice

import org.junit.Assert.*
import org.junit.Test

class GroundwireConfigurationTest {
    @Test fun stableRoutesRequireAnExactDeviceSimAndCurrentSubscription(){
        val route=GroundwireConfiguration.parse("line-a server 1 9 *81*").single()
        val row:Map<String,Any> = mapOf("lineId" to "line-a","deviceId" to "server","slot" to 1,"subscriptionId" to 9,
            "lineOnline" to true,"present" to true,"confirmed" to true,"enabled" to true)
        assertTrue(GroundwireConfiguration.matches(route,row))
        for((key,value) in listOf("lineId" to "replacement","deviceId" to "other","slot" to 2,"subscriptionId" to 10,
            "lineOnline" to false,"present" to false,"confirmed" to false,"enabled" to false))
            assertFalse(GroundwireConfiguration.matches(route,row+(key to value)))
        assertFalse(GroundwireConfiguration.matches(route,row-"subscriptionId"))
    }
    @Test fun rejectsDuplicateAndInjectedRoutes(){
        for(value in listOf("line server 1 9 sip:other","line server 3 9 *81*","line server 1 -1 *81*",
            "line server 1 9 *81*\nline peer 2 8 *82*","line server 1 9 *81*\nother peer 2 8 *81*"))
            assertTrue(runCatching{GroundwireConfiguration.parse(value)}.isFailure)
        assertEquals(2,GroundwireConfiguration.parse("a server 1 9 *81*\nb server 2 10 *82*").size)
    }

    @Test fun replacementMatchesOnlyTheOptedInDeviceAndSlot() {
        val route=GroundwireRoute("original","peer",2,47,"*84*")
        val replacement=mapOf("lineId" to "new","deviceId" to "peer","slot" to 2,
            "subscriptionId" to 48,"present" to true,"confirmed" to true,"enabled" to true,"lineOnline" to true)
        assertFalse(GroundwireConfiguration.matches(route,replacement))
        val optedIn=replacement+("followSlot" to true)
        assertTrue(GroundwireConfiguration.matches(route,optedIn))
        for(change in listOf("deviceId" to "other","slot" to 1,"enabled" to false,
            "confirmed" to false,"present" to false,"lineOnline" to false)) {
            assertFalse(GroundwireConfiguration.matches(route,optedIn+change))
        }
    }
}
