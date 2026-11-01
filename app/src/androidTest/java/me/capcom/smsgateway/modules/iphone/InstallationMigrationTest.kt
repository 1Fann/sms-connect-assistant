package me.capcom.smsgateway.modules.iphone

import android.content.Context
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.util.UUID

@RunWith(AndroidJUnit4::class)
class InstallationMigrationTest {
    @Test fun legacySessionRotatesWithoutLosingUnknownRequestOrSmsPush() {
        val ctx=InstrumentationRegistry.getInstrumentation().targetContext
        val file="fixture-"+UUID.randomUUID()+".db"
        val old=PrivateStore.token()
        val until=System.currentTimeMillis()+3600000
        try {
            ctx.openOrCreateDatabase(file, Context.MODE_PRIVATE,null).use { db ->
                db.execSQL("CREATE TABLE sessions(hash TEXT PRIMARY KEY,name TEXT NOT NULL,expires INTEGER NOT NULL)")
                db.execSQL("CREATE TABLE refresh(hash TEXT PRIMARY KEY,owner TEXT NOT NULL,expires INTEGER NOT NULL)")
                db.execSQL("CREATE TABLE subscriptions(endpoint TEXT PRIMARY KEY,owner TEXT NOT NULL,public_key BLOB,auth_key BLOB)")
                db.execSQL("CREATE TABLE conversations(address TEXT PRIMARY KEY,pinned INTEGER,removed_before INTEGER,unread INTEGER,muted INTEGER,region TEXT)")
                db.execSQL("CREATE TABLE reads(address TEXT PRIMARY KEY,seen INTEGER)")
                db.execSQL("INSERT INTO conversations VALUES('fixture',1,0,0,1,'CN')")
                db.execSQL("CREATE TABLE requests(id TEXT PRIMARY KEY,fingerprint TEXT,created INTEGER,generation INTEGER,rejected INTEGER)")
                db.execSQL("CREATE TABLE submissions(id TEXT,phone TEXT,PRIMARY KEY(id,phone))")
                db.execSQL("INSERT INTO sessions VALUES(?,?,?)",arrayOf(PrivateStore.hash(old),"fixture",until))
                db.execSQL("INSERT INTO subscriptions(endpoint,owner) VALUES(?,?)",arrayOf("fixture-sms",PrivateStore.hash(old)))
                db.execSQL("INSERT INTO requests VALUES('fixture','fingerprint',1,1,0)")
                db.execSQL("INSERT INTO submissions VALUES('fixture','fixture-recipient')")
                db.version=7
            }
            PrivateStore(ctx,file).use { db ->
                val sms=requireNotNull(db.install(old,"sms"))
                assertTrue(sms.allows("sms.send"));assertEquals(setOf("server","peer"),sms.nodes())
                assertNull(db.install(old,"phone"));assertTrue(db.subscriptions("phone","server").isEmpty())
                val refresh=db.issueRefresh(old)
                assertNull(db.rotate(refresh,"phone"))
                val access=requireNotNull(db.rotate(refresh,"sms")).first
                assertEquals(sms.installation,db.install(access,"sms")?.installation)
                assertEquals(1,db.subscriptions("sms","peer").size);assertTrue(db.subscriptions("sms","new-device").isEmpty())
                val a=PrivateStore.smsScope("device:server")
                val b=PrivateStore.smsScope("device:peer")
                assertTrue(db.scopedStates(a).single().muted)
                db.updateConversation("fixture","unmute","CN",a)
                assertFalse(db.scopedStates(a).single().muted);assertTrue(db.scopedStates(b).single().muted)
                db.markScopedRead(a,"fixture",24);db.markScopedRead(a,"fixture",10)
                assertEquals(24L,db.scopedReadTimes(a)["fixture"]);assertTrue(db.scopedReadTimes(b).isEmpty())
                assertFalse(db.claimSubmission("fixture","fixture-recipient"))
                db.enqueueOnce("fixture","fingerprint",{false}){fail("Ambiguous legacy SMS was retried")}
                val phone=PrivateStore.token()
                db.authorize(phone,PrivateStore.Install("fixture","phone","install-2","calls.read,device:new-device"))
                db.writableDatabase.execSQL("INSERT INTO subscriptions(endpoint,owner) VALUES(?,?)",arrayOf("fixture-phone",PrivateStore.hash(phone)))
                assertEquals(1,db.subscriptions("phone","new-device").size)
                assertTrue(db.subscriptions("phone","server").isEmpty())
                db.revokeInstallation("install-2");assertNull(db.install(phone,"phone"));assertNotNull(db.install(access,"sms"))
                assertEquals(1,db.subscriptions("sms","server").size)
            }
        } finally {ctx.deleteDatabase(file)}
    }
}
