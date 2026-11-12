// Synthetic network only. No cookies, SMS APIs or production server.
const vm=require('node:vm'),fs=require('node:fs'),assert=require('node:assert/strict');
async function checkShell(phone) {
const events={},entries=new Map(),origin='https://fixture.invalid';
const shell=phone?'/phone/':'/';
const alternate=phone?'/phone/index.html':'/index.html';
const urlOf=r=>typeof r==='string'?new URL(r,origin).href:r.url;
const cache={
 match:async request=>entries.get(urlOf(request))?.clone(),
 put:async(request,response)=>entries.set(urlOf(request),response.clone())
};
let reads=[],network=async url=>new Response(url.endsWith('/')?'<script src="/assets/messages-AbCd1234.js"></script>':'asset');
const fetch=async request=>{const url=urlOf(request);reads.push(url);return network(url)};
vm.runInNewContext(fs.readFileSync(require.resolve(phone?'../public/phone/sw.js':'../public/sw.js'),'utf8'),{
 self:{addEventListener:(key,fn)=>events[key]=fn,location:{origin},navigator:{}},
 caches:{open:async()=>cache},fetch,URL,Response
});
function begin(path,method='GET'){
 let response;const background=[];
 events.fetch({request:{url:origin+path,method},respondWith:p=>response=p,waitUntil:p=>background.push(p)});
 return {response,done:Promise.all(background)};
}
async function request(path){
 const pending=begin(path);
 if(pending.response===undefined)return false;
 const response=await pending.response;await pending.done;return response;
}
 for(const path of ['/api/history','/api/v2/startup','/api/conversations','/api/refresh',phone?'/':'/phone/'])
  assert.equal(begin(path).response,undefined);
 assert.equal(begin(shell,'POST').response,undefined);
 await request('/assets/messages-AbCd1234.js');assert.equal(reads.length,1);
 await request('/assets/messages-AbCd1234.js');assert.equal(reads.length,1);
 await request('/assets/messages-EfGh5678.js');assert.equal(reads.length,2);
 await request(shell);
 assert.match(await entries.get(origin+shell).clone().text(),/AbCd1234/);
 let finish;
 network=async url=>url===origin+shell?await new Promise(resolve=>finish=resolve):new Response('asset');
 const warm=begin(shell);
 const cached=await Promise.race([warm.response,new Promise((_,reject)=>setTimeout(()=>reject(Error('Cached shell waited for network')),1000))]);
 assert.match(await cached.text(),/AbCd1234/);
 finish(new Response('<script src="/assets/messages-NewHash1.js"></script><link href="/assets/shared-NewHash2.css">'));
 await warm.done;
 assert.ok(entries.has(origin+'/assets/messages-NewHash1.js'));
 assert.ok(entries.has(origin+'/assets/shared-NewHash2.css'));
 assert.match(await entries.get(origin+shell).clone().text(),/NewHash1/);
 network=async url=>url.endsWith('.js')?new Response('unavailable',{status:503}):
  new Response('<script src="/assets/messages-BadHash1.js"></script>');
 const partial=begin(alternate);assert.match(await (await partial.response).text(),/NewHash1/);await partial.done;
 assert.match(await entries.get(origin+shell).clone().text(),/NewHash1/,'Interrupted updates must preserve the complete old shell');
 network=async()=>{throw Error('offline')};
 const offline=begin(shell);assert.match(await (await offline.response).text(),/NewHash1/);await offline.done;
 assert.equal(begin('/api/history').response,undefined);
}
Promise.all([checkShell(false),checkShell(true)]).then(()=>{
 console.log('PASS both cached shells render before a blocked network, update atomically, and exclude API responses');
}).catch(e=>{console.error(e);process.exitCode=1});
