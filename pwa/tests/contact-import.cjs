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

 let imported=false;const requests=[];
 await page.route('**/api/**',async route=>{
  const req=route.request(),endpoint=new URL(req.url()).pathname.replace('/api/v2/','');
  const data={
   session:{installationId:'test',permissions:['contacts.read','contacts.write']},
   devices:[{deviceId:'server',name:'主机',online:true}],lines:[],
   'call-history/missed':{count:0},'voice/history':[],
   contacts:{items:imported?[{id:'new',name:'合成姓名',numbers:['5550100'],sources:[],revision:1,favorite:false,conflict:false}]:[],next:null},
   'contact-sync/jobs':{items:[]},'call-history':{items:[],next:null}
  };
  if(endpoint==='contacts/import'){
   const body=req.postDataJSON();requests.push(body);
   assert.equal(req.method(),'POST');assert.equal(body.contacts.length,1);
   assert.deepEqual(body.contacts[0],{name:'合成姓名',numbers:['5550100']});
   assert.ok(body.requestId);assert.equal('targets' in body,false);
   if(requests.length===1)return route.abort('failed');
   imported=true;return route.fulfill({contentType:'application/json',body:JSON.stringify({added:1,skipped:0,replayed:true})});
  }
  if(req.method()!=='GET')writes.push(endpoint);
  if(!(endpoint in data))throw Error('Unexpected fixture path '+endpoint);
  return route.fulfill({contentType:'application/json',body:JSON.stringify(data[endpoint])});
 });
 await page.goto('http://127.0.0.1:'+server.address().port+'/phone/');
 await page.locator('nav button').filter({hasText:'联系人'}).click();
 await page.getByRole('button',{name:'导入 iPhone 联系人',exact:true}).click();
 await page.getByLabel('联系人文件').setInputFiles({
  name:'synthetic.vcf',mimeType:'text/vcard',
  buffer:Buffer.from('BEGIN:VCARD\r\nVERSION:3.0\r\nFN:合成姓名\r\nTEL:5550100\r\nEND:VCARD\r\nBEGIN:VCARD\r\nFN:合成姓名\r\nTEL:5550100\r\nEND:VCARD\r\n')
 });
 await page.getByText('可导入 1 条 · 文件内重复 1 条 · 跳过 0 条',{exact:true}).waitFor();
 assert.equal(requests.length,0);
 await page.getByRole('button',{name:'确认导入到助手',exact:true}).click();
 await page.getByRole('alert').filter({hasText:'重试当前批次'}).waitFor();
 await page.getByRole('button',{name:'继续导入',exact:true}).click();
 await page.getByText('导入完成：新增 1 条，跳过 1 条重复联系人',{exact:true}).waitFor();
 assert.deepEqual(requests[0],requests[1]);assert.deepEqual(writes,[]);assert.deepEqual(errors,[]);
 await page.getByRole('button',{name:/合成姓名/}).waitFor();
 console.log('PASS explicit vCard preview/import, lost reply retry keeps request ID, no system-contact targets');
 }finally{await browser.close();server.close()}
})().catch(e=>{server.close();console.error(e);process.exitCode=1});
