import {useEffect,useRef,useState} from 'react';
import {SimpleUser} from 'sip.js/lib/platform/web';
import {api,err} from './client';
import {CallMedia,playAudio} from './media';
type Endpoint={uri:string,wss:string,username:string,password:string,iceServers?:RTCIceServer[],testTarget?:string};
export function AudioCheck({disabled,onBusy}:{disabled:boolean,onBusy:(v:boolean)=>void}){
  const [busy,setBusy]=useState(false),[status,setStatus]=useState(''),[packets,setPackets]=useState(''),[blocked,setBlocked]=useState(false);
  const audio=useRef<HTMLAudioElement>(null),user=useRef<SimpleUser|null>(null),capture=useRef<CallMedia|null>(null);
  const running=useRef(false),expiry=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
  function stop(){
    running.current=false;
    if(expiry.current)clearTimeout(expiry.current);
    const current=user.current;user.current=null;
    if(current)void current.hangup().catch(()=>{}).finally(()=>current.disconnect().catch(()=>{}));
    capture.current?.release();capture.current=null;setBusy(false);onBusy(false);
  }
  useEffect(()=>()=>{stop()},[]);
  useEffect(()=>{
    if(!busy)return;
    const t=setInterval(()=>{void capture.current?.summary().then(setPackets).catch(()=>{})},1000);
    return()=>clearInterval(t);
  },[busy]);
  function play(){void playAudio(audio.current).then(()=>setBlocked(false)).catch(()=>setBlocked(true))}
  async function start(){
    if(disabled||running.current)return;
    running.current=true;setBusy(true);onBusy(true);setBlocked(false);setPackets('');setStatus('请允许麦克风，正在连接测试');
    const media=new CallMedia(state=>{if(state==='failed')setStatus('音频连接失败，请检查当前网络')});capture.current=media;
    try{
      await media.acquire();
      if(!running.current)return;
      const cfg=await api<Endpoint>('voice/web-session',{});
      if(!running.current)return;
      if(!cfg.testTarget||!/^sip:cl-audio-test@[A-Za-z0-9.-]+$/.test(cfg.testTarget))throw Error('主节点尚未配置音频测试');
      const sip=new SimpleUser(cfg.wss,{aor:cfg.uri,media:{constraints:{audio:true,video:false},remote:{audio:audio.current!}},
        userAgentOptions:{authorizationUsername:cfg.username,authorizationPassword:cfg.password,logBuiltinEnabled:false,
          sessionDescriptionHandlerFactory:media.factory,
          sessionDescriptionHandlerFactoryOptions:{peerConnectionConfiguration:{iceServers:cfg.iceServers||[]}}},
        delegate:{onCallAnswered:()=>{setStatus('请说话，正常时会听到回声；测试不拨打电话');play()},
          onCallHangup:()=>{if(running.current){setStatus('测试已结束');stop()}},
          onServerDisconnect:()=>{if(running.current){setStatus('测试连接已断开');stop()}}}});
      user.current=sip;
      await sip.connect();if(!running.current)return;
      await sip.register();if(!running.current)return;
      await sip.call(cfg.testTarget);
      if(running.current)expiry.current=setTimeout(()=>{setStatus('30 秒测试结束，麦克风已关闭');stop()},30000);
    }catch(e){if(running.current){setStatus(err(e));stop()}}
  }
  return <section className="card"><h2>通话音频测试</h2><audio ref={audio} autoPlay playsInline onPlaying={()=>setBlocked(false)}/>
    <p>仅连接安卓主节点，检测麦克风与回声，不呼叫任何手机号。</p>
    <button disabled={disabled||busy} onClick={()=>void start()}>开始音频测试</button>
    {busy&&<><button onClick={play}>{blocked?'点此启用声音':'播放测试声音'}</button><button onClick={()=>{setStatus('已结束测试，麦克风已关闭');stop()}}>结束测试</button></>}
    <p role="status">{status}</p>{busy&&<small>{packets}</small>}
    <p className="hint">iPhone 主屏幕网页应用关闭重开后，系统可能再次询问麦克风；网页无法永久授予权限。每次通话只申请一次，结束即释放麦克风。Safari 标签页的单站授权不保证沿用到主屏幕应用。</p>
  </section>;
}
