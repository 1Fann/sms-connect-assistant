package me.capcom.smsgateway.modules.iphone

import android.content.Context
import androidx.work.*
import com.google.gson.JsonObject
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.HttpUrl.Companion.toHttpUrl
import org.jose4j.jws.JsonWebSignature
import org.jose4j.jws.AlgorithmIdentifiers
import java.security.*
import java.security.interfaces.ECPublicKey
import java.security.spec.*
import java.util.concurrent.TimeUnit

/** Payload-free Web Push: Apple receives no SMS content, number or conversation ID. */
class WebPush(private val context: Context) {
    private val vault=SecretVault(context)
    private fun keys(): KeyPair = synchronized(KEY_LOCK) {
        val saved=vault.get("vapid")
        if(saved!=null) {
            val input=java.io.DataInputStream(saved.inputStream());val pub=ByteArray(input.readInt());input.readFully(pub);val priv=ByteArray(input.readInt());input.readFully(priv)
            val f=KeyFactory.getInstance("EC");KeyPair(f.generatePublic(X509EncodedKeySpec(pub)),f.generatePrivate(PKCS8EncodedKeySpec(priv)))
        } else KeyPairGenerator.getInstance("EC").apply { initialize(ECGenParameterSpec("secp256r1")) }.generateKeyPair().also { pair ->
            val out=java.io.ByteArrayOutputStream();java.io.DataOutputStream(out).use { it.writeInt(pair.public.encoded.size);it.write(pair.public.encoded);it.writeInt(pair.private.encoded.size);it.write(pair.private.encoded) };vault.put("vapid",out.toByteArray())
        }
    }
    fun publicKey(): String {
        val pub=keys().public as ECPublicKey
        fun coordinate(n: java.math.BigInteger): ByteArray { val raw=n.toByteArray();return ByteArray(32).also { raw.copyInto(it,maxOf(0,32-raw.size),maxOf(0,raw.size-32)) } }
        return android.util.Base64.encodeToString(byteArrayOf(4)+coordinate(pub.w.affineX)+coordinate(pub.w.affineY),android.util.Base64.URL_SAFE or android.util.Base64.NO_PADDING or android.util.Base64.NO_WRAP)
    }
    fun send(endpoint: String): Int {
        require(validEndpoint(endpoint))
        val url=endpoint.toHttpUrl()
        val host=context.getSharedPreferences("iphone",0).getString("host","sms.example.com")!!
        val claims=JsonObject().apply { addProperty("aud","https://${url.host}");addProperty("exp",System.currentTimeMillis()/1000+3600);addProperty("sub","https://$host:8443") }
        val jwt=JsonWebSignature().apply { payload=claims.toString();algorithmHeaderValue=AlgorithmIdentifiers.ECDSA_USING_P256_CURVE_AND_SHA256;key=keys().private }.compactSerialization
        return http.newCall(Request.Builder().url(url).header("Authorization","vapid t=$jwt, k=${publicKey()}")
            .header("TTL","300").header("Urgency","high").post(ByteArray(0).toRequestBody()).build()).execute().use { it.code }
    }
    companion object {
        private val KEY_LOCK=Any()
        private val http=OkHttpClient.Builder().callTimeout(20,TimeUnit.SECONDS).followRedirects(false).followSslRedirects(false).build()
        fun validEndpoint(endpoint: String): Boolean = runCatching {
            val u=endpoint.toHttpUrl()
            u.scheme=="https" && u.port==443 && u.username.isEmpty() && u.password.isEmpty() && u.host.endsWith(".push.apple.com") && u.fragment==null && endpoint.length<4096
        }.getOrDefault(false)
    }
}

class WebPushWorker(context: Context,params: WorkerParameters): CoroutineWorker(context,params) {
    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        if(!applicationContext.getSharedPreferences("iphone",0).getBoolean("enabled",false))return@withContext Result.success()
        var retry=false
        var permanent=false
        PrivateStore(applicationContext).use { store ->
            for(endpoint in store.subscriptions()) {
                // Recheck on execution and retry: the conversation may have been
                // muted while offline. The sender stays on Android, never in the push.
                if(!PushPolicy.allowed(inputData.getString("address"),store.conversations(),inputData.getBoolean("test",false))) return@withContext Result.success()
                try { when(val status=WebPush(applicationContext).send(endpoint)) {
                    404,410 -> {
                        store.removeSubscription(endpoint);permanent=true
                        applicationContext.getSharedPreferences("iphone",0).edit().putString("push-status","推送订阅已失效，请在 iPhone 重新订阅").apply()
                    }
                    429 -> retry=true
                    in 500..599 -> retry=true
                    else -> {
                        if(status !in 200..299)permanent=true
                        if(status !in 200..299 || !permanent)applicationContext.getSharedPreferences("iphone",0).edit().putString("push-status",if(status in 200..299) "推送请求提交成功；设备是否收到待确认" else "推送服务拒绝（HTTP $status），请重新订阅").apply()
                    }
                } } catch(e: Exception) { if(e is kotlinx.coroutines.CancellationException)throw e;retry=true }
            }
        }
        // A locally connected network can remain unable to reach Apple for hours.
        // Keep retryable failures durable under WorkManager's exponential backoff.
        if(retry) {
            applicationContext.getSharedPreferences("iphone",0).edit().putString("push-status",if(permanent)"部分订阅需重新授权；暂时不可达的推送已保留重试" else "推送暂不可达，任务已保留并自动退避重试").apply()
            Result.retry()
        } else Result.success()
    }
    companion object {
        fun enqueuePeer(context:Context,address:String,event:String) {
            if(!context.getSharedPreferences("iphone",0).getBoolean("enabled",false))return
            if(!PrivateStore(context).use { PushPolicy.allowed(address,it.conversations()) })return
            val operation=WorkManager.getInstance(context).enqueueUniqueWork("iphone-push-"+event,ExistingWorkPolicy.KEEP,
                OneTimeWorkRequestBuilder<WebPushWorker>().setInputData(workDataOf("address" to address.take(100)))
                    .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                    .setBackoffCriteria(BackoffPolicy.EXPONENTIAL,30,TimeUnit.SECONDS).build())
            // Called only from the IO service loop. Keep the journal until WorkManager
            // confirms its own transaction committed, with a bounded wait.
            repeat(200) {
                when(val state=operation.state.value) {
                    is Operation.State.SUCCESS -> return
                    is Operation.State.FAILURE -> throw IllegalStateException("Push enqueue failed",state.throwable)
                }
                Thread.sleep(50)
            }
            throw IllegalStateException("Push enqueue confirmation timed out")
        }
        fun enqueue(context: Context, address: String) {
            if(!context.getSharedPreferences("iphone",0).getBoolean("enabled",false))return
            if(!PrivateStore(context).use { PushPolicy.allowed(address,it.conversations()) })return
            queue(context,workDataOf("address" to address.take(100)),false)
        }
        fun enqueueTest(context: Context) = queue(context,workDataOf("test" to true),true)
        private fun queue(context: Context,data: Data,test: Boolean) {
            // KEEP could drop an unmuted message arriving behind a muted job.
            WorkManager.getInstance(context).enqueueUniqueWork(if(test)"iphone-push-test" else "iphone-push",if(test)ExistingWorkPolicy.KEEP else ExistingWorkPolicy.APPEND_OR_REPLACE,
                OneTimeWorkRequestBuilder<WebPushWorker>().setInputData(data).setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                    .setBackoffCriteria(BackoffPolicy.EXPONENTIAL,30,TimeUnit.SECONDS).build())
        }
    }
}
