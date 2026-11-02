// Real Service Worker, synthetic localhost gateway; never contacts an Android device.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'../../app/src/main/assets/iphone');
let hold=false,held=[],assetReads=0;
const serve=(req,res)=>{
 const pathname=new URL(req.url,'http://fixture.invalid').pathname;
 if(pathname.startsWith('/api/'))return res.writeHead(401,{'Content-Type':'application/json'}).end('{}');
 const file=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));
 if(!file.startsWith(root+path.sep))return res.writeHead(403).end();
 try{
  const body=fs.readFileSync(file);
  res.writeHead(200,{'Cache-Control':'no-store','Content-Type':file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':file.endsWith('.png')?'image/png':'text/html'}).end(body);
 }catch{res.writeHead(404).end()}
};
const server=http.createServer((req,res)=>{
 if(req.url.startsWith('/assets/'))assetReads++;
 if(hold&&req.url==='/'){held.push([req,res]);return}
 serve(req,res);
});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({headless:true,channel:process.env.BROWSER_CHANNEL||'msedge'});
 try{
  const page=await browser.newPage();
  await page.goto('http://127.0.0.1:'+server.address().port);
  await page.evaluate(()=>navigator.serviceWorker.ready);
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
  await page.getByLabel('安卓显示的配对码').waitFor();
  const previousReads=assetReads;hold=true;
  const started=Date.now();
  await page.reload({waitUntil:'domcontentloaded',timeout:4000});
  await page.getByLabel('安卓显示的配对码').waitFor({timeout:2000});
  assert.ok(held.length>0,'The network shell is intentionally still pending');
  assert.equal(assetReads,previousReads,'All versioned entry assets are served from the app cache');
  const keys=await page.evaluate(async()=>{const c=await caches.open('sms-shell-v10');return(await c.keys()).map(r=>new URL(r.url).pathname)});
  assert.ok(!keys.some(k=>k.startsWith('/api/')),'No authenticated API data enters the shell cache');
  console.log('PASS actual browser reopened cached UI in '+(Date.now()-started)+'ms while shell network remained blocked; no asset downloads or API caching');
 }finally{
  hold=false;for(const [req,res] of held)serve(req,res);
  await browser.close();server.close();
 }
})().catch(e=>{console.error(e);server.close();process.exitCode=1});
