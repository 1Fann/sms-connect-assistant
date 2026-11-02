// Exercise built CommLink assets with synthetic records, without registering SIP or calling any phone.
const http=require('node:http'), fs=require('node:fs'), path=require('node:path'), assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'../../app/src/main/assets/iphone');
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
 const page=await browser.newPage({viewport:{width:390,height:844},serviceWorkers:'block'});const writes=[],errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 const screenshots=path.resolve(__dirname,'../../.work/contacts-ui');
 fs.mkdirSync(screenshots,{recursive:true});
 const photo=await page.evaluate(()=>{
   const canvas=document.createElement('canvas');canvas.width=64;canvas.height=64;
   const ctx=canvas.getContext('2d');ctx.fillStyle='#246eaf';ctx.fillRect(0,0,64,64);ctx.fillStyle='#95d7ed';
   ctx.beginPath();ctx.moveTo(0,56);ctx.lineTo(38,15);ctx.lineTo(64,48);ctx.lineTo(64,64);ctx.lineTo(0,64);ctx.fill();
   return canvas.toDataURL('image/png').split(',')[1];
 });
 const row={id:'demo',name:'合成联系人',numbers:['5550100','5550101'],deviceId:'server',primaryRawId:'raw',sources:[{deviceId:'server',rawId:'raw',contactId:'5',revision:'source-2',name:'合成联系人',numbers:['5550100','5550101'],readOnly:false}],revision:2,favorite:false,conflict:false};
 const cards=[row,...['岸桥','北辰','彩禾','冬青','枫林','河谷','江城','蓝石','南星','松石','云舟','栀子'].map((name,index)=>{
   const number='55502'+String(index).padStart(2,'0');
   return {...row,id:'extra-'+index,name,numbers:[number],photo:name==='北辰'?photo:undefined,
     sources:[{...row.sources[0],name,numbers:[number]}]};
 })];
 let canEdit=true;
 await page.route('**/api/**',async route=>{
   const req=route.request(),url=new URL(req.url()),endpoint=url.pathname.replace('/api/v2/','');
   const data={
    session:{installationId:'test',permissions:['contacts.read','calls.read',...(canEdit?['contacts.write']:[])]},
    devices:[{deviceId:'server',name:'主机',online:true,contactsWrite:true}],lines:[{lineId:'line-a',deviceId:'server',name:'主机 · A',online:true,confirmed:true}],
    'call-history/missed':{count:0},'call-history/seen':{count:0},'voice/history':[],contacts:{items:cards.filter(card=>card.name.includes(url.searchParams.get('q')||'')),next:null},
    'contact-sync/jobs':{items:[{id:'job',state:'done',detail:''}]},'call-history':{items:[{id:'record1',name:'合成联系人',number:'5550100',deviceId:'server',type:'missed',date:1720000000000,duration:0}],next:null},
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
 assert.equal(await page.getByLabel('电话号码',{exact:true}).inputValue(),'5550100');
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
 await simulatedInsets.evaluate(style=>style.remove());

 await openCard('北辰');
 await sheet.locator('img').first().waitFor();
 assert.ok(await sheet.locator('img').first().evaluate(async img=>{await img.decode();return img.naturalWidth===64}),'Contact photo is not decoded on the detail page');
 const onlyNumberLink=sheet.getByLabel('给联系人发短信',{exact:true});
 assert.equal(new URL(await onlyNumberLink.getAttribute('href')).hash,'#compose=5550201');
 await sheet.getByRole('button',{name:'返回',exact:true}).click();
 await sheet.waitFor({state:'hidden'});
 await openCard(row.name);
 await sheet.waitFor();
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
 assert.deepEqual(links.map(href=>new URL(href).hash),['#compose=5550100','#compose=5550101']);
 assert.ok(links.every(href=>new URL(href).protocol==='https:'&&new URL(href).port==='8443'&&!new URL(href).search));
 await page.keyboard.press('Escape');
 await smsPicker.waitFor({state:'hidden'});
 await call.click();
 const callPicker=page.getByRole('dialog',{name:'选择拨号号码',exact:true});
 await callPicker.getByRole('button',{name:/5550101/}).click();
 assert.equal(await page.getByLabel('电话号码',{exact:true}).inputValue(),'5550101');
 assert.deepEqual(writes,[],'Opening a detail or choosing a number must not write or dial');

 await page.locator('nav button').filter({hasText:'联系人'}).click();
 await openCard(row.name);
 await page.emulateMedia({colorScheme:'dark'});
 await page.screenshot({path:path.join(screenshots,'contact-detail-dark.png'),animations:'disabled'});
 await page.emulateMedia({colorScheme:'light'});
 await editButton.click();
 const editor=page.getByRole('dialog',{name:'编辑联系人',exact:true});
 await editor.waitFor();
 assert.ok(await editor.getByRole('button',{name:'完成',exact:true}).isDisabled(),'An unchanged contact must not generate a write');
 await page.screenshot({path:path.join(screenshots,'contact-edit.png'),animations:'disabled'});
 await editor.getByRole('button',{name:'添加电话',exact:true}).click();
 await editor.getByLabel('联系人电话号码 3',{exact:true}).fill('5550102');
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
 assert.equal(await editor.getByLabel('联系人电话号码',{exact:true}).inputValue(),'5550100');
 await editor.getByLabel('姓名',{exact:true}).fill('合成备注');
 await editor.getByRole('button',{name:'添加电话',exact:true}).click();
 await editor.getByLabel('联系人电话号码 3',{exact:true}).fill('5550102');
 await page.getByRole('button',{name:'完成',exact:true}).click();
 await editor.waitFor({state:'hidden'});
 assert.equal(writes.length,1);assert.equal(writes[0][0],'contacts/native/edit');assert.equal(writes[0][1].deviceId,'server');assert.equal(writes[0][1].rawId,'raw');assert.equal('targets' in writes[0][1],false);
 assert.deepEqual(writes[0][1].numbers,['5550100','5550101','5550102']);
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
 console.log('PASS contact list index, thumbnails, single/multiple number actions, native detail/edit surfaces, cancelled draft protection, versioned save and read-only capability');
 }finally{await browser.close();server.close()}
})().catch(e=>{server.close();console.error(e);process.exitCode=1});
