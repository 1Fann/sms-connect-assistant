// A cache hit for a hashed app asset must require no gateway round trip.
const vm=require('node:vm'),fs=require('node:fs'),assert=require('node:assert/strict');
const events={},entries=new Map();
let reads=0,writes=0;
const cache={match:async request=>entries.get(request.url),put:async(request,response)=>{writes++;entries.set(request.url,response)}};
const fetch=async()=>{reads++;return {ok:true,clone(){return this}}};
vm.runInNewContext(fs.readFileSync(require.resolve('../public/sw.js'),'utf8'),{
 self:{addEventListener:(key,fn)=>events[key]=fn,location:{origin:'https://fixture.invalid'},navigator:{}},
 caches:{open:async()=>cache},fetch,URL
});
async function request(path){
 let response;const background=[];
 events.fetch({request:{url:'https://fixture.invalid'+path,method:'GET'},respondWith:p=>response=p,waitUntil:p=>background.push(p)});
 if(response===undefined)return false;
 await response;await Promise.all(background);return true;
}
(async()=>{
 assert.equal(await request('/api/history'),false);assert.equal(await request('/phone/'),false);
 await request('/assets/messages-AbCd1234.js');assert.equal(reads,1);assert.equal(writes,1);
 await request('/assets/messages-AbCd1234.js');assert.equal(reads,1);
 await request('/assets/messages-EfGh5678.js');assert.equal(reads,2);
 await request('/');await request('/');assert.equal(reads,4,'HTML remains fresh on every visit');
 console.log('PASS hashed assets reopen without network, updates use new URLs, authenticated data bypass the cache');
})().catch(e=>{console.error(e);process.exitCode=1});
