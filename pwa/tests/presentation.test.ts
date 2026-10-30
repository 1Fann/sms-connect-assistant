import {test} from 'node:test';
import assert from 'node:assert/strict';
import {listTime,groupEnd,showDate} from '../src/presentation';
import type {Sms} from '../src/api';
const date=new Date(2026,9,31,9,40).getTime();
const sms:Sms={id:'test',date,address:'+12025550123',body:'test fixture',incoming:true,read:true,sim:1,state:'received'};
test('conversation dates distinguish yesterday and older years',()=>{
 assert.equal(listTime(new Date(2026,9,30,23).getTime(),new Date(date)),'昨天');
 assert.match(listTime(new Date(2025,9,30).getTime(),new Date(date)),/2025/);
});
test('bubble groups preserve sender, SIM and unresolved-send boundaries',()=>{
 assert.equal(groupEnd(sms,{...sms,date:date+60000}),false);
 assert.equal(groupEnd(sms,{...sms,sim:2}),true);
 assert.equal(groupEnd(sms,{...sms,incoming:false}),true);
 assert.equal(groupEnd({...sms,state:'unknown'},{...sms,date:date+60000}),true);
 assert.equal(groupEnd(sms,{...sms,date:date+180000}),true);
});
test('timestamps appear for the first message, time gaps and midnight',()=>{
 assert.equal(showDate(sms),true);assert.equal(showDate(sms,{...sms,date:date-60000}),false);
 assert.equal(showDate(sms,{...sms,date:date-360000}),true);
 assert.equal(showDate({...sms,date:new Date(2026,10,1,0,1).getTime()},{...sms,date:new Date(2026,9,31,23,59).getTime()}),true);
});
