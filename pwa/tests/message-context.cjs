// Local fixtures only. No device or SMS service is contacted.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'../../app/src/main/assets/iphone');
const output=path.resolve(__dirname,'../../.work');fs.mkdirSync(output,{recursive:true});
const server=http.createServer((req,res)=>{try{const f=path.join(root,req.url==='/'?'index.html':req.url.split('?')[0]);if(!f.startsWith(root+path.sep))return res.writeHead(403).end();res.setHeader('Content-Type',f.endsWith('.js')?'application/javascript':f.endsWith('.css')?'text/css':'text/html');res.end(fs.readFileSync(f))}catch{res.writeHead(404).end()}});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({headless:true,channel:process.env.BROWSER_CHANNEL||'msedge'});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true,serviceWorkers:'block'});
  let longText=false;
  const phones=[{id:'server',name:'服务器手机'},{id:'peer',name:'共享手机'}];
  const names={1:'卡 1',101:'卡 1'};const errors=[];let sends=0;
  page.on('pageerror',e=>errors.push(e.message));
  const lines=()=>Object.entries(names).map(([key,simName])=>{const id=Number(key),p=phones[id>100?1:0];return{id,phoneId:p.id,phoneName:p.name,simName,slot:id>100?id-100:id,online:true,name:p.name+' · '+simName}});
  await page.route('**/api/**',async route=>{
   const req=route.request(),p=new URL(req.url()).pathname;let data={};let status=200;
   if(p==='/api/phones')data=phones;
   else if(p==='/api/sims')data=lines();
   else if(p==='/api/history')data={items:[{id:'xia:1',address:'13800138000',body:longText?'长短信测试。'.repeat(300):'到家记得给我发个消息。',date:Date.now()-10000,incoming:true,read:true,sim:101,state:'received'},{id:'sms:2',address:'13800138000',body:'好的，我快到了。',date:Date.now(),incoming:false,read:true,sim:1,state:'sent'}],next:null};
   else if(p==='/api/conversations'||p==='/api/outgoing'||p==='/api/contacts')data=[];
   else if(p==='/api/send'){sends++;throw Error('Unexpected send')}
   await route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
  });
  let copied='';
  await page.exposeFunction('recordCopy',text=>{copied=text});
  await page.addInitScript(()=>{
    Object.defineProperty(navigator,'clipboard',{value:{writeText:text=>window.recordCopy(text)}});
    const visual = new EventTarget();
    let geometry = {};
    for(const [key,fallback] of Object.entries({width:()=>innerWidth,height:()=>innerHeight,offsetLeft:()=>0,offsetTop:()=>0,scale:()=>1})) {
      Object.defineProperty(visual,key,{get:()=>geometry[key] ?? fallback()});
    }
    Object.defineProperty(window,'visualViewport',{value:visual,configurable:true});
    window.setTestViewport = values=>{
      geometry=values;
      visual.dispatchEvent(new Event('resize'));
      visual.dispatchEvent(new Event('scroll'));
    };
  });
  const ready=async()=>page.waitForFunction(()=>getComputedStyle(document.querySelector('.message-preview')).transform==='none');
  const closed=async()=>page.locator('.message-context[open]').waitFor({state:'hidden'});
  const cdp=await page.context().newCDPSession(page);
  const actions=page.getByRole('dialog',{name:'信息操作'});
  const copy=actions.getByRole('button',{name:'拷贝',exact:true});
  const forward=actions.getByRole('button',{name:'转发',exact:true});
  const drawsOutline=locator=>locator.evaluate(el=>{
    const style=getComputedStyle(el);
    return !['none','hidden'].includes(style.outlineStyle)&&parseFloat(style.outlineWidth)>0&&
      style.outlineColor!=='transparent'&&!/^rgba\([^)]*,\s*0\)$/.test(style.outlineColor);
  });
  const checkPointerFocus=async gesture=>{
    assert.equal(await copy.evaluate(el=>el===document.activeElement),false,gesture+' opening does not autofocus Copy');
    assert.equal(await drawsOutline(copy),false,gesture+' must open without a visible outline on Copy');
  };
  const open=async incoming=>{
    const bubble=page.locator('.messages article.'+(incoming?'incoming':'outgoing')+' .bubble').first();
    await bubble.scrollIntoViewIfNeeded();
    await bubble.evaluate(el=>el.addEventListener('contextmenu',()=>{window.contextAnchor=el.getBoundingClientRect().toJSON()},{once:true}));
    await bubble.click({button:'right'});
    const rect=await page.evaluate(()=>window.contextAnchor);
    await ready();
    return {bubble,rect};
  };
  const fits=async()=>{
    const dialog=page.getByRole('dialog',{name:'信息操作'}),preview=dialog.locator('.message-preview'),actions=dialog.locator('.context-actions');
    const p=await preview.boundingBox(),a=await actions.boundingBox();
    const v=await page.evaluate(()=>({x:visualViewport.offsetLeft,y:visualViewport.offsetTop,width:visualViewport.width,height:visualViewport.height}));
    for(const [name,box] of [['bubble',p],['menu',a]]) {
      assert.ok(box.x>=v.x-1&&box.x+box.width<=v.x+v.width+1,name+' fits viewport horizontally');
      assert.ok(box.y>=v.y-1&&box.y+box.height<=v.y+v.height+1,name+' fits viewport vertically');
    }
    assert.ok(a.y>=p.y+p.height-1||a.y+a.height<=p.y+1,'menu and bubble do not overlap');
    assert.equal(await dialog.getByRole('button',{name:'取消',exact:true}).count(),0);
  };
  const goto=async()=>{
    await page.goto('http://127.0.0.1:'+server.address().port);
    await page.getByText('138 0013 8000',{exact:true}).click();
    await page.waitForFunction(()=>Math.abs(new DOMMatrix(getComputedStyle(document.querySelector('.chat-page')).transform).m41)<.1);
  };
  await goto();
  const first=await open(true);await fits();
  await checkPointerFocus('right-click');
  let placement=await page.locator('.message-context .context-actions').boundingBox();
  assert.ok(placement.y>=first.rect.y+first.rect.height,'menu prefers available space below');
  assert.ok(Math.abs((await page.locator('.message-preview').boundingBox()).y-first.rect.y)<1,'short bubble retains its original vertical position');
  const clone=page.locator('.message-preview');
  assert.equal(Math.round((await clone.boundingBox()).width),Math.round(first.rect.width));
  assert.equal(await first.bubble.evaluate(e=>getComputedStyle(e).visibility),'hidden');
  await page.screenshot({path:path.join(output,'message-context-light.png')});
  await page.keyboard.press('Tab');
  assert.equal(await copy.evaluate(el=>el===document.activeElement),true,'first Tab reaches Copy after pointer opening');
  assert.equal(await drawsOutline(copy),true,'Tab reveals the focused action');
  await page.getByRole('button',{name:'拷贝',exact:true}).click();await closed();
  assert.equal(copied,'到家记得给我发个消息。');
  assert.equal(await first.bubble.evaluate(e=>getComputedStyle(e).visibility),'visible');
  await page.emulateMedia({colorScheme:'dark'});
  await open(false);await fits();
  await page.screenshot({path:path.join(output,'message-context-dark.png')});
  await page.mouse.click(5,10);await closed();
  // A keyboard can reduce the visual viewport without changing layout viewport size.
  const anchor=await page.locator('.messages article.incoming .bubble').boundingBox();
  await page.evaluate(height=>window.setTestViewport({height}),Math.round(anchor.y+anchor.height+40));
  await page.waitForTimeout(240);
  const bottom=await open(true);await fits();
  const above=await page.locator('.message-context .context-actions').boundingBox();
  const lifted=await page.locator('.message-preview').boundingBox();
  assert.ok(above.y+above.height<=lifted.y+1,'menu uses space above a bubble near the keyboard');
  assert.ok(Math.abs(lifted.y-bottom.rect.y)<1,'upward menu preserves short bubble position '+JSON.stringify({lifted,source:bottom.rect}));
  await page.evaluate(()=>window.setTestViewport({height:240,offsetTop:36}));
  await page.waitForTimeout(300);await fits();
  await page.keyboard.press('Escape');await closed();
  assert.equal(await bottom.bubble.evaluate(el=>el.style.visibility),'');
  await page.evaluate(()=>window.setTestViewport({}));await page.waitForTimeout(240);
  // Closing a keyboard-opened menu restores focus to the source message.
  await bottom.bubble.focus();await page.keyboard.press('Shift+F10');await ready();
  assert.equal(await copy.evaluate(el=>el===document.activeElement),true,'Shift+F10 focuses Copy');
  assert.equal(await drawsOutline(copy),true,'keyboard opening shows the Copy focus ring');
  await page.keyboard.press('Tab');
  assert.equal(await forward.evaluate(el=>el===document.activeElement),true,'Tab moves from Copy to Forward');
  assert.equal(await drawsOutline(forward),true,'Forward has a visible keyboard focus indicator');
  await page.keyboard.press('Escape');await closed();
  assert.equal(await bottom.bubble.evaluate(el=>el===document.activeElement),true);
  await open(true);await page.getByRole('button',{name:'转发',exact:true}).click();await closed();
  assert.equal(await page.getByLabel('短信内容',{exact:true}).inputValue(),'到家记得给我发个消息。');
  longText=true;await page.setViewportSize({width:320,height:568});await goto();
  const longBubble=page.locator('.messages article.incoming .bubble');
  await longBubble.evaluate(el=>el.addEventListener('contextmenu',()=>{
    window.previewScales=[];
    let frames=0;
    const sample=()=>{
      const preview=document.querySelector('.message-preview');
      if(preview) {
        const matrix=new DOMMatrix(getComputedStyle(preview).transform);
        window.previewScales.push([Math.hypot(matrix.m11,matrix.m12),Math.hypot(matrix.m21,matrix.m22)]);
      }
      if(++frames<12)requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  },{once:true}));
  await open(true);await fits();
  const scales=await page.evaluate(()=>window.previewScales);
  assert.ok(scales.length>=3,'sample long-message opening frames');
  assert.ok(scales.every(([x,y])=>Math.abs(x-y)<.025),'long-message text uses uniform scaling during opening');
  assert.ok(await clone.evaluate(el=>el.scrollHeight>el.clientHeight));
  await clone.evaluate(el=>el.scrollTop=el.scrollHeight);
  await page.screenshot({path:path.join(output,'message-context-long.png')});
  assert.ok(await clone.evaluate(el=>el.scrollTop>0));
  await page.keyboard.press('Escape');await closed();
  await open(true);assert.equal(await clone.evaluate(el=>el.scrollTop),0,'reopening long text begins at its start');
  await page.keyboard.press('Escape');await closed();
  await page.emulateMedia({reducedMotion:'reduce'});await open(false);await fits();await page.keyboard.press('Escape');await closed();
  await page.emulateMedia({reducedMotion:'no-preference'});
  const bubble=page.locator('.messages article.outgoing .bubble');
  for(let i=0;i<3;i++){await bubble.click({button:'right'});await page.keyboard.press('Escape');await closed();assert.equal(await bubble.evaluate(e=>getComputedStyle(e).visibility),'visible')}
  const startTouch=async rect=>cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:rect.x+rect.width/2,y:rect.y+rect.height/2}]});
  await bubble.scrollIntoViewIfNeeded();
  let initial=await bubble.boundingBox();
  await startTouch(initial);await page.waitForTimeout(180);
  const held=await bubble.boundingBox();
  assert.ok(held.width<initial.width-.3&&held.width>initial.width*.94,'press feedback gently contracts the bubble');
  await cdp.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});
  await page.waitForTimeout(300);
  assert.ok(Math.abs((await bubble.boundingBox()).width-initial.width)<.5,'cancel restores bubble scale');
  assert.equal(await page.locator('.message-context[open]').count(),0);
  initial=await bubble.boundingBox();await startTouch(initial);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:initial.x+initial.width/2,y:initial.y+initial.height/2-45}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await page.waitForTimeout(550);
  assert.equal(await page.locator('.message-context[open]').count(),0,'scroll cancels the long press');
  assert.ok(Math.abs((await bubble.boundingBox()).width-initial.width)<.5,'scroll restores bubble scale');
  await bubble.scrollIntoViewIfNeeded();const b=await bubble.boundingBox();
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:b.x+b.width/2,y:b.y+b.height/2}]});
  await page.getByRole('dialog',{name:'信息操作'}).waitFor();
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await ready();await fits();
  assert.equal(await page.getByRole('dialog',{name:'信息操作'}).isVisible(),true);
  await checkPointerFocus('touch long-press');
  await page.keyboard.press('Escape');await closed();
  assert.deepEqual(errors,[]);assert.equal(sends,0);
  console.log('PASS anchored upper/lower menu, copy, forward draft, keyboard viewport/focus, uniform long-text opening and scroll reset, press/cancel/scroll feedback, reduced motion, interrupted close, release suppression; no SMS sends');
 }finally{await browser.close();server.close()}
})().catch(e=>{console.error(e);server.close();process.exitCode=1});
