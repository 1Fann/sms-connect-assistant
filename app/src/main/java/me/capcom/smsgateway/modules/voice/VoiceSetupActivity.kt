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
import java.security.SecureRandom

/** Local administrator only; no credential management endpoint is exported over HTTPS. */
class VoiceSetupActivity:AppCompatActivity(){
    private lateinit var box:LinearLayout
    private lateinit var config:VoiceConfiguration
    private var unlocked=false
    private var revealAction:(()->Unit)?=null
    private var proposedConfig:String?=null
    private var sensitiveDialog:AlertDialog?=null
    private val runtime get()=VoiceRuntime.get(this)
    override fun onCreate(savedInstanceState:Bundle?){
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        title="SIP 服务 · Groundwire"
        config=VoiceConfiguration(this)
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
        if(requestCode==22){
            val template=proposedConfig;proposedConfig=null
            if(resultCode==Activity.RESULT_OK && template!=null)data?.data?.let { uri->
                val ok=runCatching{checkNotNull(contentResolver.openOutputStream(uri)).bufferedWriter().use{it.write(template)}}
                toast(if(ok.isSuccess)"已导出脱敏模板" else "导出失败")
            }
            return
        }
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
        val s=runtime.adminStatus()
        label(if(s["ready"]==true)"ARI 已连接，存在已注册的语音网关" else s["reason"].toString())
        label("Groundwire 注册："+if((s["groundwire"] as? Map<*,*>)?.get("registered")==true)"在线" else "尚未确认")
        if(runtime.lastProblem.isNotEmpty())label("最近故障："+runtime.lastProblem)
        val probe=VoiceGatewayProbe.detect(this)
        label(if(probe["installed"]==true)"本机 Voice SIP Agent："+probe["version"] else "尚未检测到 Voice SIP Agent；需要蜂窝语音时请先在本机配置并完成权限和双向音频检查。")
        if(probe["installed"]==true)button("打开本机语音网关"){
            val intent=packageManager.getLaunchIntentForPackage(probe["packageName"].toString())
            if(intent!=null)startActivity(intent) else toast("请从桌面打开 Voice SIP Agent")
        }
        button("刷新注册状态"){screen()}
        button("读取本机 PBX 实际传输（Root）"){
            Thread{
                val result=runCatching{PbxCapabilities.inspect()}
                runOnUiThread{if(!isFinishing)AlertDialog.Builder(this).setTitle("Asterisk 已监听的传输")
                    .setMessage(result.getOrElse{it.message?:"探测失败"}).setPositiveButton("关闭",null).show()}
            }.start()
        }
        button("测试 Groundwire 来电"){
            AlertDialog.Builder(this).setMessage("仅向已配置的 Groundwire 账户发起一次测试来电，接听后结束。")
                .setNegativeButton("取消",null).setPositiveButton("发起"){_,_->verify{
                    Thread {val result=runCatching{runtime.testNative()};runOnUiThread{toast(if(result.isSuccess)"已请求测试来电" else result.exceptionOrNull()?.message?:"测试失败")}}.start()
                }}.show()
        }
        if(!unlocked){button("管理 SIP 账号和线路"){verify{unlocked=true;screen()}};return}
        val enabled=CheckBox(this).apply{text="启用 CommLink 语音";isChecked=config.enabled;box.addView(this)}
        val port=field("本机 ARI HTTP 端口（仅回环）",config.ariPort.toString())
        val user=field("ARI 控制账户（仅主节点）",config.ariUser)
        val ariSecret=field("ARI 密码（留空保留）",password=true)
        val wss=field("WebRTC WSS 地址",config.wss)
        val domain=field("SIP 域名 / Groundwire 服务器",config.domain)
        val web=field("仅可拨内部通话票据的网页端点",config.webUser)
        val webSecret=field("网页端点密码（留空保留）",password=true)
        val native=field("Groundwire 专用账户",config.nativeUser)
        val nativeSecret=field("Groundwire 密码（留空保留）",password=true)
        button("生成新的 Groundwire 密码草案"){
            val bytes=ByteArray(30).also{SecureRandom().nextBytes(it)}
            nativeSecret.setText(android.util.Base64.encodeToString(bytes,android.util.Base64.URL_SAFE or android.util.Base64.NO_PADDING or android.util.Base64.NO_WRAP))
            toast("请在 PBX 和 Groundwire 完成同一凭据配置后保存")
        }
        button("查看 Groundwire 配置信息"){verify{
            val pwd=nativeSecret.text.toString().ifEmpty{config.secret("voice-native")}
            sensitiveDialog=AlertDialog.Builder(this).setTitle("Groundwire · 仅此设备查看").setMessage("服务器 "+domain.text+"\n账户 "+native.text+"\n密码 "+pwd+"\n传输与端口须按 PBX 实际监听设置。").setPositiveButton("关闭",null).create().also{
                it.window?.addFlags(WindowManager.LayoutParams.FLAG_SECURE);it.show()
            }
        }}
        val routes=field("已实测支持 X-VSA-SIM 的设备。每行：设备 ID、PJSIP 网关端点；仅唯一入站线路时可附线路 ID",config.bindingsText,multi=true)
        button("导出 PBX 配置草案（不含密码）"){
            proposedConfig=VoiceProvisioning.render(web.text.toString(),native.text.toString(),config.bindings(routes.text.toString()).map{it.device to it.endpoint})
            val intent=android.content.Intent(android.content.Intent.ACTION_CREATE_DOCUMENT).setType("text/plain")
                .addCategory(android.content.Intent.CATEGORY_OPENABLE).putExtra(android.content.Intent.EXTRA_TITLE,"commlink-pbx-review.txt")
            @Suppress("DEPRECATION") startActivityForResult(intent,22)
        }
        val allowed=field("允许拨出的号码（逗号分隔，精确号码或前缀加 *；空表示禁止外拨）",config.dialRules,multi=true)
        val ice=field("可选 ICE 服务器 JSON（留空使用直连候选）",config.iceText,password=true,multi=true)
        label("保存的是主节点连接设置；请先按运维文档配置独立的受限端点与 Stasis 路由。只有 PBX 事件连接、网关注册和绑定检查通过后才可拨号。")
        button("保存主节点设置"){
            val values=listOf(user,ariSecret,wss,domain,web,webSecret,native,nativeSecret,routes,ice,allowed).map{it.text.toString()}
            val active=enabled.isChecked;val localPort=port.text.toString().toInt()
            Thread{
                val result=runCatching{runtime.changeConfig{
                    config.save(active,localPort,values[0],values[1],values[2].trim(),values[3].trim(),values[4],values[5],
                        values[6],values[7],values[8],values[9],values[10])
                }}
                runOnUiThread{if(!isFinishing){
                    if(result.isSuccess){unlocked=false;screen()}else toast(result.exceptionOrNull()?.message?:"保存失败")
                }}
            }.start()
        }
    }
}
