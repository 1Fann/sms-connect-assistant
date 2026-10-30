import {test} from 'node:test';
import assert from 'node:assert/strict';
import {stepSpring,rubberBand,SpringMotion} from '../src/gestureMotion';
test('spring settles at both 60 and 120 Hz',()=>{
 for(const hz of [60,120])for(const target of [-136,0,76]){let state={position:-50,velocity:500};for(let i=0;i<hz*2;i++)state=stepSpring(state,target,1/hz);assert.ok(Math.abs(state.position-target)<.01);assert.ok(Math.abs(state.velocity)<.1)}
});
test('reversing a spring preserves its displayed position and momentum',()=>{
 const initial={position:-80,velocity:-600},forward=stepSpring(initial,-136,1/120),reversed=stepSpring(forward,0,1/120);
 assert.ok(forward.position<initial.position);assert.ok(Math.abs(reversed.position-forward.position)<10);assert.notEqual(reversed.position,0);assert.notEqual(reversed.position,-136);
});
test('delayed frames stay bounded; rubber band is continuous and resisted',()=>{
 let state={position:200,velocity:2400};for(let i=0;i<50;i++)state=stepSpring(state,0,.5);
 assert.ok(Number.isFinite(state.position));assert.ok(Math.abs(state.position)<.01);assert.equal(rubberBand(0),0);assert.ok(rubberBand(100)>0&&rubberBand(100)<100);assert.ok(rubberBand(1000)<120);assert.equal(rubberBand(-50),-rubberBand(50));
});

function animationClock(check:(clock:{tick:()=>void,pending:()=>number,reduce:()=>void,time:()=>number})=>void){
 const keys=['requestAnimationFrame','cancelAnimationFrame','matchMedia','performance'] as const;
 const original=keys.map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)] as const);
 let now=0,id=0,reduced=false;const callbacks=new Map<number,FrameRequestCallback>();
 Object.defineProperty(globalThis,'performance',{configurable:true,value:{now:()=>now}});
 Object.defineProperty(globalThis,'requestAnimationFrame',{configurable:true,value:(cb:FrameRequestCallback)=>{callbacks.set(++id,cb);return id}});
 Object.defineProperty(globalThis,'cancelAnimationFrame',{configurable:true,value:(key:number)=>callbacks.delete(key)});
 Object.defineProperty(globalThis,'matchMedia',{configurable:true,value:()=>({matches:reduced})});
 try{check({tick:()=>{now+=1000/60;const active=[...callbacks.values()];callbacks.clear();active.forEach(cb=>cb(now))},pending:()=>callbacks.size,reduce:()=>{reduced=true},time:()=>now})}
 finally{for(const [key,descriptor] of original){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else Reflect.deleteProperty(globalThis,key)}}
}
test('drag writes coalesce, interruption preserves the visible frame, destruction cancels work',()=>{
 animationClock(clock=>{
  const writes:number[]=[],motion=new SpringMotion(x=>writes.push(x));
  motion.interrupt();motion.dragTo(10,1);motion.dragTo(20,2);motion.dragTo(30,3);
  assert.equal(clock.pending(),1);assert.equal(writes.length,0);clock.tick();assert.deepEqual(writes,[30]);
  motion.springTo(76);clock.tick();const paused=motion.interrupt();assert.equal(paused.position,writes.at(-1));assert.equal(clock.pending(),0);
  motion.springTo(0);assert.equal(clock.pending(),1);motion.destroy();assert.equal(clock.pending(),0);
 });
});
test('reduced motion snaps settling but keeps direct gesture tracking',()=>{
 animationClock(clock=>{
  clock.reduce();const writes:number[]=[],motion=new SpringMotion(x=>writes.push(x));
  motion.dragTo(40,1);clock.tick();assert.equal(writes.at(-1),40);
  motion.springTo(76);assert.equal(writes.at(-1),76);assert.equal(clock.pending(),0);
  motion.springTo(0);assert.equal(writes.at(-1),0);motion.destroy();
 });
});
test('a disconnected writer can stop its own spring without leaving a frame callback',()=>{
 animationClock(clock=>{const motion=new SpringMotion(()=>motion.destroy(),50);motion.springTo(0);clock.tick();assert.equal(clock.pending(),0)});
});
