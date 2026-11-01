package me.capcom.smsgateway.modules.iphone

import android.content.Context
import androidx.work.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.IOException

/** A missed-call alert contains no number, contact name or PBX credentials. */
class PhoneAlert(context:Context,params:WorkerParameters):CoroutineWorker(context,params) {
    override suspend fun doWork()=withContext(Dispatchers.IO) {
        val device=inputData.getString("device") ?: return@withContext Result.failure()
        if(System.currentTimeMillis()-inputData.getLong("time",0L)>3600000L)return@withContext Result.success()
        var retry=false
        PrivateStore(applicationContext).use { db ->
            for(sub in db.subscriptions("phone",device)) {
                try {
                    when(WebPush(applicationContext).send(sub,null)) {
                        404,410 -> db.removeSubscription(sub.endpoint)
                        429,in 500..599 -> retry=true
                    }
                } catch(_:IOException) { retry=true }
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
