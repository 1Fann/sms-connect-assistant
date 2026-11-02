package me.capcom.smsgateway.modules.directory

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith

/** Explicit opt-in diagnostic: read real Android contacts, count only, never write or log contents. */
@RunWith(AndroidJUnit4::class)
class NativeReadDeviceTest {
 @Test fun canReadActualProviderWithoutModifyingContacts(){
  val instrumentation=InstrumentationRegistry.getInstrumentation()
  assumeTrue(InstrumentationRegistry.getArguments().getString("allowReadOnlyContactProbe")=="true")
  val ctx=instrumentation.targetContext
  check(ctx.packageName.endsWith(".commlinkfixture"))
  val prefs=ctx.getSharedPreferences("directory-consent",0)
  val previous=prefs.getBoolean("contacts.read",false)
  try{
   prefs.edit().putBoolean("contacts.read",true).commit()
   val provider=DirectoryProvider(ctx)
   assertTrue("Read permission required",provider.allowed("contacts.read"))
   val stamps=mutableMapOf<String,String>()
   val started=android.os.SystemClock.elapsedRealtime()
   provider.scanContacts(emptyMap()){raw,stamp,record->if(record!=null)stamps[raw]=stamp}
   val first=android.os.SystemClock.elapsedRealtime()
   assertTrue("Expected existing Android contacts",stamps.isNotEmpty())
   var unchanged=0
   provider.scanContacts(stamps){_,_,record->if(record==null)unchanged++}
   val end=android.os.SystemClock.elapsedRealtime()
   assertTrue("Contacts changed during read-only measurement",unchanged==stamps.size)
   instrumentation.sendStatus(0,android.os.Bundle().apply{
    putInt("contactSourcesRead",stamps.size);putLong("initialReadMs",first-started)
    putLong("unchangedReadMs",end-first);putString("probe","read-only; no content logged")
   })
  }finally{prefs.edit().putBoolean("contacts.read",previous).commit()}
 }
}
