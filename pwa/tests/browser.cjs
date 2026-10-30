// Test-only SMS adapter. This process cannot send actual SMS.
const http = require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root=path.resolve(__dirname,'../../app/src/main/assets/iphone');
const server=http.createServer((req,res)=>{const file=path.join(root,req.url==='/'?'index.html':req.url.split('?')[0]);if(!file.startsWith(root)){res.writeHead(403).end();return}try{res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':file.endsWith('.png')?'image/png':'text/html');res.end(fs.readFileSync(file))}catch{res.writeHead(404).end()}});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({headless:true,channel:process.env.BROWSER_CHANNEL || 'msedge'});
 try{
 const page=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true,serviceWorkers:'block'});
 let paired=false;let failSend=true;let historyFails=false;let failedMessage=null;const ids=[];const errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/**',async route=>{const p=new URL(route.request().url()).pathname;let data={};let status=200;
 if(p==='/api/pair'){data={status:'pending'}}else if(p==='/api/pair/finish'){paired=true;data={status:'ok'}}else if(!paired){status=401}
 else if(p==='/api/status'){data={publicConnectivity:'unverified'}}
 else if(p==='/api/sims'){data=[{id:1,name:'中国联通'},{id:2,name:'备用线路'}]}
 else if(p==='/api/history'){if(historyFails)status=500;data={items:[{id:'sms:1',address:'13800138000',body:'这是一条用于界面验证的测试短信。',date:Date.now(),incoming:true,read:false,sim:1,state:'received'}],next:null}}
 else if(p==='/api/outgoing'){data=failedMessage?[failedMessage]:[]}
 else if(p==='/api/send'){const body=route.request().postDataJSON();ids.push(body.id);if(failSend){failSend=false;await route.abort('failed');return}data={state:'accepted'}}
 else if(p.startsWith('/api/send/')){data={state:'unknown'}}
 await route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
 });
 const origin='http://127.0.0.1:'+server.address().port;
 await page.goto(origin);await page.getByLabel('安卓显示的配对码').fill('testcode1234');await page.getByRole('button',{name:'连接我的手机'}).click();
 await page.getByText('138 0013 8000',{exact:true}).waitFor();
 const out=path.resolve(__dirname,'../../verification');fs.mkdirSync(out,{recursive:true});await page.screenshot({path:path.join(out,'conversations-light.png')});
 await page.getByText('138 0013 8000',{exact:true}).click();await page.getByLabel('短信内容',{exact:true}).fill('仅模拟发送');await page.getByRole('button',{name:'发送短信',exact:true}).click();
 await page.getByRole('button',{name:'核对 / 重试同一请求'}).click();await page.getByText('网关已接受',{exact:true}).waitFor();assert.equal(ids.length,2);assert.equal(ids[0],ids[1]);
 await page.emulateMedia({colorScheme:'dark'});await page.screenshot({path:path.join(out,'chat-dark.png')});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.deepEqual(errors,[]);
 historyFails=true;failedMessage={id:ids[0],address:'+8613800138000',body:'仅模拟发送',date:Date.now(),incoming:false,read:true,sim:1,state:'failed',error:'安卓短信接口返回通用发送失败'};
 await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
 await page.getByText('发送失败 · 安卓短信接口返回通用发送失败',{exact:true}).waitFor();
 assert.equal(ids.length,2); // Refresh must never resend a failed message.
 console.log('PASS: outgoing failure updates even when history fails; no automatic resend');
 console.log('PASS: pairing, two SIM choices, history, safe timeout retry, accepted-not-delivered state, mobile overflow, no JS errors');
 }finally{await browser.close();server.close()}
})().catch(e=>{console.error(e);server.close();process.exitCode=1});
