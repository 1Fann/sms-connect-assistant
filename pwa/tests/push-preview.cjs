// Execute the shipped worker: no real network, SMS, or subscriptions.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const handlers={},badgeValues=[],requests=[];
let notification,opened,iconBadge=7,replies=[];
const self={
 location:{origin:'https://sms.example.com'},
 navigator:{async setAppBadge(count){badgeValues.push(count);iconBadge=count;},async clearAppBadge(){badgeValues.push(0);iconBadge=0;}},
 registration:{async showNotification(title,options){notification={title,...options};}},
 addEventListener(name,handler){handlers[name]=handler;}
};
const clients={async matchAll(){return [];},async openWindow(url){opened=url;}};
const fetch=async(url,options)=>{
 requests.push([url,options]);const reply=replies.shift();
 if(reply instanceof Error)throw reply;
 if(!reply)throw Error('Unexpected request');
 return {status:reply.status,ok:reply.status===200,json:async()=>reply.body};
};
vm.runInNewContext(fs.readFileSync(require.resolve('../public/sw.js'),'utf8'),{self,clients,URL,fetch,AbortSignal});
async function dispatch(type,event){let pending;handlers[type]({...event,waitUntil(value){pending=value;}});await pending;}
const push=payload=>dispatch('push',{data:payload?{json:()=>payload}:null});
const response=count=>({status:200,body:{count}});
(async()=>{
 replies=[response(8)];await push(null);
 assert.equal(notification.body,'收到一条新短信');assert.equal(iconBadge,8);
 replies=[response(9)];await dispatch('push',{data:{json(){throw Error('Malformed');}}});
 assert.equal(iconBadge,9,'legacy push fetches the actual count');
 const before=requests.length;
 await push({title:'短信互联助手',body:'这是短信预览测试',badge:false});
 assert.equal(requests.length,before);assert.equal(iconBadge,9,'test preserves the count');
 const message={title:'测试联系人',body:'测试摘要',address:'+15550101234'};
 replies=[response(12)];await push(message);
 assert.equal(notification.title,message.title);assert.equal(notification.body,message.body);assert.equal(iconBadge,12);
 for(const failures of [[new Error('offline')],[{status:403}],[{status:500}],[{status:401},{status:401}],[{status:401},{status:503}]]){
  replies=failures;await push(message);assert.equal(iconBadge,12,'failure must not replace a known count with 1');
 }
 for(const count of [-1,1.5,'1',null,Number.MAX_SAFE_INTEGER+1]){
  replies=[response(count)];await push(message);assert.equal(iconBadge,12);
 }
 replies=[{status:401},{status:200},response(13)];await push(message);
 assert.equal(iconBadge,13);assert.deepEqual(requests.slice(-3).map(r=>r[0]),['/api/badge','/api/refresh','/api/badge']);
 replies=[response(14),response(15)];await Promise.all([push(message),push(message)]);
 assert.equal(iconBadge,15,'concurrent pushes apply in order');
 replies=[response(0)];await push(message);assert.equal(iconBadge,0,'only confirmed zero clears the badge');
 assert.ok(!badgeValues.includes(1),'no synthetic one appears, even transiently');
 assert.ok(requests.filter(r=>r[0]==='/api/badge').every(r=>r[1].cache==='no-store'&&r[1].credentials==='include'));
 const click={notification:{...notification,close(){}}};await dispatch('notificationclick',click);
 assert.equal(opened,'/#conversation=%2B15550101234');
 let focused=false;clients.matchAll=async()=>[{url:self.location.origin+'/',async navigate(url){
  assert.equal(url,self.location.origin+opened);return {async focus(){focused=true;}};
 }}];
 await dispatch('notificationclick',click);assert.ok(focused);
 const requestCount=requests.length;
 const declarative={web_push:8030,app_badge:27,notification:{title:'互联信息',body:'收到一条新短信',data:{address:''}}};
 replies=[];await push(declarative);assert.equal(iconBadge,27);assert.equal(requests.length,requestCount,'included badge never contacts gateway');
 assert.equal(notification.body,'收到一条新短信');assert.equal(notification.data.address,'');
 await push({...declarative,app_badge:'28'});assert.equal(iconBadge,28);
 await push({...declarative,app_badge:0});assert.equal(iconBadge,0);
 const currentNotice=notification;
 await dispatch('push',{notification:{title:'Native proposal'},data:null});
 assert.equal(notification,currentNotice,'native proposal is not replaced with a duplicate');
 assert.equal(requests.length,requestCount,'native proposal never contacts gateway');
 self.navigator.setAppBadge=async()=>{throw Error('Unavailable');};
 replies=[response(3)];await push(message);assert.equal(notification.body,message.body);
 delete self.navigator.setAppBadge;await push(null);assert.equal(notification.body,'收到一条新短信');
 console.log('PASS SMS exact badge, renewal, offline preservation, concurrent pushes, test isolation and notification routing');
})().catch(error=>{console.error(error);process.exitCode=1;});
