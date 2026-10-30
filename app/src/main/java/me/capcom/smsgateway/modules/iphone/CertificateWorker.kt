package me.capcom.smsgateway.modules.iphone

import android.content.Context
import android.content.Intent
import androidx.work.*
import com.google.gson.JsonObject
import com.google.gson.JsonParser
import kotlinx.coroutines.*
import kotlinx.coroutines.sync.Mutex
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import org.shredzone.acme4j.AccountBuilder
import org.shredzone.acme4j.Session
import org.shredzone.acme4j.Status
import org.shredzone.acme4j.challenge.Dns01Challenge
import org.bouncycastle.asn1.x500.X500Name
import org.bouncycastle.asn1.x509.*
import org.bouncycastle.asn1.pkcs.PKCSObjectIdentifiers
import org.bouncycastle.pkcs.jcajce.JcaPKCS10CertificationRequestBuilder
import org.bouncycastle.operator.jcajce.JcaContentSignerBuilder
import org.bouncycastle.jce.provider.BouncyCastleProvider
import java.security.*
import java.security.spec.PKCS8EncodedKeySpec
import java.security.spec.X509EncodedKeySpec
import java.security.cert.X509Certificate
import java.util.concurrent.TimeUnit

/** Provider boundary: future DNS backends do not change the ACME lifecycle. */
interface DnsChallengeProvider {
    fun create(name: String,value: String): String
    fun remove(recordId: String)
}

class CloudflareDns(private val token: String,private val zone: String) : DnsChallengeProvider {
    private val http=OkHttpClient.Builder().callTimeout(25,TimeUnit.SECONDS).followRedirects(false).build()
    init { require(zone.matches(Regex("[a-f0-9]{32}"))) }
    private fun request(path: String,method: String,body: String?=null): JsonObject {
        val req=Request.Builder().url("https://api.cloudflare.com/client/v4/zones/$zone$path")
            .header("Authorization","Bearer $token").method(method,body?.toRequestBody("application/json".toMediaType())).build()
        return http.newCall(req).execute().use {
            check(it.isSuccessful) { "Cloudflare HTTP ${it.code}" }
            val json=JsonParser.parseString(it.body!!.string()).asJsonObject
            check(json["success"].asBoolean) { "Cloudflare rejected DNS request" };json
        }
    }
    fun verifyDomain(host: String) {
        val name=request("","GET")["result"].asJsonObject["name"].asString
        require(host==name || host.endsWith(".$name"))
    }
    override fun create(name: String,value: String): String = request("/dns_records","POST",JsonObject().apply {
        addProperty("type","TXT");addProperty("name",name);addProperty("content",value);addProperty("ttl",120)
    }.toString())["result"].asJsonObject["id"].asString
    override fun remove(recordId: String) { require(recordId.matches(Regex("[a-f0-9]{32}")));request("/dns_records/$recordId","DELETE") }
}

class CertificateWorker(context: Context,params: WorkerParameters): CoroutineWorker(context,params) {
    private val prefs=context.getSharedPreferences("iphone",0)
    private fun status(value: String) { prefs.edit().putString("certificate-status",value).apply() }
    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        if(!lock.tryLock())return@withContext Result.retry()
        var phase="检查配置"
        try {
            if(!inputData.getBoolean("force",false)) {
                val validUntil=prefs.getLong("certificate-until",0)
                if(validUntil-System.currentTimeMillis()>30L*86400_000)return@withContext Result.success()
            }
            val host=prefs.getString("host","sms.example.com")!!
            require(host.matches(Regex("[a-zA-Z0-9.-]+")))
            val vault=SecretVault(applicationContext)
            val token=String(requireNotNull(vault.get("cloudflare")),Charsets.UTF_8)
            val dns=CloudflareDns(token,prefs.getString("zone-id","")!!)
            dns.verifyDomain(host)
            val keys=KeyPairGenerator.getInstance("RSA").apply { initialize(2048) }
            val accountKey=vault.get("acme-account")?.let { bytes ->
                val stream=java.io.DataInputStream(bytes.inputStream())
                val public=ByteArray(stream.readInt());stream.readFully(public)
                val private=ByteArray(stream.readInt());stream.readFully(private)
                val f=KeyFactory.getInstance("RSA");KeyPair(f.generatePublic(X509EncodedKeySpec(public)),f.generatePrivate(PKCS8EncodedKeySpec(private)))
            } ?: keys.generateKeyPair().also { pair ->
                val out=java.io.ByteArrayOutputStream();java.io.DataOutputStream(out).use { it.writeInt(pair.public.encoded.size);it.write(pair.public.encoded);it.writeInt(pair.private.encoded.size);it.write(pair.private.encoded) };vault.put("acme-account",out.toByteArray())
            }
            val staging=inputData.getBoolean("staging",false)
            val session=Session(if(staging) "https://acme-staging-v02.api.letsencrypt.org/directory" else "https://acme-v02.api.letsencrypt.org/directory")
            session.networkSettings().setTimeout(java.time.Duration.ofSeconds(60))
            phase="创建 ACME 订单";status(phase)
            val account=AccountBuilder().agreeToTermsOfService().useKeyPair(accountKey).create(session)
            val order=account.newOrder().domains(host).create()
            for(auth in order.authorizations) {
                if(auth.status==Status.VALID)continue
                val challenge=auth.findChallenge<Dns01Challenge>(Dns01Challenge.TYPE) ?: error("DNS challenge unavailable")
                phase="发布 DNS 验证记录";status(phase)
                // Recover only our own orphan record from an interrupted job, never other TXT records.
                prefs.getString("acme-orphan",null)?.let { orphan ->
                    if(prefs.getString("acme-orphan-zone",null)==prefs.getString("zone-id",null)) {
                        runCatching { dns.remove(orphan) };prefs.edit().remove("acme-orphan").apply()
                    }
                }
                val id=dns.create("_acme-challenge.$host",challenge.digest)
                prefs.edit().putString("acme-orphan",id).putString("acme-orphan-zone",prefs.getString("zone-id",null)).commit()
                try {
                    phase="等待 DNS 传播（至少 90 秒）";status(phase);delay(90_000)
                    challenge.trigger()
                    phase="等待 CA 验证";status(phase)
                    withTimeout(240_000) { while(auth.status!=Status.VALID) { delay(5000);auth.update();check(auth.status!=Status.INVALID) { "DNS validation failed" } } }
                } finally {
                    withContext(NonCancellable) { runCatching { dns.remove(id) }.onSuccess { prefs.edit().remove("acme-orphan").apply() } }
                }
            }
            withTimeout(60_000) { while(order.status!=Status.READY) { delay(3000);order.update();check(order.status!=Status.INVALID) } }
            phase="签发证书";status(phase)
            val domainKey=keys.generateKeyPair()
            val extensions=ExtensionsGenerator().apply { addExtension(Extension.subjectAlternativeName,false,GeneralNames(GeneralName(GeneralName.dNSName,host))) }
            val csr=JcaPKCS10CertificationRequestBuilder(X500Name("CN=$host"),domainKey.public)
                .addAttribute(PKCSObjectIdentifiers.pkcs_9_at_extensionRequest,extensions.generate())
                .build(JcaContentSignerBuilder("SHA256withRSA").setProvider(BouncyCastleProvider()).build(domainKey.private))
            order.execute(csr.encoded)
            withTimeout(120_000) { while(order.status!=Status.VALID) { delay(3000);order.update();check(order.status!=Status.INVALID) } }
            val chain=order.certificate!!.certificateChain.toTypedArray()
            if(staging) { status("测试 CA 验证成功；测试证书未启用，请执行正式签发");return@withContext Result.success() }
            chain[0].checkValidity()
            val password=PrivateStore.token()
            val pkcs=KeyStore.getInstance("PKCS12").apply { load(null,null);setKeyEntry("https",domainKey.private,password.toCharArray(),chain) }
            val out=java.io.ByteArrayOutputStream();pkcs.store(out,password.toCharArray())
            TlsIdentity(applicationContext).import(out.toByteArray(),password)
            prefs.edit().putLong("certificate-until",chain[0].notAfter.time).apply()
            status("证书已安装，到期：${chain[0].notAfter}；每天检查，到期前 30 天续期")
            if(prefs.getBoolean("enabled",false)) {
                applicationContext.stopService(Intent(applicationContext,IphoneService::class.java));delay(1500)
                runCatching { IphoneService.start(applicationContext) }.onFailure { status("证书已续期；请打开 App 重启 HTTPS 服务") }
            }
            schedule(applicationContext)
            Result.success()
        } catch(e: CancellationException) { throw e }
        catch(e: Exception) { status("$phase 失败（${generateSequence<Throwable>(e) { it.cause }.take(5).joinToString(" / ") { it.javaClass.simpleName + ": " + (it.message ?: "").take(160) }}）。检查网络、Zone ID、令牌权限及 CA 限额；旧证书保留。"); if(runAttemptCount<3)Result.retry() else Result.failure() }
        finally { lock.unlock() }
    }
    companion object {
        private val lock=Mutex()
        fun schedule(context: Context) {
            WorkManager.getInstance(context).enqueueUniquePeriodicWork("iphone-certificate-renewal",ExistingPeriodicWorkPolicy.KEEP,
                PeriodicWorkRequestBuilder<CertificateWorker>(1,TimeUnit.DAYS).setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()).build())
        }
        fun issue(context: Context,staging: Boolean) {
            WorkManager.getInstance(context).enqueueUniqueWork("iphone-certificate-issue",ExistingWorkPolicy.REPLACE,
                OneTimeWorkRequestBuilder<CertificateWorker>().setInputData(workDataOf("force" to true,"staging" to staging))
                    .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                    .setBackoffCriteria(BackoffPolicy.EXPONENTIAL,30,TimeUnit.MINUTES).build())
        }
    }
}
