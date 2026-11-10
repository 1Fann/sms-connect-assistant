package me.capcom.smsgateway.modules.voice

import org.junit.Assert.*
import org.junit.Test

class IncomingLineNamesTest {
    private val route = GroundwireRoute("line","device",2,47,"*84*")
    private val row: Map<String,Any> = mapOf("lineId" to "line","deviceId" to "device","slot" to 2,
        "subscriptionId" to 47,"present" to true,"confirmed" to true,"phoneName" to "示例手机","simName" to "工作卡")
    @Test fun exportsOnlyNamesFromTheExactBoundLine() {
        assertEquals(mapOf("*84*" to mapOf("phone" to "示例手机","sim" to "工作卡")), IncomingLineNames.names(listOf(row),listOf(route)))
    }
    @Test fun swappedOrUnconfirmedSimDoesNotInheritAnAlias() {
        for (change in listOf(mapOf("subscriptionId" to 48),mapOf("deviceId" to "other"),mapOf("confirmed" to false),mapOf("present" to false))) {
            assertTrue(IncomingLineNames.names(listOf(row+change),listOf(route)).isEmpty())
        }
    }
    @Test fun renameChangesExportWithoutIncludingOtherPrivateFields() {
        val result=IncomingLineNames.names(listOf(row+mapOf("phoneName" to "新手机","simName" to "新卡","token" to "private")),listOf(route))
        assertEquals(mapOf("phone" to "新手机","sim" to "新卡"),result["*84*"])
    }
}
