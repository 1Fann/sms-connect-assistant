// Exercise the real Calling component; synthetic SIP and HTTP never reach a PBX or cellular line.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const repo=path.resolve(__dirname,'../..'),work=path.join(repo,'.work/phone-recovery');
fs.mkdirSync(work,{recursive:true});
fs.writeFileSync(path.join(work,'sip.ts'),`
export const defaultSessionDescriptionHandlerFactory=()=>()=>{};
export class SimpleUser {
  constructor(server,options){this.options=options;window.fixtureUsers??=[];window.fixtureUsers.push(this)}
  async connect(){} async register(){} async disconnect(){this.options.delegate.onCallHangup()}
  async call(target){window.fixtureTargets??=[];window.fixtureTargets.push(target);this.options.delegate.onCallAnswered()}
}
`);
fs.writeFileSync(path.join(work,'entry.tsx'),`
import React from 'react';import {createRoot} from 'react-dom/client';
import {Calling} from '../../pwa/src/dialer/Calling';
createRoot(document.getElementById('root')).render(<Calling lines={[{lineId:'fixture-line',deviceId:'fixture-device',name:'Fixture',slot:1,lineOnline:true,online:true,confirmed:true}]} number="" setNumber={()=>{}} enabled={true} lineHint={{id:'',seq:0}} onBusy={()=>{}} openSettings={()=>{}}/>);
`);
fs.writeFileSync(path.join(work,'index.html'),'<div id="root"></div><script type="module" src="/entry.tsx"></script>');
(async()=>{
 const {build}=await import(pathToFileURL(path.join(repo,'pwa/node_modules/vite/dist/node/index.js')).href);
 await build({configFile:false,root:work,resolve:{alias:[{find:'sip.js/lib/platform/web',replacement:path.join(work,'sip.ts')},{find:'react-dom/client',replacement:path.join(repo,'pwa/node_modules/react-dom/client.js')},{find:'react/jsx-runtime',replacement:path.join(repo,'pwa/node_modules/react/jsx-runtime.js')},{find:/^react$/,replacement:path.join(repo,'pwa/node_modules/react/index.js')}]},build:{outDir:path.join(work,'dist'),emptyOutDir:true}});
 const server=http.createServer((req,res)=>{const file=path.join(work,'dist',req.url==='/'?'index.html':req.url);res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':'text/html');res.end(fs.readFileSync(file))});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({channel:process.env.BROWSER_CHANNEL||'msedge',headless:true});
 try{
  for(const phase of ['HANDOFF_FAILED','RECOVERING']){
   const context=await browser.newContext(),page=await context.newPage(),writes=[],errors=[];
   page.on('pageerror',e=>errors.push(e.message));
   await page.addInitScript(()=>{
    sessionStorage.setItem('phone.call','fixture-call');
    window.fixtureTracks=[];
    navigator.mediaDevices.getUserMedia=async()=>{const stream=new AudioContext().createMediaStreamDestination().stream;window.fixtureTracks.push(stream.getAudioTracks()[0]);return stream};
   });
   let state=phase;
   await context.route('**/api/**',route=>{
    const req=route.request(),key=new URL(req.url()).pathname.replace('/api/v2/','');
    if(req.method()!=='GET')writes.push(key);
    const call={id:'fixture-call',lineId:'fixture-line',number:'5550100',state,direction:'outgoing',created:Date.now(),answeredAt:Date.now()-20000};
    const data={
     'voice/status':{ready:true,reason:'',gateways:[{deviceId:'fixture-device',registered:true,busy:true}]},
     'calls/fixture-call/state':call,
     'voice/web-session':{wss:'wss://example.invalid',uri:'sip:fixture@example.invalid',username:'fixture',password:'synthetic'},
     'calls/fixture-call/resume':{...call,target:'sip:cl-0123456789abcdef0123456789abcdef@example.invalid'}
    };
    assert.ok(key in data,'Unexpected API: '+key);
    if(key.endsWith('/resume'))state='WEB_ACTIVE';
    return route.fulfill({contentType:'application/json',body:JSON.stringify(data[key])});
   });
   await page.goto('http://127.0.0.1:'+server.address().port);
   await page.getByRole('button',{name:'恢复网页通话',exact:true}).click();
   await page.waitForFunction(()=>window.fixtureTargets?.length===1);
   assert.deepEqual(writes,['voice/web-session','calls/fixture-call/resume']);
   // Replacing a SIP session can deliver the old hangup after the new microphone is acquired.
   await page.getByRole('button',{name:'恢复网页通话',exact:true}).click();
   await page.waitForFunction(()=>window.fixtureTargets?.length===2);
   await page.evaluate(()=>window.fixtureUsers[0].options.delegate.onCallHangup());
   assert.deepEqual(await page.evaluate(()=>window.fixtureTracks.map(t=>t.readyState)),['ended','live']);
   assert.equal(writes.filter(x=>x==='calls').length,0);assert.deepEqual(errors,[]);
   await context.close();
  }
  console.log('PASS rejected/timeout recovery UI, existing-call resume only, late old hangup cannot stop the new microphone; no real SIP or calls');
 }finally{await browser.close();server.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
