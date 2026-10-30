import {test} from 'node:test';
import assert from 'node:assert/strict';
import {reconcile} from '../src/reconcile';
import type {Sms} from '../src/api';
const base:Sms={id:'sms:1',address:'+8613800138000',body:'test',date:1000,incoming:false,read:true,sim:1,state:'sent',creator:'me.capcom.smsgateway.iphone'};
test('系统副本与网关发送记录一对一归并，不吞掉连续相同短信',()=>{
 const system=[base,{...base,id:'sms:2'}];const gateway=[{...base,id:'request-1',creator:undefined}];
 assert.equal(reconcile(system,gateway,'CN').length,2);
});
test('其他应用、未知来源、未知发送状态绝不能猜测为重复',()=>{
 const gateway=[{...base,id:'request-1',creator:undefined}];
 for(const creator of [undefined,'other.package'])assert.equal(reconcile([{...base,creator}],gateway,'CN').length,2);
 assert.equal(reconcile([base],[{...gateway[0],state:'unknown'}],'CN').length,2);
});
test('默认应用写入的发送中与失败记录也只展示一次',()=>{
 for(const state of ['accepted','failed'] as const){
  const gateway=[{...base,id:'request-1',creator:undefined,state}];
  assert.deepEqual(reconcile([{...base,state}],gateway,'CN'),gateway);
 }
});
