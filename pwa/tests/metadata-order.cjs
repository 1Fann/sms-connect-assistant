// Local synthetic gateway: exercises metadata ordering and avatar rollback only.
// No phone connection, real contacts, notification service, or SMS sends.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'../../app/src/main/assets/iphone');
const server=http.createServer((req,res)=>{
 const name=new URL(req.url,'http://localhost').pathname;
 const file=path.resolve(root,'.'+(name==='/'?'/index.html':decodeURIComponent(name)));
 if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return}
 try{res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(fs.readFileSync(file))}catch{res.writeHead(404).end()}
});
function deferred(){let resolve;const promise=new Promise(done=>{resolve=done});return {promise,resolve}}
const addresses={a:'+12025550101',b:'+12025550102',c:'+12025550103'};
const names={a:'合成自动已读 A',b:'合成置顶 B',c:'合成失败回退 C'};

(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const origin='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({headless:true,channel:process.env.BROWSER_CHANNEL||'msedge'});
 const readArrived=deferred(),readGate=deferred(),failureArrived=deferred(),failureGate=deferred();
 try{
  const page=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true,serviceWorkers:'block'});
  page.setDefaultTimeout(10000);
  // Sample both the real avatar and the visual clone at every rendered frame.
  // An absent clone is fine only when the real avatar has already been restored.
  await page.addInitScript(()=>{
   const trace=window.__avatarTrace={active:false,key:'',samples:[]};
   function visible(el){if(!el?.isConnected)return false;const style=getComputedStyle(el),box=el.getBoundingClientRect();return Number(style.opacity)>.1&&style.visibility!=='hidden'&&style.display!=='none'&&box.width>0&&box.height>0}
   function tick(time){
    if(trace.active){
     const target=[...document.querySelectorAll('[data-motion-key]')].find(el=>el.dataset.motionKey===trace.key);
     const ghost=[...document.querySelectorAll('[data-motion-ghost]')].find(el=>el.dataset.motionGhost===trace.key);
     trace.samples.push({time,kind:target?.dataset.motionKind||'missing',target:visible(target?.querySelector('.avatar')),ghost:visible(ghost),ghostPresent:!!ghost});
    }
    requestAnimationFrame(tick);
   }
   requestAnimationFrame(tick);
  });
  const errors=[],violations=[],posts=[];
  page.on('pageerror',e=>errors.push(e.message));
  const states=new Map(Object.entries(addresses).map(([key,address])=>[address,{address,pinned:0,removedBefore:0,unread:key==='a',muted:key==='c',region:'CN'}]));
  const rows=Object.entries(addresses).map(([key,address],i)=>({id:'sms:'+(100-i),address,name:names[key],body:'本地合成信息，仅验证动画和会话状态，不发送短信。',date:Date.now()-(i+1)*60000,incoming:true,read:true,sim:1,state:'received'}));
  const snapshot=()=>[...states.values()].map(s=>({...s}));
  let activeWrites=0,maxConcurrentWrites=0,failedPins=0;
  await page.route('**/*',async route=>{
   if(new URL(route.request().url()).origin!==origin){violations.push('external request blocked');await route.abort('blockedbyclient')}
   else await route.continue();
  });
  await page.route('**/api/**',async route=>{
   const p=new URL(route.request().url()).pathname,method=route.request().method();let data={};
   if(p==='/api/history')data={items:rows,next:null};
   else if(p==='/api/outgoing'||p==='/api/contacts')data=[];
   else if(p==='/api/phones')data=[{id:'server',name:'测试主机'}];
   else if(p==='/api/sims')data=[{id:1,name:'合成线路',phoneId:'server',phoneName:'测试主机',slot:1,simName:'合成线路',online:true}];
   else if(p==='/api/conversations'&&method==='GET')data=snapshot();
   else if(p==='/api/conversations'&&method==='POST'){
    const {address,action}=route.request().postDataJSON();
    assert.ok(Object.values(addresses).includes(address),'metadata writes must only address the synthetic fixture');
    posts.push({address,action});activeWrites++;maxConcurrentWrites=Math.max(maxConcurrentWrites,activeWrites);
    try{
     const next={...states.get(address)};
     if(address===addresses.a&&action==='read'){
      next.unread=false;states.set(address,next);
      // Freeze the response now: allowing B's write to pass this blocked POST
      // would make this old full snapshot erase B's optimistic/server state.
      data=snapshot();readArrived.resolve();await readGate.promise;
     }else if(address===addresses.c&&action==='pin'){
      failedPins++;failureArrived.resolve();await failureGate.promise;
      await route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({error:'合成测试：置顶保存失败'})});return;
     }else{
      if(address===addresses.b&&action==='pin')next.pinned=Date.now();
      else if(address===addresses.c&&action==='unmute')next.muted=false;
      else {violations.push('unexpected metadata action '+action);await route.fulfill({status:405,contentType:'application/json',body:'{"error":"Unsupported synthetic action"}'});return}
      states.set(address,next);data=snapshot();
     }
     await route.fulfill({contentType:'application/json',body:JSON.stringify(data)});return;
    }finally{activeWrites--}
   }else if(p==='/api/read'&&method==='POST'){
    assert.equal(route.request().postDataJSON().address,addresses.a,'only opening synthetic A may mark history read');
   }else if(p!=='/api/status'){
    violations.push('unexpected API '+p);await route.fulfill({status:405,contentType:'application/json',body:'{"error":"No real messages or SMS sends are permitted"}'});return;
   }
   await route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
  });
  const row=key=>page.locator('.conversation').filter({has:page.getByText(names[key],{exact:true})});
  const pin=key=>page.getByRole('button',{name:names[key]+'，已置顶',exact:true});
  async function context(key){
   await page.locator('dialog[open]').waitFor({state:'hidden'});
   await row(key).click({button:'right'});
   await page.getByRole('dialog',{name:'对话操作'}).waitFor();
   await page.waitForFunction(()=>getComputedStyle(document.querySelector('.conversation-preview')).transform==='none');
  }
  await page.goto(origin);await row('a').waitFor();
  assert.match(await row('a').getAttribute('aria-label'),/未读/);
  await row('a').click();
  await Promise.race([readArrived.promise,page.waitForTimeout(8000).then(()=>{throw Error('automatic read metadata POST did not arrive')})]);
  await page.getByLabel('返回信息列表',{exact:true}).click();await page.locator('.chat-page').waitFor({state:'detached'});
  await context('b');await page.getByRole('button',{name:'置顶',exact:true}).click();
  await page.waitForTimeout(180);
  assert.deepEqual(posts,[{address:addresses.a,action:'read'}],'B must wait for the automatic-read POST instead of racing a full-snapshot response');
  assert.equal(await pin('b').count(),0,'queued optimism must wait too, so the older read snapshot cannot roll it back');
  readGate.resolve();
  await pin('b').waitFor();
  await page.waitForTimeout(450);
  assert.deepEqual(posts,[{address:addresses.a,action:'read'},{address:addresses.b,action:'pin'}]);
  assert.equal(maxConcurrentWrites,1,'automatic read and user metadata updates must use one write queue');
  assert.ok(states.get(addresses.b).pinned>0);assert.equal(states.get(addresses.a).unread,false);
  assert.doesNotMatch(await row('a').getAttribute('aria-label'),/未读/);
  assert.equal(await pin('b').count(),1,'B must stay pinned after the delayed read response has settled');

  await context('c');
  await page.evaluate(key=>{const t=window.__avatarTrace;t.key=key;t.samples=[];t.active=true},addresses.c);
  await page.getByRole('button',{name:'置顶',exact:true}).click();
  await Promise.race([failureArrived.promise,page.waitForTimeout(8000).then(()=>{throw Error('failing pin POST did not arrive')})]);
  await page.waitForFunction(key=>{
   const target=[...document.querySelectorAll('[data-motion-key]')].find(el=>el.dataset.motionKey===key);
   const ghost=[...document.querySelectorAll('[data-motion-ghost]')].find(el=>el.dataset.motionGhost===key);
   return target?.dataset.motionKind==='pin'&&getComputedStyle(target.querySelector('.avatar')).opacity==='0'&&ghost?.getAnimations().some(a=>a.playState==='running');
  },addresses.c);
  // Two actual frames establish that the forward animation is still running.
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  failureGate.resolve();
  await page.getByRole('alert').first().waitFor();
  await page.waitForFunction(key=>{
   const target=[...document.querySelectorAll('[data-motion-key]')].find(el=>el.dataset.motionKey===key);
   const ghost=[...document.querySelectorAll('[data-motion-ghost]')].find(el=>el.dataset.motionGhost===key);
   return target?.dataset.motionKind==='row'&&!!ghost;
  },addresses.c);
  await page.waitForTimeout(500);
  const samples=await page.evaluate(()=>{window.__avatarTrace.active=false;return window.__avatarTrace.samples});
  const forward=samples.filter(s=>s.kind==='pin'&&s.ghostPresent),rollback=samples.filter(s=>s.kind==='row'&&s.ghostPresent);
  assert.ok(forward.length>=2,'fixture must observe the forward pin flight before failure');
  assert.ok(rollback.length>=2,'fixture must observe the interrupted reverse flight, not only its final state');
  assert.ok(rollback[0].time-forward[0].time<380,'failure must interrupt the original 380 ms flight');
  assert.deepEqual(samples.filter(s=>!s.target&&!s.ghost),[],'every animation frame must show either the real avatar or its visible flight clone');
  assert.ok(rollback.every(s=>s.ghost),'rollback flight clones must not inherit the hidden target opacity');
  assert.equal(await page.locator('[data-motion-ghost]').count(),0,'finished animations must remove all cloned avatars');
  assert.equal(await row('c').locator('.avatar').evaluate(el=>getComputedStyle(el).opacity),'1','rollback must restore the real avatar');
  assert.equal(await pin('c').count(),0,'failed optimism must restore C as an ordinary conversation');
  assert.equal(await pin('b').count(),1,'rollback of C must preserve B');
  assert.match(await row('c').getAttribute('aria-label'),/已隐藏提醒/,'rollback must restore C metadata beyond the pin field');
  assert.equal(states.get(addresses.c).pinned,0);assert.equal(states.get(addresses.c).muted,true);assert.equal(failedPins,1);

  // A failure must release the queue so a subsequent deliberate action works.
  await page.getByLabel('关闭提示',{exact:true}).click();
  await context('c');await page.getByRole('button',{name:'显示提醒',exact:true}).click();
  await page.getByRole('button',{name:names.c,exact:true}).waitFor();
  assert.equal(states.get(addresses.c).muted,false);assert.equal(maxConcurrentWrites,1);
  assert.deepEqual(posts.map(p=>p.action),['read','pin','pin','unmute']);
  assert.deepEqual(violations,[]);assert.deepEqual(errors,[]);
  console.log('PASS serialized delayed automatic-read + pin, no stale snapshot overwrite, failed pin rollback with a visible avatar on every sampled frame, clone cleanup, preserved independent metadata, queue continues after rejection; zero SMS sends');
  console.log('Synthetic avatar observation: '+JSON.stringify({samples:samples.length,forwardFrames:forward.length,rollbackFrames:rollback.length,rollbackAfterMs:Math.round(rollback[0].time-forward[0].time),maxConcurrentWrites}));
 }finally{readGate.resolve();failureGate.resolve();await browser.close();server.close()}
})().catch(e=>{console.error(e);server.close();process.exitCode=1});
