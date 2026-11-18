package me.capcom.smsgateway.modules.iphone

import android.content.Context
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.util.UUID

@RunWith(AndroidJUnit4::class)
class PushConsentMigrationTest {
    @Test fun upgradingKeysNeverEnablesPreviewOrRestoresUnsubscribedDevices() {
        val ctx=InstrumentationRegistry.getInstrumentation().targetContext
        val file="push-fixture-"+UUID.randomUUID()+".db"
        val key=android.util.Base64.decode("BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",android.util.Base64.URL_SAFE)
        val auth=ByteArray(16){it.toByte()}
        val sms=PrivateStore.token();val phone=PrivateStore.token();val other=PrivateStore.token()
        val smsEndpoint="https://fixture.push.apple.com/sms";val phoneEndpoint="https://fixture.push.apple.com/phone"
        try {
            // Minimal real v8 DB, isolated from the installed gateway and all user records.
            ctx.openOrCreateDatabase(file,Context.MODE_PRIVATE,null).use { db ->
                db.execSQL("CREATE TABLE sessions(hash TEXT PRIMARY KEY,name TEXT,expires INTEGER,app TEXT,installation TEXT,grants TEXT)")
                db.execSQL("CREATE TABLE refresh(hash TEXT PRIMARY KEY,owner TEXT,expires INTEGER)")
                db.execSQL("CREATE TABLE subscriptions(endpoint TEXT PRIMARY KEY,owner TEXT,public_key BLOB,auth_key BLOB)")
                db.execSQL("INSERT INTO sessions VALUES(?,?,?,?,?,?)",arrayOf(PrivateStore.hash(sms),"fixture",System.currentTimeMillis()+60000,"sms","sms-fixture","sms.read,device:server"))
                db.execSQL("INSERT INTO sessions VALUES(?,?,?,?,?,?)",arrayOf(PrivateStore.hash(phone),"fixture",System.currentTimeMillis()+60000,"phone","phone-fixture","calls.read,device:server"))
                db.execSQL("INSERT INTO subscriptions VALUES(?,?,?,?)",arrayOf(smsEndpoint,PrivateStore.hash(sms),key,auth))
                db.execSQL("INSERT INTO subscriptions(endpoint,owner) VALUES(?,?)",arrayOf(phoneEndpoint,PrivateStore.hash(phone)))
                db.version=8
            }
            PrivateStore(ctx,file).use { db ->
                assertEquals(9,db.writableDatabase.version)
                assertTrue(db.previewEnabled(sms));assertFalse(db.previewEnabled(phone))
                assertTrue(db.refreshPushKeys(phoneEndpoint,phone,key,auth));assertFalse(db.previewEnabled(phone))
                assertFalse(db.refreshPushKeys(phoneEndpoint,other,key,auth))
                db.disablePreview(sms);assertFalse(db.previewEnabled(sms))
                assertTrue(db.refreshPushKeys(smsEndpoint,sms,key,auth));assertFalse(db.previewEnabled(sms))
                val sub=db.subscriptions("sms","server").single()
                assertFalse(sub.previewEnabled);assertArrayEquals(key,sub.publicKey)
                assertEquals(1,db.subscriptions("phone","server").size)
                assertTrue(db.subscriptions("sms","other-device").isEmpty())
                db.unsubscribe(sms);assertFalse(db.refreshPushKeys(smsEndpoint,sms,key,auth))
                assertTrue(db.subscriptions("sms").isEmpty())
                db.subscribe(smsEndpoint,sms,key,auth,false);assertFalse(db.previewEnabled(sms))
                db.subscribe(smsEndpoint,sms,key,auth,true);assertTrue(db.previewEnabled(sms))
            }
        } finally {ctx.deleteDatabase(file)}
    }
}
