import {useEffect,useRef,useState} from 'react';
import {SimpleUser} from 'sip.js/lib/platform/web';
import {api,err,PhoneError,type Line,type PbxCall} from './client';

type Endpoint={uri:string,wss:string,username:string,password:string,iceServers?:RTCIceServer[]};
type Voice={ready:boolean,reason:string,groundwire?:{registered:boolean},gateways?:{deviceId:string,registered:boolean,busy:boolean}[]};
const phases:Record<string,string>={WAITING_WEB:'等待网页连接',DIALING:'正在呼叫',WEB_ACTIVE:'通话中',HANDOFF_REQUESTED:'正在请求接续',NATIVE_RINGING:'请在 Groundwire 接听',NATIVE_ANSWERED:'Groundwire 已接听',MEDIA_VERIFYING:'正在验证媒体',NATIVE_ACTIVE:'Groundwire 通话中',RECOVERING:'正在恢复连接',HANDOFF_FAILED:'接续未成功',CALL_ENDED:'通话已结束'};
const available=(line:Line)=>(line.lineOnline??line.online)&&line.confirmed;
export function Calling({lines,number,setNumber,enabled,lineHint}:{lines:Line[],number:string,setNumber:(v:string)=>void,enabled:boolean,lineHint:{id:string,seq:number}}){
  const [selected,setSelected]=useState(()=>localStorage.getItem('phone.lastLine')||'');
  const [voice,setVoice]=useState<Voice|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [call,setCall]=useState<PbxCall|null>(null),[activeId,setId]=useState(()=>sessionStorage.getItem('phone.call')||'');
  const [media,setMedia]=useState(''),[held,setHeld]=useState(false),[muted,setMuted]=useState(false);
  const [auto,setAuto]=useState(()=>localStorage.getItem('phone.autoHandoff')==='true');
  const sip=useRef<SimpleUser|null>(null),audio=useRef<HTMLAudioElement>(null),pending=useRef(false),handoff=useRef('');
  const [now,setNow]=useState(Date.now());
  useEffect(()=>{
    if(lineHint.seq>0 && !activeId)setSelected(lineHint.id);
  },[lineHint,activeId]);
  function detach(){
    const user=sip.current;sip.current=null;
    if(user)void user.disconnect().catch(()=>{});
  }
  function releaseLocal(){
    setId('');sessionStorage.removeItem('phone.call');sessionStorage.removeItem('phone.handoff');detach();
  }
  async function status(){try{setVoice(await api<Voice>('voice/status'))}catch(e){setError(err(e))}}
  useEffect(()=>{void status();const t=setInterval(()=>{if(!document.hidden)void status()},15000);return()=>clearInterval(t)},[]);
  useEffect(()=>()=>{void sip.current?.disconnect().catch(()=>{})},[]);
  useEffect(()=>{
    if(!activeId)return;
    let alive=true,running=false;
    async function check(){
      if(running)return;running=true;
      try{const c=await api<PbxCall>('calls/'+activeId+'/state');if(!alive)return;setCall(c);
        if(c.state==='CALL_ENDED')releaseLocal();
      }catch(e){if(alive){setError(err(e));if(e instanceof PhoneError && e.status===404){releaseLocal();setCall(null)}}}finally{running=false}
    }
    void check();const t=setInterval(()=>{if(!document.hidden)void check()},1800);
    const back=()=>{if(!document.hidden)void check()};document.addEventListener('visibilitychange',back);
    return()=>{alive=false;clearInterval(t);document.removeEventListener('visibilitychange',back)};
  },[activeId]);
  useEffect(()=>{
    if(!call?.answeredAt||!activeId)return;
    const t=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(t);
  },[activeId,call?.answeredAt]);
  function handoffBody(){
    handoff.current||=sessionStorage.getItem('phone.handoff')||crypto.randomUUID();
    sessionStorage.setItem('phone.handoff',handoff.current);
    return {requestId:handoff.current};
  }
  useEffect(()=>{
    if(!auto||!activeId||call?.state!=='WEB_ACTIVE')return;
    const background=()=>{if(document.hidden)void fetch('/api/v2/calls/'+activeId+'/handoff',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(handoffBody()),keepalive:true}).catch(()=>{})};
    document.addEventListener('visibilitychange',background);return()=>document.removeEventListener('visibilitychange',background);
  },[auto,activeId,call?.state]);
  async function webSession(){
      if(!audio.current)throw Error('页面音频尚未就绪');
      detach();
      const config=await api<Endpoint>('voice/web-session',{});
      const user=new SimpleUser(config.wss,{aor:config.uri,sendDTMFUsingSessionDescriptionHandler:true,media:{constraints:{audio:true,video:false},remote:{audio:audio.current}},
        userAgentOptions:{authorizationUsername:config.username,authorizationPassword:config.password,logBuiltinEnabled:false,
          sessionDescriptionHandlerFactoryOptions:{peerConnectionConfiguration:{iceServers:config.iceServers||[]}}},
        delegate:{onCallAnswered:()=>setMedia('SIP 已应答'),onCallHangup:()=>setMedia('网页通道已关闭'),
          onServerDisconnect:()=>setMedia('信令连接已断开'),onCallHold:setHeld}});
      sip.current=user;await user.connect();await user.register();return user;
  }
  async function dial(resume=false){
    const recovering=resume&&call?.state==='WAITING_WEB'&&activeId===call.id;
    const route=recovering?call.lineId:selected,destination=recovering?call.number:number;
    const line=lines.find(l=>l.lineId===route);
    if(!enabled||pending.current||(activeId&&!recovering)||!line||!available(line)||!voice?.ready)return;
    pending.current=true;setBusy(true);setError('');setMedia('连接中');
    if(!recovering){handoff.current='';sessionStorage.removeItem('phone.handoff')}
    let id='';
    try{
      const user=await webSession();
      id=recovering?activeId:crypto.randomUUID();sessionStorage.setItem('phone.call',id);
      const result=await api<PbxCall>('calls',{id,lineId:route,number:destination,autoHandoff:auto});
      setCall(result);setId(id);localStorage.setItem('phone.lastLine',route);
      if(result.state!=='WAITING_WEB')return;
      if(!result.target||!/^sip:cl-[0-9a-f]{32}@[A-Za-z0-9.-]+$/.test(result.target))throw Error('通话票据已过期或无效');
      await user.call(result.target);
      setMuted(false);setHeld(false);
    }catch(e){setError(err(e));if(id){
      // A lost allocation response is ambiguous. Inspect the same ID; never redial.
      try{const c=await api<PbxCall>('calls/'+id+'/state');setId(id);setCall(c)}
      catch(inspect){if(inspect instanceof PhoneError && inspect.status===404){releaseLocal();setCall(null)}else setId(id)}
    }else detach()}
    finally{pending.current=false;setBusy(false)}
  }
  async function action(f:()=>Promise<unknown>){if(pending.current)return;pending.current=true;setBusy(true);setError('');try{await f()}catch(e){setError(err(e))}finally{pending.current=false;setBusy(false)}}
  const canDial=(line:Line)=>available(line)&&voice?.gateways?.some(g=>g.deviceId===line.deviceId&&g.registered&&!g.busy);
  const connected=call?.state==='WEB_ACTIVE'||call?.state==='HANDOFF_FAILED';
  const elapsed=call?.answeredAt?Math.max(0,Math.floor(((call.endedAt||now)-call.answeredAt)/1000)):0;
  return <><audio ref={audio} autoPlay playsInline/>
    {activeId?<section className="live">
      <small>{lines.find(l=>l.lineId===call?.lineId)?.name}</small><h1>{call?.number}</h1>
      <p>{phases[call?.state||'']||'查询真实通话状态…'}</p>{!!call?.answeredAt&&<time>{Math.floor(elapsed/60)}:{String(elapsed%60).padStart(2,'0')}</time>}
      <p>{media} {call?.reason}</p><div className="controls">
        {call?.state==='WAITING_WEB'&&(!sip.current||error)&&<button disabled={busy} onClick={()=>void dial(true)}>继续连接此通话</button>}
        <button disabled={!connected||!sip.current} onClick={()=>{if(muted)sip.current?.unmute();else sip.current?.mute();setMuted(sip.current?.isMuted()||false)}}>{muted?'取消静音':'静音'}</button>
        <button disabled={!connected||!sip.current||busy} onClick={()=>void action(async()=>{if(held)await sip.current?.unhold();else await sip.current?.hold()})}>{held?'继续':'保持'}</button>
        <button disabled={!connected||busy} onClick={()=>void action(async()=>{
          if(call?.state==='HANDOFF_FAILED'){handoff.current='';sessionStorage.removeItem('phone.handoff')}
          const result=await api<PbxCall>('calls/'+activeId+'/handoff',handoffBody());setCall(result);
        })}>切换至后台通话</button>
      </div><div className="dtmf">{'123456789*0#'.split('').map(k=><button key={k} disabled={!connected||!sip.current} onClick={()=>void action(async()=>sip.current?.sendDTMF(k))}>{k}</button>)}</div>
      <button className="hangup" disabled={busy} onClick={()=>void action(()=>api('calls/'+activeId+'/hangup',{}))}>挂断</button>
    </section>:<><h1>拨号键盘</h1>
      <input className="number" inputMode="tel" aria-label="电话号码" value={number} maxLength={24} onChange={e=>setNumber(e.target.value)}/>
      <div className="keypad">{'123456789*0#'.split('').map((k,i)=><button key={k} onClick={()=>setNumber((number+k).slice(0,24))}>{k}<small>{['','ABC','DEF','GHI','JKL','MNO','PQRS','TUV','WXYZ','','+',''][i]}</small></button>)}</div>
      <div className="dialrow"><button onClick={()=>setNumber(number.startsWith('+')?number:'+'+number)}>＋</button><button className="dial" disabled={!enabled||busy||!voice?.ready||!lines.some(l=>l.lineId===selected&&canDial(l))||!/^\+?\d{3,20}$/.test(number)} onClick={()=>void dial()}>拨打</button><button aria-label="退格" onClick={()=>setNumber(number.slice(0,-1))}>⌫</button></div>
      <label>拨出线路<select value={selected} onChange={e=>setSelected(e.target.value)}><option value="">选择线路</option>{selected&&!lines.some(l=>l.lineId===selected)&&<option value={selected} disabled>原选线路不可用</option>}{lines.map(l=><option key={l.lineId} value={l.lineId} disabled={!canDial(l)}>{l.name}{!canDial(l)?' · 不可拨出':''}</option>)}</select></label>
      <label><input type="checkbox" checked={auto} onChange={e=>{setAuto(e.target.checked);localStorage.setItem('phone.autoHandoff',String(e.target.checked))}}/> 切到后台时请求 Groundwire 接续</label>
      <p className="hint">{!enabled?'本安装尚未获拨号授权':voice?.reason||(!voice?.ready?'正在检查语音网关':'语音网关就绪')}</p>{call?.state==='CALL_ENDED'&&<p>上一通电话已结束</p>}
    </>}{error&&<p role="alert">{error}</p>}</>;
}
