import {test} from 'node:test';
import assert from 'node:assert/strict';
import {gesture,isRemoved,isUnread,type ConversationState} from '../src/conversations';
import type {Sms} from '../src/api';
const message:Sms={id:'sms:1',address:'+12025550123',body:'test',date:100,incoming:true,read:true,state:'received'};
const state:ConversationState={address:message.address,pinned:0,removedBefore:100,unread:false};
test('removed history stays hidden; new messages remain visible and restore exposes old history',()=>{
 assert.equal(isRemoved(message,state),true);
 assert.equal(isRemoved({...message,date:101},state),false);
 assert.equal(isRemoved(message,{...state,removedBefore:0}),false);
 assert.equal(isRemoved(message),false);
});
test('manual unread survives provider read state and clears independently',()=>{
 assert.equal(isUnread([message],{...state,unread:true}),true);
 assert.equal(isUnread([message],state),false);
 assert.equal(isUnread([{...message,read:false}],state),true);
});
test('tiny movement cannot swipe; vertical and diagonal scrolling cancel the press',()=>{
 assert.equal(gesture(4,5),null);
 assert.equal(gesture(-40,5),'horizontal');
 assert.equal(gesture(5,40),'vertical');
 assert.equal(gesture(20,20),'vertical');
});
