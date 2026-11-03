package me.capcom.smsgateway.modules.iphone

import android.content.Context
import android.Manifest
import android.content.pm.PackageManager
import androidx.core.content.ContextCompat
import android.os.Build
import android.net.ConnectivityManager
import android.net.Network
import android.net.LinkProperties
import java.net.Inet6Address
import me.capcom.smsgateway.modules.directory.PeerDirectoryAgent
import com.google.gson.Gson
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.ensureActive
import me.capcom.smsgateway.helpers.SubscriptionsHelper
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.util.concurrent.TimeUnit

class PeerClient(private val ctx: Context) {
    val prefs=ctx.getSharedPreferences("peer-client",0)
    val vault=SecretVault(ctx)
    private val client=OkHttpClient.Builder().followRedirects(false).followSslRedirects(false)
        .retryOnConnectionFailure(false).callTimeout(15,TimeUnit.SECONDS).build()
    private val retry = PeerRetry()
    private var networkCallback: ConnectivityManager.NetworkCallback? = null

    // Both lifecycle methods are called by the foreground service on the main thread.
    internal fun observeNetwork() {
        if (Build.VERSION.SDK_INT < 24 || networkCallback != null) return
        val cm = ctx.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager ?: return
        val callback = object : ConnectivityManager.NetworkCallback() {
            private var current: Network? = null
            private var hasV6Default: Boolean? = null
            private fun wakeRetry() {
                client.connectionPool.evictAll()
                retry.networkAvailable()
            }
            override fun onAvailable(network: Network) {
                current = network
                hasV6Default = null
                wakeRetry()
            }
            override fun onLinkPropertiesChanged(network: Network, properties: LinkProperties) {
                if (network != current) return
                val present = properties.routes.any { it.isDefaultRoute && it.destination.address is Inet6Address }
                if (hasV6Default == false && present) wakeRetry()
                hasV6Default = present
            }
            override fun onLost(network: Network) {
                if (network == current) {
                    current = null
                    hasV6Default = null
                }
            }
        }
        try {
            cm.registerDefaultNetworkCallback(callback)
            networkCallback = callback
        } catch (_: RuntimeException) {
            // The normal timed retry also works on devices that reject registration.
        }
    }

    internal fun close() {
        networkCallback?.let { callback ->
            val cm = ctx.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
            runCatching { cm.unregisterNetworkCallback(callback) }
        }
        networkCallback = null
        client.dispatcher.cancelAll()
        client.connectionPool.evictAll()
    }
    private class Denied : IOException("接入未获授权")
    private fun request(host:String,path:String,token:String,obj:JSONObject):JSONObject {
        require(host.matches(Regex("[A-Za-z0-9.-]+")))
        val origin="https://"+host+":8443"
        val req=Request.Builder().url(origin+"/peer/"+path).header("Origin",origin)
            .header("Authorization","Bearer "+token)
            .post(obj.toString().toRequestBody("application/json".toMediaType())).build()
        return client.newCall(req).execute().use { if(it.code==403)throw Denied();if(!it.isSuccessful)throw IOException("HTTP "+it.code);JSONObject(it.body!!.string()) }
    }
    fun join(host:String,code:String) {
        check(!ctx.getSharedPreferences("iphone",0).getBoolean("enabled",false))
        val saved=if(prefs.getString("token-host",null)==host)vault.get("peer-token")?.toString(Charsets.UTF_8) else null
        val info=JSONObject().put("code",code).put("protocol",3).put("model",Build.MODEL)
        if(saved!=null) {
            val existing=try { request(host,"link",saved,info) } catch (_:Denied) { null }
            if(existing!=null) {
                awaitApproval(host,saved,info,existing)
                check(prefs.edit().putString("host",host).putBoolean("enabled",true).commit())
                return
            }
            info.put("previous",saved)
        }
        val pending=if(prefs.getString("pending-host",null)==host)vault.get("peer-pending")?.toString(Charsets.UTF_8) else null
        val secret=pending?.takeIf{it!=saved} ?: PrivateStore.token().also{
            vault.put("peer-pending",it.toByteArray())
            check(prefs.edit().putString("pending-host",host).commit())
        }
        awaitApproval(host,secret,info,request(host,"link",secret,info))
        vault.put("peer-token",secret.toByteArray())
        val edit=prefs.edit().putString("host",host).putString("token-host",host)
            .remove("pending-host").putLong("cursor",0).putBoolean("enabled",true)
        if (saved==null || host!=prefs.getString("host",null)) edit.putString("queue-scope",java.util.UUID.randomUUID().toString())
        check(edit.commit())
    }
    private fun awaitApproval(host:String,secret:String,info:JSONObject,first:JSONObject) {
        val deadline=android.os.SystemClock.elapsedRealtime()+180000
        var response=first
        while(response.optString("status")=="pending") {
            check(android.os.SystemClock.elapsedRealtime()<deadline) { "主节点确认已超时" }
            Thread.sleep(12_000)
            response=request(host,"link",secret,info)
        }
        require(response.optString("status")=="ok" || response.optBoolean("ok"))
    }
    suspend fun run(history:SmsHistory, store:PrivateStore, state:(String)->Map<String,String>,present:(String)->Boolean,send:(String,String,String,Int,Long?)->Unit){
        var inspect=emptyList<String>();var failures=0
        val queueScope=prefs.getString("queue-scope","").orEmpty()
        // Migrated clients keep peer:<uuid> and their original receipt table.
        // A different master cannot inspect old jobs or acknowledge old receipts.
        val prefix=if(queueScope.isEmpty())"peer:" else "peer:"+queueScope+":"
        val monitor=me.capcom.smsgateway.modules.directory.DirectoryService.get(ctx).monitor
        val journal=PeerHub.get(ctx)
        while(currentCoroutineContext().isActive && prefs.getBoolean("enabled",false)){
            retry.beginAttempt()
            lastProgress=android.os.SystemClock.elapsedRealtime()
            var catchingUp=false
            try{
                val secret=checkNotNull(vault.get("peer-token")).toString(Charsets.UTF_8)
                val cursor=prefs.getLong("cursor",0)
                val shareSms=prefs.getBoolean("share-sms",true)
                val canRead=shareSms && ContextCompat.checkSelfPermission(ctx,Manifest.permission.READ_SMS)==PackageManager.PERMISSION_GRANTED
                val canSend=shareSms && ContextCompat.checkSelfPermission(ctx,Manifest.permission.SEND_SMS)==PackageManager.PERMISSION_GRANTED
                val batch=if(canRead)history.page(cursor,20,true) else emptyList()
                val sims=JSONObject()
                for(s in SubscriptionsHelper.getActiveSimCards(ctx)){
                    SubscriptionsHelper.getSubscriptionId(ctx,s.simNumber-1)?.let{sims.put(s.simNumber.toString(),it)}
                }
                val states=JSONObject()
                for(id in inspect)states.put(id,state(prefix+id)["state"])
                val receipts=if(queueScope.isEmpty())store.receipts() else journal.clientReceipts(queueScope)
                val payload=JSONObject().put("protocol",3).put("model",Build.MODEL).put("os",Build.VERSION.RELEASE).put("smsAvailable",canSend).put("smsRead",canRead).put("receipts",JSONArray(receipts)).put("slots",sims).put("rows",JSONArray(Gson().toJson(batch))).put("states",states)
                runCatching { me.capcom.smsgateway.modules.voice.VoiceGatewayProbe.detect(ctx) }.onSuccess { voice ->
                    if(voice["installed"]==true)payload.put("voiceAgentVersion",voice["version"])
                }
                val directory=PeerDirectoryAgent(ctx,PrivateStore.hash(secret))
                runCatching { payload.put("directory",directory.prepare()) }
                currentCoroutineContext().ensureActive()
                if(!prefs.getBoolean("enabled",false))return
                val res=request(prefs.getString("host","")!!,"sync",secret,payload)
                currentCoroutineContext().ensureActive()
                if(!prefs.getBoolean("enabled",false))return
                res.optJSONObject("directory")?.let { reply->runCatching { directory.accept(reply) } }
                if(batch.isNotEmpty())prefs.edit().putLong("cursor",batch.last().id.substringAfter(':').toLong()).commit()
                catchingUp=batch.size==20
                val ids=res.getJSONArray("inspect");inspect=(0 until ids.length()).map{ids.getString(it)}
                res.optJSONArray("acked")?.let { acked->
                    val confirmed=(0 until acked.length()).map{acked.getString(it)}.filter{it in receipts}
                    if(queueScope.isEmpty())store.acknowledgeReceipts(confirmed) else journal.confirmClientReceipts(queueScope,confirmed)
                }
                res.optJSONObject("job")?.let { job->
                    val id=job.getString("id");val slot=job.optInt("slot",job.getInt("sim")-100)
                    val address=job.getString("address");val body=job.getString("body")
                    require(id.matches(Regex("[a-fA-F0-9-]{36}")) && slot>0 && address.matches(Regex("\\+?[0-9]{3,20}")) && body.length in 1..2000)
                    currentCoroutineContext().ensureActive()
                    if(!prefs.getBoolean("enabled",false))return
                    val localId=prefix+id;val fingerprint=PrivateStore.hash(address+"|"+slot+"|"+body)
                    val expires=if(job.has("expires"))job.getLong("expires") else null
                    if((!canSend || SubscriptionsHelper.getSubscriptionId(ctx,slot-1)!=job.getInt("sub")) && !present(localId))store.rejectPeer(localId,fingerprint)
                    else store.enqueueOnce(localId,fingerprint,{present(localId)}) {
                        PeerHub.get(ctx).bindSubmission(localId,slot,job.getInt("sub"))
                        send(localId,address,body,slot,expires)
                    }
                    if(queueScope.isEmpty())store.receipt(id) else journal.clientReceipt(queueScope,id)
                }
                failures=0
                failureSince=0
                status="已连接服务器手机 · 本机共享 "+sims.length()+" 条线路"
            }catch(e:Exception){
                if(e is kotlinx.coroutines.CancellationException)throw e
                currentCoroutineContext().ensureActive()
                if(failureSince==0L)failureSince=android.os.SystemClock.elapsedRealtime()
                failures=(failures+1).coerceAtMost(4)
                status="等待连接 · "+e.javaClass.simpleName
            }
            when {
                failures>0 -> retry.waitAfterFailure(failures)
                catchingUp -> delay(100)
                else -> monitor.awaitWork(2000)
            }
        }
    }
    companion object {
        @Volatile var status="等待连接"
        @Volatile var lastProgress=0L
        @Volatile var failureSince=0L
    }
}
