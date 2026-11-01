package me.capcom.smsgateway.modules.voice

import android.content.Context
import android.content.pm.PackageManager

object VoiceGatewayProbe {
    fun detect(context:Context):Map<String,Any> {
        for(name in listOf("com.fann.voicesip.dualsim","io.github.sparkcyf.voicesipagent")){
            try{
                val info=context.packageManager.getPackageInfo(name,0)
                return mapOf("installed" to true,"packageName" to name,"version" to info.versionName.orEmpty())
            }catch(_:PackageManager.NameNotFoundException){ /* Not installed or not visible. */ }
        }
        return mapOf("installed" to false,"packageName" to "","version" to "")
    }
}
