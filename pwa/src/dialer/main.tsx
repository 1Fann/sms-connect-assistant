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
import {isPresentSim,lineStatus} from '../lines';

async function enablePush(){
 if(!('serviceWorker' in navigator)||!('Notification' in window))throw Error('请从 iPhone 主屏幕打开互联电话');
 if(await Notification.requestPermission()!=='granted')throw Error('系统未允许通知');
 const reg=await navigator.serviceWorker.ready;
 const {key}=await api<{key:string}>('push/key');
 const sub=await reg.pushManager.getSubscription()||await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:Uint8Array.from(atob(key.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0))});
 await api('push/subscribe',{endpoint:sub.endpoint});
}
function App(){
 useViewport();
 useContactEditorDock();
 const [searching,setSearching]=useState(false),[query,setQuery]=useState('');
 const [session,setSession]=useState<Session|null>(null),[loading,setLoading]=useState(true),[code,setCode]=useState(''),[waiting,wait]=useState(false),[message,setMessage]=useState('');
 const [tab,setTab]=useState(()=>location.hash==='#missed'?'最近通话':'拨号键盘'),[devices,setDevices]=useState<Device[]>([]),[lines,setLines]=useState<Line[]>([]),[number,setNumber]=useState('');
 const [lineHint,hint]=useState({id:'',seq:0}),[order,setOrder]=useState<string[]>(()=>{try{const v=JSON.parse(localStorage.getItem('phone.order')||'[]');return Array.isArray(v)?v:[]}catch{return []}});
 async function boot(){try{setSession(await api<Session>('session'));setMessage('')}catch(e){if(!(e instanceof PhoneError&&e.status===401))setMessage(err(e));setSession(null)}finally{setLoading(false)}}
 useEffect(()=>{void boot()},[]);
 useEffect(()=>{if(!waiting)return;let active=true,running=false;
   const t=setInterval(async()=>{if(running)return;running=true;try{const r=await request<{status:string}>('pair/finish',{});if(active&&r.status==='ok'){wait(false);await boot()}}catch(e){if(active){wait(false);setMessage(err(e))}}finally{running=false}},1800);
   const end=setTimeout(()=>{wait(false);setMessage('配对已过期，请在安卓生成新配对码')},180000);
   return()=>{active=false;clearInterval(t);clearTimeout(end)};
 },[waiting]);
 useEffect(()=>{if(!session)return;let active=true;const load=async()=>{if(document.hidden)return;try{const [ds,ls]=await Promise.all([api<Device[]>('devices'),api<Line[]>('lines')]);if(active){setDevices(ds);setLines(ls)}}catch(e){if(active){if(e instanceof PhoneError&&e.status===401)setSession(null);setMessage(err(e))}}};void load();const t=setInterval(load,8000);return()=>{active=false;clearInterval(t)}},[session]);
 useEffect(()=>{const f=()=>{if(location.hash==='#missed')setTab('最近通话')};window.addEventListener('hashchange',f);return()=>window.removeEventListener('hashchange',f)},[]);
 const [directoryVisit,setDirectoryVisit]=useState(0);
 const inDirectory=tab==='通讯录'||tab==='个人收藏';
 function switchTab(next:string){
  if(inDirectory&&next===tab)setDirectoryVisit(value=>value+1);
  setSearching(false);setQuery('');setTab(next);
 }
 function dial(n:string,id=''){setNumber(n);if(id)hint(v=>({id,seq:v.seq+1}));switchTab('拨号键盘')}
 const sorted=lines.filter(isPresentSim).sort((a,b)=>(order.indexOf(a.lineId)+1||99999)-(order.indexOf(b.lineId)+1||99999));
 const missed=useMissedBadge(session?.installationId,session?.permissions.includes('calls.read')===true);
 if(!session)return <main className="pair"><img src="/phone/icon-192.png" width="80" alt=""/><h1>互联电话</h1><p>{loading?'连接中…':waiting?'请在安卓主机上确认设备和权限':'输入安卓主机生成的三分钟配对码'}</p>
   {!waiting&&!loading&&<form onSubmit={async e=>{e.preventDefault();try{await request('pair',{code});setCode('');wait(true);setMessage('')}catch(ex){setMessage(err(ex))}}}><input required aria-label="配对码" autoCapitalize="none" autoComplete="off" value={code} onChange={e=>setCode(e.target.value.trim())}/><button className="primary">请求配对</button></form>}{message&&<p role="alert">{message}</p>}</main>;
 const can=(p:string)=>session.permissions.includes(p);
 return <><main id="phone-app" className={'phone-app'+(searching?' searching':'')+(tab==='设置'?' settings-page':'')} key={session.installationId}>{message&&<p role="status">{message}</p>}
   <div hidden={tab!=='拨号键盘'}><Calling lines={sorted} number={number} setNumber={setNumber} enabled={can('calls.dial')} lineHint={lineHint} openSettings={()=>switchTab('设置')}/></div>
   {tab==='最近通话'&&(can('calls.read')?<Recent canAddContacts={can('contacts.read')&&can('contacts.write')} devices={devices} dial={dial} installation={session.installationId} searching={searching} query={query} settings={()=>switchTab('设置')} contacts={()=>switchTab('个人收藏')} onSeen={missed.viewed}/>:<p>此安装未获通话记录授权</p>)}
   {(tab==='通讯录'||tab==='个人收藏')&&(can('contacts.read')?<Directory key={tab+directoryVisit} devices={devices} lines={sorted} canEdit={can('contacts.write')} favorites={tab==='个人收藏'} searchQuery={query} settings={()=>switchTab('设置')} allContacts={()=>switchTab(tab==='个人收藏'?'通讯录':'个人收藏')} dial={dial}/>:<p>此安装未获通讯录读取授权</p>)}
   {tab==='设置'&&<><header className="phone-toolbar"><button className="glass-circle" aria-label="返回通话" onClick={()=>switchTab('最近通话')}><PhoneIcon name="back"/></button><h1>互联设置</h1><span className="toolbar-spacer"/></header><h2>设备与线路</h2>{devices.map(d=><section key={d.deviceId} className="card"><b>{d.name}</b><small>{d.online?'在线':'离线'}</small>{sorted.filter(l=>l.deviceId===d.deviceId).map(l=><div className="row" key={l.lineId}>{l.name}<span>{lineStatus({...l,online:l.lineOnline??l.online})||'可用'}</span><button onClick={()=>{const v=[l.lineId,...sorted.map(x=>x.lineId).filter(id=>id!==l.lineId)];setOrder(v);localStorage.setItem('phone.order',JSON.stringify(v))}}>排在首位</button></div>)}</section>)}
   <p className="hint">网页拨号会打开 Groundwire，通话全程由 Groundwire 承载。</p>
   <h2>通知</h2><button disabled={!can('calls.read')} onClick={()=>void enablePush().then(()=>{setMessage('已开启未接来电提醒及主屏幕角标');void missed.refresh()}).catch(e=>setMessage(err(e)))}>开启未接来电提醒</button>
   <button onClick={async()=>{try{await api('push/unsubscribe',{});const reg=await navigator.serviceWorker.ready;await(await reg.pushManager.getSubscription())?.unsubscribe();setMessage('已关闭电话通知')}catch(e){setMessage(err(e))}}}>关闭电话通知</button>
   <p className="hint">锁屏接听请在 Groundwire 中配置安卓主机提供的账号。</p><button onClick={async()=>{try{await request('logout',{});missed.viewed(0);setSession(null);setLines([]);setDevices([]);setMessage('已退出')}catch(e){setMessage(err(e))}}}>退出此安装</button></>}
 </main><div className={'phone-dock'+(searching?' search-open':'')}>
 {searching?<div className="dock-search"><PhoneIcon name="search" size={21}/><input autoFocus aria-label="搜索通话或联系人" placeholder="搜索" value={query} onChange={e=>setQuery(e.target.value)} type="search"/>{query&&<button aria-label="清空搜索" onClick={()=>setQuery('')}><PhoneIcon name="close" size={15}/></button>}</div>:
 <nav aria-label="电话导航">{([{id:'最近通话',label:'通话',icon:'calls'},{id:'通讯录',label:'联系人',icon:'person'},{id:'拨号键盘',label:'拨号键盘',icon:'keypad'}] as const).map(t=><button key={t.id} aria-current={(t.id===tab||t.id==='通讯录'&&tab==='个人收藏')?'page':undefined} onClick={()=>switchTab(t.id)}><span className="dock-icon"><PhoneIcon name={t.icon} size={25}/>{t.id==='最近通话'&&missed.count>0&&<i className="missed-badge" aria-label={missed.count+' 个未查看来电'}>{missed.count>99?'99+':missed.count}</i>}</span><span>{t.label}</span></button>)}</nav>}
 <button className="dock-search-toggle glass-circle" aria-label={searching?'取消搜索':'搜索'} onClick={()=>{if(inDirectory)setDirectoryVisit(value=>value+1);if(searching){setSearching(false);setQuery('')}else{if(tab==='拨号键盘'||tab==='设置')setTab('最近通话');setSearching(true)}}}><PhoneIcon name={searching?'close':'search'} size={25}/></button>
 </div></>;
}
if('serviceWorker' in navigator)void navigator.serviceWorker.register('/phone/sw.js',{scope:'/phone/'}).catch(()=>{});
createRoot(document.getElementById('root')!).render(<App/>);
