// Opens only synthetic Messages pages; any send request is rejected immediately.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'../../app/src/main/assets/iphone');
const server=http.createServer((req,res)=>{const name=path.resolve(root,'.'+(req.url==='/'?'/index.html':req.url.split('?')[0]));if(!name.startsWith(root+path.sep)||!fs.existsSync(name))return res.writeHead(404).end();res.setHeader('Content-Type',name.endsWith('.js')?'application/javascript':name.endsWith('.css')?'text/css':'text/html');res.end(fs.readFileSync(name))});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({channel:process.env.BROWSER_CHANNEL||'msedge',headless:true});
 try{for(const initiallyPaired of [true,false]){
  const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'}),page=await context.newPage();
  let paired=initiallyPaired;const sends=[],errors=[];page.on('pageerror',e=>errors.push(e.message));
  await context.route('**/api/**',route=>{
   const key=new URL(route.request().url()).pathname.slice(5);let status=200,data={};
   if(key==='status'){if(!paired)status=401}
   else if(key==='refresh'){status=401}
   else if(key==='pair')data={status:'pending'};
   else if(key==='pair/finish'){paired=true;data={status:'ok'}}
   else if(key==='sims')data=[{id:1,lineId:'fixture-line',name:'SIM 1',phoneName:'Fixture',slot:1,simName:'SIM 1',online:true}];
   else if(key==='phones')data=[{id:'server',name:'Fixture'}];
   else if(key==='history')data={items:[],next:null};
   else if(['outgoing','conversations','contacts'].includes(key))data=[];
   else if(key==='send'){sends.push(key);return route.abort()}
   else throw Error('Unexpected API '+key);
   return route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
  });
  await page.goto('http://127.0.0.1:'+server.address().port+'/#compose=%2B15550100');
  if(!initiallyPaired){await page.getByLabel('安卓显示的配对码').fill('fixture');await page.getByRole('button',{name:'连接我的手机'}).click()}
  await page.getByLabel('收件人号码',{exact:true}).waitFor();
  assert.equal(await page.getByLabel('收件人号码',{exact:true}).inputValue(),'+15550100');
  assert.equal(await page.getByLabel('短信内容',{exact:true}).inputValue(),'');
  assert.equal(await page.getByRole('button',{name:'发送短信',exact:true}).isDisabled(),true);
  assert.equal(new URL(page.url()).hash,'');assert.deepEqual(sends,[]);assert.deepEqual(errors,[]);
  await context.close();
 }console.log('PASS Messages compose link prefill before/after pairing, fragment removal and zero automatic sends')}
 finally{await browser.close();server.close()}
})().catch(e=>{server.close();console.error(e);process.exitCode=1});
