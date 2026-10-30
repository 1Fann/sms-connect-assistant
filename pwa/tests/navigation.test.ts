import {test} from 'node:test';
import assert from 'node:assert/strict';
import {navigationFrame,completeBack} from '../src/navigation';

test('page parallax uses pixels throughout rather than normalized spring positions',()=>{
 const half=navigationFrame(195,390);
 assert.equal(half.detail,195);assert.ok(Math.abs(half.list+52.65)<1e-9);assert.equal(half.dim,.04);
 assert.deepEqual(navigationFrame(390,390),{detail:390,list:0,dim:0});
 const open=navigationFrame(0,390);
 assert.equal(open.detail,0);assert.ok(Math.abs(open.list+105.3)<1e-9);assert.equal(open.dim,.08);
});

test('spring overshoot never exposes space outside either page',()=>{
 assert.deepEqual(navigationFrame(-20,430),navigationFrame(0,430));
 assert.deepEqual(navigationFrame(450,430),navigationFrame(430,430));
});

test('edge-back completion scales distance with viewport and velocity remains pixels per second',()=>{
 for(const width of [375,390,430,768]){
  assert.equal(completeBack(width*.2,0,width),false,'a short slow drag cancels');
  assert.equal(completeBack(width*.45,0,width),true,'a deliberate long drag completes');
  assert.equal(completeBack(width*.12,700,width),true,'a rightward flick completes');
  assert.equal(completeBack(width*.02,700,width),false,'tiny edge touches do not navigate');
  assert.equal(completeBack(width*.5,-400,width),false,'reversing direction cancels');
  assert.equal(completeBack(width*.12,700,width,180),false,'a held-short drag must not retain old flick velocity');
  assert.equal(completeBack(width*.5,-400,width,180),true,'a held-long drag follows distance after old velocity expires');
 }
});
