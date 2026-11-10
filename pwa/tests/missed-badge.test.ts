import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const source=ts.transpileModule(readFileSync(new URL('../src/dialer/missedBadge.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
function fixture(installation:string|undefined,enabled=true){
 const badges:number[]=[],effects:(()=>unknown)[]=[],listeners=new Map<string,()=>void>();
 let resolve!:(value:{count:number})=>void;
 const response=new Promise<{count:number}>(r=>resolve=r);
 const document={hidden:false,addEventListener:(key:string,fn:()=>void)=>listeners.set(key,fn),removeEventListener:()=>{}};
 const react={useState:(value:unknown)=>[value,()=>{}],useRef:(current:unknown)=>({current}),useCallback:(f:unknown)=>f,useEffect:(f:()=>unknown)=>effects.push(f)};
 const exports:{useMissedBadge?:(id:string|undefined,on:boolean)=>{viewed:(value:number)=>void}}={};
 vm.runInNewContext(source,{exports,require:(name:string)=>name==='react'?react:{api:()=>response},document,
  navigator:{setAppBadge:async(value:number)=>{badges.push(value)},clearAppBadge:async()=>{badges.push(0)}},
  window:{addEventListener:(key:string,fn:()=>void)=>listeners.set(key,fn),removeEventListener:()=>{}},setInterval:()=>1,clearInterval:()=>{}});
 const hook=exports.useMissedBadge!(installation,enabled);effects.forEach(f=>f());
 return {badges,document,resolve,hook,listeners,settle:()=>new Promise(r=>setImmediate(r))};
}
test('startup without a session never clears the installed badge',async()=>{const f=fixture(undefined);await f.settle();assert.deepEqual(f.badges,[])});
test('response finishing after suspension cannot clear a newer push dot',async()=>{const f=fixture('fixture');f.document.hidden=true;f.resolve({count:0});await f.settle();assert.deepEqual(f.badges,[])});
test('validated zero clears only after an authenticated visible response',async()=>{const f=fixture('fixture');f.resolve({count:0});await f.settle();assert.deepEqual(f.badges,[0])});
test('invalid server counts cannot clear or replace the badge',async()=>{const f=fixture('fixture');f.resolve({count:-1});await f.settle();assert.deepEqual(f.badges,[])});
test('viewing calls still clears explicitly',async()=>{const f=fixture('fixture');f.hook.viewed(0);await f.settle();assert.deepEqual(f.badges,[0])});
test('foreground resumption reconciles an unchanged positive count',async()=>{const f=fixture('fixture');f.resolve({count:3});await f.settle();f.listeners.get('pageshow')!();await f.settle();assert.deepEqual(f.badges,[3,3])});
