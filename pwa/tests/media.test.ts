import {test} from 'node:test';
import assert from 'node:assert/strict';
import {CallMedia,playAudio} from '../src/dialer/media';
function stream(){
  const track={readyState:'live',stopped:0,stop(){this.stopped++;this.readyState='ended'}};
  return {value:{getTracks:()=>[track],getAudioTracks:()=>[track]} as unknown as MediaStream,track};
}
test('concurrent offer requests share one microphone grant; ending a call releases it permanently',async()=>{
  const s=stream();let requests=0,resolve!:(s:MediaStream)=>void;
  const media=new CallMedia(()=>{},()=>{requests++;return new Promise(r=>{resolve=r})});
  const first=media.acquire(),second=media.acquire();
  assert.equal(first,second);assert.equal(requests,1);
  resolve(s.value);assert.equal(await first,s.value);assert.equal(await media.acquire(),s.value);
  assert.equal(requests,1);media.release();assert.equal(s.track.stopped,1);
  await assert.rejects(media.acquire(),{name:'AbortError'});assert.equal(requests,1);
});
test('a late permission dialog cannot leave the microphone live after navigating away',async()=>{
  const s=stream();let resolve!:(s:MediaStream)=>void;
  const media=new CallMedia(()=>{},()=>new Promise(r=>{resolve=r}));
  const capture=media.acquire();media.release();resolve(s.value);
  await assert.rejects(capture,{name:'AbortError'});assert.equal(s.track.stopped,1);
});
test('autoplay refusal is observable so the UI can offer an explicit playback button',async()=>{
  const element={srcObject:{},muted:true,volume:0,play:()=>Promise.reject(new DOMException('gesture needed','NotAllowedError'))};
  await assert.rejects(playAudio(element as unknown as HTMLAudioElement),{name:'NotAllowedError'});
  assert.equal(element.muted,false);assert.equal(element.volume,1);
});
