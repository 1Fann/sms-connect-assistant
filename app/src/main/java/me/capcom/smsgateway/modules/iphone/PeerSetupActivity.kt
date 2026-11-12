package me.capcom.smsgateway.modules.iphone

import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.WindowManager
import android.widget.*
import java.util.concurrent.Executors

class PeerSetupActivity : Activity() {
    private val worker = Executors.newSingleThreadExecutor()
    private val main = Handler(Looper.getMainLooper())
    private var joining = false

    override fun onDestroy() {
        main.removeCallbacksAndMessages(null)
        worker.shutdownNow()
        super.onDestroy()
    }

    override fun onCreate(state: Bundle?) {
        super.onCreate(state)
        window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        title="多设备通讯－配对与共享"
        val client=PeerClient(this)
        val hub=PeerHub.get(this)
        val box=LinearLayout(this).apply { orientation=LinearLayout.VERTICAL;setPadding(32,32,32,32) }
        setContentView(ScrollView(this).apply{addView(box)})
        val status=TextView(this).also{box.addView(it)}
        fun button(label:String, click:()->Unit)=Button(this).apply { text=label;box.addView(this);setOnClickListener{click()} }
        button("通讯录与通话记录授权"){
            startActivity(Intent().setClassName(this,"me.capcom.smsgateway.modules.directory.DirectoryAccessActivity"))
        }
        if(getSharedPreferences("iphone",0).getBoolean("enabled",false)){
            status.text="本机是主节点。请在要加入的手机上填写主节点域名和一次性接入码。"
            button("生成新的接入码"){runCatching { hub.invite() }.onSuccess{status.text="三分钟内有效的接入码："+it}.onFailure{status.text="生成失败，请稍后重试"}}
            val approval=button("审批待配对设备"){
                val pending=hub.pending() ?: return@button
                AlertDialog.Builder(this).setMessage("允许这台设备接入通讯系统？\n设备自报型号："+pending.second.ifBlank{"未知"})
                    .setPositiveButton("允许"){_,_->hub.approve(pending.first);recreate()}.setNegativeButton("取消",null).show()
            }
            val checkPending=object:Runnable {
                override fun run() {
                    if(isDestroyed||isFinishing)return
                    approval.isEnabled=hub.pending()!=null
                    main.postDelayed(this,1500)
                }
            }
            main.post(checkPending)
            hub.devices().filter{it["id"]!="server"}.forEach { device->
                val id=device["id"] as String
                val label=(device["name"] as String)+" · "+(if(device["online"]==true)"在线" else "离线")+" · "+id.take(8)
                button("撤销 "+label){
                    AlertDialog.Builder(this).setMessage("撤销此设备的授权？它不能再同步或领取任务。")
                        .setPositiveButton("撤销"){_,_->hub.revoke(id);recreate()}.setNegativeButton("取消",null).show()
                }
            }
            val lines=hub.allLines()
            lines.forEach { line->
                val id=line["lineId"] as String
                val label=line["name"].toString()+(if(line["isDefault"]==true)" · 默认" else "")
                button("管理线路："+label){
                    val enable=if(line["enabled"]==true)"停用" else "启用"
                    val makeDefault=if(line["isDefault"]==true)"取消默认" else "设为默认"
                    val absent=lines.filter { it["present"]==false && it["lineId"]!=id }
                    val actions=mutableListOf(makeDefault,"移到首位",enable)
                    val policyOption=if(line["present"]==true)actions.size else -1
                    if(policyOption>=0)actions.add(if(line["followSlot"]==true)"关闭按卡槽自动接管" else "按卡槽自动接管")
                    if(line["present"]==true && line["deviceOnline"]==true && absent.isNotEmpty())actions.add("这是原有 SIM，关联旧线路")
                    AlertDialog.Builder(this).setTitle(label).setItems(actions.toTypedArray()){_,which->
                        if(which<3) {
                            hub.configureLine(id,listOf(if(line["isDefault"]==true)"no-default" else "default","first",if(line["enabled"]==true)"disable" else "enable")[which])
                            recreate()
                        } else if(which==policyOption) {
                            if(line["followSlot"]==true){hub.configureLine(id,"confirm-sim");recreate()}
                            else AlertDialog.Builder(this).setMessage("开启后，这个卡槽换入的新 SIM 会自动用于短信和拨号。已排队短信仍绑定原 SIM。")
                                .setPositiveButton("开启自动接管"){_,_->hub.configureLine(id,"follow-slot");recreate()}
                                .setNegativeButton("取消",null).show()
                        } else {
                            AlertDialog.Builder(this).setTitle("选择已经移出的原线路").setItems(absent.map{it["name"].toString()}.toTypedArray()){_,pos->
                                val old=absent[pos]
                                AlertDialog.Builder(this).setMessage("确认 "+old["name"]+" 的原 SIM 已移到 "+label+"？之后使用原线路身份拨号或发送会使用新位置。")
                                    .setPositiveButton("已核实，关联"){_,_-> runCatching { hub.moveIdentity(old["lineId"] as String,id) }.onFailure{Toast.makeText(this,"线路已变化，请刷新后重试",Toast.LENGTH_LONG).show()};recreate() }
                                    .setNegativeButton("取消",null).show()
                            }.show()
                        }
                    }.show()
                }
            }
            for(line in lines.filter { it["confirmed"]==false && it["present"]==true }) {
                button("确认换卡："+line["name"]){
                    AlertDialog.Builder(this).setMessage("检测到卡槽或订阅变化。请核对 "+line["phoneName"]+" 的卡槽 "+line["slot"]+" 内的实际 SIM，再允许使用此线路。")
                        .setPositiveButton("已核实 SIM"){_,_->hub.confirmLine(line["lineId"] as String);recreate()}.setNegativeButton("取消",null).show()
                }
            }
            return
        }
        val sms=CheckBox(this).apply {
            text="共享本机短信与发送线路"
            isChecked=client.prefs.getBoolean("share-sms",true)
            setOnCheckedChangeListener {_,checked -> client.prefs.edit().putBoolean("share-sms",checked).apply() }
            box.addView(this)
        }
        if(client.prefs.getBoolean("enabled",false)){
            status.text=PeerClient.status
            button("停止共享"){client.prefs.edit().putBoolean("enabled",false).commit();stopService(Intent(this,IphoneService::class.java));recreate()}
            return
        }
        status.text="连接已有主节点。通讯录、写回和通话记录可单独授权。"
        val host=EditText(this).apply{hint="主节点域名";setSingleLine();box.addView(this)}
        val code=EditText(this).apply{hint="主节点接入码";setSingleLine();box.addView(this)}
        button("加入通讯系统"){
            if(joining)return@button
            if (sms.isChecked) {
                val missing=listOf(android.Manifest.permission.READ_SMS,android.Manifest.permission.SEND_SMS,android.Manifest.permission.READ_PHONE_STATE)
                    .filter { androidx.core.content.ContextCompat.checkSelfPermission(this,it)!=android.content.pm.PackageManager.PERMISSION_GRANTED }
                if(missing.isNotEmpty()){
                    status.text="请允许短信及 SIM 权限，或关闭短信共享后加入。"
                    if(android.os.Build.VERSION.SDK_INT>=23)requestPermissions(missing.toTypedArray(),60)
                    return@button
                }
            }
            val h=host.text.toString().trim()
            val c=code.text.toString().trim()
            joining=true
            status.text="正在连接，请在主节点审批这台设备。"
            worker.execute {
                val result=runCatching { client.join(h,c) }
                runOnUiThread {
                    if(isFinishing||isDestroyed)return@runOnUiThread
                    joining=false
                    result.onSuccess { IphoneService.start(this);recreate() }.onFailure { status.text="接入失败，请检查网络、接入码及主节点审批状态。" }
                }
            }
        }
    }
}
