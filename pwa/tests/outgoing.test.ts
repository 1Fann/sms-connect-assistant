import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mergeOutgoing} from '../src/outgoing';
import type {Sms} from '../src/api';
const row:Sms={id:'one',address:'+8613800138000',body:'test',date:1,incoming:false,read:true,state:'accepted'};
test('提交后缺少回执时显示未知，收到真实送达回执后保留结果',()=>{
 const unknown=mergeOutgoing([row],[{...row,state:'unknown'}]);
 assert.equal(unknown[0].state,'unknown');
 const delivered=mergeOutgoing(unknown,[{...row,state:'delivered'}]);
 assert.equal(mergeOutgoing(delivered,unknown)[0].state,'delivered');
});
test('服务端失败替换本地已接受，不被旧的提交响应覆盖',()=>{
 const failed=mergeOutgoing([row],[{...row,state:'failed',error:'系统发送失败'}]);
 assert.equal(failed[0].state,'failed');
 assert.equal(mergeOutgoing(failed,[row])[0].state,'failed');
});
test('刷新期间新建的本地短信保留，已送达不被过期查询降级',()=>{
 const current=[{...row,state:'delivered' as const},{...row,id:'new',state:'local' as const}];
 const result=mergeOutgoing(current,[row]);
 assert.equal(result.length,2);assert.equal(result[0].state,'delivered');assert.equal(result[1].state,'local');
});
