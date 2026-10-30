import {test} from 'node:test';
import assert from 'node:assert/strict';
import {resolveViewport,type ViewportSample} from '../src/viewport';

const rest:ViewportSample={layoutWidth:390,layoutHeight:844,visualHeight:844,offsetTop:0,scale:1,editable:false};
const initial=()=>resolveViewport(rest);

test('keyboard pan is compensated separately from bottom avoidance',()=>{
 const next=resolveViewport({...rest,visualHeight:506,offsetTop:28,editable:true},initial());
 assert.deepEqual(next,{width:390,height:844,top:28,inset:338,keyboardOpen:true,zoomed:false});
 // Top compensation is not also subtracted from the keyboard inset.
 assert.equal(next.height-next.inset,506);
});
test('blur preserves avoidance until the keyboard actually retracts',()=>{
 const open=resolveViewport({...rest,visualHeight:506,offsetTop:28,editable:true},initial());
 const retracting=resolveViewport({...rest,visualHeight:650,offsetTop:14},open);
 assert.equal(retracting.height,844);assert.equal(retracting.inset,194);assert.equal(retracting.keyboardOpen,true);
 const closed=resolveViewport({...rest,offsetTop:34},retracting);
 assert.equal(closed.height,844);assert.equal(closed.inset,0);assert.equal(closed.top,0);assert.equal(closed.keyboardOpen,false);
});
test('dismissing the keyboard while its textarea stays focused clears stale offset',()=>{
 const open=resolveViewport({...rest,visualHeight:506,offsetTop:28,editable:true},initial());
 const closed=resolveViewport({...rest,offsetTop:34,editable:true},open);
 assert.equal(closed.top,0);assert.equal(closed.inset,0);assert.equal(closed.keyboardOpen,false);
});
test('hardware keyboard focus and subpixel resize do not imply occlusion',()=>{
 assert.equal(resolveViewport({...rest,editable:true},initial()).keyboardOpen,false);
 const tiny=resolveViewport({...rest,visualHeight:843.5,offsetTop:.5,editable:true},initial());
 assert.equal(tiny.keyboardOpen,false);assert.equal(tiny.inset,0);assert.equal(tiny.top,0);
});
test('pinch zoom does not shrink the shell or get misidentified as a keyboard',()=>{
 const before=initial(),zoom=resolveViewport({...rest,visualHeight:422,offsetTop:120,scale:2},before);
 assert.deepEqual(zoom,{...before,zoomed:true});
 const returned=resolveViewport(rest,zoom);assert.deepEqual(returned,before);
 const open=resolveViewport({...rest,visualHeight:506,offsetTop:28,editable:true},before);
 assert.deepEqual(resolveViewport({...rest,visualHeight:253,offsetTop:80,scale:2,editable:true},open),{...open,zoomed:true});
});
test('rotation establishes a new shell baseline while the keyboard remains open',()=>{
 const portrait=resolveViewport({...rest,visualHeight:506,offsetTop:28,editable:true},initial());
 const landscape=resolveViewport({...rest,layoutWidth:844,layoutHeight:390,visualHeight:180,offsetTop:12,editable:true},portrait);
 assert.equal(landscape.height,390);assert.equal(landscape.inset,210);assert.equal(landscape.top,12);
 const closed=resolveViewport({...rest,layoutWidth:844,layoutHeight:390,visualHeight:390,offsetTop:12},landscape);
 assert.equal(closed.height,390);assert.equal(closed.inset,0);assert.equal(closed.top,0);
});
test('ordinary window/browser-chrome changes update the resting viewport baseline',()=>{
 const resized=resolveViewport({...rest,layoutHeight:650,visualHeight:650},initial());
 assert.equal(resized.height,650);assert.equal(resized.keyboardOpen,false);
 const initialChrome=resolveViewport({...rest,visualHeight:800});
 assert.equal(initialChrome.height,800);
 const focused=resolveViewport({...rest,visualHeight:500,editable:true},initialChrome);
 assert.equal(focused.height,800);assert.equal(focused.inset,300);
});
test('opening on an already focused input uses the full layout baseline',()=>{
 const first=resolveViewport({...rest,visualHeight:500,offsetTop:28,editable:true});
 assert.equal(first.height,844);assert.equal(first.inset,344);
});
test('invalid and transient viewport values cannot produce negative avoidance',()=>{
 const overshoot=resolveViewport({...rest,visualHeight:506,offsetTop:900,editable:true},initial());
 assert.equal(overshoot.top,338);assert.equal(overshoot.inset,338);
 const negative=resolveViewport({...rest,visualHeight:506,offsetTop:-20,editable:true},initial());assert.equal(negative.top,0);
 const invalid=resolveViewport({...rest,visualHeight:0,offsetTop:NaN,scale:NaN},initial());assert.deepEqual(invalid,initial());
});
