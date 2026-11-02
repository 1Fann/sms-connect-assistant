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


 let renamed=false,imported=false;const edits=[],imports=[];let pages=new Set();
 await page.route('**/api/**',async route=>{
  const req=route.request(),url=new URL(req.url()),endpoint=url.pathname.replace('/api/v2/','');
  const original={id:'original',name:renamed?'张三':'三张',numbers:['5550100'],sources:[],revision:renamed?8:7,favorite:true,conflict:false};
  if(endpoint==='contacts'){
   const offset=+(url.searchParams.get('offset')||0);pages.add(offset);
   return route.fulfill({contentType:'application/json',body:JSON.stringify(offset===50?{items:[original],next:null}:{items:imported?[{...original,id:'new',name:'合成姓名',numbers:['5550101']}]:[],next:50})});
  }
  if(endpoint==='contacts/edit'){
   const body=req.postDataJSON();edits.push(body);
   assert.equal(body.id,'original');assert.equal(body.revision,7);assert.equal(body.name,'张三');
   assert.deepEqual(body.targets,[]);assert.equal('numbers' in body,false);assert.equal('favorite' in body,false);
   renamed=true;
   if(edits.length===1)return route.abort('failed');
   return route.fulfill({contentType:'application/json',body:JSON.stringify({id:'original',replayed:true})});
  }
  if(endpoint==='contacts/import'){
   const body=req.postDataJSON();imports.push(body);
   assert.deepEqual(body.contacts,[{name:'合成姓名',numbers:['5550101']}]);
   imported=true;
   if(imports.length===1)return route.abort('failed');
   return route.fulfill({contentType:'application/json',body:JSON.stringify({added:1,skipped:0,replayed:true})});
  }
  const data={session:{installationId:'test',permissions:['contacts.read','contacts.write']},devices:[],lines:[],
   'call-history/missed':{count:0},'voice/history':[],'contact-sync/jobs':{items:[]},'call-history':{items:[],next:null}};
  assert.equal(req.method(),'GET');
  if(!(endpoint in data))throw Error('Unexpected fixture '+endpoint);
  return route.fulfill({contentType:'application/json',body:JSON.stringify(data[endpoint])});
 });
 await page.goto('http://127.0.0.1:'+server.address().port+'/phone/');
 await page.locator('nav button').filter({hasText:'联系人'}).click();
 await page.getByRole('button',{name:'导入 iPhone 联系人',exact:true}).click();
 await page.getByLabel('联系人文件').setInputFiles({name:'synthetic.vcf',mimeType:'text/vcard',buffer:Buffer.from(
 'BEGIN:VCARD\r\nN:张;三;;;\r\nFN:三张\r\nTEL:5550100\r\nEND:VCARD\r\nBEGIN:VCARD\r\nFN:合成姓名\r\nTEL:5550101\r\nEND:VCARD\r\n')});
 await page.getByRole('status').filter({hasText:'可更正 1 条'}).waitFor();
 assert.ok(pages.has(50));assert.equal(edits.length,0);assert.equal(imports.length,0);
 await page.getByRole('button',{name:'确认导入并更正姓名',exact:true}).click();
 await page.getByRole('alert').filter({hasText:'重试当前批次'}).waitFor();
 assert.equal(imports.length,0);
 await page.getByRole('button',{name:'继续导入',exact:true}).click();
 await page.waitForFunction(()=>Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='继续导入'&&!b.disabled));
 assert.equal(edits.length,2);assert.equal(imports.length,1);
 await page.getByRole('button',{name:'继续导入',exact:true}).click();
 await page.getByText('导入完成：新增 1 条，更正姓名 1 条，跳过 0 条重复联系人',{exact:true}).waitFor();
 assert.deepEqual(edits[0],edits[1]);assert.deepEqual(imports[0],imports[1]);assert.deepEqual(errors,[]);
 console.log('PASS paginated name-repair preview, same-ID/revision name-only edits, saved favorites/numbers and lost-reply retries');
 }finally{await browser.close();server.close()}
})().catch(e=>{server.close();console.error(e);process.exitCode=1});
