package me.capcom.smsgateway.modules.voice

import android.os.Build
import java.util.concurrent.TimeUnit

/** Optional local-admin diagnostic for the existing Asterisk Assistant installation. */
internal object PbxCapabilities {
    fun inspect():String{
        check(Build.VERSION.SDK_INT>=26){"当前 Android 版本不支持有界 Root 探测"}
        // Static command, no administrator input or secret-bearing configuration is read.
        val command="test -x /data/adb/asterisk-app/control.sh && /system/bin/sh /data/adb/asterisk-app/control.sh cli pjsip show transports"
        val process=ProcessBuilder("su","-c",command).redirectErrorStream(true).start()
        try{
            check(process.waitFor(5,TimeUnit.SECONDS)){"读取 PBX 传输超时"}
            check(process.exitValue()==0){"无法读取本机 PBX；请确认 Root 已授权并已安装 Asterisk 助手"}
            val safe=Regex("^\\s*Transport:\\s+\\S+\\s+(udp|tcp|tls|ws|wss)\\s+.*:(\\d+)\\s*$",RegexOption.IGNORE_CASE)
            val records=process.inputStream.bufferedReader().useLines{lines->
                lines.take(300).mapNotNull { row ->safe.matchEntire(row)?.let{
                    it.groupValues[1].uppercase()+" · "+it.groupValues[2]
                }}.distinct().toList()
            }
            return if(records.isEmpty())"未识别出已启用的传输，请在 Asterisk 助手核对" else records.joinToString("，")
        }finally{if(process.isAlive)process.destroyForcibly()}
    }
}
