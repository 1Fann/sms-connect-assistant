import {test} from 'node:test';
import assert from 'node:assert/strict';
import {callSourceLabel} from '../src/dialer/callSource';
const devices=[{deviceId:'a',name:'主机',online:true},{deviceId:'b',name:'共享手机',online:false}];
test('call history identifies the source device and recorded SIM for either direction',()=>{
 assert.equal(callSourceLabel({deviceId:'a',slot:1},devices),'主机 · SIM 1');
 assert.equal(callSourceLabel({deviceId:'a',slot:2},devices),'主机 · SIM 2');
 assert.equal(callSourceLabel({deviceId:'b',slot:2},devices),'共享手机 · SIM 2');
});
test('missing and invalid historical slots remain unknown instead of inheriting a current SIM',()=>{
 for(const slot of [undefined,null,0,-1,1.5,NaN])assert.equal(callSourceLabel({deviceId:'a',slot},devices),'主机 · SIM 未知');
});
test('an unavailable device does not erase the stored slot or borrow a different device name',()=>{
 assert.equal(callSourceLabel({deviceId:'removed',slot:2},devices),'互联通话 · SIM 2');
 assert.equal(callSourceLabel({deviceId:'b',slot:1},devices),'共享手机 · SIM 1');
});
