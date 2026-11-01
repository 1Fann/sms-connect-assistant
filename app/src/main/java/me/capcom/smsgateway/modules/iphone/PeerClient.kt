package me.capcom.smsgateway.modules.iphone

import android.content.Context
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
    private fun request(host:String,path:String,token:String,obj:JSONObject):JSONObject {
        require(host.matches(Regex("[A-Za-z0-9.-]+")))
        val origin="https://"+host+":8443"
        val req=Request.Builder().url(origin+"/peer/"+path).header("Origin",origin)
            .header("Authorization","Bearer "+token)
            .post(obj.toString().toRequestBody("application/json".toMediaType())).build()
        return client.newCall(req).execute().use { if(!it.isSuccessful)throw IOException("HTTP "+it.code);JSONObject(it.body!!.string()) }
    }
    fun join(host:String,code:String) {
        check(!ctx.getSharedPreferences("iphone",0).getBoolean("enabled",false))
        val saved=if(prefs.getString("token-host",null)==host)vault.get("peer-token")?.toString(Charsets.UTF_8) else null
        val secret=saved?:PrivateStore.token().also{
            vault.put("peer-token",it.toByteArray())
            check(prefs.edit().putString("token-host",host).commit())
        }
        request(host,"link",secret,JSONObject().put("code",code))
        prefs.edit().putString("host",host).putLong("cursor",0).putBoolean("enabled",true).commit()
    }
    suspend fun run(history:SmsHistory, store:PrivateStore, state:(String)->Map<String,String>,present:(String)->Boolean,send:(String,String,String,Int,Long?)->Unit){
        var inspect=emptyList<String>();var failures=0
        while(currentCoroutineContext().isActive && prefs.getBoolean("enabled",false)){
            lastProgress=android.os.SystemClock.elapsedRealtime()
            var catchingUp=false
            try{
                val secret=checkNotNull(vault.get("peer-token")).toString(Charsets.UTF_8)
                val cursor=prefs.getLong("cursor",0)
                val batch=history.page(cursor,20,true)
                val sims=JSONObject()
                for(s in SubscriptionsHelper.getActiveSimCards(ctx)){
                    SubscriptionsHelper.getSubscriptionId(ctx,s.simNumber-1)?.let{sims.put(s.simNumber.toString(),it)}
                }
                val states=JSONObject()
                for(id in inspect)states.put(id,state("peer:"+id)["state"])
                val receipts=store.receipts()
                val payload=JSONObject().put("protocol",2).put("receipts",JSONArray(receipts)).put("slots",sims).put("rows",JSONArray(Gson().toJson(batch))).put("states",states)
                val res=request(prefs.getString("host","")!!,"sync",secret,payload)
                if(batch.isNotEmpty())prefs.edit().putLong("cursor",batch.last().id.substringAfter(':').toLong()).commit()
                catchingUp=batch.size==20
                val ids=res.getJSONArray("inspect");inspect=(0 until ids.length()).map{ids.getString(it)}
                res.optJSONArray("acked")?.let { acked->store.acknowledgeReceipts((0 until acked.length()).map{acked.getString(it)}.filter{it in receipts}) }
                res.optJSONObject("job")?.let { job->
                    val id=job.getString("id");val slot=job.getInt("sim")-100
                    val address=job.getString("address");val body=job.getString("body")
                    require(id.matches(Regex("[a-fA-F0-9-]{36}")) && slot in 1..4 && address.matches(Regex("\\+?[0-9]{3,20}")) && body.length in 1..2000)
                    currentCoroutineContext().ensureActive()
                    if(!prefs.getBoolean("enabled",false))return
                    val localId="peer:"+id;val fingerprint=PrivateStore.hash(address+"|"+slot+"|"+body)
                    val expires=if(job.has("expires"))job.getLong("expires") else null
                    if(SubscriptionsHelper.getSubscriptionId(ctx,slot-1)!=job.getInt("sub") && !present(localId))store.rejectPeer(localId,fingerprint)
                    else store.enqueueOnce(localId,fingerprint,{present(localId)}) { send(localId,address,body,slot,expires) }
                    store.receipt(id)
                }
                failures=0;status="已连接服务器手机 · 本机共享 "+sims.length()+" 条线路"
            }catch(e:Exception){if(e is kotlinx.coroutines.CancellationException)throw e;failures=(failures+1).coerceAtMost(4);status="等待连接 · "+e.javaClass.simpleName}
            delay(if(catchingUp && failures==0)100 else 2000L*(1 shl failures))
        }
    }
    companion object { @Volatile var status="等待连接";@Volatile var lastProgress=0L }
}
