import {useEffect,useRef,useState} from 'react';
import {SimpleUser} from 'sip.js/lib/platform/web';
import {api,err,PhoneError,type Line,type PbxCall} from './client';
import {CallMedia,playAudio} from './media';
import {PhoneIcon} from './PhoneIcon';
import {formatPhone} from '../phone';

type Endpoint={uri:string,wss:string,username:string,password:string,iceServers?:RTCIceServer[]};
type Voice={ready:boolean,reason:string,groundwire?:{registered:boolean},gateways?:{deviceId:string,registered:boolean,busy:boolean}[]};
const phases:Record<string,string>={WAITING_WEB:'等待网页连接',DIALING:'正在呼叫',WEB_ACTIVE:'通话中',HANDOFF_REQUESTED:'正在请求接续',NATIVE_RINGING:'请在 Groundwire 接听',NATIVE_ANSWERED:'Groundwire 已接听',MEDIA_VERIFYING:'正在验证媒体',NATIVE_ACTIVE:'Groundwire 通话中',RECOVERING:'正在恢复连接',HANDOFF_FAILED:'接续未成功',CALL_ENDED:'通话已结束'};
const available=(line:Line)=>(line.lineOnline??line.online)&&line.confirmed;
export function Calling({lines,number,setNumber,enabled,lineHint,onBusy,openSettings}:{lines:Line[],number:string,setNumber:(v:string)=>void,enabled:boolean,lineHint:{id:string,seq:number},onBusy:(value:boolean)=>void,openSettings:()=>void}){
  const [selected,setSelected]=useState(()=>localStorage.getItem('phone.lastLine')||'');
  const [voice,setVoice]=useState<Voice|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [call,setCall]=useState<PbxCall|null>(null),[activeId,setId]=useState(()=>sessionStorage.getItem('phone.call')||'');
  const [media,setMedia]=useState(''),[held,setHeld]=useState(false),[muted,setMuted]=useState(false);
  const [auto,setAuto]=useState(()=>localStorage.getItem('phone.autoHandoff')==='true');
  const sip=useRef<SimpleUser|null>(null),audio=useRef<HTMLAudioElement>(null),pending=useRef(false),handoff=useRef('');
  const [dtmf,setDtmf]=useState(false);
  const digitTimer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined),deleteTimer=useRef<ReturnType<typeof setInterval>|undefined>(undefined),longPress=useRef(false),currentNumber=useRef(number);currentNumber.current=number;
  function clearPress(){if(digitTimer.current)clearTimeout(digitTimer.current);if(deleteTimer.current)clearInterval(deleteTimer.current)}
  useEffect(()=>{const cancel=()=>clearPress();window.addEventListener('blur',cancel);document.addEventListener('visibilitychange',cancel);return()=>{clearPress();window.removeEventListener('blur',cancel);document.removeEventListener('visibilitychange',cancel)}},[]);
  function zeroDown(){longPress.current=false;digitTimer.current=setTimeout(()=>{longPress.current=true;if(!currentNumber.current)setNumber('+')},450)}
  function deleteDown(){longPress.current=false;digitTimer.current=setTimeout(()=>{longPress.current=true;setNumber(currentNumber.current.slice(0,-1));deleteTimer.current=setInterval(()=>setNumber(currentNumber.current.slice(0,-1)),85)},350)}
  const [now,setNow]=useState(Date.now());
  const capture=useRef<CallMedia|null>(null);
  const [blocked,setBlocked]=useState(false),[audioStats,setAudioStats]=useState('');
  useEffect(()=>{onBusy(!!activeId||busy)},[activeId,busy,onBusy]);
  function play(){void playAudio(audio.current).then(()=>setBlocked(false)).catch(()=>setBlocked(true))}
  useEffect(()=>{
    if(!activeId)return;
    const t=setInterval(()=>{void capture.current?.summary().then(setAudioStats).catch(()=>{})},1500);
    return()=>clearInterval(t);
  },[activeId]);
  useEffect(()=>{
    if(lineHint.seq>0 && !activeId)setSelected(lineHint.id);
  },[lineHint,activeId]);
  function detach(){
    const user=sip.current;sip.current=null;
    capture.current?.release();capture.current=null;setAudioStats('');
    if(user)void user.disconnect().catch(()=>{});
  }
  function releaseLocal(){
    setId('');sessionStorage.removeItem('phone.call');sessionStorage.removeItem('phone.handoff');detach();
  }
  async function status(){try{setVoice(await api<Voice>('voice/status'))}catch(e){setError(err(e))}}
  useEffect(()=>{if(!enabled)return;void status();const t=setInterval(()=>{if(!document.hidden)void status()},15000);return()=>clearInterval(t)},[enabled]);
  useEffect(()=>()=>{capture.current?.release();void sip.current?.disconnect().catch(()=>{})},[]);
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
  useEffect(()=>{
    if(!activeId||!['WEB_ACTIVE','HANDOFF_FAILED','RECOVERING'].includes(call?.state||''))return;
    const restore=()=>{if(!document.hidden)play()};
    restore();window.addEventListener('focus',restore);document.addEventListener('visibilitychange',restore);
    return()=>{window.removeEventListener('focus',restore);document.removeEventListener('visibilitychange',restore)};
  },[activeId,call?.state]);
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
      const local=new CallMedia(state=>{if(state==='failed')setMedia('音频连接失败，请检查当前网络')});
      capture.current=local;
      await local.acquire();
      const config=await api<Endpoint>('voice/web-session',{});
      if(local.isClosed)throw new DOMException('通话已取消','AbortError');
      const user=new SimpleUser(config.wss,{aor:config.uri,sendDTMFUsingSessionDescriptionHandler:true,media:{constraints:{audio:true,video:false},remote:{audio:audio.current}},
        userAgentOptions:{sessionDescriptionHandlerFactory:local.factory,authorizationUsername:config.username,authorizationPassword:config.password,logBuiltinEnabled:false,
          sessionDescriptionHandlerFactoryOptions:{peerConnectionConfiguration:{iceServers:config.iceServers||[]}}},
        delegate:{onCallAnswered:()=>{if(capture.current!==local)return;setMedia('SIP 已应答');play()},onCallHangup:()=>{local.release();if(capture.current===local)setMedia('网页通道已关闭，可恢复网页通话')},
          onServerDisconnect:()=>{if(capture.current===local)setMedia('信令连接已断开')},onCallHold:value=>{if(capture.current===local)setHeld(value)}}});
      sip.current=user;await user.connect();
      if(local.isClosed)throw new DOMException('通话已取消','AbortError');
      await user.register();
      if(local.isClosed)throw new DOMException('通话已取消','AbortError');
      return user;
  }
  async function resumeWeb(){
    if(pending.current||!activeId)return;
    pending.current=true;setBusy(true);setError('');setMedia('正在恢复原通话');
    try{
      // Opening the microphone stays inside this tap, including after CallKit interrupted capture.
      const user=await webSession();
      const result=await api<PbxCall>('calls/'+activeId+'/resume',{});
      if(!result.target||!/^sip:cl-[0-9a-f]{32}@[A-Za-z0-9.-]+$/.test(result.target))throw Error('恢复票据无效');
      setCall(result);await user.call(result.target);setMuted(false);setHeld(false);
      handoff.current='';sessionStorage.removeItem('phone.handoff');
    }catch(e){setError(err(e));detach()}
    finally{pending.current=false;setBusy(false)}
  }
  async function dial(resume=false){
    const recovering=resume&&call?.state==='WAITING_WEB'&&activeId===call.id;
    const route=recovering?call.lineId:selected,destination=recovering?call.number:number;
    const line=lines.find(l=>l.lineId===route);
    if(!enabled||pending.current||(activeId&&!recovering)||!line||!available(line)||!voice?.ready)return;
    pending.current=true;setBusy(true);setError('');setMedia('连接中');setBlocked(false);
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
  return <><audio ref={audio} autoPlay playsInline onPlaying={()=>setBlocked(false)}/>
    {activeId?<section className="live">
      <div className="live-heading"><small>{lines.find(l=>l.lineId===call?.lineId)?.name}</small><h1>{formatPhone(call?.number||'')}</h1><p>{phases[call?.state||'']||'查询通话状态…'}</p>{!!call?.answeredAt&&<time>{Math.floor(elapsed/60)}:{String(elapsed%60).padStart(2,'0')}</time>}</div>
      {dtmf?<div className="keypad in-call-keypad">{'123456789*0#'.split('').map(k=><button key={k} disabled={!connected||!sip.current} onClick={()=>void action(async()=>sip.current?.sendDTMF(k))}>{k}</button>)}</div>:
      <div className="call-controls">
        <button disabled={!connected||!sip.current} aria-pressed={muted} onClick={()=>{if(muted)sip.current?.unmute();else sip.current?.mute();setMuted(sip.current?.isMuted()||false)}}><i><PhoneIcon name="mute" size={28}/></i><span>{muted?'取消静音':'静音'}</span></button>
        <button disabled={!connected||!sip.current} onClick={()=>setDtmf(true)}><i><PhoneIcon name="keypad" size={28}/></i><span>拨号键盘</span></button>
        <button disabled={!connected||!sip.current} onClick={play}><i><PhoneIcon name="speaker" size={28}/></i><span>{blocked?'启用声音':'播放声音'}</span></button>
        <button disabled={!connected||!sip.current||busy} aria-pressed={held} onClick={()=>void action(async()=>{if(held)await sip.current?.unhold();else await sip.current?.hold()})}><i><PhoneIcon name="hold" size={28}/></i><span>{held?'继续':'保持'}</span></button>
        <button disabled={!connected||busy} onClick={()=>void action(async()=>{if(call?.state==='HANDOFF_FAILED'){handoff.current='';sessionStorage.removeItem('phone.handoff')}const result=await api<PbxCall>('calls/'+activeId+'/handoff',handoffBody());setCall(result)})}><i><PhoneIcon name="handoff" size={28}/></i><span>接续至 Groundwire</span></button>
      </div>}
      {dtmf&&<button className="hide-keypad" onClick={()=>setDtmf(false)}>隐藏拨号键盘</button>}
      {call?.state==='WAITING_WEB'&&(!sip.current||error)&&<button disabled={busy} onClick={()=>void dial(true)}>继续连接此通话</button>}
      {call&&['HANDOFF_FAILED','RECOVERING','WEB_ACTIVE'].includes(call.state)&&<button disabled={busy} onClick={()=>void resumeWeb()}>恢复网页通话</button>}
      {call?.state==='RECOVERING'&&<p className="hint">原通话暂时保留，请在一分钟内恢复，不会重新拨号。</p>}
      <button className="hangup" aria-label="挂断" disabled={busy} onClick={()=>void action(()=>api('calls/'+activeId+'/hangup',{}))}><PhoneIcon name="phone" size={32}/></button>
      <details className="call-diagnostics"><summary>音频状态</summary><p>{media} {call?.reason}</p>{audioStats&&<small>{audioStats}</small>}</details>
    </section>:<section className="dialer-screen">
      <div className="dial-top"><label className="line-chip"><span className="sr-only">拨出线路</span><select aria-label="拨出线路" value={selected} onChange={e=>setSelected(e.target.value)}><option value="">选择线路</option>{selected&&!lines.some(l=>l.lineId===selected)&&<option value={selected} disabled>原选线路不可用</option>}{lines.map(l=><option key={l.lineId} value={l.lineId} disabled={!canDial(l)}>{l.name}{!canDial(l)?' · 不可拨出':''}</option>)}</select></label><button className="glass-circle" aria-label="互联设置" onClick={openSettings}><PhoneIcon name="settings" size={22}/></button></div>
      <div className="dial-number-area"><input className="number" inputMode="none" aria-label="电话号码" autoComplete="off" spellCheck={false} value={formatPhone(number)} maxLength={32} onChange={e=>setNumber(e.target.value.replace(/[^+0-9*#]/g,'').slice(0,24))}/></div>
      <div className="keypad">{'123456789*0#'.split('').map((k,i)=><button key={k} aria-label={k} onPointerDown={k==='0'?zeroDown:undefined} onPointerUp={clearPress} onPointerCancel={clearPress} onPointerLeave={clearPress} onContextMenu={e=>e.preventDefault()} onClick={()=>{if(k==='0'&&longPress.current){longPress.current=false;return}setNumber((number+k).slice(0,24))}}><span>{k}</span><small>{['','ABC','DEF','GHI','JKL','MNO','PQRS','TUV','WXYZ','','+',''][i]}</small></button>)}</div>
      <div className="dialrow"><span/><button className="dial" aria-label="拨打" disabled={!enabled||busy||!voice?.ready||!lines.some(l=>l.lineId===selected&&canDial(l))||!/^\+?\d{3,20}$/.test(number)} onClick={()=>void dial()}><PhoneIcon name="phone" size={34}/></button><button className={'backspace'+(!number?' empty':'')} aria-label="退格" disabled={!number} onPointerDown={deleteDown} onPointerUp={clearPress} onPointerCancel={clearPress} onPointerLeave={clearPress} onContextMenu={e=>e.preventDefault()} onClick={()=>{if(longPress.current){longPress.current=false;return}setNumber(number.slice(0,-1))}}><PhoneIcon name="delete" size={25}/></button></div>
      <div className="dial-options"><details><summary>通话选项</summary><label className="switch-row"><span>切到后台时请求 Groundwire 接续</span><input type="checkbox" checked={auto} onChange={e=>{setAuto(e.target.checked);localStorage.setItem('phone.autoHandoff',String(e.target.checked))}}/></label><p className="hint">{!enabled?'本安装尚未获拨号授权':voice?.reason||(!voice?.ready?'正在检查语音网关':'语音网关就绪')}</p></details></div>
      {call?.state==='CALL_ENDED'&&<p className="last-call">上一通电话已结束</p>}
    </section>
    }{error&&<p role="alert">{error}</p>}</>;
}
