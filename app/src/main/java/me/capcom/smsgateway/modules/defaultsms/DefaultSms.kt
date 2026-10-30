package me.capcom.smsgateway.modules.defaultsms

import android.app.Activity
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.role.RoleManager
import android.content.Context
import android.content.Intent
import android.os.Build
import android.provider.Telephony
import androidx.core.app.NotificationCompat
import me.capcom.smsgateway.R

object DefaultSms {
    fun isDefault(context: Context): Boolean = if (Build.VERSION.SDK_INT >= 29) {
        context.getSystemService(RoleManager::class.java).isRoleHeld(RoleManager.ROLE_SMS)
    } else Telephony.Sms.getDefaultSmsPackage(context) == context.packageName

    @Synchronized fun note(context: Context, stage: String) {
        val prefs = context.getSharedPreferences("sms-diagnostic", 0)
        val lines = (prefs.getString("stage", "").orEmpty().lines().filter { it.isNotBlank() } + stage).takeLast(8)
        prefs.edit().putString("stage", lines.joinToString("\n")).putLong("time", System.currentTimeMillis()).apply()
    }

    fun diagnostic(context: Context): String {
        val prefs = context.getSharedPreferences("sms-diagnostic", 0)
        return "默认短信角色：${isDefault(context)}；系统短信包匹配：${Telephony.Sms.getDefaultSmsPackage(context) == context.packageName}\n" +
            (prefs.getString("stage", null) ?: "尚无新发送记录")
    }

    fun request(activity: Activity) {
        if (Build.VERSION.SDK_INT >= 29) {
            val manager = activity.getSystemService(RoleManager::class.java)
            check(manager.isRoleAvailable(RoleManager.ROLE_SMS)) { "此设备不支持默认短信应用" }
            activity.startActivityForResult(manager.createRequestRoleIntent(RoleManager.ROLE_SMS), 71)
        } else {
            activity.startActivityForResult(Intent(Telephony.Sms.Intents.ACTION_CHANGE_DEFAULT)
                .putExtra(Telephony.Sms.Intents.EXTRA_PACKAGE_NAME, activity.packageName), 71)
        }
    }

    fun notify(context: Context, message: String, id: Int = 4701) {
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= 26) manager.createNotificationChannel(
            NotificationChannel("sms-bridge-inbox", "短信与收件提醒", NotificationManager.IMPORTANCE_HIGH))
        val open = PendingIntent.getActivity(context, 4701, Intent(context, SmsInboxActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        runCatching {
            manager.notify(id, NotificationCompat.Builder(context, "sms-bridge-inbox")
                .setSmallIcon(R.drawable.ic_sms).setContentTitle("短信互联助手")
                .setContentText(message).setContentIntent(open).setAutoCancel(true)
                .setVisibility(NotificationCompat.VISIBILITY_PRIVATE).build())
        }
    }
}
