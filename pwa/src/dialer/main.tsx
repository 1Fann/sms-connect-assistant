import React,{useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {Directory} from './Directory';
import {Calling} from './Calling';
import {Recent} from './Recent';
import {PhoneIcon} from './PhoneIcon';
import {api,request,PhoneError,err,type Session,type Device,type Line} from './client';
import './phone.css';
import {useViewport} from '../viewport';
import {useContactEditorDock} from './contactEditorViewport';
import {useMissedBadge} from './missedBadge';
import {refreshPushKeys} from '../pushKeys';
import {isPresentSim,lineStatus} from '../lines';
import type {NativeRoute} from './groundwire';

type Startup = {session:Session, devices:Device[], lines:Line[], routes?:NativeRoute[]};
type StartupState = {stage:'loading'|'pair'} | {stage:'offline',error:string} | {stage:'ready',data:Startup};
const keypadTab='拨号键盘';
async function loadStartup():Promise<Startup>{
 try{return await api<Startup>('startup')}
 catch(e){
  if(!(e instanceof PhoneError&&e.status===404))throw e;
  const [session,devices,lines]=await Promise.all([api<Session>('session'),api<Device[]>('devices'),api<Line[]>('lines')]);
  return {session,devices,lines};
 }
}
async function enablePush(){
 if(!('serviceWorker' in navigator)||!('Notification' in window))throw Error('请从 iPhone 主屏幕打开互联电话');
 if(await Notification.requestPermission()!=='granted')throw Error('系统未允许通知');
 const reg=await navigator.serviceWorker.ready;
 const {key}=await api<{key:string}>('push/key');
 const sub=await reg.pushManager.getSubscription()||await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:Uint8Array.from(atob(key.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0))});
 const keys=sub.toJSON().keys;
 if(!keys?.p256dh||!keys.auth)throw Error('设备未提供通知加密密钥，请重新订阅');
 await api('push/subscribe',{endpoint:sub.endpoint,...keys});
}
function App(){
 useViewport();
 useContactEditorDock();
 const [searching,setSearching]=useState(false),[query,setQuery]=useState('');
 const [startup,setStartup]=useState<StartupState>({stage:'loading'});
 const data=startup.stage==='ready'?startup.data:null;
 const session=data?.session;
 useEffect(()=>{if(session?.permissions.includes('calls.read'))void refreshPushKeys(body=>api('push/keys',body))},[session?.installationId]);
 const [code,setCode]=useState(''),[waiting,wait]=useState(false),[message,setMessage]=useState('');
 const [tab,setTab]=useState(()=>location.hash==='#missed'?'最近通话':keypadTab),[number,setNumber]=useState('');
 const [lineHint,hint]=useState({id:'',seq:0}),[order,setOrder]=useState<string[]>(()=>{try{const v=JSON.parse(localStorage.getItem('phone.order')||'[]');return Array.isArray(v)?v:[]}catch{return []}});
 async function boot(){
  setStartup({stage:'loading'});
  setMessage('');
  try{
   const data=await loadStartup();
   setStartup({stage:'ready',data});
  }catch(e){
   setStartup(e instanceof PhoneError&&e.status===401?{stage:'pair'}:{stage:'offline',error:err(e)});
  }
 }
 useEffect(()=>{void boot()},[]);
 useEffect(()=>{if(!waiting)return;let active=true,running=false;
   const t=setInterval(async()=>{if(running)return;running=true;try{const r=await request<{status:string}>('pair/finish',{});if(active&&r.status==='ok'){wait(false);await boot()}}catch(e){if(active){wait(false);setMessage(err(e))}}finally{running=false}},1800);
   const end=setTimeout(()=>{wait(false);setMessage('配对已过期，请在安卓生成新配对码')},180000);
   return()=>{active=false;clearInterval(t);clearTimeout(end)};
 },[waiting]);
 useEffect(()=>{
  if(!session)return;
  let active=true,running=false;
  const load=async()=>{
   if(document.hidden||running)return;
   running=true;
   try{
    const {devices,lines,routes}=await loadStartup();
    if(active)setStartup(current=>current.stage==='ready'&&current.data.session===session
     ? {stage:'ready',data:{session,devices,lines,routes}} : current);
   }catch(e){if(active){if(e instanceof PhoneError&&e.status===401)setStartup({stage:'pair'});setMessage(err(e))}}
   finally{running=false}
  };
  const timer=setInterval(load,8000);
  document.addEventListener('visibilitychange',load);
  return()=>{active=false;clearInterval(timer);document.removeEventListener('visibilitychange',load)};
 },[session]);
 useEffect(()=>{const f=()=>{if(location.hash==='#missed')setTab('最近通话')};window.addEventListener('hashchange',f);return()=>window.removeEventListener('hashchange',f)},[]);
 const [directoryVisit,setDirectoryVisit]=useState(0);
 const inDirectory=tab==='通讯录'||tab==='个人收藏';
 function switchTab(next:string){
  if(inDirectory&&next===tab)setDirectoryVisit(value=>value+1);
  setSearching(false);setQuery('');setTab(next);
 }
 function dial(n:string,id=''){setNumber(n);if(id)hint(v=>({id,seq:v.seq+1}));switchTab('拨号键盘')}
 const missed=useMissedBadge(session?.installationId,session?.permissions.includes('calls.read')===true);
 const connecting=startup.stage==='loading';
 if(startup.stage==='offline'||connecting&&tab!==keypadTab)return <main className="phone-startup" aria-label="正在连接手机" aria-busy={connecting}>
   <h1>互联电话</h1>
   {startup.stage==='offline'&&<div className="phone-startup-retry"><p>暂时无法连接安卓主机</p><p role="alert">{startup.error}</p><button className="primary" onClick={()=>void boot()}>重新连接</button></div>}
 </main>;
 if(startup.stage==='pair')return <main className="pair"><img src="/phone/icon-192.png" width="80" alt=""/><h1>互联电话</h1><p>{waiting?'请在安卓主机上确认设备和权限':'输入安卓主机生成的三分钟配对码'}</p>
   {!waiting&&<form onSubmit={async e=>{e.preventDefault();try{await request('pair',{code});setCode('');wait(true);setMessage('')}catch(ex){setMessage(err(ex))}}}><input required aria-label="配对码" autoCapitalize="none" autoComplete="off" value={code} onChange={e=>setCode(e.target.value.trim())}/><button className="primary">请求配对</button></form>}{message&&<p role="alert">{message}</p>}</main>;
 const {devices=[],lines=[],routes}=data??{};
 const sorted=lines.filter(isPresentSim).sort((a,b)=>(order.indexOf(a.lineId)+1||99999)-(order.indexOf(b.lineId)+1||99999));
 const can=(p:string)=>session?.permissions.includes(p)===true;
 return <><main id="phone-app" className={'phone-app'+(searching?' searching':'')+(tab==='设置'?' settings-page':'')} aria-busy={connecting} inert={connecting}>{message&&<p role="status">{message}</p>}
   <div hidden={tab!==keypadTab}><Calling lines={sorted} liveRoutes={routes} number={number} setNumber={setNumber} enabled={can('calls.dial')} connecting={connecting} lineHint={lineHint} openSettings={()=>switchTab('设置')}/></div>
   {tab==='最近通话'&&(session&&can('calls.read')?<Recent canAddContacts={can('contacts.read')&&can('contacts.write')} devices={devices} dial={dial} installation={session.installationId} searching={searching} query={query} settings={()=>switchTab('设置')} contacts={()=>switchTab('个人收藏')} onSeen={missed.viewed}/>:<p>此安装未获通话记录授权</p>)}
   {(tab==='通讯录'||tab==='个人收藏')&&(can('contacts.read')?<Directory key={tab+directoryVisit} devices={devices} lines={sorted} canEdit={can('contacts.write')} favorites={tab==='个人收藏'} searchQuery={query} settings={()=>switchTab('设置')} allContacts={()=>switchTab(tab==='个人收藏'?'通讯录':'个人收藏')} dial={dial}/>:<p>此安装未获通讯录读取授权</p>)}
   {tab==='设置'&&<><header className="phone-toolbar"><button className="glass-circle" aria-label="返回通话" onClick={()=>switchTab('最近通话')}><PhoneIcon name="back"/></button><h1>互联设置</h1><span className="toolbar-spacer"/></header><h2>设备与线路</h2>{devices.map(d=><section key={d.deviceId} className="card"><b>{d.name}</b><small>{d.online?'在线':'离线'}</small>{sorted.filter(l=>l.deviceId===d.deviceId).map(l=><div className="row" key={l.lineId}>{l.name}<span>{lineStatus({...l,online:l.lineOnline??l.online})||'可用'}</span><button onClick={()=>{const v=[l.lineId,...sorted.map(x=>x.lineId).filter(id=>id!==l.lineId)];setOrder(v);localStorage.setItem('phone.order',JSON.stringify(v))}}>排在首位</button></div>)}</section>)}
   <p className="hint">网页拨号会打开 Groundwire，通话全程由 Groundwire 承载。</p>
   <h2>通知</h2><button disabled={!can('calls.read')} onClick={()=>void enablePush().then(()=>{setMessage('已开启未接来电提醒及主屏幕角标');void missed.refresh()}).catch(e=>setMessage(err(e)))}>开启未接来电提醒</button>
   <button onClick={async()=>{try{await api('push/unsubscribe',{});const reg=await navigator.serviceWorker.ready;await(await reg.pushManager.getSubscription())?.unsubscribe();setMessage('已关闭电话通知')}catch(e){setMessage(err(e))}}}>关闭电话通知</button>
   <p className="hint">锁屏接听请在 Groundwire 中配置安卓主机提供的账号。</p><button onClick={async()=>{try{await request('logout',{});missed.viewed(0);setStartup({stage:'pair'});setMessage('已退出')}catch(e){setMessage(err(e))}}}>退出此安装</button></>}
 </main><div className={'phone-dock'+(searching?' search-open':'')} inert={connecting}>
 {searching?<div className="dock-search"><PhoneIcon name="search" size={21}/><input autoFocus aria-label="搜索通话或联系人" placeholder="搜索" value={query} onChange={e=>setQuery(e.target.value)} type="search"/>{query&&<button aria-label="清空搜索" onClick={()=>setQuery('')}><PhoneIcon name="close" size={15}/></button>}</div>:
 <nav aria-label="电话导航">{([{id:'最近通话',label:'通话',icon:'calls'},{id:'通讯录',label:'联系人',icon:'person'},{id:'拨号键盘',label:'拨号键盘',icon:'keypad'}] as const).map(t=><button key={t.id} aria-current={(t.id===tab||t.id==='通讯录'&&tab==='个人收藏')?'page':undefined} onClick={()=>switchTab(t.id)}><span className="dock-icon"><PhoneIcon name={t.icon} size={25}/>{t.id==='最近通话'&&missed.count>0&&<i className="missed-badge" aria-label={missed.count+' 个未查看来电'}>{missed.count>99?'99+':missed.count}</i>}</span><span>{t.label}</span></button>)}</nav>}
 <button className="dock-search-toggle glass-circle" aria-label={searching?'取消搜索':'搜索'} onClick={()=>{if(inDirectory)setDirectoryVisit(value=>value+1);if(searching){setSearching(false);setQuery('')}else{if(tab==='拨号键盘'||tab==='设置')setTab('最近通话');setSearching(true)}}}><PhoneIcon name={searching?'close':'search'} size={25}/></button>
 </div></>;
}
if('serviceWorker' in navigator)void navigator.serviceWorker.register('/phone/sw.js',{scope:'/phone/'}).catch(()=>{});
createRoot(document.getElementById('root')!).render(<App/>);
