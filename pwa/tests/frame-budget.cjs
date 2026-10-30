// Synthetic performance/gesture regression. All API traffic is mocked locally;
// no phone, SMS, real contacts, clipboard, or notification service is accessed.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'../../app/src/main/assets/iphone');
const server=http.createServer((req,res)=>{
 const name=new URL(req.url,'http://localhost').pathname;
 const file=path.resolve(root,'.'+(name==='/'?'/index.html':decodeURIComponent(name)));
 if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return}
 try{res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(fs.readFileSync(file))}catch{res.writeHead(404).end()}
});

function fixture(){
 const now=Date.now(),rows=[],longAddress='+12025550100';
 for(let i=0;i<200;i++)rows.push({address:longAddress,name:'长会话压力测试',body:`合成测试信息 ${i+1}：拖动查看时间，不会发送短信。`,date:now-120*60000-(199-i)*20000,incoming:i%3!==0,read:true,sim:1,state:i%3!==0?'received':'sent'});
 for(let thread=1;thread<=80;thread++)for(let i=0;i<10;i++)rows.push({address:'+120255501'+String(thread).padStart(2,'0'),name:`合成会话 ${String(thread).padStart(2,'0')}`,body:`合成列表内容 ${thread}/${i+1}`,date:now-thread*180000-(9-i)*1000,incoming:true,read:true,sim:1,state:'received'});
 return rows.sort((a,b)=>a.date-b.date).map((m,i)=>({...m,id:'sms:'+(i+1)})).reverse();
}
const percentile=(values,p)=>{const sorted=[...values].sort((a,b)=>a-b);return sorted.length?Math.round(sorted[Math.min(sorted.length-1,Math.floor(sorted.length*p))]*100)/100:null};

(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const origin='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({headless:true,channel:process.env.BROWSER_CHANNEL||'msedge'});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true,serviceWorkers:'block'});
  page.setDefaultTimeout(10000);
  await page.addInitScript(()=>{
   const metrics=window.__motionMetrics={commits:0,renderers:0,record:false,frames:[],longTasks:[]};
   window.__REACT_DEVTOOLS_GLOBAL_HOOK__={supportsFiber:true,inject(){return ++metrics.renderers},onCommitFiberRoot(){metrics.commits++},onCommitFiberUnmount(){},onPostCommitFiberRoot(){},checkDCE(){}};
   let previous=0;
   function tick(time){if(metrics.record&&previous)metrics.frames.push(time-previous);previous=time;requestAnimationFrame(tick)}
   requestAnimationFrame(tick);
   if(typeof PerformanceObserver!=='undefined'&&PerformanceObserver.supportedEntryTypes.includes('longtask'))new PerformanceObserver(list=>{if(metrics.record)metrics.longTasks.push(...list.getEntries().map(e=>e.duration))}).observe({type:'longtask',buffered:false});
  });
  const errors=[],violations=[],rows=fixture();let reads=0,historyRequests=0,mutations=0;
  page.on('pageerror',e=>errors.push(e.message));
  // Last-registered API interception takes priority over this network guard.
  await page.route('**/*',async route=>{if(new URL(route.request().url()).origin!==origin){violations.push('external request blocked');await route.abort('blockedbyclient')}else await route.continue()});
  await page.route('**/api/**',async route=>{
   const url=new URL(route.request().url()),p=url.pathname;let data={};
   if(p==='/api/history'){
    historyRequests++;const before=Number(url.searchParams.get('before')||Number.MAX_SAFE_INTEGER),available=rows.filter(m=>Number(m.id.slice(4))<before),items=available.slice(0,200);
    data={items,next:available.length>200?items.at(-1).id.slice(4):null};
   }else if(p==='/api/outgoing'||p==='/api/contacts'||p==='/api/conversations'&&route.request().method()==='GET')data=[];
   else if(p==='/api/sims')data=[{id:1,name:'测试线路'}];
   else if(p==='/api/read')reads++;
   else if(p!=='/api/status'){
    mutations++;violations.push('unexpected API '+p);await route.fulfill({status:405,contentType:'application/json',body:JSON.stringify({error:'This regression test never sends or mutates messages'})});return;
   }
   await route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
  });
  const cdp=await page.context().newCDPSession(page);
  async function touch(type,points=[]){await cdp.send('Input.dispatchTouchEvent',{type,touchPoints:points})}
  async function swipe(locator,dx,dy=0,steps=8,pause=12,ensureVisible=true){
   if(ensureVisible)await locator.scrollIntoViewIfNeeded();const b=await locator.boundingBox(),x=Math.max(20,Math.min(350,b.x+b.width*.58)),y=b.y+b.height*.5;
   await touch('touchStart',[{x,y}]);
   for(let i=1;i<=steps;i++){await touch('touchMove',[{x:x+dx*i/steps,y:y+dy*i/steps}]);if(pause)await page.waitForTimeout(pause)}
   await touch('touchEnd');
  }
  async function pageOffset(){return page.locator('.chat-page').evaluate(el=>new DOMMatrixReadOnly(getComputedStyle(el).transform).m41)}
  async function waitForChatRest(){await page.waitForFunction(()=>{const el=document.querySelector('.chat-page');return el&&Math.abs(new DOMMatrixReadOnly(getComputedStyle(el).transform).m41)<.2})}
  async function edgeGesture(dx,dy=0,hold=0,finish='touchEnd'){
   const incoming=page.locator('.messages article.incoming .bubble').last();
   await incoming.scrollIntoViewIfNeeded();
   const b=await incoming.boundingBox(),x=b.x+3,y=b.y+Math.min(20,b.height*.5);
   assert.ok(x<=26,'edge gesture must start over an actual incoming bubble within the navigation edge');
   assert.ok(await page.evaluate(({x,y})=>!!document.elementFromPoint(x,y)?.closest('.bubble'),{x,y}),'edge start must reach the bubble rather than header/composer');
   await touch('touchStart',[{x,y}]);
   for(let i=1;i<=8;i++){await touch('touchMove',[{x:x+dx*i/8,y:y+dy*i/8}]);await page.waitForTimeout(18)}
   if(hold)await page.waitForTimeout(hold);
   const dragged=await pageOffset();
   assert.equal(await page.locator('dialog[open]').count(),0,'edge navigation must cancel the child bubble long-press timer');
   await touch(finish);return dragged;
  }
  await page.goto(origin);await page.locator('.conversation').first().waitFor();
  for(let i=0;i<4;i++){
   const before=historyRequests;await page.getByRole('button',{name:'加载更早的短信',exact:true}).click();
   await page.waitForFunction(()=>window.__motionMetrics.commits>0);
   await page.waitForTimeout(80);assert.ok(historyRequests>before,'loading older history must reach the local mock');
  }
  await page.getByRole('button',{name:'加载更早的短信',exact:true}).waitFor({state:'detached'});
  assert.equal(await page.locator('.conversation').count(),81,'fixture must expose all 1000 messages across 81 conversations');
  const longRow=page.locator('.conversation').filter({hasText:'长会话压力测试'});
  await longRow.scrollIntoViewIfNeeded();await page.waitForTimeout(80);
  const savedScroll=await page.locator('.list-view').evaluate(el=>el.scrollTop);
  assert.ok(savedScroll>300,'scroll preservation must be tested away from the top');
  await longRow.click();await page.getByLabel('返回信息列表',{exact:true}).waitFor();
  await page.waitForFunction(()=>document.querySelectorAll('.messages .bubble').length===200);
  await page.waitForTimeout(400);
  await waitForChatRest();
  const hooked=await page.evaluate(()=>({renderers:window.__motionMetrics.renderers,commits:window.__motionMetrics.commits}));
  assert.ok(hooked.renderers>0&&hooked.commits>0,'React commit instrumentation must be active, not silently produce zero');
  const bubble=page.locator('.messages .bubble').last();await bubble.scrollIntoViewIfNeeded();
  const b=await bubble.boundingBox(),x=Math.min(345,b.x+b.width*.8),y=b.y+Math.min(b.height*.5,20);
  const startingCommits=await page.evaluate(()=>{const m=window.__motionMetrics;m.frames=[];m.longTasks=[];m.record=true;return m.commits});
  await touch('touchStart',[{x,y}]);
  for(let i=1;i<=36;i++){await touch('touchMove',[{x:x-65*i/36,y}]);await page.waitForTimeout(16)}
  const reached=await page.locator('.messages').evaluate(el=>parseFloat(getComputedStyle(el).getPropertyValue('--time-drag'))||0);
  assert.ok(reached>40,'the measured drag must actually reveal timestamps');
  await touch('touchEnd');
  await page.waitForFunction(()=>Math.abs(parseFloat(getComputedStyle(document.querySelector('.messages')).getPropertyValue('--time-drag'))||0)<.25);
  const captured=await page.evaluate(()=>{const m=window.__motionMetrics;m.record=false;return {commits:m.commits,frames:m.frames,longTasks:m.longTasks}});
  assert.ok(captured.frames.length>=8,'RAF diagnostic must collect an actual gesture, not an empty window');
  const dragCommits=captured.commits-startingCommits;
  const report={fixtureMessages:rows.length,chatMessages:200,pointerMoves:36,reactCommitsDuringDrag:dragCommits,rafSamples:captured.frames.length,desktopRafMs:{median:percentile(captured.frames,.5),p95:percentile(captured.frames,.95),max:percentile(captured.frames,1)},longTasks:captured.longTasks.length};
  // Do not use machine-dependent RAF timings as a claimed iPhone frame-rate test.
  // Commit counts catch the structural regression independently of host load.
  const failures=[];if(dragCommits>5)failures.push(`Timestamp drag caused ${dragCommits} React commits for 36 pointer moves; expected at most 5 start/end/poll commits`);

  const shortDrag=await edgeGesture(80,0,550);
  assert.ok(shortDrag>=70&&shortDrag<=90,'edge navigation must track the actual pixel drag');
  await waitForChatRest();assert.equal(await page.locator('.chat-page').count(),1,'a held short drag must cancel');
  assert.equal(await page.locator('.message-details').count(),0,'cancelled edge navigation must not trigger the bubble click');
  const cancelledDrag=await edgeGesture(105,0,0,'touchCancel');
  assert.ok(cancelledDrag>90,'pointer-cancel regression must begin with an active edge drag');
  await waitForChatRest();assert.equal(await page.locator('.chat-page').count(),1,'OS pointer cancellation must keep the current conversation');
  await edgeGesture(2,-90,550);await waitForChatRest();
  assert.equal(await page.locator('.message-details').count(),0,'vertical edge scroll must not activate a bubble');
  const freshTap=page.locator('.messages article.incoming .bubble').last();
  await freshTap.tap();await page.locator('.message-details').waitFor();await freshTap.tap();
  await page.locator('.message-details').waitFor({state:'detached'});
  const completeDrag=await edgeGesture(210,0,150);
  assert.ok(completeDrag>=200,'edge completion must follow the finger beyond the distance threshold');
  await page.locator('.chat-page').waitFor({state:'detached'});
  const restored=await page.locator('.list-view').evaluate(el=>el.scrollTop);report.scrollDelta=Math.round((restored-savedScroll)*100)/100;
  if(Math.abs(restored-savedScroll)>2)failures.push(`Returning to list changed scroll position by ${restored-savedScroll}px`);
  await longRow.click();await waitForChatRest();await page.getByLabel('返回信息列表',{exact:true}).click();
  await page.locator('.chat-page').waitFor({state:'detached'});
  const buttonRestored=await page.locator('.list-view').evaluate(el=>el.scrollTop);
  assert.ok(Math.abs(buttonRestored-savedScroll)<=2,'back button must preserve list scroll as well as edge navigation');
  report.edgeNavigation=['held-short cancellation','pointer cancellation','vertical cancellation','child long-press cancellation','fresh tap after cancellation','completed back','button back'];
  const readsBeforeGestures=reads;
  // Do not ask Playwright to wait for a stable element between these gestures:
  // pointer-down must interrupt an in-flight spring, as a person's finger can.
  await longRow.scrollIntoViewIfNeeded();
  for(const dx of [-100,95,-110,130]){await swipe(longRow,dx,0,8,12,false);await page.waitForTimeout(25)}
  await page.waitForTimeout(600);
  assert.equal(reads,readsBeforeGestures,'quick alternating swipes must not open the conversation');
  assert.equal(await page.locator('dialog[open]').count(),0,'quick swipes must not activate long-press');
  await swipe(longRow,2,-110,8,12);await page.waitForTimeout(600);
  assert.equal(reads,readsBeforeGestures,'vertical scrolling must not open the conversation');
  assert.equal(await page.locator('dialog[open]').count(),0,'vertical scrolling must cancel long-press');
  assert.equal(mutations,0,'gesture-only regression must not mark, delete, mute or send anything');
  assert.deepEqual(violations,[]);assert.deepEqual(errors,[]);
  console.log('Desktop diagnostics (not an iPhone FPS claim): '+JSON.stringify(report));
  assert.deepEqual(failures,[]);
  console.log('PASS 1000-message fixture, 200-message timestamp drag without per-frame React commits, edge navigation cancellation/completion, list scroll preservation, interrupted swipes, vertical cancellation; zero SMS sends');
 }finally{await browser.close();server.close()}
})().catch(e=>{console.error(e);server.close();process.exitCode=1});
