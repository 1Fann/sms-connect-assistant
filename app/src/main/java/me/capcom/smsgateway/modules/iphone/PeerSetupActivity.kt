package me.capcom.smsgateway.modules.iphone

import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.os.Bundle
import android.widget.*
import java.util.concurrent.Executors

class PeerSetupActivity: Activity() {
    private val worker=Executors.newSingleThreadExecutor()
    override fun onDestroy(){worker.shutdown();super.onDestroy()}
    override fun onCreate(state: Bundle?){
        super.onCreate(state)
        title="多手机短信"
        val client=PeerClient(this)
        val hub=PeerHub.get(this)
        val box=LinearLayout(this).apply { orientation=LinearLayout.VERTICAL;setPadding(32,32,32,32) }
        setContentView(ScrollView(this).apply{addView(box)})
        val status=TextView(this).also{box.addView(it)}
        fun button(label:String, click:()->Unit){box.addView(Button(this).apply{text=label;setOnClickListener{click()}})}
        if(getSharedPreferences("iphone",0).getBoolean("enabled",false)){
            status.text=if(hub.paired)"服务器手机 · 已配对共享手机" else "本机作为服务器手机。在另一部兼容的安卓手机上输入本机地址和接入码，即可共享短信和发送线路，不限手机品牌。"
            button("生成接入码"){runCatching { hub.invite() }.onSuccess{status.text="接入码 "+it}.onFailure{status.text=it.message}}
            button("解除接入并删除共享手机缓存"){AlertDialog.Builder(this).setMessage("解除共享手机的授权，并删除本机缓存的共享短信？两部手机的原始短信均会保留。").setPositiveButton("解除"){_,_->hub.forget();recreate()}.setNegativeButton("取消",null).show()}
        }else{
            status.text=if(client.prefs.getBoolean("enabled",false))PeerClient.status else "本机作为共享手机，连接另一部已开启服务的安卓手机，不限手机品牌。连接后，已配对的 iPhone 可以查看两部手机的短信，并通过所选手机的 SIM 卡发送短信。"
            if(client.prefs.getBoolean("enabled",false)){
                button("停止共享"){client.prefs.edit().putBoolean("enabled",false).commit();stopService(Intent(this,IphoneService::class.java));recreate()}
                return
            }
            val host=EditText(this).apply{hint="服务器手机的域名";setSingleLine();box.addView(this)}
            val code=EditText(this).apply{hint="服务器手机上的接入码";setSingleLine();box.addView(this)}
            button("连接并共享短信"){
                val missing=listOf(android.Manifest.permission.READ_SMS,android.Manifest.permission.SEND_SMS,android.Manifest.permission.READ_PHONE_STATE)
                    .filter { androidx.core.content.ContextCompat.checkSelfPermission(this,it)!=android.content.pm.PackageManager.PERMISSION_GRANTED }
                if(missing.isNotEmpty()){
                    status.text="请允许读取短信、发送短信和读取 SIM 状态，授权后再点连接。"
                    if(android.os.Build.VERSION.SDK_INT>=23)requestPermissions(missing.toTypedArray(),60)
                    return@button
                }
                val h=host.text.toString().trim();val c=code.text.toString().trim()
                worker.execute{runCatching{client.join(h,c)}.onSuccess{runOnUiThread{IphoneService.start(this);recreate()}}.onFailure{e->runOnUiThread{status.text="接入失败 · "+(e.message?:"请检查网络")}}}
            }
        }
    }
}
