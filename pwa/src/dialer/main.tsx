import React,{useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {Directory} from './Directory';
import {Calling} from './Calling';
import {api,request,PhoneError,err,type Session,type Device,type Line,type CallRecord,type PbxCall} from './client';
import './phone.css';

const types:Record<string,string>={incoming:'呼入',outgoing:'呼出',missed:'未接',rejected:'已拒接',blocked:'已拦截',other:'其他'};
function Recent({devices,dial}:{devices:Device[],dial:(n:string)=>void}){
 const [missed,setMissed]=useState(location.hash==='#missed'),[filter,setFilter]=useState(''),[rows,setRows]=useState<CallRecord[]>([]),[pbx,setPbx]=useState<PbxCall[]>([]);
 const [next,setNext]=useState<number|null>(null),[offset,setOffset]=useState(0),[detail,setDetail]=useState<CallRecord|null>(null),[error,setError]=useState(''),[reload,refresh]=useState(0);
 useEffect(()=>{let active=true;async function load(){
   try{const page=await api<{items:CallRecord[],next:number|null}>('call-history?offset='+offset+(filter?'&deviceId='+encodeURIComponent(filter):''));if(active){setRows(p=>offset?[...p,...page.items]:page.items);setNext(page.next);setError('')}}
   catch(e){if(active)setError(err(e))}
   try{const r=await api<PbxCall[]>('voice/history');if(active)setPbx(r)}catch{if(active)setPbx([])}
 }void load();return()=>{active=false}},[filter,offset,reload]);
 useEffect(()=>{const f=()=>{if(!document.hidden){setOffset(0);refresh(v=>v+1)}};document.addEventListener('visibilitychange',f);return()=>document.removeEventListener('visibilitychange',f)},[]);
 useEffect(()=>{const f=()=>{if(location.hash==='#missed')setMissed(true)};window.addEventListener('hashchange',f);return()=>window.removeEventListener('hashchange',f)},[]);
 const label=(id?:string)=>devices.find(d=>d.deviceId===id)?.name||'未知设备';
 if(detail)return <><button onClick={()=>setDetail(null)}>‹ 通话记录</button><h1>{detail.name||detail.number||'匿名来电'}</h1><article className="card"><p>{detail.number}</p><p>{types[detail.type]||detail.type} · {label(detail.deviceId)}</p><p>{new Date(detail.date).toLocaleString()} · {detail.duration} 秒</p></article>{detail.number&&<button onClick={()=>dial(detail.number)}>拨打此号码</button>}</>;
 const visible=rows.filter(r=>!missed||r.type==='missed');
 return <><div className="title"><h1>最近通话</h1><button aria-label="刷新记录" onClick={()=>{setOffset(0);refresh(v=>v+1)}}>↻</button></div>
   <div className="segment">{['全部','未接'].map((s,i)=><button key={s} aria-pressed={missed===!!i} onClick={()=>setMissed(!!i)}>{s}</button>)}</div>
   <label>来源设备<select value={filter} onChange={e=>{setOffset(0);setFilter(e.target.value)}}><option value="">全部设备</option>{devices.map(d=><option key={d.deviceId} value={d.deviceId}>{d.name}</option>)}</select></label>
   {error&&<p role="alert">{error}</p>}
   {!missed&&!filter&&pbx.length>0&&<><h2>互联通话</h2>{pbx.map(c=><div key={c.id} className="row"><b>{c.number}</b><small>{new Date(c.created).toLocaleString()} · {c.answeredAt?'已接通':'呼叫记录'}</small></div>)}</>}
   {!!pbx.length&&<h2>设备记录</h2>}{visible.map(r=><button key={r.id} className={'row '+(r.type==='missed'?'missed':'')} onClick={()=>setDetail(r)}><div><b>{r.name||r.number||'匿名来电'}</b><small>{types[r.type]||r.type} · {label(r.deviceId)}</small></div><time>{new Date(r.date).toLocaleDateString()}</time></button>)}
   {!visible.length&&<p className="hint">暂无{missed?'未接':'设备'}通话记录</p>}{next!==null&&<button onClick={()=>setOffset(next)}>载入更多</button>}
 </>;
}
async function enablePush(){
 if(!('serviceWorker' in navigator)||!('Notification' in window))throw Error('请从 iPhone 主屏幕打开互联电话');
 if(await Notification.requestPermission()!=='granted')throw Error('系统未允许通知');
 const reg=await navigator.serviceWorker.ready;
 const {key}=await api<{key:string}>('push/key');
 const sub=await reg.pushManager.getSubscription()||await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:Uint8Array.from(atob(key.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0))});
 await api('push/subscribe',{endpoint:sub.endpoint});
}
function App(){
 const [session,setSession]=useState<Session|null>(null),[loading,setLoading]=useState(true),[code,setCode]=useState(''),[waiting,wait]=useState(false),[message,setMessage]=useState('');
 const [tab,setTab]=useState('最近通话'),[devices,setDevices]=useState<Device[]>([]),[lines,setLines]=useState<Line[]>([]),[number,setNumber]=useState('');
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
 function dial(n:string,id=''){setNumber(n);if(id)hint(v=>({id,seq:v.seq+1}));setTab('拨号键盘')}
 const sorted=[...lines].sort((a,b)=>(order.indexOf(a.lineId)+1||99999)-(order.indexOf(b.lineId)+1||99999));
 if(!session)return <main className="pair"><img src="/phone/icon-192.png" width="80" alt=""/><h1>互联电话</h1><p>{loading?'连接中…':waiting?'请在安卓主机上确认设备和权限':'输入安卓主机生成的三分钟配对码'}</p>
   {!waiting&&!loading&&<form onSubmit={async e=>{e.preventDefault();try{await request('pair',{code});setCode('');wait(true);setMessage('')}catch(ex){setMessage(err(ex))}}}><input required aria-label="配对码" autoCapitalize="none" autoComplete="off" value={code} onChange={e=>setCode(e.target.value.trim())}/><button className="primary">请求配对</button></form>}{message&&<p role="alert">{message}</p>}</main>;
 const can=(p:string)=>session.permissions.includes(p);
 return <><main key={session.installationId}>{message&&<p role="status">{message}</p>}
   <div hidden={tab!=='拨号键盘'}><Calling lines={sorted} number={number} setNumber={setNumber} enabled={can('calls.dial')} lineHint={lineHint}/></div>
   {tab==='最近通话'&&(can('calls.read')?<Recent devices={devices} dial={dial}/>:<p>此安装未获通话记录授权</p>)}
   {(tab==='通讯录'||tab==='个人收藏')&&(can('contacts.read')?<Directory key={tab} devices={devices} lines={sorted} canEdit={can('contacts.write')} favorites={tab==='个人收藏'} dial={dial}/>:<p>此安装未获通讯录读取授权</p>)}
   {tab==='设置'&&<><h1>设置</h1><h2>设备与线路</h2>{devices.map(d=><section key={d.deviceId} className="card"><b>{d.name}</b><small>{d.online?'在线':'离线'}</small>{sorted.filter(l=>l.deviceId===d.deviceId).map(l=><div className="row" key={l.lineId}>{l.name}<span>{!l.confirmed?'待确认':l.online?'可用':'离线'}</span><button onClick={()=>{const v=[l.lineId,...sorted.map(x=>x.lineId).filter(id=>id!==l.lineId)];setOrder(v);localStorage.setItem('phone.order',JSON.stringify(v))}}>排在首位</button></div>)}</section>)}
   <h2>通知</h2><button disabled={!can('calls.read')} onClick={()=>void enablePush().then(()=>setMessage('已开启未接来电提醒')).catch(e=>setMessage(err(e)))}>开启未接来电提醒</button>
   <button onClick={async()=>{try{await api('push/unsubscribe',{});const reg=await navigator.serviceWorker.ready;await(await reg.pushManager.getSubscription())?.unsubscribe();setMessage('已关闭电话通知')}catch(e){setMessage(err(e))}}}>关闭电话通知</button>
   <p className="hint">锁屏接听请在 Groundwire 中配置安卓主机提供的账号。</p><button onClick={async()=>{try{await request('logout',{});setSession(null);setLines([]);setDevices([]);setMessage('已退出')}catch(e){setMessage(err(e))}}}>退出此安装</button></>}
 </main><nav>{['个人收藏','最近通话','通讯录','拨号键盘','设置'].map((s,i)=><button aria-current={s===tab?'page':undefined} key={s} onClick={()=>setTab(s)}><strong>{['★','◷','♙','⠿','⚙'][i]}</strong>{s}</button>)}</nav></>;
}
if('serviceWorker' in navigator)void navigator.serviceWorker.register('/phone/sw.js',{scope:'/phone/'}).catch(()=>{});
createRoot(document.getElementById('root')!).render(<App/>);
