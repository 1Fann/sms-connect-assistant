// Worker push fixtures: no network, notifications or calls leave this process.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(path.join(__dirname,'../public/phone/sw.js'),'utf8');
async function run(replies,badgeApi='available',payload=null,native=false){
 const handlers={},badges=[],notices=[],requests=[];
 const self={addEventListener:(key,fn)=>handlers[key]=fn,navigator:{setAppBadge:async count=>badges.push(count??'dot'),clearAppBadge:async()=>badges.push(0)},registration:{showNotification:async(...args)=>notices.push(args)}};
 if(badgeApi==='absent')self.navigator={};
 if(badgeApi==='rejected')self.navigator.setAppBadge=async()=>{throw Error('Badging unavailable')};
 const fetch=async(url,options)=>{requests.push([url,options.method||'GET']);const reply=replies.shift();if(reply instanceof Error)throw reply;return {status:reply.status,ok:reply.status===200,json:async()=>reply.body||{}}};
 vm.runInNewContext(source,{self,clients:{matchAll:async()=>[]},fetch,AbortSignal,URL,Promise});
 let work;handlers.push({waitUntil:p=>work=p,data:payload?{json:()=>payload}:null,notification:native?{}:undefined});await work;
 assert.equal(notices.length,native?0:1);return {badges,requests};
}
(async()=>{
 assert.deepEqual((await run([{status:200,body:{count:3}}])).badges,[3]);
 assert.deepEqual((await run([{status:200,body:{count:0}}])).badges,[0]);
 assert.deepEqual((await run([new Error('offline')])).badges,[]);
 const renewed=await run([{status:401},{status:200},{status:200,body:{count:2}}]);
 assert.deepEqual(renewed.requests.map(r=>r[0]),['/api/v2/call-history/missed','/api/refresh','/api/v2/call-history/missed']);
 assert.deepEqual(renewed.badges,[2]);
 assert.deepEqual((await run([{status:401},{status:401}])).badges,[]);
 for(const status of [429,500,502,503])
  assert.deepEqual((await run([{status:401},{status}])).badges,[]);
 assert.deepEqual((await run([{status:401},new Error('timeout')])).badges,[]);
 for(const count of [-1,1.5,'0',null,Number.MAX_SAFE_INTEGER+1])
  assert.deepEqual((await run([{status:200,body:{count}}])).badges,[]);
 assert.deepEqual((await run([{status:403}])).badges,[]);
 for(const mode of ['absent','rejected'])
  assert.deepEqual((await run([{status:200,body:{count:3}}],mode)).badges,[]);
 for(const count of [0,17,'18']){
  const delivered=await run([],'available',{web_push:8030,app_badge:count});
  assert.deepEqual(delivered.badges,[Number(count)]);assert.deepEqual(delivered.requests,[]);
 }
 const native=await run([],'available',null,true);
 assert.deepEqual(native.requests,[]);assert.deepEqual(native.badges,[]);
 console.log('PASS Phone numeric iOS badge, clearing after viewing, offline preservation, refresh and unavailable authentication/badging; visible notification always shown');
})().catch(e=>{console.error(e);process.exitCode=1});
