// Contract for two installed icons and an old Messages cache present during upgrade.
const assert=require('node:assert/strict');
const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'../public');
async function check(kind){
 const phone=kind==='phone';
 const current=phone?'commlink-phone-shell-v2':'sms-shell-v10';
 const stale=phone?'commlink-phone-shell-old':'sms-shell-old';
 const foreign=phone?'sms-shell-v10':'commlink-phone-shell-v2';
 const manifest=JSON.parse(fs.readFileSync(path.join(root,phone?'phone/manifest.webmanifest':'manifest.webmanifest')));
 assert.equal(manifest.id,phone?'/phone/':'/');
 const handlers={},deleted=[],sites=[];
 const caches={keys:async()=>[current,stale,foreign,'another-product'],delete:async key=>{deleted.push(key);return true}};
 const origin=phone?'https://fixture.invalid:8444':'https://fixture.invalid:8443';
 const self={addEventListener:(event,fn)=>handlers[event]=fn,location:{origin},navigator:{},registration:{showNotification:async()=>{}}};
 const clients={matchAll:async()=>[],openWindow:async url=>sites.push(new URL(url,origin).href)};
 vm.runInNewContext(fs.readFileSync(path.join(root,phone?'phone/sw.js':'sw.js'),'utf8'),{self,caches,clients,URL,Promise});
 let work;handlers.activate({waitUntil:p=>work=p});await work;assert.deepEqual(deleted,[stale]);
 for(const pathname of ['/api/v2/contacts','/api/history','/peer/sync',phone?'/':'/phone/']){
  handlers.fetch({request:{url:origin+pathname,method:'GET'},respondWith:()=>assert.fail('intercepted '+pathname)});
 }
 handlers.notificationclick({notification:{data:phone?{}:{address:'fixture'},close(){}},waitUntil:p=>work=p});
 await work;assert.equal(sites[0],origin+(phone?'/phone/#missed':'/#conversation=fixture'));
}
Promise.all([check('sms'),check('phone')]).then(()=>console.log('PASS distinct manifests, scope-limited cache eviction, authenticated data exclusions and notification targets')).catch(e=>{console.error(e);process.exitCode=1});
