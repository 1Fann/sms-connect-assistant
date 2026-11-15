// Local synthetic session responses only. No device, credentials or SMS sending.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'../../app/src/main/assets/iphone');
const server=http.createServer((req,res)=>{
 const pathname=new URL(req.url,'http://localhost').pathname;
 const file=path.resolve(root,'.'+(pathname.endsWith('/')?pathname+'index.html':pathname));
 if(!file.startsWith(root+path.sep))return res.writeHead(403).end();
 try{res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(fs.readFileSync(file))}catch{res.writeHead(404).end()}
});

async function testPhoneStartup(browser){
 const url='http://127.0.0.1:'+server.address().port+'/phone/';
 for(const scenario of ['ready','offline','expired','missed']){
  const page=await browser.newPage({serviceWorkers:'block',viewport:{width:390,height:844}});
  try{
   await page.addInitScript(()=>{
    window.phonePairAppeared=false;window.phoneKeypadAppeared=false;
    new MutationObserver(()=>{
     window.phonePairAppeared ||= !!document.querySelector('.pair');
     window.phoneKeypadAppeared ||= !!document.querySelector('.dialer-screen:not([hidden] *)');
    }).observe(document,{subtree:true,childList:true,attributes:true});
   });
   let release;
   const gate=new Promise(resolve=>{release=resolve});
   let reads=0;
   await page.route('**/api/**',async route=>{
    const pathname=new URL(route.request().url()).pathname;
    const reply=(data,status=200)=>route.fulfill({status,json:data});
    if(pathname==='/api/v2/startup'){
     if(++reads===1){
      await gate;
      if(scenario==='offline')return reply({},503);
      if(scenario==='expired')return reply({},401);
     }
     return reply({
      session:{installationId:'test-phone',permissions:['calls.dial','calls.read']},
      devices:[],
      lines:[{lineId:'fixture-line',deviceId:'server',name:'测试线路',slot:1,online:true,confirmed:true}],
      routes:[{lineId:'fixture-line',prefix:'*81*'}],
     });
    }
    if(pathname==='/api/refresh')return reply({},401);
    if(pathname==='/api/v2/call-history/missed')return reply({count:0});
    if(pathname==='/api/v2/call-history')return reply({items:[],next:null});
    if(pathname==='/api/v2/voice/history')return reply([]);
    throw Error('Unexpected fixture request '+pathname);
   });
   await page.goto(url+(scenario==='missed'?'#missed':''),{waitUntil:'domcontentloaded'});
   const loading=page.locator('main[aria-busy="true"]');
   await loading.waitFor();
   assert.equal(await page.locator('.pair').count(),0);
   const keypad=page.locator('.keypad'),dock=page.locator('.phone-dock');
   let keypadBefore,dockBefore;
   if(scenario==='missed'){
    assert.equal(await page.locator('.dialer-screen, .phone-dock').count(),0);
   }else{
    keypadBefore=await keypad.boundingBox();dockBefore=await dock.boundingBox();
    assert.ok(keypadBefore&&dockBefore,'The final layout renders during the live startup request');
    assert.ok(await loading.evaluate(el=>el.inert));
    assert.ok(await dock.evaluate(el=>el.inert));
    assert.equal(await page.locator('.dial').getAttribute('href'),null);
    assert.equal(await page.getByText('原选线路不可用').count(),0);
    await keypad.evaluate(el=>{window.initialKeypad=el});
   }
   release();
   if(scenario==='expired'){
    await page.getByLabel('配对码').waitFor();
    assert.equal(await page.locator('.dialer-screen').count(),0);
   }else{
    if(scenario==='offline'){
     await page.getByRole('button',{name:'重新连接'}).click();
    }
    await page.getByRole('navigation',{name:'电话导航'}).waitFor();
    assert.equal(await loading.count(),0);
    assert.equal(await page.evaluate(()=>window.phonePairAppeared),false);
    if(scenario==='missed'){
     assert.equal(await page.getByRole('button',{name:'通话',exact:true}).getAttribute('aria-current'),'page');
     assert.equal(await page.evaluate(()=>window.phoneKeypadAppeared),false);
    }else{
     if(scenario==='ready'){
      assert.ok(await keypad.evaluate(el=>el===window.initialKeypad),'The same keypad stays mounted after startup');
      assert.deepEqual(await keypad.boundingBox(),keypadBefore);
      assert.deepEqual(await dock.boundingBox(),dockBefore);
     }
     await page.getByLabel('拨出线路').selectOption('fixture-line');
     assert.equal(await page.getByLabel('拨出线路').inputValue(),'fixture-line');
    }
   }
  }finally{await page.close()}
 }
}
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({headless:true,channel:process.env.BROWSER_CHANNEL||'msedge'});
 try{
  for(const scenario of ['valid','expired','network','empty']){
   const context=await browser.newContext({serviceWorkers:'block',viewport:{width:390,height:844}});
   await context.addInitScript(()=>{
    window.pairAppeared=false;window.removedAppeared=false;window.loadingAppeared=false;window.falseEmptyAppeared=false;
    const observeStartup=()=>{
     const text=document.body?.textContent||'';
     if(text.includes('正在载入…'))window.loadingAppeared=true;
     if(document.querySelector('.list-view > .empty')?.textContent.includes('还没有信息'))window.falseEmptyAppeared=true;
    };
    new MutationObserver(observeStartup).observe(document,{childList:true,subtree:true,characterData:true});
    new MutationObserver(()=>{if(document.querySelector('.pair'))window.pairAppeared=true;if(document.body?.textContent.includes('Removed fixture'))window.removedAppeared=true}).observe(document,{childList:true,subtree:true});
   });
   const requests=[];
   const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
   let release;const gate=new Promise(resolve=>release=resolve);
   let session=scenario==='network'?'offline':scenario==='expired'?'expired':'valid',statusReads=0,sends=0;
   await context.route('**/api/**',async route=>{
    const key=new URL(route.request().url()).pathname.slice(5);let status=200,data={};
    requests.push(key);
    if(key==='history'&&new URL(route.request().url()).searchParams.get('startup')==='1'){
     statusReads++;if(statusReads===1)await gate;
     if(session==='offline')status=503;else if(session==='expired')status=401;
     else data={items:[{id:'sms:1',address:'+15550100001',body:'Synthetic startup fixture',date:1,incoming:true,read:true,state:'received'}],next:null,conversations:[{address:'+16502530000',pinned:0,removedBefore:100,unread:false}]};
     if(status===200)data.items.push({id:'sms:2',address:'+16502530000',body:'Removed fixture',date:1,incoming:true,read:true,state:'received'});
     if(scenario==='empty'&&status===200)data.items=[];
    }else if(key==='refresh')status=401;
    else if(session==='expired')status=401;
    else if(key==='history')data={items:[{id:'sms:1',address:'+15550100001',body:'Synthetic startup fixture',date:1,incoming:true,read:true,state:'received'}],next:null};
    else if(['conversations','outgoing','sims','phones'].includes(key))data=[];
    else if(key==='send'){sends++;return route.abort()}
    else if(key==='read')data={};
    else throw Error('Unexpected fixture path '+key);
    await route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
   });
   await page.goto('http://127.0.0.1:'+server.address().port,{waitUntil:'domcontentloaded'});
   await page.getByRole('region',{name:'正在连接手机'}).waitFor();
   assert.equal(await page.locator('.pair').count(),0);
   assert.equal(await page.getByText('Synthetic startup fixture',{exact:true}).count(),0);
   for(let i=0;i<40&&!requests.length;i++)await new Promise(resolve=>setTimeout(resolve,25));
   assert.deepEqual(requests,['history'],'One live authenticated request before startup data arrives');
   release();
   if(scenario==='expired'){
    await page.getByLabel('安卓显示的配对码').waitFor();
    assert.equal(await page.getByText('Synthetic startup fixture',{exact:true}).count(),0);
   }else{
    if(scenario==='network'){
     await page.getByRole('button',{name:'重新连接',exact:true}).waitFor();
     assert.equal(await page.locator('.pair').count(),0);
     assert.equal(await page.getByText('Synthetic startup fixture',{exact:true}).count(),0);
     session='valid';await page.getByRole('button',{name:'重新连接',exact:true}).click();
    }
    if(scenario==='empty')await page.locator('.list-view > .empty').filter({hasText:'还没有信息'}).waitFor();
    else await page.getByText('Synthetic startup fixture',{exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>window.pairAppeared),false,'Valid/retried sessions must never mount a pairing form');
    assert.equal(await page.evaluate(()=>window.removedAppeared),false,'Startup removal metadata must apply before rendering rows');
    assert.equal(await page.evaluate(()=>window.loadingAppeared),false,'Startup must enter the prepared inbox without a second loading screen');
    if(scenario!=='empty')assert.equal(await page.evaluate(()=>window.falseEmptyAppeared),false,'A populated inbox must not flash an empty state');
    session='expired';await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
    await page.getByLabel('安卓显示的配对码').waitFor();
    assert.equal(await page.getByText('Synthetic startup fixture',{exact:true}).count(),0);
   }
   assert.equal(sends,0);assert.deepEqual(errors,[]);await context.close();
  }
  await testPhoneStartup(browser);
  console.log('PASS Messages and Phone startup: no pairing flash, live data, expiry, network retry and direct missed-call entry');
 }finally{await browser.close();server.close()}
})().catch(e=>{console.error(e);server.close();process.exitCode=1});
