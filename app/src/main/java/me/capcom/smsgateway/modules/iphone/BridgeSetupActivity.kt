package me.capcom.smsgateway.modules.iphone

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings
import android.text.InputType
import android.widget.*
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import me.capcom.smsgateway.modules.defaultsms.DefaultSms

class BridgeSetupActivity: AppCompatActivity() {
    private lateinit var state:TextView
    private lateinit var rootState:TextView
    private lateinit var interval:EditText
    private var busy=false
    private val required get()=mutableListOf(Manifest.permission.READ_SMS,Manifest.permission.SEND_SMS,Manifest.permission.RECEIVE_SMS,Manifest.permission.READ_PHONE_STATE).apply {
        if(Build.VERSION.SDK_INT>=26)add(Manifest.permission.READ_PHONE_NUMBERS)
        if(Build.VERSION.SDK_INT>=33)add(Manifest.permission.POST_NOTIFICATIONS)
    }
    override fun onCreate(savedInstanceState:Bundle?) {
        super.onCreate(savedInstanceState)
        title="短信互联助手 · 配置与自动恢复"
        val layout=LinearLayout(this).apply { orientation=LinearLayout.VERTICAL; setPadding(24,24,24,32) }
        setContentView(ScrollView(this).apply { addView(layout) })
        fun label(text:String)=TextView(this).apply { this.text=text; textSize=16f;setPadding(0,16,0,16);layout.addView(this) }
        fun button(text:String,action:()->Unit) { layout.addView(Button(this).apply { this.text=text; isAllCaps=false; minHeight=56;setOnClickListener { runCatching(action).onFailure { toast(it.message?:"操作失败") } } }) }
        label("首次安装按顺序完成以下设置。收发修复已内置，不需要电脑或关闭 MIUI 优化；系统授权、你的证书和 iPhone 配对仍需首次配置。")
        button("多设备通讯 · 配对与共享"){startActivity(Intent(this,PeerSetupActivity::class.java))}
        state=label("")
        button("1 · 设为默认短信应用") { if(DefaultSms.isDefault(this))toast("已是默认短信应用") else DefaultSms.request(this) }
        button("2 · 授予短信、SIM 与通知权限") { requestPermissions(required.toTypedArray(),72) }
        button("3 · 允许持续后台运行") {
            startActivity(Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,Uri.parse("package:$packageName")))
        }
        button("4 · 检查 MIUI 自启动与省电设置") { startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,Uri.parse("package:$packageName"))) }
        label("在系统设置中允许自启动、电池设为无限制，可在最近任务中锁定应用。此页面不会假定 MIUI 开关已正确设置；系统升级后可能需要重新确认。")
        button("5 · 域名、证书与 iPhone 配对") { startActivity(Intent(this,BridgeSettingsActivity::class.java)) }
        button("开启公网短信服务") {
            TlsIdentity(this).load()
            getSharedPreferences("iphone",0).edit().putBoolean("enabled",true).commit()
            BridgeMonitor.syncState(this); IphoneService.start(this);refresh()
        }
        button("手动关闭公网服务") {
            getSharedPreferences("iphone",0).edit().putBoolean("enabled",false).commit()
            BridgeMonitor.syncState(this);stopService(Intent(this,IphoneService::class.java));refresh()
        }
        label("间隔检测与异常恢复")
        layout.addView(Switch(this).apply {
            text="启用自动检测";isChecked=BridgeMonitor.enabled(this@BridgeSetupActivity)
            setOnCheckedChangeListener { _,value -> BridgeMonitor.prefs(this@BridgeSetupActivity).edit().putBoolean("enabled",value).commit();BridgeMonitor.syncState(this@BridgeSetupActivity);refresh() }
        })
        interval=EditText(this).apply { inputType=InputType.TYPE_CLASS_NUMBER;hint="检查间隔（1–1440 分钟）";setText(BridgeMonitor.minutes(this@BridgeSetupActivity).toString());layout.addView(this) }
        button("保存检测间隔") { val minutes=MonitorPolicy.minutes(interval.text.toString());BridgeMonitor.prefs(this).edit().putInt("minutes",minutes).commit();BridgeMonitor.syncState(this);refresh();toast("已保存：每 $minutes 分钟") }
        button("立即检查") { task { BridgeMonitor.check(this@BridgeSetupActivity,true) } }
        label("免 Root：服务运行时按所设间隔检查，后台补检最短 15 分钟，可能受系统延迟；不能绕过强行停止。\n可选 Root：独立进程每 10 秒检查应用进程，按所设间隔检查 HTTPS。支持异常拉起，每小时最多恢复 3 次；手动关闭服务或自动检测时不会拉起。检测不发送短信，也不擅自更改默认短信应用或短信权限。")
        rootState=label("Root 守护为可选功能；首次使用会请求超级用户授权。普通收发不需要 Root。")
        button("启用 / 更新 Root 守护") {
            require(BridgeMonitor.enabled(this)) { "请先开启自动检测" }
            task(root=true) { RootBridge.enable(this@BridgeSetupActivity) }
        }
        button("关闭 Root 守护") { task(root=true) { RootBridge.disable() } }
        button("Root 立即检查") { task(root=true) { RootBridge.checkNow() } }
        button("刷新 Root 状态") { task(root=true) { RootBridge.status() } }
        label("更新 APK 后请点“启用 / 更新 Root 守护”确认新版本。守护只执行已确认的安装包。重启后需先解锁手机；Root 被撤销或系统限制仍可能导致守护失效。公网可达性需从外部网络测试。")
    }
    private fun task(root:Boolean=false, action:suspend ()->String) {
        if(busy) { toast("正在处理，请稍候");return }
        busy=true
        if(root) rootState.text="正在处理 Root 请求…" else state.text="正在检查…"
        lifecycleScope.launch {
            val text=withContext(Dispatchers.IO) { runCatching { action() }.getOrElse { it.message?:"操作未完成" } }
            busy=false;refresh(); if(root)rootState.text=text else toast(text)
        }
    }
    private fun toast(text:String) { Toast.makeText(this,text,Toast.LENGTH_LONG).show() }
    override fun onResume() { super.onResume();refresh() }
    private fun refresh() {
        if(!::state.isInitialized)return
        val granted=required.all { ContextCompat.checkSelfPermission(this,it)==PackageManager.PERMISSION_GRANTED }
        val battery=Build.VERSION.SDK_INT>=23 && (getSystemService(POWER_SERVICE) as PowerManager).isIgnoringBatteryOptimizations(packageName)
        val certificate=runCatching { TlsIdentity(this).load() }.isSuccess
        state.text="默认短信应用：${if(DefaultSms.isDefault(this))"已设置" else "待设置"}\n短信 / SIM / 通知权限：${if(granted)"已授权" else "待授权"}\n电池优化豁免：${if(battery)"已允许" else "待设置"}\n有效证书：${if(certificate)"已配置" else "待配置"}\n${IphoneService.status}\n\n${BridgeMonitor.summary(this)}"
    }
}

class BridgeSettingsActivity: AppCompatActivity() {
    override fun onCreate(savedInstanceState:Bundle?) {
        super.onCreate(savedInstanceState);title="短信互联助手 · 证书与配对"
        val frame=FrameLayout(this).apply { id=android.R.id.content }
        setContentView(frame)
        if(savedInstanceState==null)supportFragmentManager.beginTransaction().replace(android.R.id.content,IphoneSettingsFragment()).commit()
    }
}
