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

 const screenshotDir=path.resolve(__dirname,'../../.work/contacts-ui');
 fs.mkdirSync(screenshotDir,{recursive:true});
 const contacts=Array.from({length:40},(_,i)=>({id:'contact-'+i,name:'合成联系人 '+String(i).padStart(2,'0'),numbers:['55502'+String(i).padStart(2,'0')],deviceId:'server',primaryRawId:'raw-'+i,sources:[{deviceId:'server',contactId:String(i+1),rawId:'raw-'+i,revision:'raw-v3',name:'合成联系人 '+String(i).padStart(2,'0'),numbers:['55502'+String(i).padStart(2,'0')],readOnly:false}],revision:3,favorite:i===0,conflict:false}));
 const create=[],edit=[];let canWrite=true;
 const record={id:'call',name:'',number:'5550100',deviceId:'server',slot:1,type:'outgoing',date:1720000000000,duration:40};
 await page.addInitScript(()=>{
  const v=new EventTarget();Object.assign(v,{height:844,width:390,offsetTop:0,scale:1});
  window.fixtureVV=v;Object.defineProperty(window,'visualViewport',{get:()=>v});
 });
 await page.route('**/api/**',async route=>{
  const req=route.request(),url=new URL(req.url()),endpoint=url.pathname.replace('/api/v2/','');
  if(endpoint==='contacts/native/create'){
   const body=req.postDataJSON();create.push(body);
   assert.equal(body.destination,'android');assert.equal(body.deviceId,'server');assert.equal('targets' in body,false);assert.deepEqual(body.numbers,['5550100']);assert.equal(body.name,'新建演示');
   record.name=body.name;
   if(create.length===1)return route.abort('failed');
   return route.fulfill({contentType:'application/json',body:JSON.stringify({id:'created',deviceId:'server',jobId:'create-job',state:'queued',replayed:true})});
  }
  if(endpoint==='contacts/native/edit'){
   const body=req.postDataJSON();edit.push(body);
   assert.equal(body.id,'contact-0');assert.deepEqual(body.numbers,['5550200','5550100']);
   assert.equal(body.destination,'android');assert.equal(body.deviceId,'server');assert.equal('targets' in body,false);assert.equal('name' in body,false);assert.equal('favorite' in body,false);
   if(edit.length===1){contacts[0].revision=4;contacts[0].sources[0].revision='raw-v4';return route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({error:'联系人已改变，请刷新后重选'})})}
   assert.equal(body.revision,4);assert.equal(body.rawId,'raw-0');assert.equal(body.sourceRevision,'raw-v4');contacts[0].sources[0].numbers=body.numbers;contacts[0].numbers=body.numbers;contacts[0].revision=5;record.name=contacts[0].name;
   return route.fulfill({contentType:'application/json',body:JSON.stringify({id:'contact-0',deviceId:'server',jobId:'edit-job',state:'queued'})});
  }
  const q=url.searchParams.get('q')||'';
  const data={session:{installationId:'test',permissions:['contacts.read','calls.read',...(canWrite?['contacts.write']:[])]},
   devices:[{deviceId:'server',name:'主机',online:true,contactsWrite:true}],lines:[],
   'call-history/missed':{count:0},'voice/history':[],
   'contacts/version':{version:'fixture'},contacts:{items:contacts.filter(c=>c.name.includes(q)),next:null,version:'fixture'},'contact-sync/jobs':{items:[{id:'create-job',state:'done',detail:''},{id:'edit-job',state:'done',detail:''}]},
   'call-history':{items:[record],next:null}};
  assert.equal(req.method(),'GET','Unexpected mutation '+endpoint);
  assert.ok(endpoint in data,'Unexpected route '+endpoint);
  return route.fulfill({contentType:'application/json',body:JSON.stringify(data[endpoint])});
 });
 const origin='http://127.0.0.1:'+server.address().port+'/phone/';
 await page.goto(origin);
 const dock=await page.locator('.phone-dock').boundingBox();
 const initialTop=await page.locator('.dial-top').evaluate(el=>({position:getComputedStyle(el).position,top:parseFloat(getComputedStyle(el).top)}));
 assert.equal(initialTop.position,'relative');assert.equal(initialTop.top,18);
 await page.locator('nav button').filter({hasText:'联系人'}).click();
 await page.getByRole('button',{name:'合成联系人 00',exact:true}).waitFor();
 await page.locator('#phone-app').evaluate(el=>{el.scrollTop=350});
 await page.evaluate(()=>{scrollTo(0,400);window.fixtureVV.offsetTop=38;window.fixtureVV.dispatchEvent(new Event('scroll'))});
 await page.waitForTimeout(300);
 const scrolledDock=await page.locator('.phone-dock').boundingBox();
 assert.equal(Math.round(scrolledDock.y),Math.round(dock.y),'Dock moved during content scroll/pull');
 assert.equal(await page.evaluate(()=>scrollY),0);
 assert.equal(await page.evaluate(()=>document.documentElement.style.getPropertyValue('--keyboard-inset')),'0px');
 assert.equal(await page.evaluate(()=>getComputedStyle(document.body).position),'fixed');
 await page.getByRole('button',{name:'搜索',exact:true}).click();
 await page.evaluate(()=>{window.fixtureVV.height=506;window.fixtureVV.offsetTop=28;window.fixtureVV.dispatchEvent(new Event('resize'))});
 await page.waitForTimeout(300);
 assert.equal(await page.evaluate(()=>document.documentElement.style.getPropertyValue('--keyboard-inset')),'338px');
 assert.equal(await page.locator('#root').evaluate(el=>Math.round(el.getBoundingClientRect().top)),28);
 const searchDock=await page.locator('.phone-dock').boundingBox();assert.ok(searchDock.y+searchDock.height<=506+28,'Search hidden behind keyboard');
 await page.getByRole('button',{name:'取消搜索'}).click();
 await page.evaluate(()=>{window.fixtureVV.height=844;window.fixtureVV.offsetTop=0;window.fixtureVV.dispatchEvent(new Event('resize'))});
 await page.waitForTimeout(300);
 assert.equal(await page.evaluate(()=>document.documentElement.style.getPropertyValue('--keyboard-inset')),'0px');
 await page.locator('nav button').filter({hasText:'通话'}).click();
 await page.locator('.call-row-main').first().click();
 await page.getByRole('button',{name:'新建联系人',exact:true}).click();
 await page.getByRole('dialog',{name:'新建联系人',exact:true}).waitFor();
 assert.equal(await page.getByLabel('联系人电话号码').inputValue(),'5550100');
 assert.equal(await page.locator('#root').evaluate(el=>el.inert),true);
 await page.getByRole('button',{name:'取消',exact:true}).click();assert.equal(create.length,0);
 await page.getByRole('button',{name:'新建联系人',exact:true}).click();
 await page.getByLabel('姓名',{exact:true}).fill('新建演示');
 await page.screenshot({path:path.join(screenshotDir,'create-contact.png'),animations:'disabled'});
 await page.getByRole('button',{name:'完成',exact:true}).click();
 await page.getByRole('alert').filter({hasText:'可重试'}).waitFor();
 await page.getByRole('button',{name:'重试',exact:true}).click();
 await page.getByText('已写入安卓通讯录',{exact:true}).waitFor();
 assert.deepEqual(create[0],create[1]);assert.equal(await page.locator('#root').evaluate(el=>el.inert),false);
 await page.getByRole('button',{name:'添加到现有联系人',exact:true}).click();
 await page.locator('.call-contact-editor').getByRole('button',{name:/合成联系人 00/}).click();
 await page.getByRole('button',{name:'完成',exact:true}).click();
 await page.getByRole('alert').filter({hasText:'联系人已改变'}).waitFor();
 await page.screenshot({path:path.join(screenshotDir,'append-contact.png'),animations:'disabled'});
 assert.equal(create.length,2);assert.equal(edit.length,1);assert.equal(await page.locator('.contact-sheet').evaluate(el=>el.inert),true);
 await page.locator('.call-contact-editor').getByRole('button',{name:'返回',exact:true}).click();
 await page.locator('.call-contact-editor').getByRole('button',{name:/合成联系人 00/}).click();
 await page.getByRole('button',{name:'完成',exact:true}).click();
 await page.getByText('已写入安卓通讯录',{exact:true}).waitFor();
 assert.notEqual(edit[0].requestId,edit[1].requestId);assert.equal(contacts[0].favorite,true);
 await page.getByRole('button',{name:'添加到现有联系人',exact:true}).click();
 await page.locator('.call-contact-editor').getByRole('button',{name:/合成联系人 00/}).click();
 await page.getByText('此联系人已包含该号码',{exact:true}).waitFor();
 assert.ok(await page.getByRole('button',{name:'完成',exact:true}).isDisabled());
 await page.locator('.call-contact-editor').getByRole('button',{name:'返回',exact:true}).click();await page.getByRole('button',{name:'取消',exact:true}).click();
 canWrite=false;
 await page.goto(origin);await page.locator('nav button').filter({hasText:'通话'}).click();await page.locator('.call-row-main').first().click();
 assert.equal(await page.getByRole('button',{name:'新建联系人',exact:true}).count(),0);
 assert.equal(await page.getByRole('button',{name:'添加到现有联系人',exact:true}).count(),0);
 assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);
 console.log('PASS anchored dock during scroll/pull, lowered controls, search keyboard avoidance, call-detail create/append/cancel, retry UUID, revision conflict, duplicate prevention and capability checks');
 }finally{await browser.close();server.close()}
})().catch(e=>{server.close();console.error(e);process.exitCode=1});
