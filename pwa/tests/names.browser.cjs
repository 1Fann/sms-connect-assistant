// Local fixtures only. No device or SMS service is contacted.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'../../app/src/main/assets/iphone');
const server=http.createServer((req,res)=>{try{const f=path.join(root,req.url==='/'?'index.html':req.url.split('?')[0]);if(!f.startsWith(root+path.sep))return res.writeHead(403).end();res.setHeader('Content-Type',f.endsWith('.js')?'application/javascript':f.endsWith('.css')?'text/css':'text/html');res.end(fs.readFileSync(f))}catch{res.writeHead(404).end()}});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({headless:true,channel:process.env.BROWSER_CHANNEL||'msedge'});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true,serviceWorkers:'block'});
  const phones=[{id:'server',name:'服务器手机'},{id:'peer',name:'共享手机'}];
  const names={1:'卡 1',2:'卡 2',101:'卡 1',102:'卡 2'};let fail=false;const errors=[];let sends=0;
  page.on('pageerror',e=>errors.push(e.message));
  const lines=()=>Object.entries(names).map(([key,simName])=>{const id=Number(key),p=phones[id>100?1:0];return{id,phoneId:p.id,phoneName:p.name,simName,slot:id>100?id-100:id,online:true,name:p.name+' · '+simName}});
  await page.route('**/api/**',async route=>{
   const req=route.request(),p=new URL(req.url()).pathname;let data={};let status=200;
   if(req.method()==='POST'&&['/api/phones','/api/sims'].includes(p)){
    if(fail){status=500;data={error:'模拟保存失败'}}else{const b=req.postDataJSON();if(p==='/api/phones')phones.find(x=>x.id===b.id).name=b.name.trim()||(b.id==='server'?'服务器手机':'共享手机');else names[b.id]=b.name.trim()||'卡 '+(Number(b.id)>100?Number(b.id)-100:b.id);}
   }else if(p==='/api/phones')data=phones;
   else if(p==='/api/sims')data=lines();
   else if(p==='/api/history')data={items:[{id:'xia:1',address:'13800138000',body:'模拟短信',date:Date.now(),incoming:true,read:true,sim:101,state:'received'}],next:null};
   else if(p==='/api/conversations'||p==='/api/outgoing')data=[];
   else if(p==='/api/send'){sends++;throw Error('Unexpected send')}
   await route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
  });
  const settings=async()=>{await page.getByRole('button',{name:'筛选与设置'}).click();await page.getByRole('menuitem',{name:'设置',exact:true}).click()};
  const save=async(label,value)=>{const input=page.getByLabel(label,{exact:true});await input.fill(value);await input.locator('xpath=ancestor::form').getByRole('button',{name:'保存',exact:true}).click()};
  await page.goto('http://127.0.0.1:'+server.address().port);await page.getByText('138 0013 8000',{exact:true}).waitFor();await settings();
  await page.getByLabel('共享手机名称',{exact:true}).fill('家中手机');
  await Promise.all([page.waitForResponse(r=>r.url().endsWith('/api/phones')),page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')))]);
  assert.equal(await page.getByLabel('共享手机名称',{exact:true}).inputValue(),'家中手机');
  await save('共享手机名称','家中手机');await page.getByLabel('家中手机 · SIM 1',{exact:true}).waitFor();
  fail=true;await save('家中手机 · SIM 1','工作卡');await page.getByRole('alert').waitFor();assert.equal(names[101],'卡 1');
  fail=false;await save('家中手机 · SIM 1','工作卡');await page.getByRole('alert').waitFor({state:'hidden'});assert.equal(names[101],'工作卡');
  await save('服务器手机名称','备用手机');await page.getByLabel('备用手机 · SIM 1',{exact:true}).waitFor();
  await save('备用手机 · SIM 2','');assert.equal(names[2],'卡 2');
  await page.reload();await page.getByText('138 0013 8000',{exact:true}).click();
  await page.locator('.message-line').filter({hasText:'家中手机 · 工作卡'}).waitFor();
  assert.equal(await page.getByLabel('发送线路',{exact:true}).inputValue(),'101');
  await page.getByRole('button',{name:'返回信息列表',exact:true}).click();await settings();
  assert.equal(await page.getByLabel('共享手机名称',{exact:true}).inputValue(),'家中手机');
  assert.equal(await page.getByLabel('家中手机 · SIM 1',{exact:true}).inputValue(),'工作卡');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.getByRole('heading',{name:'手机与 SIM 名称'}).scrollIntoViewIfNeeded();
  await page.screenshot({path:path.resolve(__dirname,'../../verification/custom-names.png')});
  assert.deepEqual(errors,[]);assert.equal(sends,0);
  console.log('PASS: editable phone/SIM aliases; poll preserves draft; save failure retry; reset defaults; reload; message and selector names; unchanged routing; mobile layout; no SMS');
 }finally{await browser.close();server.close()}
})().catch(e=>{console.error(e);server.close();process.exitCode=1});
