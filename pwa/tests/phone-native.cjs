// Built UI with synthetic data. All write requests are intercepted; no SIP connection is allowed.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'../../app/src/main/assets/iphone'),out=path.resolve(__dirname,'../../.work/phone-native');
fs.mkdirSync(out,{recursive:true});
const server=http.createServer((req,res)=>{const file=path.resolve(root,'.'+(new URL(req.url,'http://localhost').pathname==='/phone/'?'/phone/index.html':new URL(req.url,'http://localhost').pathname));if(!file.startsWith(root+path.sep)||!fs.existsSync(file))return res.writeHead(404).end();res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(fs.readFileSync(file))});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({channel:process.env.BROWSER_CHANNEL||'msedge',headless:true});
 try{
 const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
 let installation='native-fixture',missedCount=4;const page=await context.newPage(),errors=[],writes=[];
 await page.addInitScript(()=>{
  navigator.mediaDevices.getUserMedia=()=>{throw Error('The phone page must never request a microphone')};
  window.WebSocket=class{constructor(){throw Error('The phone page must never open SIP/WebSocket')}};
  window.fixtureLaunches=[];window.fixtureBadges=[];window.fixtureSms=[];
  navigator.setAppBadge=async count=>window.fixtureBadges.push(count??'dot');navigator.clearAppBadge=async()=>window.fixtureBadges.push(0);
  window.addEventListener('click',event=>{const link=event.target.closest('a[aria-label="给此号码发短信"]');if(link){event.preventDefault();window.fixtureSms.push(link.href)}},true);
  window.addEventListener('click',event=>{const link=event.target.closest('a[href^="groundwire:"]');if(link){event.preventDefault();window.fixtureLaunches.push(link.getAttribute('href'))}},true);
 });
 page.on('pageerror',e=>errors.push(e.message));
 await context.route('**/api/**',route=>{
  const req=route.request(),url=new URL(req.url()),key=url.pathname.replace('/api/v2/','');
  if(key==='call-history/seen'){
   assert.ok(req.postDataJSON().records.every(r=>r.id&&typeof r.date==='number'));missedCount=0;
   return route.fulfill({contentType:'application/json',body:JSON.stringify({count:0})});
  }
  if(req.method()!=='GET'){writes.push(key);return route.abort()}
  const records=Array.from({length:15},(_,i)=>({id:'call-'+i,name:i%3===0?'演示联系人 '+(i+1):'',number:'55501'+String(i).padStart(2,'0'),deviceId:'server',slot:i%3===0?2:i%3===1?1:null,type:i%4===1?'missed':i%2?'incoming':'outgoing',date:Date.now()-i*4000000,duration:i%4?45:0}));
  const data={
   session:{installationId:installation,permissions:['calls.read','calls.dial','contacts.read']},
   devices:[{deviceId:'server',name:'主机',online:true}],lines:[{lineId:'line-a',deviceId:'server',name:'主机 · SIM 1',slot:1,lineOnline:true,online:true,confirmed:true}],
   'groundwire/routes':{routes:[{lineId:'line-a',prefix:'*81*'}]},'voice/history':[],'call-history/missed':{count:missedCount},
   'call-history':{items:records,next:null},'contacts/version':{version:'fixture'},contacts:{items:[{id:'c',name:'演示联系人',numbers:['5550100'],favorite:false,revision:1,sources:[]}],next:null,version:'fixture'}
  };
  assert.ok(key in data,'Unexpected API '+key);
  return route.fulfill({contentType:'application/json',body:JSON.stringify(data[key])});
 });
 await page.goto('http://127.0.0.1:'+server.address().port+'/phone/');
 await page.getByRole('button',{name:'拨打',exact:true}).waitFor();
 assert.equal(await page.locator('nav [aria-current=page]').innerText(),'拨号键盘');
 await page.locator('.missed-badge').waitFor();
 assert.equal(await page.locator('.missed-badge').innerText(),'4');

 await page.screenshot({path:path.join(out,'home-keypad.png')});
 await page.locator('nav button').filter({hasText:'通话'}).click();
 await page.getByRole('button',{name:'筛选通话'}).waitFor();
 await page.waitForFunction(()=>window.fixtureBadges.at(-1)===0);
 assert.equal(await page.locator('.missed-badge').count(),0);

 const callRows=page.locator('.call-row-main');
 assert.ok((await callRows.nth(0).textContent()).includes('主机 · SIM 2 · 呼出'),await callRows.nth(0).textContent());
 assert.ok((await callRows.nth(1).textContent()).includes('主机 · SIM 1 · 未接来电'),await callRows.nth(1).textContent());
 assert.ok((await callRows.nth(2).textContent()).includes('主机 · SIM 未知 · 呼出'),await callRows.nth(2).textContent());
 await page.screenshot({path:path.join(out,'calls-light.png')});
 assert.equal(await page.locator('nav button').count(),3);
 await page.getByRole('button',{name:'筛选通话'}).click();
 await page.screenshot({path:path.join(out,'filter.png')});
 await page.getByRole('menuitem',{name:'未接来电',exact:true}).click();
 assert.equal(await page.locator('.call-row-main').count(),4);
 await page.getByRole('button',{name:'筛选通话'}).click();await page.getByRole('menuitem',{name:'全部通话',exact:true}).click();
 await page.locator('.call-row-main').first().click();await page.locator('.contact-sheet').waitFor();await page.waitForTimeout(350);
 await page.locator('.contact-sheet .history-entry').getByText('主机 · SIM 2',{exact:true}).waitFor();
 await page.screenshot({path:path.join(out,'poster.png')});
 const actions=page.locator('.poster-actions');
 assert.equal(await actions.locator('a,button').first().getAttribute('aria-label'),'给此号码发短信');
 assert.equal(await actions.locator('a,button').nth(1).getAttribute('aria-label'),'拨打此号码');
 assert.equal(await actions.getByRole('button',{name:'查看全部通话记录'}).count(),0);
 const sms=actions.getByRole('button',{name:'给此号码发短信'});
 const smsUrl=new URL(await sms.getAttribute('href'));assert.equal(smsUrl.port,'8443');assert.equal(new URLSearchParams(smsUrl.hash.slice(1)).get('compose'),'5550100');
 await sms.click();assert.equal(await page.evaluate(()=>window.fixtureSms.length),1);

 const sheet=page.locator('.contact-sheet');const sheetBox=await sheet.boundingBox();
 await page.mouse.move(sheetBox.x+140,sheetBox.y+310);await page.mouse.down();await page.mouse.move(sheetBox.x+188,sheetBox.y+312,{steps:4});await page.mouse.up();await sheet.waitFor({state:'detached'});
 await page.locator('.call-row-main').first().click();await page.locator('.contact-sheet').waitFor();await page.waitForTimeout(260);
 await page.getByRole('button',{name:'返回',exact:true}).click();await page.waitForTimeout(280);
 const swipe=page.locator('.call-swipe-front').first(),box=await swipe.boundingBox();
 await page.mouse.move(box.x+290,box.y+30);await page.mouse.down();await page.mouse.move(box.x+135,box.y+30,{steps:14});await page.mouse.up();await page.waitForTimeout(350);
 await page.screenshot({path:path.join(out,'swipe.png')});
 await page.getByRole('button',{name:'移除此通话记录',exact:true}).first().click();await page.waitForTimeout(300);assert.equal(await page.locator('.call-row-main').count(),14);
 installation='other-install';await page.reload();await page.locator('nav button').filter({hasText:'通话'}).click();await page.locator('.call-row-main').first().waitFor();assert.equal(await page.locator('.call-row-main').count(),15);
 installation='native-fixture';await page.reload();await page.locator('nav button').filter({hasText:'通话'}).click();await page.locator('.call-row-main').first().waitFor();assert.equal(await page.locator('.call-row-main').count(),14);
 await page.getByRole('button',{name:'筛选通话'}).click();await page.getByRole('menuitem',{name:'最近移除',exact:true}).click();
 assert.equal(await page.locator('.call-row-main').count(),1);
 await page.getByRole('button',{name:'编辑',exact:true}).click();await page.getByRole('button',{name:'选择记录',exact:true}).click();await page.getByRole('button',{name:'恢复',exact:true}).click();
 assert.equal(await page.locator('.call-row-main').count(),0);
 await page.locator('nav button').filter({hasText:'拨号键盘'}).click();
 await page.getByLabel('拨出线路',{exact:true}).selectOption('line-a');
 for(const k of ['1','2','3'])await page.getByRole('button',{name:k,exact:true}).click();
 assert.equal(await page.getByLabel('电话号码',{exact:true}).inputValue(),'123');
 assert.equal(await page.getByRole('button',{name:'拨打',exact:true}).isEnabled(),true);
 assert.equal(await page.getByRole('button',{name:'拨打',exact:true}).getAttribute('href'),'groundwire:*81*123?dialAction=voiceCall');
 await page.getByRole('button',{name:'拨打',exact:true}).click();
 assert.deepEqual(await page.evaluate(()=>window.fixtureLaunches),['groundwire:*81*123?dialAction=voiceCall']);
 assert.equal(await page.locator('audio').count(),0);

 await page.screenshot({path:path.join(out,'keypad-light.png')});
 await page.getByRole('button',{name:'退格',exact:true}).click();assert.equal(await page.getByLabel('电话号码',{exact:true}).inputValue(),'12');
 await page.getByRole('button',{name:'退格',exact:true}).click();await page.getByRole('button',{name:'退格',exact:true}).click();
 const zero=await page.getByRole('button',{name:'0',exact:true}).boundingBox();await page.mouse.move(zero.x+zero.width/2,zero.y+zero.height/2);await page.mouse.down();await page.waitForTimeout(520);await page.mouse.up();
 assert.equal(await page.getByLabel('电话号码',{exact:true}).inputValue(),'+');
 await page.emulateMedia({colorScheme:'dark'});await page.screenshot({path:path.join(out,'keypad-dark.png')});
 await page.setViewportSize({width:320,height:568});await page.screenshot({path:path.join(out,'keypad-small.png')});
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Horizontal overflow');
 const dialBounds=await page.getByRole('button',{name:'拨打',exact:true}).boundingBox(),dockBounds=await page.locator('.phone-dock').boundingBox();assert.ok(dialBounds.y+dialBounds.height<dockBounds.y,'Dial button covered by dock');
 assert.equal(Math.round(568-dockBounds.y-dockBounds.height),6,'Compact dock must sit 6px from the viewport bottom');
 assert.ok(await page.locator('#phone-app').evaluate(el=>el.scrollHeight<=el.clientHeight+1),'Compact dialer must not scroll');
 await page.setViewportSize({width:390,height:844});
 // Viewport geometry is applied on the next animation frame after the resize event.
 await page.waitForFunction(()=>document.querySelector('#root').clientHeight===innerHeight,undefined,{timeout:2000});
 const normalDock=await page.locator('.phone-dock').boundingBox();
 assert.equal(Math.round(844-normalDock.y-normalDock.height),6,'Normal dock must sit lower too');
 assert.ok(await page.locator('#phone-app').evaluate(el=>el.scrollHeight<=el.clientHeight+1),'Normal dialer must not scroll');
 const cssPath=await page.locator('link[rel=stylesheet]').getAttribute('href');
 const safeStyle=await page.addStyleTag({content:fs.readFileSync(path.join(root,cssPath),'utf8').replaceAll('env(safe-area-inset-bottom)','34px').replaceAll('env(safe-area-inset-top)','59px')});
 await page.waitForTimeout(220);
 const safeDock=await page.locator('.phone-dock').boundingBox(),safeDial=await page.getByRole('button',{name:'拨打',exact:true}).boundingBox();
 assert.equal(Math.round(844-safeDock.y-safeDock.height),22,'Home-indicator dock keeps 22px clearance');
 assert.ok(safeDial.y+safeDial.height<safeDock.y,'Safe-area dial button must remain above dock');
 const safeLayout=await page.locator('#phone-app').evaluate(el=>({client:el.clientHeight,scroll:el.scrollHeight,children:[...el.querySelectorAll('.dialer-screen,.dial-top,.dial-number-area,.keypad,.dialrow,.dial-options')].map(c=>({class:c.className,height:c.getBoundingClientRect().height,top:c.getBoundingClientRect().top}))}));
 assert.ok(safeLayout.scroll<=safeLayout.client+1,'Notched iPhone dialer must not scroll '+JSON.stringify(safeLayout));
 await page.screenshot({path:path.join(out,'keypad-safe-area.png')});
 await safeStyle.evaluate(el=>el.remove());

 await page.setViewportSize({width:390,height:844});await page.emulateMedia({colorScheme:'light'});
 await page.getByRole('button',{name:'搜索',exact:true}).click();await page.getByLabel('搜索通话或联系人').fill('演示联系人');await page.screenshot({path:path.join(out,'search.png')});
 await page.getByRole('button',{name:'取消搜索'}).click();await page.locator('nav button').filter({hasText:'联系人'}).click();await page.getByRole('button',{name:'演示联系人',exact:true}).waitFor();
 await page.screenshot({path:path.join(out,'contacts.png')});
 await page.goto('http://127.0.0.1:'+server.address().port+'/phone/#missed');
 await page.getByRole('button',{name:'筛选通话'}).waitFor();
 assert.equal(await page.locator('.call-row-main').count(),4,'Notification deep link must still show missed calls');
 assert.deepEqual(writes,[]);assert.deepEqual(errors,[]);
 console.log('PASS message-before-call actions, short center back swipe, missed badge/view receipts, keypad home and missed-call deep link, lower dock without dialer overflow, call list/detail recorded SIMs and unknown slots, Groundwire explicit-SIM launch, zero microphone/WebSocket requests, native shell, filters, poster, swipe remove/restore, dial input, zero hold, search, light/dark and small viewport; zero write/SIP requests');
 }finally{await browser.close();server.close()}
})().catch(e=>{server.close();console.error(e);process.exitCode=1});
