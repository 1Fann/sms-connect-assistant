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
   var count=0
   provider.scanContacts(emptyMap()){_,_,record->if(record!=null)count++}
   assertTrue("Expected existing Android contacts",count>0)
   instrumentation.sendStatus(0,android.os.Bundle().apply{putInt("contactSourcesRead",count);putString("probe","read-only; no content logged")})
  }finally{prefs.edit().putBoolean("contacts.read",previous).commit()}
 }
}
