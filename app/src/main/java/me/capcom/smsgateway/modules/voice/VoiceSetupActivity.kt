package me.capcom.smsgateway.modules.voice

import android.app.Activity
import android.app.AlertDialog
import android.app.KeyguardManager
import android.content.Context
import android.os.Bundle
import android.text.InputType
import android.view.WindowManager
import android.widget.*
import androidx.appcompat.app.AppCompatActivity

/** Local administrator only; no credential management endpoint is exported over HTTPS. */
class VoiceSetupActivity:AppCompatActivity(){
    private lateinit var box:LinearLayout
    private lateinit var config:GroundwireConfiguration
    private var unlocked=false
    private var revealAction:(()->Unit)?=null
    private var sensitiveDialog:AlertDialog?=null
    override fun onCreate(savedInstanceState:Bundle?){
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        title="SIP 服务 · Groundwire"
        config=GroundwireConfiguration(this)
        box=LinearLayout(this).apply{orientation=LinearLayout.VERTICAL;setPadding(32,16,32,32)}
        setContentView(ScrollView(this).apply{addView(box)})
        screen()
    }
    private fun label(s:String){box.addView(TextView(this).apply{text=s;setPadding(0,18,0,0)})}
    private fun button(s:String,fn:()->Unit){box.addView(Button(this).apply{text=s;setOnClickListener{runCatching{fn()}.onFailure{toast(it.message?:"操作未完成")}}})}
    private fun field(title:String,value:String="",password:Boolean=false,multi:Boolean=false):EditText{
        label(title);return EditText(this).also{e->
            e.isSingleLine=!multi;e.isSaveEnabled=false
            if(password)e.inputType=InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
            e.setText(value);box.addView(e)
        }
    }
    private fun toast(s:String){Toast.makeText(this,s,Toast.LENGTH_LONG).show()}
    private fun verify(action:()->Unit){
        val km=getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager
        val challenge=km.createConfirmDeviceCredentialIntent("主节点管理员验证","验证锁屏凭据后继续")
        if(challenge==null){toast("请先在安卓系统设置锁屏凭据");return}
        revealAction=action
        @Suppress("DEPRECATION") startActivityForResult(challenge,21)
    }
    @Deprecated("Legacy activity compatibility")
    override fun onActivityResult(requestCode:Int,resultCode:Int,data:android.content.Intent?){
        super.onActivityResult(requestCode,resultCode,data)
        val action=revealAction;revealAction=null
        if(requestCode==21 && resultCode==Activity.RESULT_OK)action?.invoke()
    }
    override fun onStop(){
        super.onStop()
        sensitiveDialog?.dismiss();sensitiveDialog=null
        if(revealAction==null && unlocked){unlocked=false;screen()}
    }
    private fun screen(){
        box.removeAllViews()
        label("网页只提供拨号入口。音频、麦克风、后台与锁屏通话由 Groundwire 处理，不需要 ARI 或 WebRTC。")
        val probe=VoiceGatewayProbe.detect(this)
        label(if(probe["installed"]==true)"本机 Voice SIP Agent："+probe["version"] else "尚未检测到 Voice SIP Agent")
        if(probe["installed"]==true)button("打开本机语音网关"){
            packageManager.getLaunchIntentForPackage(probe["packageName"].toString())?.let{startActivity(it)}
        }
        button("读取本机 PBX 实际传输（Root）"){
            Thread{val result=runCatching{PbxCapabilities.inspect()};runOnUiThread{
                if(!isFinishing)AlertDialog.Builder(this).setTitle("Asterisk 已监听的传输")
                    .setMessage(result.getOrElse{it.message?:"探测失败"}).setPositiveButton("关闭",null).show()
            }}.start()
        }
        if(!unlocked){button("管理 Groundwire 账号和线路"){verify{unlocked=true;screen()}};return}
        val server=field("Groundwire SIP 服务器（可包含端口）",config.server)
        val account=field("Groundwire 账号",config.account)
        val password=field("Groundwire 密码（留空保留）",password=true)
        val routes=field("每行：稳定线路 ID、设备 ID、卡槽、订阅 ID、拨号前缀",config.routesText,multi=true)
        label("前缀须与 Asterisk 中的设备和 SIM 路由一致；换卡或新增设备后须重新核对，不会自动套用旧线路。")
        button("查看 Groundwire 配置信息"){verify{
            sensitiveDialog=AlertDialog.Builder(this).setTitle("Groundwire · 仅此设备查看")
                .setMessage("服务器 "+server.text+"\n账号 "+account.text+"\n密码 "+password.text.toString().ifEmpty{config.password()})
                .setPositiveButton("关闭",null).create().also{it.window?.addFlags(WindowManager.LayoutParams.FLAG_SECURE);it.show()}
        }}
        button("保存 Groundwire 设置"){
            config.save(server.text.toString().trim(),account.text.toString().trim(),routes.text.toString(),password.text.toString())
            unlocked=false;screen()
        }
    }
}
