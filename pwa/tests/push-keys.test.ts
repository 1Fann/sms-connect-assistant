import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const source=ts.transpileModule(readFileSync(new URL('../src/pushKeys.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
async function run(permission:string,subscription:unknown,failed=false){
 const sent:unknown[]=[];
 const exports:{refreshPushKeys?:(send:(body:unknown)=>Promise<void>)=>Promise<void>}={};
 vm.runInNewContext(source,{exports,Notification:{permission,requestPermission(){throw Error('Must not prompt')}},navigator:{serviceWorker:{ready:Promise.resolve({pushManager:{getSubscription:async()=>subscription,subscribe(){throw Error('Must not subscribe')}}})}}});
 await exports.refreshPushKeys!(async body=>{sent.push(body);if(failed)throw Error('offline')});
 return JSON.parse(JSON.stringify(sent));
}
const subscription={endpoint:'https://fixture.push.apple.com/device',toJSON:()=>({keys:{p256dh:'public-key',auth:'auth-secret'}})};
test('only existing granted subscriptions upload keys, never preview consent',async()=>{
 assert.deepEqual(await run('granted',subscription),[{endpoint:subscription.endpoint,p256dh:'public-key',auth:'auth-secret'}]);
});
test('missing, denied or incomplete subscription is left alone',async()=>{
 for(const permission of ['default','denied'])assert.deepEqual(await run(permission,subscription),[]);
 assert.deepEqual(await run('granted',null),[]);
 assert.deepEqual(await run('granted',{...subscription,toJSON:()=>({})}),[]);
});
test('offline upgrades do not break app startup',async()=>{assert.equal((await run('granted',subscription,true)).length,1)});
