import React,{useEffect,useLayoutEffect,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {getCountries} from 'libphonenumber-js/max';
import {formatPhone,identity,type CountryCode} from './phone';
import {api,ApiError,stateLabel,type Sms} from './api';
import './style.css';
import {Icon,Avatar} from './Icons';
import {listTime,groupEnd,showDate,sectionTime} from './presentation';
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
   if(older){const el=screen==='chat'?chatView.current:listView.current;if(el)pendingAnchor.current={el,top:el.scrollTop,height:el.scrollHeight}}
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
  const viewport=()=>{document.documentElement.style.setProperty('--height',`${window.visualViewport?.height||window.innerHeight}px`);document.documentElement.style.setProperty('--viewport-top',`${window.visualViewport?.offsetTop||0}px`)};
  viewport();window.visualViewport?.addEventListener('resize',viewport);window.visualViewport?.addEventListener('scroll',viewport);return()=>{window.visualViewport?.removeEventListener('resize',viewport);window.visualViewport?.removeEventListener('scroll',viewport)};
 },[]);
 useEffect(()=>{if(!paired)return;void refresh();api<{id:number,name:string}[]>('sims').then(s=>{setSims(s);setSim(s[0]?.id.toString()||'')}).catch(fail);
  const timer=setInterval(()=>{if(!document.hidden)void refresh()},8000); const visible=()=>{if(!document.hidden)void refresh()};document.addEventListener('visibilitychange',visible);return()=>{clearInterval(timer);document.removeEventListener('visibilitychange',visible)};
 },[paired]);
 useEffect(()=>{if(!pairing)return; const timer=setInterval(()=>{api<{status:string}>('pair/finish',{}).then(r=>{if(r.status==='ok'){setPairing(false);setPaired(true);setCode('')}}).catch(fail)},2000);const expiry=setTimeout(()=>{setPairing(false);setError('配对已超时，请在安卓重新生成配对码')},180000);return()=>{clearInterval(timer);clearTimeout(expiry)}},[pairing]);
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
 const [filter,setFilter]=useState<'all'|'unread'>('all'),[menu,setMenu]=useState(false),[editing,setEditing]=useState(false);
 const [selected,setSelected]=useState<Set<string>>(new Set()),[details,setDetails]=useState<string|null>(null),[sheet,setSheet]=useState(false);
 const listView=useRef<HTMLDivElement>(null),chatView=useRef<HTMLElement>(null),textarea=useRef<HTMLTextAreaElement>(null),dialog=useRef<HTMLDialogElement>(null);
 const listScroll=useRef(0),nearBottom=useRef(true),thread=useRef<string|null>(null);
 const pendingAnchor=useRef<{el:HTMLElement,top:number,height:number}|null>(null);
 useLayoutEffect(()=>{const el=textarea.current;if(el){el.style.height='auto';el.style.height=Math.min(el.scrollHeight,128)+'px'}},[draft,screen]);
 useLayoutEffect(()=>{if(screen==='messages'&&listView.current)listView.current.scrollTop=listScroll.current},[screen]);
 useLayoutEffect(()=>{const el=chatView.current;if(!el)return;if(thread.current!==active||nearBottom.current)el.scrollTop=el.scrollHeight;thread.current=active},[active,current.length,screen]);
 useLayoutEffect(()=>{const anchor=pendingAnchor.current;if(anchor?.el.isConnected)anchor.el.scrollTop=anchor.top+anchor.el.scrollHeight-anchor.height;pendingAnchor.current=null},[rows]);
 useEffect(()=>{if(sheet)dialog.current?.showModal();else dialog.current?.close()},[sheet]);
 const visible=list.filter(c=>(filter==='all'||c.items.some(m=>m.incoming&&!m.read))&&c.items.some(m=>`${m.name||''} ${m.address} ${m.body}`.toLowerCase().includes(search.toLowerCase())));
 const unreadCount=list.filter(c=>c.items.some(m=>m.incoming&&!m.read)).length;
 const lastOutgoing=current.map(m=>m.incoming).lastIndexOf(false);
 const back=()=>{setSheet(false);setMenu(false);setActive(null);setScreen('messages');setError('')};
 const newMessage=()=>{setActive(null);setRecipient('');setDraft('');setScreen('new');setError('');setMenu(false)};
 async function markSelected(){
  if(busy)return;setBusy(true);
  try{for(const key of selected){const c=list.find(c=>c.key===key);if(!c)continue;const last=c.items.at(-1)!;
   await api('read',{address:last.address,time:String(last.date)});
   setRows(prev=>prev.map(m=>identity(m.address,region)===key&&m.date<=last.date?{...m,read:true}:m));
   setSelected(prev=>{const next=new Set(prev);next.delete(key);return next});
  }setEditing(false)}catch(e){fail(e)}finally{setBusy(false)}
 }
 return <main className={'app screen-'+(paired?screen:'pair')}>
 {!paired?<section className="pair"><div className="app-icon"><Icon name="compose" size={40}/></div><h1>你的短信，随身相伴。</h1><p>连接自己的 Android 手机<br/>在 iPhone 上安全收发短信</p><form onSubmit={async e=>{e.preventDefault();setError('');try{await api('pair',{code,name:'iPhone Safari'});setPairing(true)}catch(e){fail(e)}}}><label>安卓显示的配对码<input value={code} onChange={e=>setCode(e.target.value.trim())} autoComplete="off" autoCapitalize="none" required maxLength={12}/></label><button className="primary" disabled={pairing}>{pairing?'请在安卓确认授权…':'连接我的手机'}</button></form><p className="hint">Safari → 分享 → 添加到主屏幕<br/>只使用你自己的 HTTPS 网址</p></section>:<>
 {screen==='messages'&&<>
  <div className="list-view" ref={listView} onScroll={e=>{listScroll.current=e.currentTarget.scrollTop}}>
   <header className="list-toolbar"><button className="glass edit-button" onClick={()=>{setEditing(v=>!v);setSelected(new Set());setMenu(false)}}>{editing?'完成':'编辑'}</button><button className="glass circle" aria-label="筛选与设置" aria-expanded={menu} onClick={()=>setMenu(v=>!v)}><Icon name="filter"/></button></header>
   <h1 className="list-title">{filter==='unread'?'未读信息':'信息'}</h1>
   {!online&&<button className="offline-banner" onClick={()=>void refresh()}>连接已中断 · 轻点重试</button>}
   <section className="conversations" aria-label="会话列表">{visible.map(c=>{const m=c.items.at(-1)!,unread=c.items.some(m=>m.incoming&&!m.read);return <button className="conversation" key={c.key} aria-label={`${m.name||formatPhone(m.address,region)}${unread?'，未读':''}`} aria-pressed={editing?selected.has(c.key):undefined} onClick={()=>{if(editing){setSelected(prev=>{const s=new Set(prev);s.has(c.key)?s.delete(c.key):s.add(c.key);return s})}else{nearBottom.current=true;void openConversation(c.key)}}}>
    {editing?<span className={'selection-dot '+(selected.has(c.key)?'selected':'')}>{selected.has(c.key)&&<Icon name="check" size={15}/>}</span>:<span className={'unread-dot '+(unread?'unread':'')}/>}
    <Avatar name={m.name}/><span className="preview"><span className="row-heading"><b>{m.name||formatPhone(m.address,region)}</b><time>{listTime(m.date)}</time><Icon name="chevron" size={12}/></span><span className="snippet">{m.state==='failed'&&!m.incoming?'未发送：':''}{m.body}</span></span>
   </button>})}</section>
   {!visible.length&&<div className="empty">{search?'未找到信息':filter==='unread'?'没有未读信息':'还没有信息'}<small>{search?'试试其他姓名、号码或关键词':'新收到的短信会显示在这里'}</small></div>}
   {cursor&&<button className="load-more" onClick={()=>void refresh(true)}>加载更早的短信</button>}
  </div>
  {menu&&<><button className="menu-scrim" aria-label="关闭筛选菜单" onClick={()=>setMenu(false)}/><div className="filter-menu glass" role="menu">
   <button role="menuitemradio" aria-checked={filter==='all'} onClick={()=>{setFilter('all');setMenu(false)}}>所有信息{filter==='all'&&<Icon name="check" size={18}/>}</button>
   <button role="menuitemradio" aria-checked={filter==='unread'} onClick={()=>{setFilter('unread');setMenu(false)}}>未读信息<span>{unreadCount}</span></button>
   <button role="menuitem" onClick={()=>{setMenu(false);void refresh()}}>刷新信息<Icon name="refresh" size={18}/></button>
   <button role="menuitem" onClick={()=>{setMenu(false);setScreen('settings')}}>设置<Icon name="settings" size={18}/></button>
  </div></>}
  {editing?<nav className="list-dock editing-dock glass"><button onClick={()=>setSelected(new Set(visible.map(c=>c.key)))}>全选</button><button disabled={!selected.size||busy} onClick={()=>void markSelected()}>标为已读{selected.size?`（${selected.size}）`:''}</button></nav>:
   <nav className="list-dock" aria-label="信息工具栏"><label className="search glass"><Icon name="search" size={21}/><input aria-label="搜索信息" placeholder="搜索" value={search} onChange={e=>setSearch(e.target.value)}/>{search&&<button aria-label="清除搜索" onClick={()=>setSearch('')}><Icon name="close" size={16}/></button>}</label><button className="glass circle compose-button" aria-label="新建短信" onClick={newMessage}><Icon name="compose" size={23}/></button></nav>}
 </>}
 {(screen==='chat'||screen==='new')&&<>
  {screen==='chat'?<header className="chat-header"><button className="glass circle back" aria-label="返回信息列表" onClick={back}><Icon name="back"/></button><button className="contact-heading" aria-label="联系人与发送线路" onClick={()=>setSheet(true)}><Avatar name={current.find(m=>m.name)?.name} large/><span className="contact-title glass">{title}<Icon name="chevron" size={10}/></span></button></header>:
   <><header className="new-header"><button className="glass circle" aria-label="取消新信息" onClick={back}><Icon name="close"/></button><strong>新信息</strong><span className="header-spacer"/></header><div className="recipient"><label>收件人：<input aria-label="收件人号码" type="tel" placeholder="姓名或电话号码" value={recipient} onChange={e=>setRecipient(e.target.value)}/></label>{recipient&&<small>{formatPhone(recipient,region)}</small>}</div></>}
  <section className="messages" ref={chatView} aria-label="短信内容列表" onScroll={e=>{const el=e.currentTarget;nearBottom.current=el.scrollHeight-el.scrollTop-el.clientHeight<70}}>
   {screen==='new'&&contacts.map(c=><button className="contact-suggestion" key={c.number+c.name} onClick={()=>setRecipient(c.number)}><Avatar name={c.name}/><span>{c.name}<small>{formatPhone(c.number,region)}</small></span></button>)}
   {cursor&&screen==='chat'&&<button className="load-more" onClick={()=>{nearBottom.current=false;void refresh(true)}}>加载更早的短信</button>}
   {screen==='chat'&&<p className="sms-heading">短信 · SMS</p>}
   {current.map((m,i)=>{const tail=groupEnd(m,current[i+1]),stamp=showDate(m,current[i-1]);return <React.Fragment key={m.id}>
    {stamp&&<time className="date-divider" dateTime={new Date(m.date).toISOString()}>{sectionTime(m.date)}</time>}
    <article className={(m.incoming?'incoming':'outgoing')+(tail?' group-end':'')+(i>0&&m.incoming!==current[i-1].incoming?' new-sender':'')}>
     <p className={'bubble'+(tail?' tail':'')} tabIndex={0} role="button" aria-expanded={details===m.id} title="轻点查看时间与线路" onClick={()=>setDetails(details===m.id?null:m.id)} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();setDetails(details===m.id?null:m.id)}}}>{m.body}</p>
     {details===m.id&&<small className="message-details">{sectionTime(m.date)} · {m.sim?`SIM ${m.sim}`:'线路未知'}{!m.incoming?' · '+stateLabel[m.state]:''}</small>}
     {!m.incoming&&(i===lastOutgoing||['failed','unknown','accepted','local'].includes(m.state))&&<small className={'delivery '+(m.state==='failed'?'failed':'')}>{stateLabel[m.state]}{m.error&&<> · {m.error}</>}</small>}
     {!m.incoming&&m.state==='unknown'&&outgoing.some(o=>o.id===m.id)&&<button className="retry" disabled={busy} onClick={()=>void send(m)}>核对 / 重试同一请求</button>}
     {!m.incoming&&m.state==='failed'&&<button className="retry" onClick={()=>{setDraft(m.body);setError('短信可能已有部分送出，请确认后再发送')}}>编辑后重发</button>}
    </article></React.Fragment>})}
   <div ref={end}/>
  </section>
  <form className="composer" onSubmit={e=>{e.preventDefault();nearBottom.current=true;void send()}}>
   <label className="sim-control">发送线路 <select aria-label="发送线路" value={sim} onChange={e=>setSim(e.target.value)}>{!sims.length&&<option value="">无可用 SIM</option>}{sims.map(s=><option value={s.id} key={s.id}>{s.name} · SIM {s.id}</option>)}</select></label>
   <div className="composer-row"><button type="button" className="glass circle options-button" aria-label="短信选项" onClick={()=>setSheet(true)}><Icon name="plus"/></button><div className="input-capsule glass"><textarea ref={textarea} aria-label="短信内容" rows={1} placeholder="短信 · SMS" value={draft} maxLength={2000} onChange={e=>setDraft(e.target.value)}/><button aria-label="发送短信" className="send" disabled={busy||!draft.trim()||!sim||(screen==='new'&&!recipient.trim())}><Icon name="send" size={24}/></button></div></div>
  </form>
 </>}
 {screen==='settings'&&<header className="settings-header"><button className="glass circle" aria-label="返回信息列表" onClick={back}><Icon name="back"/></button><strong>设置</strong><span className="header-spacer"/></header>}
 {screen==='settings'&&<section className="settings"><h1>短信互联助手</h1><div className="card"><h3>号码显示</h3><label>本地号码地区<select value={region} onChange={e=>{setRegion(e.target.value as CountryCode);localStorage.setItem('sms.region',e.target.value)}}>{getCountries().map(r=><option value={r} key={r}>{new Intl.DisplayNames(['zh-CN'],{type:'region'}).of(r)} ({r})</option>)}</select></label><p>国际号码按国家码分段；没有国家码时使用此地区。号码库随应用离线提供。</p></div><div className="card"><h3>SIM 卡</h3>{sims.map(s=><label key={s.id}>SIM {s.id}<input defaultValue={s.name} maxLength={30} onBlur={e=>{const name=e.target.value;api('sims',{id:String(s.id),name}).then(()=>setSims(p=>p.map(x=>x.id===s.id?{...x,name}:x))).catch(fail)}}/></label>)}</div><div className="card"><h3>连接状态</h3><button onClick={()=>api('status').then(r=>setDiagnostic(JSON.stringify(r,null,2))).catch(fail)}>检查网关</button><pre>{diagnostic}</pre><p>无法连接时请检查证书、DDNS、路由器防火墙，以及 iPhone 当前网络是否支持 IPv6。浏览器无法单独确认是哪一项故障。</p></div><div className="card"><h3>通知</h3><p>默认只显示“收到一条新短信”，不会发送短信正文或完整号码。依赖 Apple 推送服务，可能延迟；点击通知打开会话列表。</p><p role="status">{pushStatus}</p><button onClick={()=>void subscribe()}>开启 / 重新订阅通知</button><button onClick={()=>api<{status:string}>('push/test',{}).then(r=>setPushStatus(r.status)).catch(fail)}>发送测试通知</button><button onClick={()=>api<{status:string}>('push/status').then(r=>setPushStatus(r.status)).catch(fail)}>查看提交结果</button><button onClick={()=>setPushStatus('用户已确认：此设备收到通知')}>我已收到通知</button><button onClick={async()=>{try{await api('push/unsubscribe',{});const r=await navigator.serviceWorker.ready;await(await r.pushManager.getSubscription())?.unsubscribe();setPushStatus('已关闭通知')}catch(e){fail(e)}}}>关闭通知</button></div><div className="card"><h3>隐私</h3><p>不持久保存短信正文或认证密钥。仅缓存界面资源；访问凭证 12 小时轮换，30 天未使用需重新配对。HTTPS 保护访问链路，普通短信不具备端到端加密。</p><button onClick={async()=>{await Promise.all((await caches.keys()).map(k=>caches.delete(k)));localStorage.removeItem('sms.region');setRows([]);setOutgoing([]);setError('本地缓存已清除')}}>清除本地缓存</button><button onClick={()=>api('logout',{}).then(()=>{setPaired(false);setRows([]);setOutgoing([])}).catch(fail)}>退出此设备</button></div></section>}

 <dialog ref={dialog} className="options-sheet" onCancel={()=>setSheet(false)} onClick={e=>{if(e.target===e.currentTarget)setSheet(false)}}>
  <div className="sheet-content"><button className="sheet-close circle" aria-label="关闭短信选项" onClick={()=>setSheet(false)}><Icon name="close" size={20}/></button><Avatar name={current.find(m=>m.name)?.name} large/><h2>{screen==='chat'?title:'短信选项'}</h2>
  {screen==='chat'&&<p>{formatPhone(active||'',region)}</p>}<label className="sheet-line">发送线路<select aria-label="选项中的发送线路" value={sim} onChange={e=>setSim(e.target.value)}>{!sims.length&&<option value="">无可用 SIM</option>}{sims.map(s=><option value={s.id} key={s.id}>{s.name} · SIM {s.id}</option>)}</select></label><p className="sheet-note">通过 Android 手机发送文字短信。附件、iMessage 与语音暂不支持。</p><button className="primary" onClick={()=>setSheet(false)}>完成</button></div>
 </dialog>
 </>}{error&&<div role="alert" className="error"><span>{error}</span><button aria-label="关闭提示" onClick={()=>setError('')}><Icon name="close" size={18}/></button></div>}
 </main>
}
createRoot(document.getElementById('root')!).render(<App/>);
if('serviceWorker' in navigator)void navigator.serviceWorker.register('/sw.js').catch(()=>{});
