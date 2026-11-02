// Exercise built CommLink assets with synthetic records, without registering SIP or calling any phone.
const http=require('node:http'), fs=require('node:fs'), path=require('node:path'), assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(process.env.PHONE_UI_TEST_ASSETS||path.join(__dirname,'../../app/src/main/assets/iphone'));
const server=http.createServer((req,res)=>{
 const p=new URL(req.url,'http://localhost').pathname;
 const file=path.resolve(root,'.'+(p==='/phone/'?'/phone/index.html':p));
 if(!file.startsWith(root+path.sep)||!fs.existsSync(file))return res.writeHead(404).end();
 res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':file.endsWith('.webmanifest')?'application/manifest+json':'text/html');
 res.end(fs.readFileSync(file));
});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({channel:process.env.BROWSER_CHANNEL||'msedge',headless:true});
 try{
 const page=await browser.newPage({viewport:{width:390,height:844},hasTouch:true,serviceWorkers:'block'});const writes=[],errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{
   const viewport=Object.assign(new EventTarget(),{height:844,width:390,offsetTop:0,scale:1});
   Object.defineProperty(viewport,'pageTop',{get:()=>window.scrollY+viewport.offsetTop+(viewport.pageLag||0)});
   Object.defineProperty(window,'visualViewport',{get:()=>viewport});
   window.fixtureVV=viewport;
 });
 const screenshots=path.resolve(__dirname,'../../.work/contacts-ui');
 fs.mkdirSync(screenshots,{recursive:true});
 const photo=await page.evaluate(()=>{
   const canvas=document.createElement('canvas');canvas.width=64;canvas.height=64;
   const ctx=canvas.getContext('2d');ctx.fillStyle='#246eaf';ctx.fillRect(0,0,64,64);ctx.fillStyle='#95d7ed';
   ctx.beginPath();ctx.moveTo(0,56);ctx.lineTo(38,15);ctx.lineTo(64,48);ctx.lineTo(64,64);ctx.lineTo(0,64);ctx.fill();
   return canvas.toDataURL('image/png').split(',')[1];
 });
 // Android's display order can differ from numeric order.
 const phoneNumbers=['5550107','5550101'];
 const row={id:'demo',name:'合成联系人',numbers:phoneNumbers,deviceId:'server',primaryRawId:'raw',sources:[{deviceId:'server',rawId:'raw',contactId:'5',revision:'source-2',name:'合成联系人',numbers:phoneNumbers,readOnly:false}],revision:2,favorite:false,conflict:false};
 const cards=[row,...['岸桥','北辰','彩禾','冬青','枫林','河谷','江城','蓝石','南星','松石','云舟','栀子'].map((name,index)=>{
   const number='55502'+String(index).padStart(2,'0');
   return {...row,id:'extra-'+index,name,numbers:[number],photo:name==='北辰'?photo:undefined,
     sources:[{...row.sources[0],name,numbers:[number]}]};
 })];
 const longNumbers=Array.from({length:12},(_,index)=>'55503'+String(index).padStart(2,'0'));
 const longCard={...row,id:'long',name:'多号样例',numbers:longNumbers,
   sources:[{...row.sources[0],name:'多号样例',numbers:longNumbers}]};
 cards.push(longCard);
 let canEdit=true;
 await page.route('**/api/**',async route=>{
   const req=route.request(),url=new URL(req.url()),endpoint=url.pathname.replace('/api/v2/','');
   const data={
    session:{installationId:'test',permissions:['contacts.read','calls.read',...(canEdit?['contacts.write']:[])]},
    devices:[{deviceId:'server',name:'主机',online:true,contactsWrite:true}],lines:[{lineId:'line-a',deviceId:'server',name:'主机 · A',online:true,confirmed:true}],
    'call-history/missed':{count:0},'call-history/seen':{count:0},'voice/history':[],
    'contacts/version':{version:'fixture'},contacts:{items:cards.filter(card=>card.name.includes(url.searchParams.get('q')||'')),next:null,version:'fixture'},
    'contact-sync/jobs':{items:[{id:'job',state:'done',detail:''}]},'call-history':{items:[{id:'record1',name:'合成联系人',number:phoneNumbers[0],deviceId:'server',type:'missed',date:1720000000000,duration:0}],next:null},
   };
   for(const card of cards)data['contacts/'+card.id]=card;
   if(req.method()!=='GET'&&endpoint!=='call-history/seen')writes.push([endpoint,req.postDataJSON()]);
   if(!(endpoint in data)&&endpoint!=='contacts/native/edit')throw Error('Unexpected fixture path '+endpoint);
   return route.fulfill({contentType:'application/json',body:JSON.stringify(data[endpoint]||{id:'demo',deviceId:'server',jobId:'job',state:'queued'})});
 });
 await page.goto('http://127.0.0.1:'+server.address().port+'/phone/');
 await page.locator('nav button').filter({hasText:'通话'}).click();
 await page.getByRole('button',{name:'合成联系人',exact:false}).first().click();
 await page.getByRole('button',{name:'拨打此号码'}).click();
 assert.equal(await page.getByLabel('电话号码',{exact:true}).inputValue(),phoneNumbers[0]);
 assert.ok(await page.getByRole('button',{name:'拨打',exact:true}).isDisabled());
 await page.locator('nav button').filter({hasText:'联系人'}).click();
 const list=page.locator('#phone-app');
 const openCard=name=>list.locator('.contact-list-row').filter({hasText:name}).click();
 const sheet=page.locator('.directory-poster');
 await list.locator('.contact-list-row').first().waitFor();
 await page.screenshot({path:path.join(screenshots,'contacts-list.png'),animations:'disabled'});
 const cssPath=await page.locator('link[rel=stylesheet]').getAttribute('href');
 const safeCss=fs.readFileSync(path.join(root,cssPath),'utf8')
   .replace(/env\(safe-area-inset-top(?:,[^)]*)?\)/g,'59px')
   .replace(/env\(safe-area-inset-bottom(?:,[^)]*)?\)/g,'34px');
 const simulatedInsets=await page.addStyleTag({content:safeCss});
 const toolbarTop=(await list.locator('.phone-toolbar').boundingBox()).y;
 assert.ok(Math.abs(toolbarTop-59)<=4,'The contact toolbar should reserve the top safe area once');
 await page.screenshot({path:path.join(screenshots,'contacts-list-safe-area.png'),animations:'disabled'});
 const firstLetter=list.getByRole('button',{name:'跳到 A 分组',exact:true});
 const firstBox=await firstLetter.boundingBox();
 const lastBox=await list.getByRole('button',{name:'跳到 Z 分组',exact:true}).boundingBox();
 await page.mouse.move(firstBox.x+firstBox.width/2,firstBox.y+firstBox.height/2);
 await page.mouse.down();
 await page.mouse.move(lastBox.x+lastBox.width/2,lastBox.y+lastBox.height/2,{steps:8});
 await page.mouse.up();
 await page.waitForFunction(()=>document.querySelector('#phone-app').scrollTop>200);
 assert.equal(await page.evaluate(()=>window.scrollY),0);
 assert.ok(Math.abs((await list.locator('.phone-toolbar').boundingBox()).y-toolbarTop)<12,'Contact toolbar moved off screen');
 await firstLetter.press('Enter');
 await page.waitForFunction(()=>document.querySelector('#phone-app').scrollTop<50);

 await openCard('北辰');
 await sheet.locator('img').first().waitFor();
 assert.ok(await sheet.locator('img').first().evaluate(async img=>{await img.decode();return img.naturalWidth===64}),'Contact photo is not decoded on the detail page');
 const onlyNumberLink=sheet.getByLabel('给联系人发短信',{exact:true});
 assert.equal(new URL(await onlyNumberLink.getAttribute('href')).hash,'#compose=5550201');
 const editor=page.getByRole('dialog',{name:'编辑联系人',exact:true});
 const numberPad=page.getByRole('group',{name:'电话号码键盘',exact:true});
 const padKey=name=>numberPad.getByRole('button',{name,exact:true});
 async function viewport(height,offsetTop){
   await page.evaluate(({height,offsetTop})=>{
     Object.assign(window.fixtureVV,{height,offsetTop});
     window.fixtureVV.dispatchEvent(new Event('resize'));
     window.fixtureVV.dispatchEvent(new Event('scroll'));
   },{height,offsetTop});
   await page.waitForFunction(({height,offsetTop})=>{
     const top=parseFloat(document.documentElement.style.getPropertyValue('--viewport-top'));
     return top===offsetTop && (document.documentElement.dataset.keyboardOpen==='true')===(height<844);
   },{height,offsetTop});
 }
 async function keyboardGeometry(height,offsetTop,short){
   await viewport(height,offsetTop);
   // Check the field against what is actually visible, including Safari's pan.
   await page.waitForFunction(({height,offsetTop,short})=>{
     const form=document.querySelector('.ios-editor-edit');
     const scroll=form.querySelector('.ios-editor-scroll').getBoundingClientRect();
     const toolbar=form.querySelector('.ios-editor-toolbar').getBoundingClientRect();
     const focus=document.activeElement.getBoundingClientRect();
     const avatar=form.querySelector('.poster-avatar').getBoundingClientRect();
     return document.activeElement.matches('input') && window.scrollY===0 && toolbar.top>=offsetTop-1 &&
       focus.top>=Math.max(scroll.top,toolbar.bottom)-1 && focus.bottom<=Math.min(scroll.bottom,offsetTop+height)+1 &&
       (!short || (avatar.top>=scroll.top-1 && avatar.bottom<=scroll.bottom+1));
   },{height,offsetTop,short},{timeout:4000});
   // The system keyboard is translucent. Sample the pixels it would composite over.
   const shot=await page.screenshot({clip:{x:6,y:offsetTop+height+30,width:3,height:3},animations:'disabled'});
   const pixels=await editor.evaluate(async(form,base64)=>{
     const img=new Image();img.src='data:image/png;base64,'+base64;await img.decode();
     const canvas=document.createElement('canvas');canvas.width=2;canvas.height=1;
     const ctx=canvas.getContext('2d');ctx.drawImage(img,1,1,1,1,0,0,1,1);
     ctx.fillStyle=getComputedStyle(form).backgroundColor;ctx.fillRect(1,0,1,1);
     return Array.from(ctx.getImageData(0,0,2,1).data);
   },shot.toString('base64'));
   assert.ok(pixels[7]===255 && [0,1,2,3].every(channel=>Math.abs(pixels[channel]-pixels[4+channel])<=2),
     'The area behind the keyboard should paint the opaque editor background: '+pixels.join(','));
 }
 async function visibleAbovePad(short){
   await numberPad.waitFor();
   await page.waitForFunction(short=>{
     const form=document.querySelector('.ios-editor-edit');
     const toolbar=form.querySelector('.ios-editor-toolbar').getBoundingClientRect();
     const scroll=form.querySelector('.ios-editor-scroll').getBoundingClientRect();
     const pad=document.querySelector('.phone-number-pad').getBoundingClientRect();
     const input=document.activeElement;
     const focus=input.getBoundingClientRect();
     const avatar=form.querySelector('.poster-avatar').getBoundingClientRect();
     return input.matches('input[data-phone-id]') && input.inputMode==='none' &&
       document.documentElement.dataset.keyboardOpen!=='true' && window.scrollY===0 &&
       focus.top>=Math.max(scroll.top,toolbar.bottom)-1 && focus.bottom<=Math.min(scroll.bottom,pad.top)+1 &&
       (!short || (avatar.top>=scroll.top-1 && avatar.bottom<=Math.min(scroll.bottom,pad.top)+1));
   },short,{timeout:4000});
 }
 async function setSelection(field,start,end=start){
   await field.evaluate((el,[start,end])=>el.setSelectionRange(start,end),[start,end]);
 }
 // Bounds are in layout coordinates. Subtract the simulated iOS viewport pan
 // so a correct compensation is measured as stationary on screen.
 async function editorFrame(){
   return editor.evaluate(async form=>{
     await Promise.all(form.getAnimations().map(animation=>animation.finished));
     await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
     const frame={};
     for(const [name,element] of Object.entries({
       page:form,toolbar:form.querySelector('.ios-editor-toolbar'),
       avatar:form.querySelector('.poster-avatar'),source:form.querySelector('.ios-editor-origin'),
       name:form.querySelector('[data-editor-name]'),phone:form.querySelector('[data-phone-id]'),
     })){
       const rect=element.getBoundingClientRect();
       frame[name]=[rect.x,rect.y-window.fixtureVV.offsetTop,rect.width,rect.height];
     }
     frame.scroll=[form.querySelector('.ios-editor-scroll').scrollTop,window.scrollY];
     return frame;
   });
 }
 async function assertStill(before,stage){
   const after=await editorFrame();
   for(const key of Object.keys(before)){
     // The visible content offset may be carried by a transform while the
     // scroller is temporarily clipped. Native scrollTop need not match then.
     if(key==='scroll'){
       assert.equal(after.scroll[1],before.scroll[1],stage+' unexpectedly scrolled the document');
       continue;
     }
     assert.ok(before[key].every((value,index)=>Math.abs(value-after[key][index])<=1),
       stage+' moved '+key+' from '+JSON.stringify(before[key])+' to '+JSON.stringify(after[key]));
   }
 }
 async function assertNoTransientReveal(stage){
   const frames=await editor.evaluate(form=>{
     const panel=form.querySelector('.ios-editor-scroll');
     const points=[form.querySelector('.ios-editor-toolbar'),form.querySelector('[data-editor-name]'),form.querySelector('[data-phone-id]')];
     const read=()=>points.map(element=>element.getBoundingClientRect().top-window.fixtureVV.offsetTop);
     const before=read();
     // The viewport metrics do not change while WebKit is revealing a focused row.
     // Read synchronously, before any scroll handler or rAF could repair a jump.
     document.activeElement.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'});
     const afterReveal=read();
     panel.scrollBy({top:panel.scrollTop>24?-24:24,behavior:'instant'});
     return [before,afterReveal,read()];
   });
   for(const frame of frames.slice(1))assert.ok(frame.every((v,i)=>Math.abs(v-frames[0][i])<=1),
     stage+' moved toolbar/name/phone within one frame: '+JSON.stringify(frames));
 }
 async function assertOneKeyboardInset(idlePadTop,stage){
   const {bottom,visible}=await editor.evaluate(form=>({
     bottom:form.querySelector('.ios-editor-scroll').getBoundingClientRect().bottom-window.fixtureVV.offsetTop,
     visible:window.fixtureVV.height,
   }));
   const expected=Math.min(idlePadTop,visible);
   assert.ok(Math.abs(bottom-expected)<=2,stage+' has a form bottom of '+bottom+'; expected '+expected);
 }
 await sheet.getByRole('button',{name:'编辑',exact:true}).click();
 const shortFrame=await editorFrame();
 const restingDockBottom=await page.locator('.phone-dock').evaluate(dock=>dock.getBoundingClientRect().bottom);
 async function assertDockDismissal(slowReturn=false){
  const dockFrames=await page.evaluate(async slowReturn=>{
   const dock=document.querySelector('.phone-dock');
   const frames=[];
   // A restored height is not enough: the viewport can still be panned, and can
   // briefly report a closed keyboard before the last dismissal frames arrive.
   for(const [phase,height,offsetTop,pageLag,count] of [
     ['still panned',844,26,0,3],['page origin lag',844,0,26,6],['transient rest',844,0,0,3],
     ['rebound',760,16,0,3],['settled',844,0,0,72]
   ]){
     Object.assign(window.fixtureVV,{height,offsetTop,pageLag});
     window.fixtureVV.dispatchEvent(new Event('resize'));
     window.fixtureVV.dispatchEvent(new Event('scroll'));
     const start=performance.now();
     for(let i=0;i<count || (phase==='still panned'&&slowReturn&&performance.now()-start<900);i++){
       await new Promise(requestAnimationFrame);
       if(dock.checkVisibility({checkOpacity:true,checkVisibilityCSS:true})){
         frames.push({phase,bottom:dock.getBoundingClientRect().bottom-offsetTop});
       }
     }
   }
   return frames;
  },slowReturn);
 assert.ok(dockFrames.length>0,'Navigation must return after the native keyboard closes');
 const flash=dockFrames.find(frame=>frame.phase!=='settled'||Math.abs(frame.bottom-restingDockBottom)>1);
 assert.ok(!flash,'Navigation appeared before it was safely at the screen bottom: '+JSON.stringify({flash,restingDockBottom}));
 assert.ok(await page.locator('.phone-dock nav button').first().evaluate(button=>{
   const r=button.getBoundingClientRect();
   return button.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));
 }),'Restored navigation must accept taps at its resting position');
 }
 const nameField=editor.getByLabel('姓名',{exact:true});
 // Inspect the real touch focus timing. Dragging over an unfocused field is a
 // scroll gesture; only a completed tap should request focus without scrolling.
 await nameField.evaluate(field=>{
   const original=field.focus;
   field.focus=function(options){
     if(options?.preventScroll)this.setAttribute('data-fixture-focus','prevent-scroll');
     return original.call(this,options);
   };
 });
 const touch=await page.context().newCDPSession(page);
 const nameBox=await nameField.boundingBox();
 const finger={x:nameBox.x+nameBox.width/2,y:nameBox.y+nameBox.height/2};
 await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[finger]});
 assert.equal(await nameField.evaluate(field=>field===document.activeElement),false,'Touch-down must not steal focus');
 for(const dy of [12,30,50])await touch.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:finger.x,y:finger.y-dy}]});
 await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 assert.equal(await nameField.evaluate(field=>field===document.activeElement),false,'A drag across the name field must not open its keyboard');
 await touch.detach();
 await nameField.tap();
 assert.equal(await nameField.getAttribute('data-fixture-focus'),'prevent-scroll','A completed tap should focus in the gesture with preventScroll');
 assert.ok(await nameField.evaluate(field=>field===document.activeElement),'The native name input must own focus');
 await nameField.evaluate(field=>{delete field.focus;field.removeAttribute('data-fixture-focus')});
 await viewport(620,12);
 await assertStill(shortFrame,'Opening the name keyboard');
 await assertNoTransientReveal('Initial name keyboard');
 await keyboardGeometry(492,26,true);
 await assertStill(shortFrame,'Visible name keyboard');
 await keyboardGeometry(492,64,true);
 await assertStill(shortFrame,'Additional Safari pan with unchanged keyboard height');
 // Mobile compositors can move fixed layers during the keyboard animation
 // without moving the document by the same amount. Apply the extra translation
 // to fixed positioning only; a document-anchored editor must stay stationary.
 const fixedLayer=await page.evaluateHandle(()=>{
   const shell=document.querySelector('#root');
   const shifted=getComputedStyle(document.body).position==='fixed'?document.body:
     getComputedStyle(shell).position==='fixed'?shell:null;
   if(shifted)shifted.style.translate='0 32px';
   return shifted;
 });
 await assertStill(shortFrame,'Independent native fixed-layer translation');
 await fixedLayer.evaluate(el=>el?.style.removeProperty('translate'));
 await fixedLayer.dispose();

 // Here the document itself has also scrolled. A document-coordinate top which
 // uses offsetTop alone would leave the entire editor too high by scrollY.
 const allowRootScroll=await page.addStyleTag({content:'html{overflow-y:auto!important} html::after{content:"";position:absolute;top:1100px;left:0;width:1px;height:1px;pointer-events:none}'});
 await page.evaluate(()=>window.scrollTo(0,32));
 await page.waitForFunction(()=>window.scrollY===32);
 await viewport(492,64);
 await assertStill({...shortFrame,scroll:[shortFrame.scroll[0],32]},'Visual viewport pageTop includes real document scroll');
 await page.evaluate(()=>window.scrollTo(0,0));
 await allowRootScroll.evaluate(style=>style.remove());
 await viewport(492,64);
 await assertStill(shortFrame,'Visual viewport returns to its original document origin');
 assert.ok(await numberPad.isHidden(),'Name editing uses the iOS keyboard');
 // A browser focus reveal can scroll the overflow panel after its last viewport
 // notification. No wheel or touch gesture has asked to move these visible rows.
 await assertNoTransientReveal('Late native focus reveal');
 await assertStill(shortFrame,'Late native focus reveal with no further viewport change');
 // Users can scroll even a single-number form while the native keyboard is up.
 // A later viewport event must respect that scroll when the caret remains visible.
 const panel=editor.locator('.ios-editor-scroll');
 const drag=await page.context().newCDPSession(page);
 const bounds=await panel.boundingBox();
 const start={x:bounds.x+6,y:bounds.y+Math.min(140,bounds.height*.65)};
 await drag.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[start]});
 for(const dy of [10,25,45])await drag.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:start.x,y:start.y-dy}]});
 await page.waitForFunction(()=>document.querySelector('.ios-editor-scroll').scrollTop>5,null,{timeout:400});
 await drag.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});
 await drag.detach();
 await panel.evaluate(el=>{el.scrollTop=0});
 await panel.hover();
 await page.mouse.wheel(0,24);
 await page.waitForFunction(()=>document.querySelector('.ios-editor-scroll').scrollTop>=23);
 const shortScrolled=await editorFrame();
 assert.ok(shortScrolled.scroll[0]>=23,'The short form should have room to scroll above the keyboard');
 await keyboardGeometry(492,44,false);
 await assertStill(shortScrolled,'Safari pan after an intentional short-form scroll');
 await panel.evaluate(element=>{element.scrollTop=0});
 await nameField.blur();
 await viewport(620,16);
 await assertStill(shortFrame,'Dismissing the name keyboard');
 await assertDockDismissal();
 await viewport(844,0);
 await assertStill(shortFrame,'Dismissed name keyboard');
 const shortPhone=editor.getByLabel('联系人电话号码',{exact:true});
 await shortPhone.click();
 await viewport(844,0);
 await visibleAbovePad(true);
 await assertStill(shortFrame,'Web phone keypad with the first number already visible');
 await page.screenshot({path:path.join(screenshots,'contact-edit-short-number-pad.png'),animations:'disabled'});
 const original=await shortPhone.inputValue();
 await setSelection(shortPhone,1,4);
 await padKey('8').tap();
 const replaced=original.slice(0,1)+'8'+original.slice(4);
 assert.equal(await shortPhone.inputValue(),replaced);
 await padKey('0').tap();
 assert.equal(await shortPhone.inputValue(),replaced.slice(0,2)+'0'+replaced.slice(2));
 assert.ok(await shortPhone.evaluate(input=>document.activeElement===input),'Tapping keys keeps the phone field focused');
 await padKey('退格').click();
 assert.equal(await shortPhone.inputValue(),replaced);
 await setSelection(shortPhone,1,3);
 await padKey('退格').click();
 const shortened=replaced.slice(0,1)+replaced.slice(3);
 assert.equal(await shortPhone.inputValue(),shortened);
 // A short tap in the form margin dismisses the web keypad, preserves the draft,
 // and leaves the editor open. Verify the coordinate actually hits blank space.
 const blankPoint=await panel.evaluate(surface=>{
   const bounds=surface.getBoundingClientRect();
   const x=bounds.left+6,y=bounds.top+Math.min(80,bounds.height/2);
   if(document.elementFromPoint(x,y)!==surface)throw Error('Expected to tap the blank editor margin');
   return {x,y};
 });
 const gestures=await page.context().newCDPSession(page);
 await gestures.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[blankPoint]});
 for(const dy of [10,24,42])await gestures.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:blankPoint.x,y:blankPoint.y-dy}]});
 await gestures.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 assert.ok(await numberPad.isVisible(),'A swipe over blank space must leave the keypad open');
 await gestures.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[blankPoint]});
 await new Promise(resolve=>setTimeout(resolve,650));
 await gestures.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 assert.ok(await numberPad.isVisible(),'A long press on the background must not dismiss the keypad');
 await gestures.detach();
 await page.touchscreen.tap(blankPoint.x,blankPoint.y);
 assert.ok(await numberPad.isHidden(),'Tapping blank space should dismiss the number keypad');
 assert.equal(await shortPhone.evaluate(field=>document.activeElement===field),false);
 assert.equal(await shortPhone.inputValue(),shortened);
 assert.ok(await editor.isVisible());
 await shortPhone.tap();
 await numberPad.waitFor();
 await editor.locator('.ios-editor-caption').filter({hasText:'保存后'}).tap();
 assert.ok(await numberPad.isHidden(),'Tapping the static note below the fields should dismiss the keypad');
 await shortPhone.tap();
 await numberPad.waitFor();
 await setSelection(shortPhone,0);
 await padKey('切换到符号键盘').click();
 for(const key of ['加号','星号','井号'])await padKey(key).click();
 assert.equal(await shortPhone.inputValue(),'+*#'+shortened);
 await padKey('返回数字键盘').click();
 await padKey('收起键盘').click();
 await numberPad.waitFor({state:'hidden'});
 await viewport(844,0);
 assert.ok(await numberPad.isHidden(),'Viewport events must not reopen a dismissed keypad');
 await shortPhone.click();
 await visibleAbovePad(true);
 const idlePadTop=(await numberPad.boundingBox()).y;
 const lastValue=await shortPhone.inputValue();
 // Focus switches immediately, but Safari may deliver its first keyboard resize much later.
 await nameField.click();
 const retained=await editor.evaluate(form=>{
   const pad=form.querySelector('.phone-number-pad');
   const key=pad?.querySelector('button');
   if(!key||!key.checkVisibility({checkOpacity:true,checkVisibilityCSS:true}))return null;
   const r=key.getBoundingClientRect();
   const hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
   return {top:pad.getBoundingClientRect().top,
     blocked:!!key.disabled||!!key.closest('[inert]')||!key.contains(hit)};
 });
 assert.ok(retained,'Phone-to-name switch left a blank frame before Safari reported the native keyboard');
 assert.ok(Math.abs(retained.top-idlePadTop)<=2,'The outgoing key surface should stay in place');
 assert.ok(retained.blocked,'The outgoing keys must no longer edit the previous number');
 assert.equal(await nameField.evaluate(el=>el===document.activeElement),true);
 await assertOneKeyboardInset(idlePadTop,'Waiting for the native keyboard');
 await assertStill(shortFrame,'First frame of phone-to-name handoff');
 await viewport(725,13);
 const incoming=await editor.locator('.phone-number-pad').boundingBox();
 assert.ok(incoming && Math.abs(incoming.y-13-idlePadTop)<=2,
   'Outgoing keys should remain behind the partially raised native keyboard');
 await assertOneKeyboardInset(idlePadTop,'Native keyboard has only partially covered the number pad');
 await keyboardGeometry(492,24,true);
 await editor.locator('.phone-number-pad').waitFor({state:'hidden',timeout:2500});
 assert.equal(await shortPhone.inputValue(),lastValue);
 // The reverse handoff starts while the old native keyboard is still fully visible.
 // Then it shrinks through the web keypad's height. Never reserve both heights.
 await shortPhone.click();
 await assertNoTransientReveal('Taking over from the native keyboard');
 await assertStill(shortFrame,'Phone focus before Safari starts hiding the native keyboard');
 await assertOneKeyboardInset(idlePadTop,'Native keyboard still fully open');
 await viewport(720,18);
 await assertStill(shortFrame,'Changing partial native occlusion');
 await assertOneKeyboardInset(idlePadTop,'Native keyboard partially closed');
 await viewport(844,0);
 await visibleAbovePad(true);
 await assertStill(shortFrame,'Phone keypad finished taking over');
 // A hardware keyboard can focus the name without causing any visualViewport resize.
 await nameField.click();
 await editor.locator('.phone-number-pad').waitFor({state:'hidden',timeout:2500});
 assert.equal(await nameField.evaluate(el=>el===document.activeElement),true);
 await assertStill(shortFrame,'Native keyboard did not appear');
 await shortPhone.click();
 const staleKey=await padKey('2').boundingBox();
 await nameField.click();
 await page.touchscreen.tap(staleKey.x+staleKey.width/2,staleKey.y+staleKey.height/2);
 assert.equal(await shortPhone.inputValue(),lastValue,'A tap on the outgoing keyboard must not edit the old number');
 await nameField.focus();
 // A short form scrolled to its end can lose its scroll range when the incoming
 // keyboard is smaller. An already visible number/name must not jump as a result.
 await keyboardGeometry(460,32,false);
 await panel.hover();
 await page.mouse.wheel(0,1800);
 await page.waitForFunction(()=>{
   const p=document.querySelector('.ios-editor-scroll');
   return p.scrollTop>0 && p.scrollHeight-p.clientHeight-p.scrollTop<=2;
 });
 const endFrame=await editorFrame();
 await shortPhone.click();
 await viewport(735,18);
 await assertOneKeyboardInset(idlePadTop,'At the end of a short form');
 await assertStill(endFrame,'Shorter phone keypad after scrolling to the end');
 await viewport(844,0);
 await visibleAbovePad(false);
 await assertStill(endFrame,'Scroll is retained after a shorter phone keypad takes over');
 await nameField.click();
 await viewport(675,12);
 await editor.locator('.phone-number-pad').waitFor({state:'hidden',timeout:2500});
 await assertStill(endFrame,'Shorter native keyboard after scrolling to the end');
 await nameField.blur();
 await viewport(730,12);
 // Cancel while Safari's keyboard is still going down: the editing surface
 // unmounts, but the dock must stay hidden throughout the remaining animation.
 await editor.getByRole('button',{name:'取消',exact:true}).click();
 await editor.waitFor({state:'hidden'});
 assert.ok(await page.locator('.phone-dock').isHidden(),'Exiting an editor mid-dismissal must not reveal navigation');
 await assertDockDismissal(true);
 await viewport(844,0);
 await sheet.getByRole('button',{name:'返回',exact:true}).click();
 await sheet.waitFor({state:'hidden'});
 await openCard(longCard.name);
 await sheet.getByRole('button',{name:'编辑',exact:true}).click();
 await editor.locator('.ios-editor-scroll').evaluate(panel=>{panel.scrollTop=50});
 const scrolledFrame=await editorFrame();
 assert.ok(scrolledFrame.scroll[0]>=49,'A long form must be scrolled for this scenario');
 await nameField.click();
 await keyboardGeometry(492,24,false);
 await assertStill(scrolledFrame,'Opening the keyboard on an already visible field in a scrolled form');
 await assertNoTransientReveal('Already-scrolled long form');
 // There is not enough room in this frame to preserve the old name position.
 // Only the overlap and a small caret margin should be scrolled away.
 await viewport(280,24);
 await page.waitForFunction(()=>{
   const form=document.querySelector('.ios-editor-edit');
   const toolbar=form.querySelector('header').getBoundingClientRect();
   const name=form.querySelector('[data-editor-name]').getBoundingClientRect();
   const room=window.fixtureVV.offsetTop+window.fixtureVV.height-name.bottom;
   return document.activeElement.matches('[data-editor-name]') && name.top>=toolbar.bottom && room>=0 && room<=16;
 },null,{timeout:2500});
 await assertNoTransientReveal('Only the obstructed portion moved');
 await viewport(492,24);
 await assertStill(scrolledFrame,'Reduced occlusion restores the original reading position');
 await editor.getByLabel('联系人电话号码',{exact:true}).click();
 await assertStill(scrolledFrame,'Switching a scrolled form while the native keyboard is open');
 await assertOneKeyboardInset(idlePadTop,'Scrolled name-to-phone handoff');
 await viewport(844,0);
 await visibleAbovePad(false);
 await nameField.click();
 await assertStill(scrolledFrame,'Switching back to name before the native keyboard reports its inset');
 await keyboardGeometry(492,24,false);
 await assertStill(scrolledFrame,'Restored native keyboard on a scrolled form');
 await nameField.blur();
 await viewport(844,0);
 await assertStill(scrolledFrame,'Closing the keyboard in a scrolled form');
 const longPhone=editor.getByLabel('联系人电话号码 12',{exact:true});
 await longPhone.click();
 await visibleAbovePad(false);
 await page.screenshot({path:path.join(screenshots,'contact-edit-long-number-pad.png'),animations:'disabled'});
 const otherPhone=editor.getByLabel('联系人电话号码 11',{exact:true});
 const untouched=await longPhone.inputValue();
 await otherPhone.click();
 await setSelection(otherPhone,0);
 await padKey('4').click();
 assert.equal(await otherPhone.inputValue(),'4'+longNumbers[10]);
 assert.equal(await longPhone.inputValue(),untouched);
 await padKey('收起键盘').click();
 await editor.getByRole('button',{name:'取消',exact:true}).click();
 await simulatedInsets.evaluate(style=>style.remove());
 await sheet.getByRole('button',{name:'返回',exact:true}).click();
 await sheet.waitFor({state:'hidden'});
 await openCard(row.name);
 await sheet.waitFor();
 assert.deepEqual(await sheet.locator('.directory-phone-row b').allTextContents(),phoneNumbers);
 await page.screenshot({path:path.join(screenshots,'contact-detail.png'),animations:'disabled'});
 const editButton=sheet.getByRole('button',{name:'编辑',exact:true});
 const backButton=sheet.getByRole('button',{name:'返回',exact:true});
 assert.ok((await editButton.boundingBox()).x>(await backButton.boundingBox()).x,'Edit must be on the right of Back');
 const sms=sheet.getByLabel('给联系人发短信',{exact:true});
 const call=sheet.getByLabel('拨打联系人',{exact:true});
 assert.ok((await sms.boundingBox()).x<(await call.boundingBox()).x,'The message action precedes the call action');
 await sms.click();
 const smsPicker=page.getByRole('dialog',{name:'选择短信号码',exact:true});
 await smsPicker.waitFor();
 const links=await smsPicker.getByRole('link').evaluateAll(nodes=>nodes.map(a=>a.href));
 assert.deepEqual(links.map(href=>new URL(href).hash),phoneNumbers.map(number=>'#compose='+number));
 assert.ok(links.every(href=>new URL(href).protocol==='https:'&&new URL(href).port==='8443'&&!new URL(href).search));
 await page.keyboard.press('Escape');
 await smsPicker.waitFor({state:'hidden'});
 await call.click();
 const callPicker=page.getByRole('dialog',{name:'选择拨号号码',exact:true});
 assert.deepEqual(await callPicker.getByRole('button').filter({hasText:/^\d+$/}).allTextContents(),phoneNumbers);
 await callPicker.getByRole('button',{name:/5550101/}).click();
 assert.equal(await page.getByLabel('电话号码',{exact:true}).inputValue(),'5550101');
 assert.deepEqual(writes,[],'Opening a detail or choosing a number must not write or dial');

 await page.locator('nav button').filter({hasText:'联系人'}).click();
 await openCard(row.name);
 await page.emulateMedia({colorScheme:'dark'});
 await page.screenshot({path:path.join(screenshots,'contact-detail-dark.png'),animations:'disabled'});
 await page.emulateMedia({colorScheme:'light'});
 await editButton.click();
 await editor.waitFor();
 assert.deepEqual(await editor.locator('input[data-phone-id]').evaluateAll(inputs=>inputs.map(input=>input.value)),phoneNumbers);
 assert.ok(await editor.getByRole('button',{name:'完成',exact:true}).isDisabled(),'An unchanged contact must not generate a write');
 await page.screenshot({path:path.join(screenshots,'contact-edit.png'),animations:'disabled'});
 await editor.getByRole('button',{name:'添加电话',exact:true}).click();
 const newNumber=editor.getByLabel('联系人电话号码 3',{exact:true});
 await numberPad.waitFor();
 assert.equal(await newNumber.evaluate(el=>el===document.activeElement&&el.inputMode==='none'),true);
 for(const digit of '5550102')await padKey(digit).click();
 assert.equal(await newNumber.inputValue(),'5550102');
 await padKey('收起键盘').click();
 await editor.getByRole('button',{name:'移除第 1 个电话号码',exact:true}).click();
 await editor.getByRole('button',{name:'删除',exact:true}).click();
 assert.equal(await editor.getByLabel('联系人电话号码',{exact:true}).inputValue(),'5550101');
 const dockTab=page.locator('.phone-dock').getByRole('button',{name:'拨号键盘',exact:true});
 const confirmDialog=page.waitForEvent('dialog',{timeout:4000}).then(async dialog=>{
   assert.equal(dialog.type(),'confirm');
   await dialog.dismiss();
 });
 await Promise.all([dockTab.click(),confirmDialog]);
 assert.ok(await editor.isVisible(),'Dismissing the discard prompt should keep the draft open');
 await editor.getByRole('button',{name:'取消',exact:true}).click();
 assert.deepEqual(writes,[],'Removing a number from a cancelled draft must not change Android contacts');
 await editButton.click();
 assert.equal(await editor.getByLabel('联系人电话号码',{exact:true}).inputValue(),phoneNumbers[0]);
 await editor.getByLabel('姓名',{exact:true}).fill('合成备注');
 await editor.getByRole('button',{name:'添加电话',exact:true}).click();
 await editor.getByLabel('联系人电话号码 3',{exact:true}).fill('5550102');
 assert.ok(await numberPad.isVisible());
 await page.getByRole('button',{name:'完成',exact:true}).click();
 await editor.waitFor({state:'hidden'});
 assert.equal(writes.length,1);assert.equal(writes[0][0],'contacts/native/edit');assert.equal(writes[0][1].deviceId,'server');assert.equal(writes[0][1].rawId,'raw');assert.equal('targets' in writes[0][1],false);
 assert.deepEqual(writes[0][1].numbers,[...phoneNumbers,'5550102']);
 assert.ok(writes[0][1].requestId);assert.equal(writes[0][1].revision,2);
 await editButton.click();await editor.waitFor();
 await dockTab.click();
 await editor.waitFor({state:'hidden'});
 await sheet.waitFor({state:'hidden'});
 assert.equal(await list.evaluate(element=>element.inert),false,'Switching tabs from Edit must release the underlying directory and dialer');
 await page.locator('nav button').filter({hasText:'联系人'}).click();await openCard(row.name);await sheet.waitFor();
 await backButton.click();await sheet.waitFor({state:'hidden'});
 canEdit=false;await page.reload();
 await page.locator('nav button').filter({hasText:'联系人'}).click();await openCard(row.name);
 if(await editButton.count())assert.ok(await editButton.isDisabled(),'Read-only installations cannot open a write editor');
 assert.equal(writes.length,1);assert.deepEqual(errors,[]);
 console.log('PASS contact list and number actions, keyboard handoff with one inset, inert outgoing keys, hardware timeout, preserved scroll, cancellation, versioned save and read-only capability');
 }finally{await browser.close();server.close()}
})().catch(e=>{server.close();console.error(e);process.exitCode=1});
