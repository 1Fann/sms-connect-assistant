import {test} from 'node:test';
import assert from 'node:assert/strict';
import {groupConversations,optimisticConversation,reuseRecords} from '../src/viewData';
import type {Sms} from '../src/api';

test('an unchanged poll preserves the array, but a delivery or read change is visible',()=>{
 const before=[{id:'1',state:'accepted',read:false}];
 assert.equal(reuseRecords(before,[{...before[0]}]),before);
 for(const next of [[{...before[0],state:'sent'}],[{...before[0],read:true}],[]])assert.notEqual(reuseRecords(before,next),before);
});
test('grouping a long unsorted inbox orders conversations and messages without mutating source',()=>{
 const rows=Array.from({length:1000},(_,i)=>({id:String(i),address:i%2?'a':'b',date:1000-i} as Sms));
 const original=[...rows],result=groupConversations(rows,s=>s);
 assert.equal(result.groups.get('a')?.length,500);
 assert.deepEqual(result.list.map(c=>c.key),['b','a']);
 assert.equal(result.groups.get('b')?.[0].date,2);
 assert.deepEqual(rows,original);
});
test('optimistic pin and alert changes preserve deletion boundary; deletion waits for server',()=>{
 const states=[{address:'a',pinned:0,removedBefore:123,unread:true,muted:true}];
 const pinned=optimisticConversation(states,'a','pin')!;
 assert.ok(pinned[0].pinned>0);assert.equal(pinned[0].removedBefore,123);assert.equal(pinned[0].muted,true);
 assert.equal(optimisticConversation(pinned,'a','unmute')![0].muted,false);
 assert.equal(states[0].pinned,0);
 assert.equal(optimisticConversation(states,'a','remove'),null);
});
