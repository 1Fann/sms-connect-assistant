// Local synthetic session responses only. No device, credentials or SMS sending.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'../../app/src/main/assets/iphone');
const server=http.createServer((req,res)=>{
 const file=path.resolve(root,'.'+(req.url==='/'?'/index.html':req.url.split('?')[0]));
 if(!file.startsWith(root+path.sep))return res.writeHead(403).end();
 try{res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(fs.readFileSync(file))}catch{res.writeHead(404).end()}
});
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({headless:true,channel:process.env.BROWSER_CHANNEL||'msedge'});
 try{
  for(const scenario of ['valid','expired','network']){
   const context=await browser.newContext({serviceWorkers:'block',viewport:{width:390,height:844}});
   await context.addInitScript(()=>{
    window.pairAppeared=false;window.removedAppeared=false;
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
    await page.getByText('Synthetic startup fixture',{exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>window.pairAppeared),false,'Valid/retried sessions must never mount a pairing form');
    assert.equal(await page.evaluate(()=>window.removedAppeared),false,'Startup removal metadata must apply before rendering rows');
    session='expired';await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
    await page.getByLabel('安卓显示的配对码').waitFor();
    assert.equal(await page.getByText('Synthetic startup fixture',{exact:true}).count(),0);
   }
   assert.equal(sends,0);assert.deepEqual(errors,[]);await context.close();
  }
  console.log('PASS pending session has no pairing flash or message exposure, valid login, expiry, network retry and revocation; zero sends');
 }finally{await browser.close();server.close()}
})().catch(e=>{console.error(e);server.close();process.exitCode=1});
