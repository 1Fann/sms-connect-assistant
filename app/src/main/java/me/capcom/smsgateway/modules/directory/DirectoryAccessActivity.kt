package me.capcom.smsgateway.modules.directory

import android.Manifest
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.content.pm.PackageManager
import android.provider.Settings
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat

/** Explicit local consent is separate from the presence of a legacy READ_CONTACTS grant. */
class DirectoryAccessActivity: AppCompatActivity() {
    private val permissions=linkedMapOf(
        "contacts.read" to Manifest.permission.READ_CONTACTS,
        "contacts.write" to Manifest.permission.WRITE_CONTACTS,
        "calls.read" to Manifest.permission.READ_CALL_LOG
    )
    private val titles=mapOf("contacts.read" to "共享本机通讯录","contacts.write" to "允许远程编辑通讯录","calls.read" to "共享本机通话记录")
    private val prefs get()=getSharedPreferences("directory-consent",0)

    override fun onCreate(savedInstanceState:Bundle?){super.onCreate(savedInstanceState);title="通讯数据授权"}
    override fun onResume(){super.onResume();render()}

    private fun render(){
        val layout=LinearLayout(this).apply{orientation=LinearLayout.VERTICAL;setPadding(28,28,28,28)}
        setContentView(ScrollView(this).apply{addView(layout)})
        layout.addView(TextView(this).apply{text="逐项选择允许主节点同步的数据。网页编辑会修改这台手机的系统通讯录，仅在开启远程编辑后执行。系统可能限制通话记录权限。"})
        getSharedPreferences("directory-sync",0).getString("contact-error",null)?.let{message->
            layout.addView(TextView(this).apply{text=message;setTextColor(android.graphics.Color.rgb(220,55,45))})
        }
        for((index,key) in permissions.keys.withIndex()){
            val permission=permissions.getValue(key)
            val label=titles.getValue(key)
            val enabled=prefs.getBoolean(key,false)
            val granted=DirectoryPermissions.granted(this,permission)
            val accessible=DirectoryPermissions.accessible(this,permission)
            layout.addView(TextView(this).apply{text=label+" · "+when{
                enabled&&!accessible->"系统权限或隐私保护限制读取"
                enabled->"已启用"
                else->"已关闭"
            }})
            layout.addView(Button(this).apply{
                text=if(enabled&&granted)"关闭"+label else if(key=="calls.read"&&!granted)"询问系统并开启通话记录权限" else "开启"+label
                isEnabled=key!="contacts.write" || DirectoryProvider(this@DirectoryAccessActivity).allowed("contacts.read")
                setOnClickListener{
                    if(enabled&&granted){
                        prefs.edit().putBoolean(key,false).apply()
                        if(key=="contacts.read")prefs.edit().putBoolean("contacts.write",false).apply()
                        render()
                    } else if(granted&&!accessible){
                        startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,Uri.parse("package:$packageName")))
                    } else if(granted){prefs.edit().putBoolean(key,true).apply();render()}
                    else ActivityCompat.requestPermissions(this@DirectoryAccessActivity,arrayOf(permission),501+index)
                }
            })
            if(key=="calls.read"&&!accessible)layout.addView(Button(this).apply{
                text="打开系统应用权限设置"
                isAllCaps=false
                setOnClickListener {
                    startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,Uri.parse("package:$packageName")))
                }
            })
        }
    }
    override fun onRequestPermissionsResult(requestCode:Int,permissions:Array<out String>,result:IntArray){
        super.onRequestPermissionsResult(requestCode,permissions,result)
        val key=this.permissions.keys.elementAtOrNull(requestCode-501)?:return
        val granted=result.firstOrNull()==PackageManager.PERMISSION_GRANTED && DirectoryPermissions.accessible(this,this.permissions.getValue(key))
        prefs.edit().putBoolean(key,granted).apply()
        if(!granted)android.widget.Toast.makeText(this,"系统未授权，其他模块可继续使用",android.widget.Toast.LENGTH_LONG).show()
        render()
    }
}
