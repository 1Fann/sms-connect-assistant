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

 let state='queued',reads=0,nativeEmpty=false,scanError='';const mutations=[];
 const row={id:'android-card',deviceId:'B',name:'安卓演示',numbers:['5550100'],revision:8,favorite:false,conflict:true,primaryRawId:'raw-7',
  sources:[{deviceId:'B',rawId:'raw-7',contactId:'11',revision:'native-v1',name:'安卓演示',numbers:['5550100'],readOnly:false}]};
 await page.route('**/api/**',async route=>{
  const req=route.request(),url=new URL(req.url()),endpoint=url.pathname.replace('/api/v2/','');
  if(req.method()==='POST'){
   assert.equal(endpoint,'contacts/native/create');const body=req.postDataJSON();mutations.push(body);
   assert.equal(body.destination,'android');assert.equal(body.deviceId,'B');assert.equal('targets' in body,false);
   return route.fulfill({contentType:'application/json',body:JSON.stringify({id:'pending-native',deviceId:'B',jobId:'job',state:'queued'})});
  }
  if(endpoint==='contact-sync/jobs'){
   reads++;return route.fulfill({contentType:'application/json',body:JSON.stringify({items:[{id:'job',state,detail:state==='denied'?'安卓未允许远程编辑':''}]})});
  }
  const data={session:{installationId:'native',permissions:['contacts.read','contacts.write']},devices:[{deviceId:'A',name:'主机',online:true,contactsWrite:true},{deviceId:'B',name:'另一手机',online:false,contactsWrite:true}],
   lines:[],'call-history/missed':{count:0},'voice/history':[],contacts:{items:nativeEmpty?[]:[row],next:null,syncError:scanError}};
  assert.ok(endpoint in data);
  return route.fulfill({contentType:'application/json',body:JSON.stringify(data[endpoint])});
 });
 await page.goto('http://127.0.0.1:'+server.address().port+'/phone/');
 await page.locator('nav button').filter({hasText:'联系人'}).click();
 await page.getByRole('button',{name:/安卓演示/}).waitFor();
 assert.equal(await page.getByText('待核对',{exact:true}).count(),0);
 assert.equal(await page.getByRole('button',{name:'导入 iPhone 联系人',exact:true}).count(),0);
 assert.equal(await page.getByRole('button',{name:'最近删除',exact:true}).count(),0);
 await page.getByRole('button',{name:'新建联系人',exact:true}).click();
 await page.getByLabel('姓名',{exact:true}).fill('新联系人');
 await page.getByLabel('联系人电话号码').fill('5550300');
 assert.equal(await page.getByLabel('保存到安卓手机').inputValue(),'');
 assert.ok(await page.getByRole('button',{name:'完成',exact:true}).isDisabled());
 await page.getByLabel('保存到安卓手机').selectOption('B');
 await page.getByRole('button',{name:'完成',exact:true}).click();
 await page.getByRole('status').filter({hasText:'正在等待手机确认写入'}).waitFor();
 assert.ok(reads>0);assert.equal(mutations.length,1);
 assert.equal(await page.getByText('已写入安卓通讯录，列表将自动同步。',{exact:true}).count(),0);
 assert.ok(await page.getByRole('dialog',{name:'新建联系人',exact:true}).isVisible());
 state='done';
 await page.getByText('已写入安卓通讯录，列表将自动同步。',{exact:true}).waitFor();
 assert.equal(mutations.length,1);
 state='denied';
 await page.getByRole('button',{name:'新建联系人',exact:true}).click();
 await page.getByLabel('姓名',{exact:true}).fill('另一个');
 await page.getByLabel('保存到安卓手机').selectOption('B');
 await page.getByRole('button',{name:'完成',exact:true}).click();
 await page.getByRole('alert').filter({hasText:'安卓未允许远程编辑'}).waitFor();
 assert.equal(mutations.length,2);assert.ok(await page.getByRole('dialog',{name:'新建联系人',exact:true}).isVisible());
 await page.locator('.call-contact-editor').getByRole('button',{name:'返回',exact:true}).click();
 nativeEmpty=true;scanError='系统通讯录接口不兼容，联系人同步尚未完成';
 await page.goto('http://127.0.0.1:'+server.address().port+'/phone/');
 await page.locator('nav button').filter({hasText:'联系人'}).click();
 await page.getByRole('alert').filter({hasText:scanError}).waitFor();
 assert.equal(await page.getByText(/安卓系统通讯录暂无联系人/).count(),0,'A failed read must not be presented as an empty address book');
 nativeEmpty=false;scanError='';
 await page.getByRole('button',{name:'刷新',exact:true}).click();
 await page.getByRole('button',{name:/安卓演示/}).waitFor();
 assert.equal(await page.getByRole('alert').count(),0);
 assert.deepEqual(errors,[]);
 console.log('PASS removed import/merge/review workflows, explicit device selection with no fallback, queued is not saved, Provider receipt gates success and denial stays visible');
 }finally{await browser.close();server.close()}
})().catch(e=>{server.close();console.error(e);process.exitCode=1});
