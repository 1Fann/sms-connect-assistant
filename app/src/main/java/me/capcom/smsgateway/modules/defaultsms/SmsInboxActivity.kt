package me.capcom.smsgateway.modules.defaultsms

import android.content.ContentValues
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.provider.Telephony
import android.text.InputType
import android.view.ViewGroup
import android.widget.*
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import me.capcom.smsgateway.helpers.SubscriptionsHelper
import me.capcom.smsgateway.modules.iphone.PrivateStore
import me.capcom.smsgateway.modules.iphone.SmsHistory
import me.capcom.smsgateway.modules.iphone.SmsRow

class SmsInboxActivity : AppCompatActivity() {
    private lateinit var status: TextView
    private lateinit var list: ListView
    private var rows = listOf<SmsRow>()
    private var loading = false
    private var before = Long.MAX_VALUE
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        title = "短信互联助手 · 本机短信"
        val root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(24, 16, 24, 0) }
        status = TextView(this)
        root.addView(status)
        fun button(label: String, block: () -> Unit) { root.addView(Button(this).apply { text = label; setOnClickListener { block() } }) }
        button("设为默认短信应用") { runCatching { DefaultSms.request(this) }.onFailure { toast(it.message ?: "无法打开系统选择器") } }
        button("写短信") { compose(null) }
        button("刷新") { refresh(true) }
        button("发送诊断") { AlertDialog.Builder(this).setTitle("发送诊断")
            .setMessage(DefaultSms.diagnostic(this)).setPositiveButton("关闭", null).show() }
        button("彩信说明") {
            val count = DefaultSmsStore(this).use { it.mmsCount() }
            AlertDialog.Builder(this).setTitle("彩信附件暂不支持")
                .setMessage("已保留 $count 条彩信通知。当前版本只收发文字短信，不下载彩信附件。需要彩信时，请切回原短信应用，并联系发送方重新发送；切换不会自动补收已有附件。")
                .setPositiveButton("知道了", null).show()
        }
        list = ListView(this)
        root.addView(list, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
        button("加载更早短信") { refresh(false) }
        setContentView(root)
        list.setOnItemClickListener { _, _, index, _ ->
            val row = rows[index]
            AlertDialog.Builder(this).setTitle(row.name ?: row.display).setMessage(row.body)
                .setPositiveButton("回复") { _, _ -> compose(Uri.parse("smsto:${Uri.encode(row.address)}")) }
                .setNegativeButton("关闭", null).show()
            if (DefaultSms.isDefault(this)) lifecycleScope.launch(Dispatchers.IO) {
                runCatching { contentResolver.update(Uri.withAppendedPath(Telephony.Sms.CONTENT_URI, row.id.removePrefix("sms:")),
                    ContentValues().apply { put("read", 1); put("seen", 1) }, null, null) }
            }
        }
        if (savedInstanceState == null && intent.action == Intent.ACTION_SENDTO) compose(intent.data)
    }
    override fun onResume() {
        super.onResume()
        if (DefaultSms.isDefault(this)) InboxRecoveryWorker.enqueue(this)
        refresh(true)
    }
    override fun onNewIntent(intent: Intent) { super.onNewIntent(intent); setIntent(intent); if (intent.action == Intent.ACTION_SENDTO) compose(intent.data) }
    private fun refresh(reset: Boolean) {
        status.text = if (DefaultSms.isDefault(this)) "已是默认短信应用 · 文字短信收发已启用" else "尚未设为默认短信应用"
        if (loading) return
        loading = true
        if (reset) { before = Long.MAX_VALUE; rows = emptyList() }
        lifecycleScope.launch {
            val result = withContext(Dispatchers.IO) { runCatching { PrivateStore(this@SmsInboxActivity).use { SmsHistory(this@SmsInboxActivity, it).page(before, 100) } } }
            result.onSuccess { page ->
                rows = rows + page
                page.lastOrNull()?.let { before = it.id.removePrefix("sms:").toLong() }
                list.adapter = ArrayAdapter(this@SmsInboxActivity, android.R.layout.simple_list_item_1, rows.map {
                    val state = when (it.state) { "received" -> "收到"; "delivered" -> "已送达"; "sent" -> "已发送"; "failed" -> "发送失败"; else -> "发送中" }
                    "${it.name ?: it.display} · SIM ${it.sim ?: "?"} · $state\n${java.text.DateFormat.getDateTimeInstance().format(java.util.Date(it.date))}\n${it.body.take(100)}"
                })
            }.onFailure { toast("无法读取短信，请检查短信权限") }
            loading = false
        }
    }
    private fun compose(uri: Uri?) {
        val form = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(32, 16, 32, 0) }
        val address = EditText(this).apply { hint = "收件号码"; inputType = InputType.TYPE_CLASS_PHONE
            setText(uri?.schemeSpecificPart?.substringBefore('?')?.trim()?.removePrefix("//") ?: "") }
        val body = EditText(this).apply { hint = "短信正文"; minLines = 3; inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_MULTI_LINE
            setText(intent.getStringExtra("sms_body") ?: uri?.encodedSchemeSpecificPart?.substringAfter('?', "")?.let {
                Uri.parse("https://local/?$it").getQueryParameter("body")
            } ?: "") }
        val sims = SubscriptionsHelper.getActiveSimCards(this)
        val selector = Spinner(this).apply { adapter = ArrayAdapter(this@SmsInboxActivity, android.R.layout.simple_spinner_dropdown_item,
            listOf("请选择发送 SIM") + sims.map { "SIM ${it.simNumber} · ${it.carrierName ?: ""}" }) }
        form.addView(address); form.addView(body); form.addView(selector)
        val dialog = AlertDialog.Builder(this).setTitle("写短信").setView(form).setPositiveButton("发送", null).setNegativeButton("取消", null).create()
        dialog.setOnShowListener {
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
                val sim = sims.getOrNull(selector.selectedItemPosition - 1)
                if (sim == null) { toast("请选择发送 SIM"); return@setOnClickListener }
                val to = address.text.toString(); val text = body.text.toString()
                if (!LocalSmsSend.valid(to, text)) { toast("请输入一个有效号码及 1–2000 字的短信"); return@setOnClickListener }
                dialog.getButton(AlertDialog.BUTTON_POSITIVE).isEnabled = false
                lifecycleScope.launch {
                    val result = withContext(Dispatchers.IO) { runCatching { LocalSmsSend.enqueue(this@SmsInboxActivity, to, text, sim.simNumber) } }
                    result.onSuccess { toast("已加入发送队列"); dialog.dismiss(); refresh(true) }
                        .onFailure { toast("无法加入发送队列，请检查权限"); dialog.getButton(AlertDialog.BUTTON_POSITIVE).isEnabled = true }
                }
            }
        }
        dialog.show()
    }
    private fun toast(text: String) = Toast.makeText(this, text, Toast.LENGTH_LONG).show()
}
