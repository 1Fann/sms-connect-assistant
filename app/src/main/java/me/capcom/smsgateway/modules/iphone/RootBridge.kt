package me.capcom.smsgateway.modules.iphone

import android.content.Context
import java.io.File
import java.security.MessageDigest
import java.util.concurrent.TimeUnit

object RootBridge {
    private const val base="/data/adb/sms-bridge"
    private const val hook="/data/adb/service.d/98-sms-bridge.sh"
    private val refreshing = java.util.concurrent.atomic.AtomicBoolean(false)
    private fun quote(s:String)="'"+s.replace("'","'\\''")+"'"
    private fun run(command:String):String {
        val su=listOf("/system/bin/su","/system/xbin/su","/sbin/su","/debug_ramdisk/su").firstOrNull { File(it).canExecute() } ?: "su"
        val p=ProcessBuilder(su,"-c","[ \"${'$'}(id -u)\" = 0 ] || exit 1;\n"+command).redirectErrorStream(true).start()
        val output=StringBuilder()
        val reader=Thread { p.inputStream.bufferedReader().useLines { lines -> lines.forEach { if(output.length<16384) output.append(it).append('\n') } } }.apply { isDaemon=true; start() }
        if(!p.waitFor(25,TimeUnit.SECONDS)) { p.destroyForcibly(); error("Root 请求超时，请检查授权") }
        reader.join(1000)
        check(p.exitValue()==0) { "Root 操作未完成，请在超级用户管理器中允许通讯互联的 Root 权限，并检查 BusyBox" }
        return output.toString().trim()
    }
    private val stopOwned = """
        if [ -f $base/supervisor.pid ]; then
            supervisor=${'$'}(cat $base/supervisor.pid)
            case "${'$'}supervisor" in ''|*[!0-9]*) ;; *)
                if [ -r /proc/${'$'}supervisor/cmdline ] && tr '\000' ' ' < /proc/${'$'}supervisor/cmdline | grep -Fq '$base/run.sh'; then
                    kill "${'$'}supervisor" 2>/dev/null || true
                fi ;;
            esac
        fi
        if [ -f $base/pid ]; then
            pid=${'$'}(cat $base/pid)
            case "${'$'}pid" in ''|*[!0-9]*) ;; *)
                if [ -r /proc/${'$'}pid/cmdline ] && tr '\000' ' ' < /proc/${'$'}pid/cmdline | grep -q 'me.capcom.smsgateway.modules.iphone.RootMonitorMain'; then
                    kill "${'$'}pid" 2>/dev/null || true
                fi ;;
            esac
        fi
        # Allow the supervisor to release its flock before starting its replacement.
        sleep 1
    """.trimIndent()
    fun status():String = run("""
        echo 'Root 已授权（UID 0）'
        if [ -f $base/enabled ]; then echo 'Root 守护已启用'; else echo 'Root 守护未启用'; fi
        show_process() {
            pid=${'$'}(cat "${'$'}1" 2>/dev/null)
            case "${'$'}pid" in ''|*[!0-9]*) echo "${'$'}3未运行";; *)
                if kill -0 "${'$'}pid" 2>/dev/null && tr '\000' ' ' < /proc/${'$'}pid/cmdline | grep -Fq "${'$'}2"; then
                    echo "${'$'}3正在运行"
                else echo "${'$'}3未运行"; fi;;
            esac
        }
        show_process $base/supervisor.pid '$base/run.sh' '独立监护进程'
        show_process $base/pid 'me.capcom.smsgateway.modules.iphone.RootMonitorMain' '功能检查进程'
        cat $base/status 2>/dev/null
        true
    """.trimIndent())
    fun enable(c:Context):String = install(c, false)
    /** Only refresh a guard previously authorized here; never enable a stopped guard. */
    fun refreshIfAuthorized(c: Context, discoverExisting: Boolean = false) {
        if ((!discoverExisting && !BridgeMonitor.prefs(c).getBoolean("root-authorized", false)) || !refreshing.compareAndSet(false,true)) return
        Thread {
            try { install(c.applicationContext, true) }
            catch (_: Exception) { BridgeMonitor.prefs(c).edit().putString("root-refresh-result", "Root 守护刷新失败，请检查超级用户授权").apply() }
            finally { refreshing.set(false) }
        }.apply { name="bridge-root-refresh"; isDaemon=true; start() }
    }
    @Synchronized private fun install(c:Context, refreshOnly:Boolean):String {
        require(android.os.Build.VERSION.SDK_INT>=26) { "Root 守护需要 Android 8 或以上" }
        BridgeMonitor.syncState(c)
        val source=File(c.filesDir,"bridge-root.sh").apply { writeBytes(c.assets.open("bridge-root.sh").use { it.readBytes() }) }
        val digest=MessageDigest.getInstance("SHA-256")
        File(c.applicationInfo.sourceDir).inputStream().use { input -> val b=ByteArray(65536); while(true) { val n=input.read(b); if(n<0)break;digest.update(b,0,n) } }
        val hash=digest.digest().joinToString("") { "%02x".format(it) }
        val script="""
            set -e
            umask 077
            busybox=${'$'}(command -v busybox 2>/dev/null || true)
            if [ ! -x "${'$'}busybox" ]; then
            for candidate in /data/adb/magisk/busybox /data/adb/ksu/bin/busybox /data/adb/ap/bin/busybox; do
                if [ -x "${'$'}candidate" ]; then busybox=${'$'}candidate; break; fi
            done
            fi
            [ -x "${'$'}busybox" ] || { echo '未找到 Root BusyBox'; exit 1; }
            [ ! -L $base ] && [ ! -L /data/adb/service.d ] && [ ! -L $hook ]
            if [ -e $base ]; then [ -f $base/owner ] && [ "${'$'}(cat $base/owner)" = sms-bridge-owned-v1 ]; fi
            if [ -e $hook ]; then grep -q '^# sms-bridge-owned-v1${'$'}' $hook; fi
            ${if(refreshOnly) "[ -f $base/enabled ] || { echo inactive; exit 0; }" else ""}
            mkdir -p $base /data/adb/service.d
            echo sms-bridge-owned-v1 > $base/owner
            if [ -f $base/enabled ] && [ "${'$'}(cat $base/apk.sha256 2>/dev/null)" = '$hash' ] && cmp -s ${quote(source.absolutePath)} $base/run.sh && [ -f $hook ]; then
                nohup /system/bin/sh $base/run.sh >/dev/null 2>&1 < /dev/null &
                echo active
                exit 0
            fi
            $stopOwned
            cp ${quote(source.absolutePath)} $base/run.new
            chmod 700 $base/run.new
            mv $base/run.new $base/run.sh
            echo $hash > $base/apk.sha256
            touch $base/enabled
            printf '#!/system/bin/sh\n# sms-bridge-owned-v1\n/system/bin/sh $base/run.sh >/dev/null 2>&1 &\n' > $hook
            chmod 700 $hook
            nohup /system/bin/sh $base/run.sh >/dev/null 2>&1 < /dev/null &
            echo active
        """.trimIndent()
        val active=run(script).lineSequence().any { it=="active" }
        BridgeMonitor.prefs(c).edit().putBoolean("root-authorized",active)
            .putString("root-refresh-result",if(active) "Root 守护已与当前安装包同步" else "Root 守护已停用，未重新开启").apply()
        return "Root 守护已启用；约 10 秒后刷新查看结果"
    }
    @Synchronized fun disable():String {
        run("set -e; [ ! -L $base ]; [ ! -L $hook ]; if [ -e $base ]; then [ \"${'$'}(cat $base/owner)\" = sms-bridge-owned-v1 ]; rm -f $base/enabled; $stopOwned; fi; if [ -f $hook ]; then grep -q '^# sms-bridge-owned-v1${'$'}' $hook; rm -f $hook; fi")
        return "Root 守护已关闭（当前检查结束后退出）；短信服务保持原状态"
    }
    fun checkNow():String { run("[ -f $base/enabled ] && touch $base/check-now"); return "已请求 Root 立即检查" }
}
