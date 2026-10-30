package me.capcom.smsgateway.modules.iphone

import android.content.Context
import java.io.File
import java.security.MessageDigest
import java.util.concurrent.TimeUnit

object RootBridge {
    private const val base="/data/adb/sms-bridge"
    private const val hook="/data/adb/service.d/98-sms-bridge.sh"
    private fun quote(s:String)="'"+s.replace("'","'\\''")+"'"
    private fun run(command:String):String {
        val p=ProcessBuilder("su","-c",command).redirectErrorStream(true).start()
        val output=StringBuilder()
        val reader=Thread { p.inputStream.bufferedReader().useLines { lines -> lines.forEach { if(output.length<16384) output.append(it).append('\n') } } }.apply { isDaemon=true; start() }
        if(!p.waitFor(25,TimeUnit.SECONDS)) { p.destroyForcibly(); error("Root 请求超时，请检查授权") }
        reader.join(1000)
        check(p.exitValue()==0) { "Root 操作未完成，请检查超级用户授权与守护状态" }
        return output.toString().trim()
    }
    private val stopOwned = """
        if [ -f $base/pid ]; then
            pid=${'$'}(cat $base/pid)
            case "${'$'}pid" in ''|*[!0-9]*) ;; *)
                if [ -r /proc/${'$'}pid/cmdline ] && tr '\000' ' ' < /proc/${'$'}pid/cmdline | grep -q 'me.capcom.smsgateway.modules.iphone.RootMonitorMain'; then
                    kill "${'$'}pid" 2>/dev/null || true
                fi ;;
            esac
        fi
    """.trimIndent()
    fun status():String = run("if [ -f $base/enabled ]; then echo 'Root 守护已启用'; else echo 'Root 守护未启用'; fi; pid=${'$'}(cat $base/pid 2>/dev/null); case \"${'$'}pid\" in ''|*[!0-9]*) echo '独立进程未运行';; *) if kill -0 \"${'$'}pid\" 2>/dev/null && tr '\\000' ' ' < /proc/${'$'}pid/cmdline | grep -q 'me.capcom.smsgateway.modules.iphone.RootMonitorMain'; then echo '独立进程正在运行'; else echo '独立进程未运行，请重新启用'; fi;; esac; cat $base/status 2>/dev/null; true")
    fun enable(c:Context):String {
        require(android.os.Build.VERSION.SDK_INT>=26) { "Root 守护需要 Android 8 或以上" }
        BridgeMonitor.syncState(c)
        val source=File(c.filesDir,"bridge-root.sh").apply { writeBytes(c.assets.open("bridge-root.sh").use { it.readBytes() }) }
        val digest=MessageDigest.getInstance("SHA-256")
        File(c.applicationInfo.sourceDir).inputStream().use { input -> val b=ByteArray(65536); while(true) { val n=input.read(b); if(n<0)break;digest.update(b,0,n) } }
        val hash=digest.digest().joinToString("") { "%02x".format(it) }
        val script="""
            set -e
            umask 077
            [ ! -L $base ] && [ ! -L /data/adb/service.d ] && [ ! -L $hook ]
            if [ -e $base ]; then [ -f $base/owner ] && [ "${'$'}(cat $base/owner)" = sms-bridge-owned-v1 ]; fi
            if [ -e $hook ]; then grep -q '^# sms-bridge-owned-v1${'$'}' $hook; fi
            mkdir -p $base /data/adb/service.d
            echo sms-bridge-owned-v1 > $base/owner
            $stopOwned
            cp ${quote(source.absolutePath)} $base/run.new
            chmod 700 $base/run.new
            mv $base/run.new $base/run.sh
            echo $hash > $base/apk.sha256
            touch $base/enabled
            printf '#!/system/bin/sh\n# sms-bridge-owned-v1\n/system/bin/sh $base/run.sh >/dev/null 2>&1 &\n' > $hook
            chmod 700 $hook
            nohup /system/bin/sh $base/run.sh >/dev/null 2>&1 < /dev/null &
        """.trimIndent()
        run(script)
        return "Root 守护已启用；约 10 秒后刷新查看结果"
    }
    fun disable():String {
        run("set -e; [ ! -L $base ]; [ ! -L $hook ]; if [ -e $base ]; then [ \"${'$'}(cat $base/owner)\" = sms-bridge-owned-v1 ]; rm -f $base/enabled; $stopOwned; fi; if [ -f $hook ]; then grep -q '^# sms-bridge-owned-v1${'$'}' $hook; rm -f $hook; fi")
        return "Root 守护已关闭（当前检查结束后退出）；短信服务保持原状态"
    }
    fun checkNow():String { run("[ -f $base/enabled ] && touch $base/check-now"); return "已请求 Root 立即检查" }
}
