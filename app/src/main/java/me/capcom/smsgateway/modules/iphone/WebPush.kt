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

/** Legacy subscriptions receive empty pushes; previews use RFC 8291 encryption. */
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
    fun send(subscription: PrivateStore.Subscription, preview: ByteArray?): Int {
        val endpoint = subscription.endpoint
        require(validEndpoint(endpoint))
        val url=endpoint.toHttpUrl()
        val host=context.getSharedPreferences("iphone",0).getString("host","sms.example.com")!!
        val claims=JsonObject().apply { addProperty("aud","https://${url.host}");addProperty("exp",System.currentTimeMillis()/1000+3600);addProperty("sub","https://$host:8443") }
        val jwt=JsonWebSignature().apply { payload=claims.toString();algorithmHeaderValue=AlgorithmIdentifiers.ECDSA_USING_P256_CURVE_AND_SHA256;key=keys().private }.compactSerialization
        val request = Request.Builder().url(url).header("Authorization","vapid t=$jwt, k=${publicKey()}")
            .header("TTL","300").header("Urgency","high")
        val body = if(preview != null && subscription.publicKey != null && subscription.auth != null) {
            request.header("Content-Encoding", "aes128gcm").header("Content-Type", "application/octet-stream")
            PushEncryption.encrypt(subscription.publicKey, subscription.auth, preview)
        } else ByteArray(0)
        return http.newCall(request.post(body.toRequestBody()).build()).execute().use { it.code }
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
            val preview by lazy {
                if(inputData.getBoolean("test",false)) org.json.JSONObject().put("title","短信互联助手")
                    .put("body","这是短信预览测试").toString().toByteArray()
                else inputData.getByteArray("preview")?.let { runCatching { SecretVault(applicationContext).open(it) }.getOrNull() }
            }
            for(subscription in store.subscriptions()) {
                // Recheck on execution and retry: the conversation may have been
                // muted while offline.
                if(!PushPolicy.allowed(inputData.getString("address"),store.conversations(),inputData.getBoolean("test",false))) return@withContext Result.success()
                try { when(val status=WebPush(applicationContext).send(subscription, if(subscription.publicKey != null) preview else null)) {
                    404,410 -> {
                        store.removeSubscription(subscription.endpoint);permanent=true
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
        private fun messageData(context: Context, address: String, body: String?, name: String?): Data {
            val data = Data.Builder().putString("address",address.take(100))
            PrivateStore(context).use { store ->
                if(body != null && store.subscriptions().any { it.publicKey != null }) {
                    // Keep only an encrypted, bounded snapshot in WorkManager, tied to this receipt.
                    val sealed = runCatching {
                        val history = SmsHistory(context, store)
                        val title = name ?: history.contact(address) ?: history.format(address)
                        val payload = org.json.JSONObject().put("title",title.take(100))
                            .put("body",body.take(200)).put("address",PhoneIdentity.normalize(address).take(100))
                        SecretVault(context).seal(payload.toString().toByteArray())
                    }.getOrNull()
                    if(sealed != null) data.putByteArray("preview", sealed)
                }
            }
            return data.build()
        }
        fun enqueuePeer(context:Context,address:String,event:String,row:SmsRow?) {
            if(!context.getSharedPreferences("iphone",0).getBoolean("enabled",false))return
            if(!PrivateStore(context).use { PushPolicy.allowed(address,it.conversations()) })return
            val operation=WorkManager.getInstance(context).enqueueUniqueWork("iphone-push-"+event,ExistingWorkPolicy.KEEP,
                OneTimeWorkRequestBuilder<WebPushWorker>().setInputData(messageData(context,address,row?.body,row?.name))
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
        fun enqueue(context: Context, address: String, body: String) {
            if(!context.getSharedPreferences("iphone",0).getBoolean("enabled",false))return
            if(!PrivateStore(context).use { PushPolicy.allowed(address,it.conversations()) })return
            queue(context,messageData(context,address,body,null),false)
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
