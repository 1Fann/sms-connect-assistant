import {useEffect,useRef,useState} from 'react';
import {api,err,type Line} from './client';
import {groundwireUri,type NativeRoute} from './groundwire';
import {PhoneIcon} from './PhoneIcon';
import {formatPhone} from '../phone';
import {slotSelectionKey} from '../lines';

const selectionKey=(line:Line)=>slotSelectionKey(line)??line.lineId;

export function Calling({lines,liveRoutes,number,setNumber,enabled,lineHint,openSettings}:{lines:Line[],liveRoutes?:NativeRoute[],number:string,setNumber:(v:string)=>void,enabled:boolean,lineHint:{id:string,seq:number},openSettings:()=>void}){
  const [selected,setSelected]=useState(()=>localStorage.getItem('phone.lastLine')||'');
  const [routes,setRoutes]=useState<NativeRoute[]>([]),[error,setError]=useState(''),[message,setMessage]=useState('');
  useEffect(()=>{if(lineHint.seq>0)setSelected(lineHint.id)},[lineHint]);
  useEffect(()=>{const old=lines.find(l=>l.lineId===selected);if(old&&selectionKey(old)!==selected)setSelected(selectionKey(old))},[lines,selected]);
  const fetchLegacyRoutes=enabled&&liveRoutes===undefined;
  useEffect(()=>{
    // Retire old browser call state without revoking the installation or clearing message data.
    sessionStorage.removeItem('phone.call');sessionStorage.removeItem('phone.handoff');localStorage.removeItem('phone.autoHandoff');
    if(!fetchLegacyRoutes){setRoutes([]);return}
    let alive=true;
    const load=async()=>{try{const r=await api<{routes:NativeRoute[]}>('groundwire/routes');if(alive){setRoutes(r.routes);setError('')}}catch(e){if(alive){setRoutes([]);setError(err(e))}}};
    const back=()=>{if(!document.hidden)void load()};
    void load();const timer=setInterval(back,8000);document.addEventListener('visibilitychange',back);
    return()=>{alive=false;clearInterval(timer);document.removeEventListener('visibilitychange',back)};
  },[fetchLegacyRoutes]);
  const digitTimer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined),deleteTimer=useRef<ReturnType<typeof setInterval>|undefined>(undefined),longPress=useRef(false),currentNumber=useRef(number);currentNumber.current=number;
  function clearPress(){if(digitTimer.current)clearTimeout(digitTimer.current);if(deleteTimer.current)clearInterval(deleteTimer.current)}
  useEffect(()=>{const cancel=()=>clearPress();window.addEventListener('blur',cancel);document.addEventListener('visibilitychange',cancel);return()=>{clearPress();window.removeEventListener('blur',cancel);document.removeEventListener('visibilitychange',cancel)}},[]);
  function zeroDown(){longPress.current=false;digitTimer.current=setTimeout(()=>{longPress.current=true;if(!currentNumber.current)setNumber('+')},450)}
  function deleteDown(){longPress.current=false;digitTimer.current=setTimeout(()=>{longPress.current=true;setNumber(currentNumber.current.slice(0,-1));deleteTimer.current=setInterval(()=>setNumber(currentNumber.current.slice(0,-1)),85)},350)}

  const canDial=(line:Line)=>!!groundwireUri('5550100',line,liveRoutes??routes,enabled);
  const uri=groundwireUri(number,lines.find(l=>selectionKey(l)===selected),liveRoutes??routes,enabled);
  return <section className="dialer-screen">
      <div className="dial-top"><label className="line-chip"><span className="sr-only">拨出线路</span><select aria-label="拨出线路" value={selected} onChange={e=>setSelected(e.target.value)}><option value="">选择线路</option>{selected&&!lines.some(l=>selectionKey(l)===selected)&&<option value={selected} disabled>原选线路不可用</option>}{lines.map(l=><option key={l.lineId} value={selectionKey(l)} disabled={!canDial(l)}>{l.name}{!canDial(l)?' · 不可拨出':''}</option>)}</select></label><button className="glass-circle" aria-label="互联设置" onClick={openSettings}><PhoneIcon name="settings" size={22}/></button></div>
      <div className="dial-number-area"><input className="number" inputMode="none" aria-label="电话号码" autoComplete="off" spellCheck={false} value={formatPhone(number)} maxLength={32} onChange={e=>setNumber(e.target.value.replace(/[^+0-9*#]/g,'').slice(0,24))}/></div>
      <div className="keypad">{'123456789*0#'.split('').map((k,i)=><button key={k} aria-label={k} onPointerDown={k==='0'?zeroDown:undefined} onPointerUp={clearPress} onPointerCancel={clearPress} onPointerLeave={clearPress} onContextMenu={e=>e.preventDefault()} onClick={()=>{if(k==='0'&&longPress.current){longPress.current=false;return}setNumber((number+k).slice(0,24))}}><span>{k}</span><small>{['','ABC','DEF','GHI','JKL','MNO','PQRS','TUV','WXYZ','','+',''][i]}</small></button>)}</div>
      <div className="dialrow"><span/><a className="dial" role="button" aria-label="拨打" aria-disabled={!uri} href={uri} onClick={e=>{if(!uri)e.preventDefault();else{localStorage.setItem("phone.lastLine",selected);setMessage("已请求打开 Groundwire")}}}><PhoneIcon name="phone" size={34}/></a><button className={'backspace'+(!number?' empty':'')} aria-label="退格" disabled={!number} onPointerDown={deleteDown} onPointerUp={clearPress} onPointerCancel={clearPress} onPointerLeave={clearPress} onContextMenu={e=>e.preventDefault()} onClick={()=>{if(longPress.current){longPress.current=false;return}setNumber(number.slice(0,-1))}}><PhoneIcon name="delete" size={25}/></button></div>

      <div className="dial-options"><p className="hint" role={message?"status":undefined}>{message||(!enabled?'本安装尚未获拨号授权':(liveRoutes??routes).length?'由 Groundwire 发起和承载通话':'所选设备尚未配置 Groundwire 拨号线路')}</p></div>
      {error&&<p role="alert">{error}</p>}
    </section>;
}
