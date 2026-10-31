package me.capcom.smsgateway.modules.iphone

import android.content.Context
import android.provider.Telephony
import android.provider.ContactsContract
import android.net.Uri
import me.capcom.smsgateway.helpers.SubscriptionsHelper
import com.google.i18n.phonenumbers.PhoneNumberUtil

data class SmsRow(val id: String, val address: String, val display: String, val name: String?, val body: String,
    val date: Long, val incoming: Boolean, val read: Boolean, val sim: Int?, val state: String, val creator: String? = null, val error: String? = null)

class SmsHistory(private val context: Context, private val store: PrivateStore) {
    fun contacts(query: String): List<Map<String,String>> = try {
        val result=mutableListOf<Map<String,String>>()
        context.contentResolver.query(ContactsContract.CommonDataKinds.Phone.CONTENT_URI,
            arrayOf("display_name","data1"),"display_name LIKE ? OR data1 LIKE ?",arrayOf("%${query.take(60)}%","%${query.take(60)}%"),"display_name ASC")?.use { c ->
            while(result.size<50 && c.moveToNext())result.add(mapOf("name" to (c.getString(0) ?: ""),"number" to (c.getString(1) ?: "")))
        };result
    } catch(_: SecurityException) { emptyList() }
    fun page(before: Long, limit: Int, ascending: Boolean=false): List<SmsRow> {
        val result = mutableListOf<SmsRow>()
        val names = mutableMapOf<String, String?>()
        context.contentResolver.query(Telephony.Sms.CONTENT_URI,
            arrayOf("_id", "address", "body", "date", "type", "read", "sub_id", "status", "creator"),
            if(ascending) "_id > ?" else "_id < ?", arrayOf(before.toString()), if(ascending) "_id ASC" else "_id DESC")?.use { c ->
            while (result.size < limit && c.moveToNext()) {
                val raw = c.getString(1) ?: "未知号码"
                val address = PhoneIdentity.normalize(raw)
                val date = c.getLong(3)
                val type = c.getInt(4)
                val name = names.getOrPut(address) { contact(raw) }
                result.add(SmsRow("sms:${c.getLong(0)}", address, format(raw), name, c.getString(2) ?: "", date,
                    type == 1, c.getInt(5) == 1 || date <= store.seen(address),
                    if(c.isNull(6)) null else SubscriptionsHelper.getSimSlotIndex(context, c.getInt(6))?.plus(1),
                    when { type == 1 -> "received"; type == 5 || (type == 2 && c.getInt(7) >= 64) -> "failed"; type == 2 && c.getInt(7) == 0 -> "delivered"; type == 2 -> "sent"; type == 4 || type == 6 -> "accepted"; else -> "unknown" },c.getString(8)))
            }
        }
        return result
    }
    fun contact(number: String): String? = try {
        context.contentResolver.query(Uri.withAppendedPath(ContactsContract.PhoneLookup.CONTENT_FILTER_URI, Uri.encode(number)),
            arrayOf(ContactsContract.PhoneLookup.DISPLAY_NAME), null, null, null)?.use { if(it.moveToFirst()) it.getString(0) else null }
    } catch (_: SecurityException) { null }
    fun format(number: String): String = try {
        val util = PhoneNumberUtil.getInstance()
        val region = context.getSharedPreferences("iphone", 0).getString("region", "CN")!!
        val parsed = util.parse(number, region)
        if (!util.isValidNumber(parsed)) number else util.format(parsed,
            if(number.startsWith("+")) PhoneNumberUtil.PhoneNumberFormat.INTERNATIONAL else PhoneNumberUtil.PhoneNumberFormat.NATIONAL)
    } catch (_: Exception) { number }
}
