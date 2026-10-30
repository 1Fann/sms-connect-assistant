import React,{useEffect,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {getCountries} from 'libphonenumber-js/max';
import {formatPhone,identity,type CountryCode} from './phone';
import {api,ApiError,stateLabel,type Sms} from './api';
import './style.css';
import {reconcile} from './reconcile';
import {mergeOutgoing} from './outgoing';

function App(){
 const [paired,setPaired]=useState(false),[pairing,setPairing]=useState(false),[code,setCode]=useState('');
 const [rows,setRows]=useState<Sms[]>([]),[outgoing,setOutgoing]=useState<Sms[]>([]),[cursor,setCursor]=useState<string|null>(null);
 const [active,setActive]=useState<string|null>(null),[screen,setScreen]=useState('messages'),[search,setSearch]=useState('');
 const [draft,setDraft]=useState(''),[recipient,setRecipient]=useState(''),[sims,setSims]=useState<{id:number,name:string}[]>([]),[sim,setSim]=useState('');
 const [error,setError]=useState(''),[busy,setBusy]=useState(false),[online,setOnline]=useState(navigator.onLine),[diagnostic,setDiagnostic]=useState('');
 const [region,setRegion]=useState<CountryCode>(()=>(localStorage.getItem('sms.region') as CountryCode)||'CN');
 const [pushStatus,setPushStatus]=useState('尚未授权'),[contacts,setContacts]=useState<{name:string,number:string}[]>([]);
 const cursorRef=useRef(cursor);cursorRef.current=cursor;
 async function subscribe(){
  try{
   if(!('PushManager' in window)||!('Notification' in window))throw Error('请在 iOS 16.4 及以上将网页添加到主屏幕后开启');
   const permission=await Notification.requestPermission();if(permission!=='granted'){setPushStatus('系统未授权');return}
   const {key}=await api<{key:string}>('push/key');const decoded=atob(key.replace(/-/g,'+').replace(/_/g,'/'));const bytes=Uint8Array.from(decoded,c=>c.charCodeAt(0));
   const registration=await navigator.serviceWorker.ready;
   const subscription=await registration.pushManager.getSubscription()||await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:bytes});
   await api('push/subscribe',{endpoint:subscription.endpoint});setPushStatus('已订阅；请发送测试通知并在设备确认');
  }catch(e){setPushStatus('推送订阅失败');fail(e)}
 }
 useEffect(()=>{if(screen!=='new'||!paired)return;let cancelled=false;const t=setTimeout(()=>api<{name:string,number:string}[]>('contacts?q='+encodeURIComponent(recipient)).then(r=>{if(!cancelled)setContacts(r)}).catch(()=>{}),250);return()=>{cancelled=true;clearTimeout(t)}},[recipient,screen,paired]);
 const end=useRef<HTMLDivElement>(null),loading=useRef(false),sending=useRef(false),outRef=useRef(outgoing); outRef.current=outgoing;
 const fail=(e:unknown)=>{setError(e instanceof Error?e.message:'连接失败'); if(e instanceof ApiError&&e.status===401){setPaired(false);setRows([]);setOutgoing([])}};
 async function refresh(older=false){
  if(loading.current)return; loading.current=true;
  const historyTask=(async()=>{
   const data=await api<{items:Sms[],next:string|null}>('history'+(older&&cursorRef.current?'?before='+cursorRef.current:''));
   setRows(prev=>{
    if(older)return [...new Map([...prev,...data.items].map(m=>[m.id,m])).values()];
    const oldest=Math.min(...data.items.map(m=>Number(m.id.slice(4))));
    return [...data.items,...(data.next?prev.filter(m=>Number(m.id.slice(4))<oldest):[])];
   });
   if(older||!cursorRef.current)setCursor(data.next);
  })();
  const outgoingTask=(async()=>{
   const restored=await api<Sms[]>('outgoing');
   setOutgoing(prev=>mergeOutgoing(prev,restored));
   const missing=outRef.current.filter(m=>['accepted','unknown'].includes(m.state)&&!restored.some(r=>r.id===m.id));
   const updates=await Promise.allSettled(missing.map(async m=>({...m,...await api<{state:Sms['state'],error?:string}>('send/'+m.id)})));
   setOutgoing(prev=>mergeOutgoing(prev,updates.flatMap(r=>r.status==='fulfilled'?[r.value]:[])));
  })();
  try{
   const results=await Promise.allSettled([historyTask,outgoingTask]);
   setOnline(results.every(r=>r.status==='fulfilled'));
   for(const result of results)if(result.status==='rejected')fail(result.reason);
  }finally{loading.current=false}
 }
 useEffect(()=>{api('status').then(()=>setPaired(true)).catch(e=>{if(!(e instanceof ApiError&&e.status===401))fail(e)});
  const viewport=()=>document.documentElement.style.setProperty('--height',`${window.visualViewport?.height||window.innerHeight}px`);
  viewport();window.visualViewport?.addEventListener('resize',viewport);return()=>window.visualViewport?.removeEventListener('resize',viewport);
 },[]);
 useEffect(()=>{if(!paired)return;void refresh();api<{id:number,name:string}[]>('sims').then(s=>{setSims(s);setSim(s[0]?.id.toString()||'')}).catch(fail);
  const timer=setInterval(()=>{if(!document.hidden)void refresh()},8000); const visible=()=>{if(!document.hidden)void refresh()};document.addEventListener('visibilitychange',visible);return()=>{clearInterval(timer);document.removeEventListener('visibilitychange',visible)};
 },[paired]);
 useEffect(()=>{if(!pairing)return; const timer=setInterval(()=>{api<{status:string}>('pair/finish',{}).then(r=>{if(r.status==='ok'){setPairing(false);setPaired(true);setCode('')}}).catch(fail)},2000);const expiry=setTimeout(()=>{setPairing(false);setError('配对已超时，请在安卓重新生成配对码')},180000);return()=>{clearInterval(timer);clearTimeout(expiry)}},[pairing]);
 useEffect(()=>{end.current?.scrollIntoView({behavior:'smooth'})},[active,outgoing.length]);
 const all=reconcile(rows,outgoing,region);
 const conversations=new Map<string,Sms[]>();for(const m of all){const key=identity(m.address,region);conversations.set(key,[...(conversations.get(key)||[]),m])}
 const list=[...conversations].map(([key,items])=>({key,items:items.sort((a,b)=>a.date-b.date)})).sort((a,b)=>b.items.at(-1)!.date-a.items.at(-1)!.date);
 const current=active?(conversations.get(active)||[]).sort((a,b)=>a.date-b.date):[];
 const title=current.find(m=>m.name)?.name||formatPhone(active||'',region);
 async function openConversation(address:string){setActive(address);setScreen('chat');setError('');const time=Date.now();setRows(prev=>prev.map(m=>identity(m.address,region)===address?{...m,read:true}:m));try{await api('read',{address:rows.find(m=>identity(m.address,region)===address)?.address||address,time:String(time)})}catch(e){fail(e)}}
 async function send(existing?:Sms){
  if(sending.current)return;
  const address=active||identity(recipient,region);
  if(!existing&&(!draft.trim()||!address||!sim))return;
  const m:Sms=existing||{id:crypto.randomUUID(),address,body:draft,date:Date.now(),incoming:false,read:true,sim:Number(sim),state:'local'};
  if(!existing){setOutgoing(p=>[...p,m]);setDraft('');setActive(address);setScreen('chat')}
  sending.current=true;setBusy(true);setError('');
  try{const result=await api<{state:Sms['state'],error?:string}>('send',{id:m.id,address:m.address,body:m.body,sim:String(m.sim)});setOutgoing(p=>mergeOutgoing(p,[{...m,...result}]))}
  catch(e){setOutgoing(p=>mergeOutgoing(p,[{...m,state:'unknown'}]));fail(e)}finally{sending.current=false;setBusy(false);void refresh()}
 }
 const time=(date:number)=>new Date(date).toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'});
 return <main className={screen==='chat'?'chat-layout':''}>
 {!paired?<section className="pair"><div className="app-icon">•••</div><h1>你的短信，随身相伴。</h1><p>连接自己的 Android 手机<br/>在 iPhone 上安全收发短信</p><form onSubmit={async e=>{e.preventDefault();setError('');try{await api('pair',{code,name:'iPhone Safari'});setPairing(true)}catch(e){fail(e)}}}><label>安卓显示的配对码<input value={code} onChange={e=>setCode(e.target.value.trim())} autoComplete="off" autoCapitalize="none" required maxLength={12}/></label><button className="primary" disabled={pairing}>{pairing?'请在安卓确认授权…':'连接我的手机'}</button></form><p className="hint">Safari → 分享 → 添加到主屏幕<br/>只使用你自己的 HTTPS 网址</p></section>:<>
 <header><button onClick={()=>{setActive(null);setScreen('messages')}}>{screen==='messages'?'短信':'‹ 短信'}</button><strong>{screen==='chat'?title:screen==='settings'?'设置':screen==='new'?'新信息':''}</strong><button aria-label="新建短信" onClick={()=>{setActive(null);setScreen('new')}}>＋</button></header>
 {screen==='messages'&&<><section className="intro"><h1>短信</h1><label className="search">⌕ <input placeholder="搜索姓名、号码或短信" value={search} onChange={e=>setSearch(e.target.value)}/></label><p className="connection"><i className={online?'live':'offline'}/>{online?'已连接私人网关':'连接中断，检查网络与 IPv6'}</p></section><section className="conversations">{list.filter(c=>c.items.some(m=>`${m.name||''} ${m.address} ${m.body}`.toLowerCase().includes(search.toLowerCase()))).map(c=>{const m=c.items.at(-1)!;const unread=c.items.filter(m=>m.incoming&&!m.read).length;return <button className="conversation" key={c.key} onClick={()=>void openConversation(c.key)}><span className={'dot '+(unread?'unread':'')}/><span className="avatar">{(m.name||'#').slice(0,1)}</span><span className="preview"><span className="line"><b>{m.name||formatPhone(m.address,region)}</b><time>{time(m.date)} ›</time></span><span className="line"><span className="snippet">{m.body}</span>{unread>0&&<em>{unread}</em>}</span><small>{m.sim?`SIM ${m.sim}`:'线路信息不可用'}</small></span></button>})}{!list.length&&<div className="empty">还没有短信<br/><small>连接后将显示安卓的短信记录</small></div>}</section>{cursor&&<button onClick={()=>void refresh(true)}>加载更早的短信</button>}<nav><button onClick={()=>void refresh()}>刷新</button><button onClick={()=>setScreen('settings')}>设置</button></nav></>}
 {(screen==='chat'||screen==='new')&&<><div className="recipient">{screen==='new'?<label>收件人：<input type="tel" placeholder="电话号码（含国家码）" value={recipient} onChange={e=>setRecipient(e.target.value)}/><small>{formatPhone(recipient,region)}</small></label>:<><span className="avatar small">{(title||'#').slice(0,1)}</span><small>短信 · Android SIM 卡</small></>}</div><section className="messages">{screen==='new'&&contacts.map(c=><button className="contact" key={c.number+c.name} onClick={()=>setRecipient(c.number)}>{c.name}<small>{formatPhone(c.number,region)}</small></button>)}{cursor&&<button onClick={()=>void refresh(true)}>加载更早的短信</button>}{current.map(m=><article key={m.id} className={m.incoming?'incoming':'outgoing'}><time>{time(m.date)} · {m.sim?`SIM ${m.sim}`:'线路未知'}</time><p className="bubble">{m.body}</p>{!m.incoming&&<small>{stateLabel[m.state]}{m.error&&<> · {m.error}</>}</small>}{!m.incoming&&m.state==='unknown'&&outgoing.some(o=>o.id===m.id)&&<button disabled={busy} onClick={()=>void send(m)}>核对 / 重试同一请求</button>}{!m.incoming&&m.state==='failed'&&<button onClick={()=>{setDraft(m.body);setError('短信可能已有部分送出，请确认后再发送')}}>编辑后重发</button>}</article>)}<div ref={end}/></section><form className="composer" onSubmit={e=>{e.preventDefault();void send()}}><select aria-label="发送线路" value={sim} onChange={e=>setSim(e.target.value)}>{!sims.length&&<option value="">无可用 SIM</option>}{sims.map(s=><option value={s.id} key={s.id}>{s.name} · SIM {s.id}</option>)}</select><div><textarea aria-label="短信内容" rows={1} placeholder="短信" value={draft} maxLength={2000} onChange={e=>{setDraft(e.target.value);e.target.style.height='auto';e.target.style.height=Math.min(e.target.scrollHeight,140)+'px'}}/><button aria-label="发送短信" className="send" disabled={busy||!draft.trim()||!sim}>↑</button></div></form></>}
 {screen==='settings'&&<section className="settings"><h1>设置</h1><div className="card"><h3>号码显示</h3><label>本地号码地区<select value={region} onChange={e=>{setRegion(e.target.value as CountryCode);localStorage.setItem('sms.region',e.target.value)}}>{getCountries().map(r=><option value={r} key={r}>{new Intl.DisplayNames(['zh-CN'],{type:'region'}).of(r)} ({r})</option>)}</select></label><p>国际号码按国家码分段；没有国家码时使用此地区。号码库随应用离线提供。</p></div><div className="card"><h3>SIM 卡</h3>{sims.map(s=><label key={s.id}>SIM {s.id}<input defaultValue={s.name} maxLength={30} onBlur={e=>{const name=e.target.value;api('sims',{id:String(s.id),name}).then(()=>setSims(p=>p.map(x=>x.id===s.id?{...x,name}:x))).catch(fail)}}/></label>)}</div><div className="card"><h3>连接状态</h3><button onClick={()=>api('status').then(r=>setDiagnostic(JSON.stringify(r,null,2))).catch(fail)}>检查网关</button><pre>{diagnostic}</pre><p>无法连接时请检查证书、DDNS、路由器防火墙，以及 iPhone 当前网络是否支持 IPv6。浏览器无法单独确认是哪一项故障。</p></div><div className="card"><h3>通知</h3><p>默认只显示“收到一条新短信”，不会发送短信正文或完整号码。依赖 Apple 推送服务，可能延迟；点击通知打开会话列表。</p><p role="status">{pushStatus}</p><button onClick={()=>void subscribe()}>开启 / 重新订阅通知</button><button onClick={()=>api<{status:string}>('push/test',{}).then(r=>setPushStatus(r.status)).catch(fail)}>发送测试通知</button><button onClick={()=>api<{status:string}>('push/status').then(r=>setPushStatus(r.status)).catch(fail)}>查看提交结果</button><button onClick={()=>setPushStatus('用户已确认：此设备收到通知')}>我已收到通知</button><button onClick={async()=>{try{await api('push/unsubscribe',{});const r=await navigator.serviceWorker.ready;await(await r.pushManager.getSubscription())?.unsubscribe();setPushStatus('已关闭通知')}catch(e){fail(e)}}}>关闭通知</button></div><div className="card"><h3>隐私</h3><p>不持久保存短信正文或认证密钥。仅缓存界面资源；访问凭证 12 小时轮换，30 天未使用需重新配对。HTTPS 保护访问链路，普通短信不具备端到端加密。</p><button onClick={async()=>{await Promise.all((await caches.keys()).map(k=>caches.delete(k)));localStorage.removeItem('sms.region');setRows([]);setOutgoing([]);setError('本地缓存已清除')}}>清除本地缓存</button><button onClick={()=>api('logout',{}).then(()=>{setPaired(false);setRows([]);setOutgoing([])}).catch(fail)}>退出此设备</button></div></section>}
 </>}{error&&<div role="alert" className="error" onClick={()=>setError('')}>{error} ×</div>}
 </main>
}
createRoot(document.getElementById('root')!).render(<App/>);
if('serviceWorker' in navigator)void navigator.serviceWorker.register('/sw.js').catch(()=>{});
