// Synthetic messages only. All APIs are intercepted; no real SMS is sent or read.
const http=require('http'),fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'../../app/src/main/assets/iphone'),out=path.resolve(__dirname,'../../verification');
const server=http.createServer((req,res)=>{const file=path.join(root,req.url==='/'?'index.html':req.url.split('?')[0]);if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return}try{res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(fs.readFileSync(file))}catch{res.writeHead(404).end()}});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({headless:true,channel:process.env.BROWSER_CHANNEL||'msedge'});
 try{
 const page=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true,serviceWorkers:'block'}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 const now=Date.now(),number='+12025550123';
 const conversation=[
  ['到了给我发个消息。',true],['好，我已经在路上啦。',false],['大概还有十分钟到。',false],['不着急，慢慢来。',true],['我在路口的咖啡店等你 ☕️',true],['好呀，一会儿见！',false]
 ].map(([body,incoming],i)=>({id:'sms:'+i,address:number,name:'小林',body,incoming,date:now-(6-i)*60000,sim:1,state:incoming?'received':'sent',read:i!==4}));
 const other=[['妈妈','周末回来吃饭吗？'],['快递通知','您的快件已送达，请及时查收。'],['陈雨','那就明天下午三点见。'],['王晓雨','照片收到了，谢谢你！'],['李明','好的，路上注意安全。'],['工作手机','会议时间调整到明天上午十点。'],['周辰','收到，到时候联系。']].map(([name,body],i)=>({id:'sms:'+(20+i),address:'+120255501'+(30+i),name,body,incoming:true,read:i%3!==0,date:now-(i+1)*900000,sim:2,state:'received'}));
 let rows=[...conversation,...other],reads=0;
 await page.route('**/api/**',async route=>{const p=new URL(route.request().url()).pathname;let data={};
  if(p==='/api/history')data={items:rows,next:null};
  else if(p==='/api/conversations'){data=[]}
 else if(p==='/api/outgoing')data=[];
  else if(p==='/api/sims')data=[{id:1,name:'主号'},{id:2,name:'副号'}];
  else if(p==='/api/read'){reads++;const b=route.request().postDataJSON();rows=rows.map(m=>m.address===b.address?{...m,read:true}:m)}
  else if(p==='/api/contacts')data=[{name:'小林',number}];
  else if(p==='/api/send')throw Error('Layout checks must not send messages');
  await route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
 });
 await page.goto('http://127.0.0.1:'+server.address().port);await page.getByText('小林',{exact:true}).waitFor();
 await page.screenshot({animations:"disabled",path:path.join(out,'conversations-light.png')});
 await page.getByLabel('筛选与设置').click();await page.getByRole('menuitemradio',{name:/未读信息/}).click();assert.equal(await page.locator('.conversation').count(),4);
 await page.getByLabel('筛选与设置').click();await page.getByRole('menuitemradio',{name:'所有信息'}).click();
 await page.getByLabel('搜索信息').fill('咖啡店');assert.equal(await page.locator('.conversation').count(),1);await page.getByLabel('清除搜索').click();
 await page.getByText('小林',{exact:true}).click();await page.getByText('好呀，一会儿见！',{exact:true}).waitFor();
 assert.equal(await page.locator('.bubble.tail').count(),4);assert.equal(await page.locator('.date-divider').count(),1);
 await page.screenshot({animations:"disabled",path:path.join(out,'chat-light.png')});
 await page.getByLabel('短信内容',{exact:true}).fill('测试草稿，不会发送');await page.getByLabel('发送线路',{exact:true}).selectOption('2');assert.equal(await page.getByLabel('发送线路',{exact:true}).inputValue(),'2');
 await page.setViewportSize({width:390,height:450});await page.getByLabel('短信内容',{exact:true}).focus();
 const composer=await page.locator('.composer').boundingBox();assert.ok(composer.y+composer.height<=451);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await page.getByLabel('短信内容',{exact:true}).fill('');await page.setViewportSize({width:390,height:844});
 await page.emulateMedia({colorScheme:'dark'});await page.screenshot({animations:"disabled",path:path.join(out,'chat-dark.png')});
 await page.getByLabel('短信选项',{exact:true}).click();await page.getByRole('dialog').waitFor();await page.getByLabel('选项中的发送线路').selectOption('1');await page.getByRole('button',{name:'完成',exact:true}).click();
 assert.equal(await page.getByLabel('发送线路',{exact:true}).inputValue(),'1');
 await page.getByLabel('返回信息列表').click();await page.screenshot({animations:"disabled",path:path.join(out,'conversations-dark.png')});
 await page.getByRole('button',{name:'编辑',exact:true}).click();await page.getByRole('button',{name:'全选',exact:true}).click();await page.getByRole('button',{name:/标为已读/}).click();await page.getByRole('button',{name:'编辑',exact:true}).waitFor();assert.ok(reads>=8);
 await page.getByLabel('新建短信').click();await page.getByLabel('收件人号码').fill('+12025550123');await page.getByLabel('短信内容',{exact:true}).fill('多行\n测试草稿');
 for(const viewport of [{width:375,height:667},{width:430,height:932},{width:667,height:375}]){await page.setViewportSize(viewport);await page.waitForFunction(()=>Math.abs(document.querySelector("main").getBoundingClientRect().height-innerHeight)<2);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);const b=await page.locator('.composer').boundingBox();assert.ok(b.y+b.height<=viewport.height+1)}
 assert.deepEqual(errors,[]);console.log('PASS layout: filters, search, read selection, bubble grouping, SIM sheet, compact keyboard viewport, portrait/landscape, light/dark; zero SMS sends');
 }finally{await browser.close();server.close()}
})().catch(e=>{console.error(e);server.close();process.exitCode=1});
