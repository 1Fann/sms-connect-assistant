// Simulated visualViewport regression, NOT an iPhone/Safari hardware test.
// Keyboard steps keep the real browser layout viewport at 390 x 844. Only the
// controllable visualViewport EventTarget changes; rotation is tested separately.
// All SMS data and endpoints are synthetic, and sending is explicitly blocked.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'../../app/src/main/assets/iphone');
const server=http.createServer((req,res)=>{
 const name=new URL(req.url,'http://localhost').pathname;
 const file=path.resolve(root,'.'+(name==='/'?'/index.html':decodeURIComponent(name)));
 if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return}
 try{res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(fs.readFileSync(file))}catch{res.writeHead(404).end()}
});
const close=(actual,expected,label,tolerance=1.1)=>assert.ok(Math.abs(actual-expected)<=tolerance,`${label}: expected ${expected}, got ${actual}`);

(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const origin='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({headless:true,channel:process.env.BROWSER_CHANNEL||'msedge'});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true,serviceWorkers:'block'});
  page.setDefaultTimeout(10000);
  await page.addInitScript(({width,height})=>{
   const metrics=window.__keyboardMetrics={renderers:0,commits:0};
   window.__REACT_DEVTOOLS_GLOBAL_HOOK__={supportsFiber:true,inject(){return ++metrics.renderers},onCommitFiberRoot(){metrics.commits++},onCommitFiberUnmount(){},onPostCommitFiberRoot(){},checkDCE(){}};
   // Init scripts precede the viewport meta tag; mobile Chromium temporarily
   // reports a 980 px layout width then. Seed the known final device size.
   const values={width,height,offsetTop:0,offsetLeft:0,pageTop:0,pageLeft:0,scale:1};
   const viewport=new EventTarget();
   for(const key of Object.keys(values))Object.defineProperty(viewport,key,{enumerable:true,get:()=>values[key]});
   Object.defineProperty(window,'visualViewport',{configurable:true,get:()=>viewport});
   window.__setVisualViewport=(next,events=['resize','scroll'])=>{
    Object.assign(values,next);values.pageTop=values.offsetTop+scrollY;values.pageLeft=values.offsetLeft+scrollX;
    for(const type of events)viewport.dispatchEvent(new Event(type));
   };
   window.__keyboardGeometry=()=>{
    const app=document.querySelector('.app'),header=document.querySelector('.chat-header'),composer=document.querySelector('.composer'),messages=document.querySelector('.messages'),input=document.querySelector('.composer textarea');
    const style=getComputedStyle(document.documentElement),a=app?.getBoundingClientRect(),h=header?.getBoundingClientRect(),c=composer?.getBoundingClientRect();
    return {layoutHeight:innerHeight,layoutWidth:innerWidth,visualHeight:values.height,visualTop:values.offsetTop,scale:values.scale,
     rootHeight:a?.height,rootTop:a?.top,headerVisualTop:h?h.top-values.offsetTop:null,composerVisualBottom:c?c.bottom-values.offsetTop:null,
     composerHeight:c?.height,composerPadding:composer?parseFloat(getComputedStyle(composer).paddingBottom):null,inputHeight:input?.getBoundingClientRect().height,
     keyboard:document.documentElement.dataset.keyboardOpen,inset:parseFloat(style.getPropertyValue('--keyboard-inset'))||0,offset:parseFloat(style.getPropertyValue('--viewport-top'))||0,
     scrollTop:messages?.scrollTop,bottomGap:messages?messages.scrollHeight-messages.scrollTop-messages.clientHeight:null,
     messagePadding:messages?parseFloat(getComputedStyle(messages).paddingBottom):null};
   };
  },{width:390,height:844});
  const errors=[],violations=[],address='+12025550101';let reads=0;
  page.on('pageerror',e=>errors.push(e.message));
  const rows=Array.from({length:160},(_,i)=>({id:'sms:'+(i+1),address,name:'合成键盘会话',body:`合成内容 ${i+1}：用于阅读锚点和输入框布局验证。`,date:Date.now()-(160-i)*30000,incoming:i%3!==0,read:true,sim:1,state:i%3!==0?'received':'sent'})).reverse();
  await page.route('**/*',async route=>{
   if(new URL(route.request().url()).origin!==origin){violations.push('external request blocked');await route.abort('blockedbyclient')}
   else await route.continue();
  });
  await page.route('**/api/**',async route=>{
   const p=new URL(route.request().url()).pathname;let data={};
   if(p==='/api/history')data={items:rows,next:null};
   else if(p==='/api/outgoing'||p==='/api/contacts'||p==='/api/conversations'&&route.request().method()==='GET')data=[];
   else if(p==='/api/sims')data=[{id:1,name:'合成线路'}];
   else if(p==='/api/read'){assert.equal(route.request().postDataJSON().address,address);reads++}
   else if(p!=='/api/status'){
    violations.push('unexpected API '+p);await route.fulfill({status:405,contentType:'application/json',body:'{"error":"Keyboard checks never send or change messages"}'});return;
   }
   await route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
  });
  async function settle(){await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))))}
  async function viewport(values,events=['resize','scroll']){await page.evaluate(({values,events})=>window.__setVisualViewport(values,events),{values,events});await settle()}
  const geometry=()=>page.evaluate(()=>window.__keyboardGeometry());
  const input=page.getByLabel('短信内容',{exact:true});
  async function openKeyboard(height=500,offsetTop=18){
   await input.focus();await viewport({height,width:390,offsetTop,scale:1});
   await page.waitForFunction(()=>document.documentElement.dataset.keyboardOpen==='true');await settle();
   return geometry();
  }
  async function closeKeyboard(){
   await input.evaluate(el=>el.blur());await viewport({height:844,width:390,offsetTop:0,scale:1});
   await page.waitForFunction(()=>document.documentElement.dataset.keyboardOpen==='false');await settle();
   return geometry();
  }
  function keyboardBounds(g,base){
   assert.equal(g.layoutHeight,844,'keyboard simulation must not resize the real layout viewport');
   close(g.rootHeight,base.rootHeight,'stable app shell height');
   close(g.headerVisualTop,base.headerVisualTop,'header position relative to the visible viewport');
   close(g.composerVisualBottom,g.visualHeight,'composer lower edge at the visible keyboard boundary');
   close(g.inset,844-g.visualHeight,'keyboard inset tracks visual height without offset double counting');
  }
  function atBottom(g,label){assert.ok(g.bottomGap<=2,`${label}: bottom gap is ${g.bottomGap}px`)}

  await page.goto(origin);await page.locator('.conversation').waitFor();
  // Give the simulated device a nonzero home-indicator inset. This selector
  // deliberately yields when production marks the keyboard open.
  await page.addStyleTag({content:'html:not([data-keyboard-open="true"]){--safe-bottom:34px}'});
  await page.locator('.conversation').click();
  await page.waitForFunction(()=>{const el=document.querySelector('.chat-page');return el&&Math.abs(new DOMMatrixReadOnly(getComputedStyle(el).transform).m41)<.1});
  await settle();
  const base=await geometry();
  assert.equal(base.keyboard,'false');close(base.rootHeight,844,'initial shell');
  assert.ok(base.composerPadding>=34,'fixture must exercise a nonzero safe-area inset');atBottom(base,'initial conversation');
  const hooked=await page.evaluate(()=>window.__keyboardMetrics);assert.ok(hooked.renderers>0&&hooked.commits>0,'React instrumentation must be active');

  const opened=await openKeyboard();keyboardBounds(opened,base);atBottom(opened,'opening keyboard for a bottom reader');
  close(base.composerPadding-opened.composerPadding,34,'keyboard must remove exactly the simulated safe-area addition');
  assert.ok(opened.messagePadding>=opened.composerHeight-1,'last message must reserve the floating composer space');

  // A stream of visualViewport scroll events must not rerender the app for
  // every frame. Also check geometry after each event rather than only at rest.
  const scrollTrace=await page.evaluate(async()=>{
   const before=window.__keyboardMetrics.commits,frames=[];
   for(let i=0;i<36;i++){
    window.__setVisualViewport({offsetTop:18+(i%5)*3},['scroll']);
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    frames.push(window.__keyboardGeometry());
   }
   return {commits:window.__keyboardMetrics.commits-before,frames};
  });
  assert.ok(scrollTrace.commits<=2,`36 viewport scroll events caused ${scrollTrace.commits} React commits; expected at most 2 incidental commits`);
  for(const frame of scrollTrace.frames){keyboardBounds(frame,base);atBottom(frame,'viewport scroll')}
  const closed=await closeKeyboard();
  close(closed.rootHeight,base.rootHeight,'closing preserves shell');close(closed.offset,0,'closing resets visual offset');close(closed.inset,0,'closing clears keyboard inset');
  close(closed.headerVisualTop,base.headerVisualTop,'closing restores header');close(closed.composerPadding,base.composerPadding,'closing restores safe-area');atBottom(closed,'closing keyboard');

  // Reading older content must keep both scrollTop and the first visible
  // message's local offset instead of jumping to the newest message.
  await page.locator('.messages').evaluate(el=>{el.scrollTop=Math.floor(el.scrollHeight*.35)});await settle();
  const oldAnchor=await page.locator('.messages').evaluate(el=>{
   const top=el.getBoundingClientRect().top;const item=[...el.querySelectorAll('article')].find(n=>n.getBoundingClientRect().top>top+125);
   return {scrollTop:el.scrollTop,text:item.querySelector('.bubble').textContent,relativeTop:item.getBoundingClientRect().top-top};
  });
  const oldOpen=await openKeyboard(470,24);keyboardBounds(oldOpen,base);close(oldOpen.scrollTop,oldAnchor.scrollTop,'older-reading scrollTop after opening',2);
  const relativeTop=await page.locator('.messages').evaluate((el,text)=>{const item=[...el.querySelectorAll('article')].find(n=>n.querySelector('.bubble').textContent===text);return item.getBoundingClientRect().top-el.getBoundingClientRect().top},oldAnchor.text);
  close(relativeTop,oldAnchor.relativeTop,'older-reading visible message anchor',2);
  await input.fill('阅读旧消息时的合成草稿\n第二行\n第三行\n第四行\n第五行');await settle();
  close((await geometry()).scrollTop,oldAnchor.scrollTop,'older-reading anchor during textarea growth',2);
  await input.fill('');await settle();
  close((await geometry()).scrollTop,oldAnchor.scrollTop,'older-reading anchor during textarea shrink',2);
  await closeKeyboard();close((await geometry()).scrollTop,oldAnchor.scrollTop,'older-reading scrollTop after closing',2);

  await page.locator('.messages').evaluate(el=>{el.scrollTop=el.scrollHeight});await settle();
  await openKeyboard(490,16);await input.fill('合成草稿一行');await settle();
  const oneLine=await geometry();atBottom(oneLine,'one-line input');
  await input.fill('第一行合成草稿\n第二行合成草稿\n第三行合成草稿\n第四行合成草稿\n第五行合成草稿\n第六行合成草稿');await settle();
  const multiline=await geometry();
  assert.ok(multiline.inputHeight>oneLine.inputHeight+40,'fixture must actually grow the textarea');
  assert.ok(multiline.composerHeight>oneLine.composerHeight+40,'growing input must grow the composer');
  keyboardBounds(multiline,base);atBottom(multiline,'multiline input growth');
  await input.fill('');await settle();atBottom(await geometry(),'input shrink');await closeKeyboard();

  for(const [height,offsetTop] of [[510,0],[450,22],[520,11]]){
   const g=await openKeyboard(height,offsetTop);keyboardBounds(g,base);atBottom(g,'repeated keyboard open');
   const restored=await closeKeyboard();close(restored.offset,0,'repeated blur offset reset');close(restored.inset,0,'repeated blur inset reset');atBottom(restored,'repeated keyboard close');
  }

  // Pinch-zoom also shrinks visualViewport, but must not become a keyboard.
  await input.focus();await viewport({height:844/1.5,width:390/1.5,offsetTop:20,scale:1.5});
  const zoomed=await geometry();assert.equal(zoomed.keyboard,'false','pinch zoom must not be classified as keyboard');
  close(zoomed.rootHeight,844,'pinch zoom freezes shell geometry');close(zoomed.inset,0,'pinch zoom has no keyboard inset');close(zoomed.composerPadding,base.composerPadding,'pinch zoom keeps safe-area');
  await viewport({height:844,width:390,offsetTop:0,scale:1});

  // Change the real layout viewport only for orientation, while an editable
  // remains focused, to distinguish rotation from an on-screen keyboard.
  await page.evaluate(()=>window.__setVisualViewport({width:844,height:390,offsetTop:0,scale:1},[]));
  await page.setViewportSize({width:844,height:390});await viewport({width:844,height:390,offsetTop:0,scale:1});
  const landscape=await geometry();assert.equal(landscape.keyboard,'false','landscape resize must not be classified as keyboard');
  close(landscape.rootHeight,390,'orientation rebuilds shell baseline');close(landscape.inset,0,'orientation clears keyboard inset');close(landscape.composerVisualBottom,390,'landscape composer boundary');
  await page.evaluate(()=>window.__setVisualViewport({width:390,height:844,offsetTop:0,scale:1},[]));
  await page.setViewportSize({width:390,height:844});await viewport({width:390,height:844,offsetTop:0,scale:1});
  const portrait=await geometry();assert.equal(portrait.keyboard,'false');close(portrait.rootHeight,844,'portrait baseline restored');close(portrait.offset,0,'portrait visual offset restored');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'no horizontal document overflow');
  assert.equal(reads,1);assert.deepEqual(violations,[]);assert.deepEqual(errors,[]);
  console.log('PASS simulated visualViewport: stable shell/header, floating composer boundary, no doubled safe-area, bottom/older-message anchors, multiline growth, repeated focus/blur, rotation/zoom discrimination, no per-frame React commits; zero SMS sends');
  console.log('Simulation only, not iPhone device evidence: '+JSON.stringify({messages:rows.length,viewportScrollEvents:36,reactCommitsDuringViewportScroll:scrollTrace.commits,baseHeight:base.rootHeight,keyboardVisualHeight:opened.visualHeight,multilineHeight:multiline.inputHeight}));
 }finally{await browser.close();server.close()}
})().catch(e=>{console.error(e);server.close();process.exitCode=1});
