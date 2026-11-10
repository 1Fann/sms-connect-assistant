package me.capcom.smsgateway.modules.voice

import android.content.Context
import android.util.AtomicFile
import org.json.JSONObject
import java.io.File

/** Names only: the optional local PBX bridge never needs SMS, contacts or credentials. */
object IncomingLineNames {
    fun names(lines: List<Map<String,Any>>, routes: List<GroundwireRoute>): Map<String,Map<String,String>> =
        routes.mapNotNull { route ->
            val row = lines.singleOrNull { it["lineId"] == route.lineId && it["deviceId"] == route.deviceId &&
                (it["slot"] as? Number)?.toInt() == route.slot &&
                (it["subscriptionId"] as? Number)?.toInt() == route.subscriptionId &&
                it["present"] == true && it["confirmed"] == true } ?: return@mapNotNull null
            route.prefix to mapOf("phone" to row["phoneName"].toString(), "sim" to row["simName"].toString())
        }.toMap()

    @Synchronized fun publish(context: Context, lines: List<Map<String,Any>>) {
        // A display export failure must never break routing or the naming UI.
        runCatching {
            val routes = GroundwireConfiguration.parse(context.getSharedPreferences("commlink-groundwire",0).getString("routes","").orEmpty())
            val text = JSONObject(names(lines,routes)).toString()
            val file = File(context.noBackupFilesDir,"incoming-line-names.json")
            if (file.exists() && file.readText() == text) return
            val atomic = AtomicFile(file)
            val stream = atomic.startWrite()
            try { stream.write(text.toByteArray(Charsets.UTF_8)); atomic.finishWrite(stream) }
            catch (e: Exception) { atomic.failWrite(stream); throw e }
        }
    }
}
