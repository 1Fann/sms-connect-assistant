package me.capcom.smsgateway.modules.iphone

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.content.pm.PackageManager
import android.os.Build
import android.os.PowerManager
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import androidx.work.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.withContext
import me.capcom.smsgateway.MainActivity
import me.capcom.smsgateway.R
import me.capcom.smsgateway.modules.defaultsms.DefaultSms
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.io.File
import java.net.Inet6Address
import java.net.InetAddress
import java.net.Proxy
import java.security.cert.X509Certificate
import java.util.concurrent.TimeUnit

object BridgeMonitor {
    private val lock = Mutex()
    private var listener: SharedPreferences.OnSharedPreferenceChangeListener? = null
    fun prefs(c: Context) = c.getSharedPreferences("bridge-monitor", 0)
    fun enabled(c: Context) = prefs(c).getBoolean("enabled", true)
    fun minutes(c: Context) = prefs(c).getInt("minutes", 5).coerceIn(1,1440)
    fun initialize(c: Context) {
        if (Build.VERSION.SDK_INT < 23) return
        if (listener == null) {
            listener = SharedPreferences.OnSharedPreferenceChangeListener { _, key ->
                if (key in setOf("enabled", "minutes", "host")) { syncState(c); schedule(c) }
            }
            c.getSharedPreferences("iphone",0).registerOnSharedPreferenceChangeListener(listener)
            prefs(c).registerOnSharedPreferenceChangeListener(listener)
        }
        syncState(c); schedule(c)
        RootBridge.refreshIfAuthorized(c)
    }
    @Synchronized fun syncState(c: Context) {
        val phone = c.getSharedPreferences("iphone",0)
        val state = JSONObject().put("enabled", phone.getBoolean("enabled",false))
            .put("monitor", enabled(c)).put("minutes", minutes(c)).put("host",phone.getString("host","sms.example.com"))
        val file = android.util.AtomicFile(File(c.noBackupFilesDir,"bridge-monitor-state.json"))
        var out: java.io.FileOutputStream? = null
        try { out=file.startWrite(); out.write(state.toString().toByteArray()); file.finishWrite(out) }
        catch (e: Exception) { out?.let { file.failWrite(it) } }
    }
    fun schedule(c: Context) {
        val work = WorkManager.getInstance(c)
        if (!enabled(c)) { work.cancelUniqueWork("bridge-monitor-periodic"); return }
        // Android requires >=15 minutes for the process-death fallback. The live service uses the selected interval.
        val interval = maxOf(15, minutes(c))
        if (prefs(c).getInt("scheduled-minutes",0) != interval) {
            work.enqueueUniquePeriodicWork("bridge-monitor-periodic", ExistingPeriodicWorkPolicy.REPLACE,
                PeriodicWorkRequestBuilder<BridgeMonitorWorker>(interval.toLong(),TimeUnit.MINUTES).build())
            prefs(c).edit().putInt("scheduled-minutes",interval).apply()
        } else work.enqueueUniquePeriodicWork("bridge-monitor-periodic", ExistingPeriodicWorkPolicy.KEEP,
            PeriodicWorkRequestBuilder<BridgeMonitorWorker>(interval.toLong(),TimeUnit.MINUTES).build())
    }
    fun summary(c: Context): String {
        val p=prefs(c); val time=p.getLong("checked-at",0)
        return (if(enabled(c)) "每 ${minutes(c)} 分钟完整检查" else "自动检测已关闭") +
            (if(time>0) "\n上次检查：${java.text.DateFormat.getDateTimeInstance().format(java.util.Date(time))}" else "\n尚未检查")+
            "\n"+p.getString("result","首次配置后可立即检查")
    }
    suspend fun check(c: Context, force: Boolean=false): String = withContext(Dispatchers.IO) {
        if(!lock.tryLock()) return@withContext "正在检查，请稍后刷新"
        try {
            val p=prefs(c); val now=System.currentTimeMillis()
            if(!force && (!enabled(c) || !MonitorPolicy.due(now,p.getLong("checked-at",0),minutes(c)))) return@withContext summary(c)
            val phone=c.getSharedPreferences("iphone",0)
            if(c.getSharedPreferences("peer-client",0).getBoolean("enabled",false)) {
                val issue=when {
                    !IphoneService.peerRunning -> {
                        if(runCatching { IphoneService.start(c) }.isSuccess) "共享同步服务未运行，已请求恢复；请确认自启动和后台权限"
                        else "共享同步服务未运行，系统未允许自动启动；请打开应用检查后台权限"
                    }
                    android.os.SystemClock.elapsedRealtime()-PeerClient.lastProgress>120_000 -> "共享同步心跳超时，请检查系统短信权限与网络"
                    else -> PeerClient.status
                }
                p.edit().putLong("checked-at",now).putString("result",issue).apply()
                if(!IphoneService.peerRunning || android.os.SystemClock.elapsedRealtime()-PeerClient.lastProgress>120_000)notify(c,issue)
                return@withContext summary(c)
            }
            if(!phone.getBoolean("enabled",false)) {
                p.edit().putLong("checked-at",now).putString("result","公网服务已手动关闭或尚未配置，不自动拉起").putInt("failures",0).apply()
                return@withContext summary(c)
            }
            val issues=mutableListOf<String>()
            if(!DefaultSms.isDefault(c)) issues.add("默认短信应用已改变，请手动确认")
            val permissions=listOf(Manifest.permission.READ_SMS,Manifest.permission.SEND_SMS,Manifest.permission.RECEIVE_SMS,Manifest.permission.READ_PHONE_STATE)
            if(permissions.any { ContextCompat.checkSelfPermission(c,it)!=PackageManager.PERMISSION_GRANTED }) issues.add("短信或 SIM 权限缺失，请重新授权")
            if(!(c.getSystemService(Context.POWER_SERVICE) as PowerManager).isIgnoringBatteryOptimizations(c.packageName)) issues.add("未允许持续运行，请检查省电设置")
            val cert = runCatching { TlsIdentity(c).load().let { (store,alias,_) -> store.getCertificate(alias) as X509Certificate } }.getOrNull()
            if(cert==null) issues.add("证书缺失、过期或无法读取，请检查证书配置")
            else if(cert.notAfter.time-now<30L*86400_000) issues.add("证书将在 30 天内到期，请查看自动续期结果")
            val host=phone.getString("host","sms.example.com")!!
            val localHealthy = cert!=null && probe(host)
            val failures=if(localHealthy) 0 else p.getInt("failures",0)+1
            p.edit().putInt("failures",failures).apply()
            var repaired=false
            val attempts=p.getString("repairs","").orEmpty().split(',').mapNotNull { it.toLongOrNull() }.filter { it>now || now-it<3_600_000 }
            if(enabled(c) && MonitorPolicy.mayRepair(phone.getBoolean("enabled",false),cert!=null,localHealthy,failures,now,attempts)) {
                p.edit().putString("repairs",(attempts+now).joinToString(",")).apply()
                repaired=runCatching { IphoneService.recover(c); true }.getOrDefault(false)
            }
            if(!localHealthy) issues.add(if(repaired) "已请求恢复 HTTPS，下一次检查确认结果" else "本机 HTTPS 不可用；连续失败后有限重试，或打开应用恢复")
            val addresses=runCatching { IphoneService.addresses().filter { it["kind"]=="global-unicast" }.mapNotNull { it["address"]?.substringBefore('%') } }.getOrDefault(emptyList())
            if(addresses.isEmpty()) issues.add("手机当前没有公网 IPv6")
            else {
                val dns=runCatching { InetAddress.getAllByName(host).filterIsInstance<Inet6Address>().mapNotNull { it.hostAddress } }.getOrNull()
                if(dns==null) issues.add("域名解析暂不可用；保留服务，等待网络恢复")
                else if(dns.none { it in addresses }) issues.add("域名 IPv6 与手机不一致，请检查现有 DDNS")
            }
            val result=if(issues.isEmpty()) "本机 HTTPS、证书、权限与 IPv6 解析正常；不代表外网或运营商必达" else issues.joinToString("\n")
            val changed=result!=p.getString("result",null)
            p.edit().putLong("checked-at",now).putString("result",result).apply()
            if(changed && issues.isNotEmpty()) notify(c,issues.first())
            else if(issues.isEmpty()) (c.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).cancel(4705)
            summary(c)
        } finally { lock.unlock() }
    }
    private fun probe(host: String): Boolean = runCatching {
        require(host.matches(Regex("[a-zA-Z0-9.-]+")))
        val client=OkHttpClient.Builder().proxy(Proxy.NO_PROXY).dns(object: okhttp3.Dns {
            override fun lookup(hostname: String): List<InetAddress> = listOf(InetAddress.getByName("127.0.0.1"))
        })
            .callTimeout(6,TimeUnit.SECONDS).connectTimeout(2,TimeUnit.SECONDS).readTimeout(3,TimeUnit.SECONDS).build()
        try { client.newCall(Request.Builder().url("https://$host:8443/healthz").build()).execute().use {
            it.isSuccessful && JSONObject(it.body!!.string()).optString("service")=="sms-bridge"
        } } finally { client.connectionPool.evictAll(); client.dispatcher.executorService.shutdown() }
    }.getOrDefault(false)
    private fun notify(c: Context, text: String) {
        val manager=c.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if(Build.VERSION.SDK_INT>=26) manager.createNotificationChannel(NotificationChannel("bridge-health","服务异常提醒",NotificationManager.IMPORTANCE_DEFAULT))
        val open=PendingIntent.getActivity(c,4705,Intent(c,MainActivity::class.java).putExtra("openSetup",true),PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        runCatching { manager.notify(4705,NotificationCompat.Builder(c,"bridge-health").setSmallIcon(R.drawable.ic_sms)
            .setContentTitle("短信互联助手需要检查").setContentText(text).setContentIntent(open).setAutoCancel(true).build()) }
    }
}

class BridgeMonitorWorker(c: Context,p: WorkerParameters): CoroutineWorker(c,p) {
    override suspend fun doWork(): Result {
        return try { BridgeMonitor.check(applicationContext); Result.success() } catch (_: Exception) { Result.retry() }
    }
}
