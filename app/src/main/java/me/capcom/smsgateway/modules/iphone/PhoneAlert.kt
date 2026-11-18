package me.capcom.smsgateway.modules.iphone

import android.content.Context
import androidx.work.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** A missed-call alert contains no number, contact name or PBX credentials. */
class PhoneAlert(context:Context,params:WorkerParameters):CoroutineWorker(context,params) {
    override suspend fun doWork()=withContext(Dispatchers.IO) {
        val device=inputData.getString("device") ?: return@withContext Result.failure()
        if(System.currentTimeMillis()-inputData.getLong("time",0L)>3600000L)return@withContext Result.success()
        var retry=false
        val origin="https://"+applicationContext.getSharedPreferences("iphone",0).getString("host","sms.example.com")+":8444"
        PrivateStore(applicationContext).use { db ->
            for(sub in db.subscriptions("phone",device)) {
                try {
                    val content=if(sub.publicKey==null)null else {
                        val nodes=sub.grants.split(',').filter{it.startsWith("device:")}.map{it.removePrefix("device:")}.toSet()
                        val visible=PeerHub.get(applicationContext).devices().map{it["deviceId"]}.toSet()
                        val count=runCatching { me.capcom.smsgateway.modules.directory.DirectoryService.get(applicationContext)
                            .missed(sub.installation){it in nodes && it in visible}.getInt("count") }.getOrNull()
                        PushPayload.phone(origin,count)
                    }
                    when(WebPush(applicationContext).send(sub,content)) {
                        404,410 -> db.removeSubscription(sub.endpoint)
                        429,in 500..599 -> retry=true
                    }
                } catch(e:Exception) { if(e is kotlinx.coroutines.CancellationException)throw e;retry=true }
            }
        }
        if(retry)Result.retry() else Result.success()
    }
    companion object {
        fun enqueue(context:Context,deviceId:String,eventId:String) {
            val job=OneTimeWorkRequestBuilder<PhoneAlert>().setInputData(workDataOf("device" to deviceId,"time" to System.currentTimeMillis()))
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()).build()
            WorkManager.getInstance(context).enqueueUniqueWork("phone-missed-"+PrivateStore.hash(deviceId+"|"+eventId),ExistingWorkPolicy.KEEP,job)
        }
    }
}
