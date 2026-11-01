import {test} from 'node:test';
import assert from 'node:assert/strict';
import {detailBackIntent} from '../src/dialer/detailGesture';
test('a short decisive back swipe needs less travel, while a slow swipe can finish at 44px',()=>{
 assert.equal(detailBackIntent(22,2,40),true);
 assert.equal(detailBackIntent(44,4,500),true);
 assert.equal(detailBackIntent(15,0,15),false);
 assert.equal(detailBackIntent(30,1,500),false);
});
test('vertical scrolling, diagonal movement and left swipes never dismiss the detail',()=>{
 for(const [dx,dy,ms] of [[44,70,80],[22,30,20],[-80,0,30],[5,0,500]])assert.equal(detailBackIntent(dx,dy,ms),false);
});
