import {defaultSessionDescriptionHandlerFactory} from 'sip.js/lib/platform/web';

/** One capture per call, shared by offer/re-INVITE. Never retains the microphone between calls. */
export class CallMedia {
  private stream?:MediaStream;
  private pending?:Promise<MediaStream>;
  private generation=0;
  private closed=false;
  get isClosed(){return this.closed}
  private pc?:RTCPeerConnection;
  constructor(private changed:(state:RTCPeerConnectionState)=>void=()=>{},
              private capture=()=>navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true},video:false})){}
  acquire():Promise<MediaStream>{
    if(this.closed)return Promise.reject(new DOMException('通话已结束','AbortError'));
    if(this.stream?.getAudioTracks().some(t=>t.readyState==='live'))return Promise.resolve(this.stream);
    if(this.pending)return this.pending;
    const generation=this.generation;
    const task=this.capture().then(stream=>{
      if(generation!==this.generation){stream.getTracks().forEach(t=>t.stop());throw new DOMException('通话已取消','AbortError')}
      this.stream=stream;return stream;
    }).finally(()=>{if(this.pending===task)this.pending=undefined});
    this.pending=task;return task;
  }
  factory=defaultSessionDescriptionHandlerFactory(async(constraints,handler)=>{
    if(constraints.video)throw Error('此应用只支持音频');
    this.pc=handler.peerConnection;
    this.pc?.addEventListener('connectionstatechange',()=>this.changed(this.pc?.connectionState||'closed'));
    return constraints.audio?this.acquire():new MediaStream();
  });
  async summary():Promise<string>{
    if(!this.pc)return '尚未建立音频连接';
    let received=0,sent=0;
    const stats=await this.pc.getStats();
    stats.forEach(r=>{
      if((r.kind||r.mediaType)!=='audio')return;
      if(r.type==='inbound-rtp')received+=Number(r.packetsReceived||0);
      if(r.type==='outbound-rtp')sent+=Number(r.packetsSent||0);
    });
    const states:Record<string,string>={new:'等待连接',connecting:'连接中',connected:'已连接',disconnected:'已断开',failed:'连接失败',closed:'已关闭'};
    return (states[this.pc.connectionState]||this.pc.connectionState)+' · 收到 '+received+' 包 / 发出 '+sent+' 包';
  }
  release(){
    this.closed=true;++this.generation;this.pending=undefined;
    this.stream?.getTracks().forEach(t=>t.stop());this.stream=undefined;this.pc=undefined;
  }
}
export async function playAudio(element:HTMLAudioElement|null):Promise<void>{
  if(!element?.srcObject)return;
  element.muted=false;element.volume=1;
  await element.play();
}
