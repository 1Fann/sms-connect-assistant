// Synthetic gateway only: no connection to a phone and no real SMS operations.
const http=require('http'),fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'../../app/src/main/assets/iphone'),out=path.resolve(__dirname,'../../verification');
const server=http.createServer((req,res)=>{const file=path.join(root,req.url==='/'?'index.html':req.url.split('?')[0]);if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return}try{res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(fs.readFileSync(file))}catch{res.writeHead(404).end()}});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({headless:true,channel:process.env.BROWSER_CHANNEL||'msedge'});
 try{
 const page=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true,serviceWorkers:'block'});
 page.setDefaultTimeout(8000);const errors=[],states=new Map();page.on('pageerror',e=>errors.push(e.message));let operations=0,rejectNext=false;
 const names=['小林','妈妈','陈雨','工作手机','快递通知','周辰','李明','王晓雨','林雨','陈晨'];
 let rows=names.map((name,i)=>({id:'sms:'+(100-i),address:'+120255501'+(20+i),name,body:i===0?'到家记得给我发个消息。':'明天见，路上注意安全。',date:Date.now()-60000*(i+1),incoming:true,read:true,sim:1,state:'received'}));
 await page.route('**/api/**',async route=>{const p=new URL(route.request().url()).pathname;let data={};
  if(p==='/api/history')data={items:rows,next:null};
  else if(p==='/api/outgoing')data=[];
  else if(p==='/api/sims')data=[{id:1,name:'主号'}];
  else if(p==='/api/conversations'){
   if(route.request().method()==='POST'){
    if(rejectNext){rejectNext=false;await route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({error:'测试：保存失败'})});return}
    operations++;const {address,action}=route.request().postDataJSON(),s=states.get(address)||{address,pinned:0,removedBefore:0,unread:false};
    if(action==='pin')s.pinned=s.pinned||Date.now();else if(action==='unpin')s.pinned=0;
    else if(action==='remove'){s.removedBefore=Date.now();s.pinned=0;s.unread=false}
    else if(action==='restore')s.removedBefore=0;else if(action==='read')s.unread=false;else if(action==='unread')s.unread=true;else throw Error('Unexpected mutation');
    states.set(address,s);
   }data=[...states.values()];
  }else if(p==='/api/read'){const b=route.request().postDataJSON();rows=rows.map(m=>m.address===b.address?{...m,read:true}:m)}
  else if(p==='/api/send')throw Error('Interaction checks must never send SMS');
  await route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
 });
 const row=name=>page.locator('.conversation').filter({has:page.getByText(name,{exact:true})});
 const cdp=await page.context().newCDPSession(page);
 async function touchSwipe(locator,dx,dy=0){await page.locator("dialog[open]").waitFor({state:"hidden"});await locator.scrollIntoViewIfNeeded();const b=await locator.boundingBox(),x=b.x+b.width*.55,y=b.y+b.height*.5;await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});for(let i=1;i<=8;i++){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+dx*i/8,y:y+dy*i/8}]});await page.waitForTimeout(18)}await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]})}
 async function context(locator){await page.locator("dialog[open]").waitFor({state:"hidden"});await locator.click({button:'right'});await page.getByRole('dialog',{name:'对话操作'}).waitFor()}
 async function filter(name){await page.getByLabel('筛选与设置').click();await page.getByRole('menuitemradio',{name,exact:true}).click()}
 await page.goto('http://127.0.0.1:'+server.address().port);await row('小林').waitFor();
 // A vertical drag must scroll without opening, removing, or long-pressing a row.
 await touchSwipe(row('陈雨'),3,-90);await page.waitForTimeout(550);assert.equal(await page.locator('dialog[open]').count(),0);assert.equal(operations,0);
 await page.locator('.list-view').evaluate(el=>el.scrollTop=0);
 const b=await row('小林').boundingBox();await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:b.x+150,y:b.y+40}]});await page.waitForTimeout(600);await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await page.getByRole('dialog',{name:'对话操作'}).waitFor();
 await page.getByRole('button',{name:'置顶',exact:true}).click();await page.getByRole('region',{name:'置顶会话'}).waitFor();
 await page.reload();await page.getByRole('button',{name:'小林，已置顶',exact:true}).waitFor();
 await context(page.getByRole('button',{name:'小林，已置顶',exact:true}));await page.screenshot({path:path.join(out,'conversation-menu.png'),animations:'disabled'});await page.getByRole('button',{name:'取消置顶',exact:true}).click();await row('小林').waitFor();
 await touchSwipe(row('小林'),100);await page.getByRole('button',{name:'标为未读',exact:true}).click();await page.getByRole('button',{name:'小林，未读',exact:true}).waitFor();
 await page.reload();await page.getByRole('button',{name:'小林，未读',exact:true}).waitFor();
 await touchSwipe(row('小林'),-100);await page.screenshot({path:path.join(out,'swipe-delete.png'),animations:'disabled'});await page.getByRole('button',{name:/^删除小林/}).click();
 await page.getByRole('button',{name:'取消',exact:true}).click();assert.equal(states.get(rows[0].address).removedBefore,0);
 await touchSwipe(row('小林'),-100);await page.getByRole('button',{name:/^删除小林/}).click();rejectNext=true;await page.getByRole('button',{name:'删除对话',exact:true}).click();await page.getByRole('dialog',{name:'删除对话确认'}).getByRole('alert').waitFor();assert.equal(await row('小林').count(),1);
 await page.getByRole('button',{name:'删除对话',exact:true}).click();await row('小林').waitFor({state:'detached'});assert.equal(rows.length,10); // Original records are intact.
 await page.reload();await row('妈妈').waitFor();assert.equal(await row('小林').count(),0);
 // A new message reappears; old messages remain removed until restored.
 rows=[{...rows[0],id:'sms:200',date:Date.now()+1,body:'新的消息仍然可以收到。',read:false},...rows];await page.reload();await row('小林').click();assert.equal(await page.getByText('到家记得给我发个消息。',{exact:true}).count(),0);await page.getByText('新的消息仍然可以收到。',{exact:true}).waitFor();await page.getByLabel('返回信息列表').click();
 await filter('最近删除');await row('小林').click();await page.getByRole('button',{name:'恢复对话',exact:true}).click();await page.getByText('没有最近删除的对话',{exact:false}).waitFor();await filter('所有信息');await row('小林').click();await page.getByText('到家记得给我发个消息。',{exact:true}).waitFor();await page.getByLabel('返回信息列表').click();
 // Keyboard users can reach the same menu without a gesture.
 await row('妈妈').focus();await page.keyboard.press('Shift+F10');await page.getByRole('button',{name:'置顶',exact:true}).click();
 for(const name of names.filter(n=>n!=='妈妈').slice(0,8)){await row(name).scrollIntoViewIfNeeded();await context(row(name));await page.getByRole('button',{name:'置顶',exact:true}).click()}
 await context(row('陈晨'));await page.getByRole('button',{name:'置顶',exact:true}).click();await page.getByRole('dialog',{name:'对话操作'}).getByRole('alert').waitFor();assert.equal([...states.values()].filter(s=>s.pinned).length,9);await page.getByRole('button',{name:'取消',exact:true}).click();
 await page.getByLabel('关闭提示').click();await page.locator('.list-view').evaluate(el=>el.scrollTop=0);await page.screenshot({path:path.join(out,'pinned-conversations.png'),animations:'disabled'});
 await page.getByRole('button',{name:'编辑',exact:true}).click();await page.getByRole('button',{name:'全选',exact:true}).click();await page.getByRole('button',{name:'删除',exact:true}).click();await page.getByRole('button',{name:'删除对话',exact:true}).click();await page.getByText('还没有信息',{exact:false}).waitFor();assert.equal(rows.length,11);
 await filter('最近删除');await page.getByRole('button',{name:'编辑',exact:true}).click();await page.getByRole('button',{name:'全选',exact:true}).click();await page.getByRole('button',{name:/^恢复（/}).click();await page.getByText('没有最近删除的对话',{exact:false}).waitFor();
 await page.emulateMedia({reducedMotion:'reduce'});await filter('所有信息');await context(row('小林'));assert.equal(await page.getByRole('dialog',{name:'对话操作'}).evaluate(el=>el.getAnimations().length),0);await page.keyboard.press('Escape');await page.locator('dialog[open]').waitFor({state:'hidden'});
 assert.deepEqual(errors,[]);console.log('PASS touch scroll/long-press/swipe, keyboard menu, nine-pin limit, durable unread/pins/removal, cancel/failure/new arrivals/restore, bulk actions; original SMS intact; zero sends');
 }finally{await browser.close();server.close()}
})().catch(e=>{console.error(e);server.close();process.exitCode=1});
