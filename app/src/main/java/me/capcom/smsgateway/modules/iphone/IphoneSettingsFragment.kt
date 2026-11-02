package me.capcom.smsgateway.modules.iphone

import android.Manifest
import android.content.Intent
import android.os.Bundle
import android.widget.EditText
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.preference.Preference
import androidx.preference.PreferenceFragmentCompat
import androidx.preference.EditTextPreference

class IphoneSettingsFragment : me.capcom.smsgateway.ui.settings.BasePreferenceFragment() {
    override fun onCreatePreferences(savedInstanceState: Bundle?, rootKey: String?) { render() }
    private fun render() {
        val ctx=requireContext()
        preferenceManager.sharedPreferencesName="iphone"
        preferenceScreen=preferenceManager.createPreferenceScreen(ctx)
        fun action(title: String, summary: String="", block: ()->Unit) {
            preferenceScreen.addPreference(Preference(ctx).apply { this.title=title; this.summary=summary; setOnPreferenceClickListener { block(); true } })
        }
        preferenceScreen.addPreference(EditTextPreference(ctx).apply { key="host"; title="HTTPS 域名"; setDefaultValue("sms.example.com"); summaryProvider=EditTextPreference.SimpleSummaryProvider.getInstance() })
        preferenceScreen.addPreference(EditTextPreference(ctx).apply { key="region"; title="无国家码号码的默认地区"; setDefaultValue("CN"); summaryProvider=EditTextPreference.SimpleSummaryProvider.getInstance(); setOnPreferenceChangeListener { _, v -> com.google.i18n.phonenumbers.PhoneNumberUtil.getInstance().supportedRegions.contains(v.toString()) } })
        preferenceScreen.addPreference(EditTextPreference(ctx).apply { key="zone-id"; title="Cloudflare Zone ID"; summary="你的域名概览页中的区域 ID（不是 Account ID）";setOnPreferenceChangeListener { _,v->v.toString().matches(Regex("[a-f0-9]{32}")) } })
        action("保存 Cloudflare API Token", "仅授权你的域名的 Zone DNS Edit 与 Zone Read。令牌使用 Android Keystore 加密，不写入普通设置。") {
            val input=EditText(ctx).apply { inputType=129 }
            AlertDialog.Builder(ctx).setTitle("Cloudflare API Token").setView(input).setPositiveButton("加密保存") { _,_->
                runCatching { SecretVault(ctx).put("cloudflare",input.text.toString().trim().toByteArray()) }.onSuccess { Toast.makeText(ctx,"已加密保存",Toast.LENGTH_SHORT).show() }
            }.setNegativeButton("取消",null).show()
        }
        action("查看 Let's Encrypt 服务条款") { startActivity(Intent(Intent.ACTION_VIEW,android.net.Uri.parse("https://letsencrypt.org/repository/"))) }
        fun issue(staging: Boolean) {
            AlertDialog.Builder(ctx).setTitle(if(staging) "测试证书签发" else "正式签发并启用自动续期")
                .setMessage("继续表示同意 Let's Encrypt 的现行服务条款。App 将创建 _acme-challenge TXT 记录供 CA 验证，随后删除该条记录；不修改 AAAA 或现有 DDNS。域名会进入公开证书透明度日志。")
                .setPositiveButton("同意并继续") { _,_->CertificateWorker.issue(ctx,staging);Toast.makeText(ctx,"任务已排队，可刷新查看进度",Toast.LENGTH_LONG).show() }.setNegativeButton("取消",null).show()
        }
        action("测试 DNS-01 签发", "测试 CA 证书不受 Safari 信任，不会替换正式证书") { issue(true) }
        action("正式签发 / 立即续期", ctx.getSharedPreferences("iphone",0).getString("certificate-status","尚未签发" )!!) { issue(false) }
        action("默认短信应用 / 本机收件箱", "短信互联助手可接管文字短信收发；无需 Root。彩信通知会保留，附件暂不支持下载。") {
            startActivity(Intent(ctx, me.capcom.smsgateway.modules.defaultsms.SmsInboxActivity::class.java))
        }
        action("授予短信与联系人权限", "联系人权限可选；可在上方申请成为默认短信应用") { requestPermissions(arrayOf(Manifest.permission.READ_SMS, Manifest.permission.SEND_SMS, Manifest.permission.RECEIVE_SMS, Manifest.permission.READ_PHONE_STATE, Manifest.permission.READ_CONTACTS), 44) }
        action("导入 HTTPS 证书", "PKCS#12 (.p12)，包含私钥及完整中间证书链。证书必须由 iPhone 信任的 CA 签发。") {
            startActivityForResult(Intent(Intent.ACTION_OPEN_DOCUMENT).apply { type="*/*"; addCategory(Intent.CATEGORY_OPENABLE) }, 45)
        }
        action("开启服务", IphoneService.status) {
            try { TlsIdentity(ctx).load(); ctx.getSharedPreferences("iphone",0).edit().putBoolean("enabled",true).apply(); IphoneService.start(ctx); Toast.makeText(ctx,"正在启动，请稍后刷新状态",Toast.LENGTH_LONG).show() }
            catch (_: Exception) { Toast.makeText(ctx,"请先导入有效证书（Android 6 及以上）",Toast.LENGTH_LONG).show() }
        }
        action("关闭公网服务") { ctx.getSharedPreferences("iphone",0).edit().putBoolean("enabled",false).apply(); ctx.stopService(Intent(ctx, IphoneService::class.java)); render() }
        action("生成三分钟配对码") { AlertDialog.Builder(ctx).setTitle("配对码").setMessage(IphoneService.newCode()).setPositiveButton("确定",null).show() }
        action("确认待配对的 iPhone", IphoneService.pending().ifEmpty { "暂无请求；在 iPhone 输入配对码后刷新" }) {
            val ticket=IphoneService.ticket()
            val phone=IphoneService.requestedApp()=="phone"
            if(IphoneService.pending().isNotEmpty())chooseAccess(phone,null) { allowed->IphoneService.approve(ticket,allowed);render() }
        }
        action("管理已授权安装", "调整单个安装可访问的设备、功能或撤销权限") {
            val installs=PrivateStore(ctx).use { it.installations() }
            AlertDialog.Builder(ctx).setTitle("选择安装实例").setItems(installs.map { (if(it.app=="phone") "互联电话" else "互联信息")+" · "+it.name+" · "+it.installation.takeLast(4) }.toTypedArray()) { _,i->
                val item=installs[i]
                AlertDialog.Builder(ctx).setTitle(item.name).setItems(arrayOf("更改权限","撤销授权")) { _,choice->
                    if(choice==0)chooseAccess(item.app=="phone",item.grants.split(',').toSet()) { allowed->
                        PrivateStore(ctx).use{it.updateGrants(item.installation,allowed)};render()
                    } else AlertDialog.Builder(ctx).setMessage("撤销此安装的访问与通知？")
                        .setPositiveButton("撤销"){_,_->PrivateStore(ctx).use { it.revokeInstallation(item.installation) };render()}
                        .setNegativeButton("取消",null).show()
                }.show()
            }.show()
        }
        action("通讯录与通话记录权限") { startActivity(Intent(ctx,me.capcom.smsgateway.modules.directory.DirectoryAccessActivity::class.java)) }
        action("SIP 服务 · Groundwire") { startActivity(Intent(ctx,me.capcom.smsgateway.modules.voice.VoiceSetupActivity::class.java)) }
        action("互联电话安装地址", "在 Safari 打开同一 HTTPS 域名的 8444 端口 /phone/，从分享菜单添加到主屏幕。"+PhoneServer.status) {}
        action("已配对设备 / 全部撤销", PrivateStore(ctx).use { it.devices().joinToString("\n").ifEmpty { "无；会话 12 小时后失效" } }) {
            AlertDialog.Builder(ctx).setMessage("撤销全部互联信息和互联电话安装的访问权限？").setPositiveButton("撤销") { _,_->PrivateStore(ctx).use { it.revoke() }; render() }.setNegativeButton("取消",null).show()
        }
        action("复制访问网址", "https://${ctx.getSharedPreferences("iphone",0).getString("host","sms.example.com")}:8443") {
            (ctx.getSystemService(android.content.Context.CLIPBOARD_SERVICE) as android.content.ClipboardManager).setPrimaryClip(android.content.ClipData.newPlainText("短信", "https://${ctx.getSharedPreferences("iphone",0).getString("host","sms.example.com")}:8443"))
        }
        action("刷新诊断", IphoneService.status+"\n"+IphoneService.addresses().joinToString("\n") { "${it["kind"]}: ${it["address"]}" }) { render() }
        action("MIUI 14 设置指引", "开启自启动，电池策略设为无限制，在最近任务中锁定应用。路由器仅放行 IPv6 TCP 8443；不要放行原网关管理端口。公网连通性必须从其他 IPv6 网络实测。现有 DDNS 保持不变。") {}
        action("当前版本限制", "Cloudflare DNS-01、续期与 Web Push 需真机验证。推送不含短信正文。不要将此构建当成已完成全部验收的正式版。") {}
    }
    private fun chooseAccess(phone:Boolean,previous:Set<String>?,save:(Set<String>)->Unit) {
        val nodes=PeerHub.get(requireContext()).devices()
        val features=if(phone) listOf("contacts.read","contacts.write","calls.read","calls.dial") else listOf("sms.read","sms.send","contacts.read")
        val keys=features+nodes.map { "device:"+it["deviceId"].toString() }
        val names=if(phone) listOf("读取通讯录","远程编辑安卓通讯录","读取通话记录","允许付费拨号及接续") else listOf("读取短信","发送短信","搜索授权设备通讯录")
        val choices=(names+nodes.map { "允许设备 · "+it["name"].toString() }).toTypedArray()
        val selected=BooleanArray(keys.size) { i->previous?.contains(keys[i]) ?: (keys[i].endsWith(".read")||keys[i]=="device:server") }
        AlertDialog.Builder(requireContext()).setTitle(if(phone)"互联电话授权" else "互联信息授权")
            .setMultiChoiceItems(choices,selected){_,i,value->selected[i]=value}
            .setPositiveButton("保存"){_,_->
                val allowed=keys.filterIndexed { i,_->selected[i] }.toMutableSet()
                if("contacts.write" in allowed)allowed.add("contacts.read")
                if("calls.dial" in allowed)allowed.add("calls.read")
                if(!phone)allowed.add("sms.read")
                save(allowed)
            }.setNegativeButton("取消",null).show()
    }

    @Deprecated("Android activity result compatibility")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode,resultCode,data)
        val uri=data?.data ?: return
        if(requestCode!=45 || resultCode!=android.app.Activity.RESULT_OK) return
        val input=EditText(requireContext()).apply { inputType=129; hint="证书私钥密码" }
        AlertDialog.Builder(requireContext()).setTitle("导入证书").setView(input).setPositiveButton("导入") { _,_->
            try {
                val bytes=requireContext().contentResolver.openInputStream(uri)!!.use { it.readBytes() }
                require(bytes.size<=1024*1024)
                TlsIdentity(requireContext()).import(bytes,input.text.toString())
                Toast.makeText(requireContext(),"证书已加密保存，请重新开启服务",Toast.LENGTH_LONG).show()
            } catch (_: Exception) { Toast.makeText(requireContext(),"证书导入失败，请检查文件和密码",Toast.LENGTH_LONG).show() }
        }.setNegativeButton("取消",null).show()
    }
}
