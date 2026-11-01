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
 const row={id:'demo',name:'合成联系人',numbers:['5550100'],sources:[],revision:2,favorite:false,conflict:false};
 await page.route('**/api/**',async route=>{
   const req=route.request(),endpoint=new URL(req.url()).pathname.replace('/api/v2/','');
   const data={
    session:{installationId:'test',permissions:['contacts.read','calls.read','contacts.write']},
    devices:[{deviceId:'server',name:'主机',online:true}],lines:[{lineId:'line-a',deviceId:'server',name:'主机 · A',online:true,confirmed:true}],
    'voice/status':{ready:false,reason:'测试：语音未配置'},'voice/history':[],contacts:{items:[row],next:null},
    'contact-sync/jobs':{items:[]},'call-history':{items:[{id:'record1',name:'合成联系人',number:'5550100',deviceId:'server',type:'missed',date:1720000000000,duration:0}],next:null},
   };
   if(req.method()!=='GET')writes.push([endpoint,req.postDataJSON()]);
   if(!(endpoint in data)&&endpoint!=='contacts/edit')throw Error('Unexpected fixture path '+endpoint);
   return route.fulfill({contentType:'application/json',body:JSON.stringify(data[endpoint]||{id:'demo'})});
 });
 await page.goto('http://127.0.0.1:'+server.address().port+'/phone/');
 await page.getByRole('button',{name:'合成联系人',exact:false}).first().click();
 await page.getByRole('button',{name:'拨打此号码'}).click();
 assert.equal(await page.getByLabel('电话号码',{exact:true}).inputValue(),'5550100');
 assert.ok(await page.getByRole('button',{name:'拨打',exact:true}).isDisabled());
 await page.locator('nav button').filter({hasText:'联系人'}).click();
 await page.getByRole('button',{name:/合成联系人/}).click();
 await page.getByRole('button',{name:'编辑',exact:true}).click();
 await page.getByLabel('姓名或备注').fill('合成备注');
 await page.getByRole('button',{name:'保存',exact:true}).click();
 await page.waitForFunction(()=>!Array.from(document.querySelectorAll('h1')).some(el=>el.textContent==='编辑联系人'));
 assert.equal(writes.length,1);assert.equal(writes[0][0],'contacts/edit');assert.deepEqual(writes[0][1].targets,[]);
 assert.ok(writes[0][1].requestId);assert.equal(writes[0][1].revision,2);assert.deepEqual(errors,[]);
 console.log('PASS recent → dial, unconfigured/unauthorized calling, explicit contact edit with no device writes');
 }finally{await browser.close();server.close()}
})().catch(e=>{server.close();console.error(e);process.exitCode=1});
