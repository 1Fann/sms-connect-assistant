import {test} from 'node:test';
import assert from 'node:assert/strict';
import {groundwireUri} from '../src/dialer/groundwire';
const line={lineId:'a',deviceId:'fixture',name:'SIM 1',slot:1,online:true,lineOnline:true,confirmed:true};
const routes=[{lineId:'a',prefix:'*81*'},{lineId:'b',prefix:'*82*'}];
test('native calls carry explicit SIM routes and preserve international digits',()=>{
 assert.equal(groundwireUri('+15550100',line,routes,true),'groundwire:*81*+15550100?dialAction=voiceCall');
 assert.equal(groundwireUri('5550100',{...line,lineId:'b',slot:2},routes,true),'groundwire:*82*5550100?dialAction=voiceCall');
});
test('unapproved, offline, replaced or unconfigured lines cannot launch Groundwire',()=>{
 for(const l of [undefined,{...line,present:false},{...line,enabled:false},{...line,lineOnline:false},{...line,confirmed:false},{...line,lineId:'replaced'}])assert.equal(groundwireUri('5550100',l,routes,true),undefined);
 assert.equal(groundwireUri('5550100',line,routes,false),undefined);
});
test('dial URI rejects injection, service codes, emergencies and untrusted route prefixes',()=>{
 for(const number of ['110','+112','911','*81*555','555?dialAction=gsmCall','555#123','555@other','555;other',' 555','12'])assert.equal(groundwireUri(number,line,routes,true),undefined);
 assert.equal(groundwireUri('5550100',line,[{lineId:'a',prefix:'sip:other'}],true),undefined);
});
