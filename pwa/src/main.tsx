import React,{useEffect,useLayoutEffect,useMemo,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {getCountries} from 'libphonenumber-js/max';
import {formatPhone,identity,type CountryCode} from './phone';
import {api,ApiError,stateLabel,type Sms} from './api';
import './style.css';
import {NameEditor} from './NameEditor';
type Phone={id:string,name:string};
type SimLine={id:number,name:string,online?:boolean,phoneId:string,phoneName:string,slot:number,simName:string};
import {Icon,Avatar} from './Icons';
import {listTime,groupEnd,showDate,sectionTime} from './presentation';
import {reconcile} from './reconcile';
import {mergeOutgoing} from './outgoing';
import {isRemoved,isUnread,type ConversationState} from './conversations';
import {ConversationGesture,Pinned} from './ConversationGesture';
import {useDialogMotion} from './motion';
import {MessageBubble} from './MessageBubble';
import {groupConversations,messageTime,optimisticConversation,reuseRecords} from './viewData';
import {useListMotion} from './listMotion';
import {useNavigation} from './navigation';
import {useContextMotion} from './contextMotion';
import {useMessageMenu,type MessageMenuTrigger} from './messageMenu';
import {useViewport} from './viewport';

const EMPTY:Sms[]=[];

function App(){
 useViewport();
 const [paired,setPaired]=useState(false),[pairing,setPairing]=useState(false),[code,setCode]=useState('');
 const [rows,setRows]=useState<Sms[]>([]),[outgoing,setOutgoing]=useState<Sms[]>([]),[cursor,setCursor]=useState<string|null>(null);
 const [active,setActive]=useState<string|null>(null),[screen,setScreen]=useState('messages'),[search,setSearch]=useState('');
 const [draft,setDraft]=useState(''),[recipient,setRecipient]=useState(''),[sims,setSims]=useState<SimLine[]>([]),[sim,setSim]=useState('');
 const [phones,setPhones]=useState<Phone[]>([]);
 const [error,setError]=useState(''),[busy,setBusy]=useState(false),[online,setOnline]=useState(navigator.onLine),[diagnostic,setDiagnostic]=useState('');
 const [region,setRegion]=useState<CountryCode>(()=>(localStorage.getItem('sms.region') as CountryCode)||'CN');
 const [pushStatus,setPushStatus]=useState('尚未授权'),[contacts,setContacts]=useState<{name:string,number:string}[]>([]);
 const cursorRef=useRef(cursor);cursorRef.current=cursor;
 const [conversationStates,setConversationStates]=useState<ConversationState[]>([]),[metadataReady,setMetadataReady]=useState(false);
 const metadataRef=useRef(conversationStates);metadataRef.current=conversationStates;
 const mutation=useRef(false),generation=useRef(0),metadataWrites=useRef(0);
 const metadataQueue=useRef<Promise<void>>(Promise.resolve());
 const meta=useMemo(()=>new Map(conversationStates.map(s=>[s.address,s])),[conversationStates]);
 const keyOf=useMemo(()=>{const keys=new Map<string,string>();return(raw:string)=>{let key=keys.get(raw);if(key===undefined){key=identity(raw,region);keys.set(raw,key)}return key}},[region]);
 async function changeConversation(address:string,action:string){
  generation.current++;metadataWrites.current++;
  // Automatic read updates and explicit actions share one ordered write queue.
  // The endpoint returns a full snapshot, so out-of-order responses are unsafe.
  const pending=metadataQueue.current;let release!:()=>void;
  metadataQueue.current=new Promise<void>(resolve=>{release=resolve});
  await pending;
  const before=metadataRef.current,optimistic=optimisticConversation(before,address,action);
  if(optimistic){if(action==='pin'||action==='unpin')captureList();metadataRef.current=optimistic;setConversationStates(optimistic)}
  try{const result=await api<ConversationState[]>('conversations',{address,action,region});metadataRef.current=result;setConversationStates(prev=>reuseRecords(prev,result));setMetadataReady(true)}catch(e){if(optimistic){if(action==='pin'||action==='unpin')captureList();const restored=[...metadataRef.current.filter(s=>s.address!==address),...before.filter(s=>s.address===address)];metadataRef.current=restored;setConversationStates(restored)}throw e}finally{metadataWrites.current--;generation.current++;release()}
 }
 const [preview,setPreview]=useState<boolean|null>(null),[pushBusy,setPushBusy]=useState(false);
 useEffect(()=>{
  if(screen!=='settings'||!paired)return;
  let active=true;
  setPreview(null);
  api<{enabled:boolean}>('push/preview').then(r=>{if(active)setPreview(r.enabled)}).catch(e=>{if(active)fail(e)});
  return ()=>{active=false};
 },[screen,paired]);
 async function disablePreview(){
  setPushBusy(true);
  try{await api('push/preview/off',{});setPreview(false);setPushStatus('已关闭短信预览')}
  catch(e){fail(e)}finally{setPushBusy(false)}
 }
 async function subscribe(wantPreview=preview===true){
  if(pushBusy)return;
  setPushBusy(true);
  try{
   if(!('PushManager' in window)||!('Notification' in window))throw Error('请在 iOS 16.4 及以上将网页添加到主屏幕后开启');
   const permission=await Notification.requestPermission();if(permission!=='granted'){setPushStatus('系统未授权');return}
   const {key}=await api<{key:string}>('push/key');const decoded=atob(key.replace(/-/g,'+').replace(/_/g,'/'));const bytes=Uint8Array.from(decoded,c=>c.charCodeAt(0));
   const registration=await navigator.serviceWorker.ready;
   const subscription=await registration.pushManager.getSubscription()||await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:bytes});
   const keys=wantPreview?subscription.toJSON().keys:undefined;
   if(wantPreview&&(!keys?.p256dh||!keys.auth))throw Error('设备未提供通知加密密钥，请重新订阅');
   await api('push/subscribe',{endpoint:subscription.endpoint,preview:wantPreview,...keys});
   setPreview(wantPreview);setPushStatus('已订阅；请发送测试通知并在设备确认');
  }catch(e){setPushStatus('推送订阅失败');fail(e)}finally{setPushBusy(false)}
 }
 useEffect(()=>{if(screen!=='new'||!paired)return;let cancelled=false;const t=setTimeout(()=>api<{name:string,number:string}[]>('contacts?q='+encodeURIComponent(recipient)).then(r=>{if(!cancelled)setContacts(r)}).catch(()=>{}),250);return()=>{cancelled=true;clearTimeout(t)}},[recipient,screen,paired]);
 const end=useRef<HTMLDivElement>(null),loading=useRef(false),sending=useRef(false),outRef=useRef(outgoing); outRef.current=outgoing;
 const fail=(e:unknown)=>{setError(e instanceof Error?e.message:'连接失败'); if(e instanceof ApiError&&e.status===401){setPaired(false);setRows([]);setOutgoing([]);setConversationStates([]);setMetadataReady(false)}};
 async function refresh(older=false){
  if(loading.current)return; loading.current=true;
  const epoch=generation.current;
  const simTask=api<SimLine[]>('sims').then(lines=>{
   setSims(lines);setSim(prev=>prev || String(lines.find(s=>s.online!==false)?.id||''));
  });
  const phonesTask=api<Phone[]>('phones').then(setPhones);
  const metadataTask=api<ConversationState[]>('conversations').then(result=>{if(epoch===generation.current&&!mutation.current&&!metadataWrites.current){if(!Array.isArray(result))throw Error('会话状态暂不可用，请更新安卓应用后重试');setConversationStates(prev=>reuseRecords(prev,result));setMetadataReady(true)}});
  const historyTask=(async()=>{
   const data=await api<{items:Sms[],next:string|null}>('history'+(older&&cursorRef.current?'?before='+cursorRef.current:''));
   if(older){const el=screen==='chat'?chatView.current:listView.current;if(el)pendingAnchor.current={el,top:el.scrollTop,height:el.scrollHeight}}
   setRows(prev=>{
    if(older)return reuseRecords(prev,[...new Map([...prev,...data.items].map(m=>[m.id,m])).values()]);
    const retained=prev.filter(m=>{
     const prefix=m.id.slice(0,4),ids=data.items.filter(r=>r.id.startsWith(prefix)).map(r=>Number(r.id.slice(4)));
     return data.next && ids.length && Number(m.id.slice(4))<Math.min(...ids);
    });
    return reuseRecords(prev,[...data.items,...retained]);
   });
   if(older||!cursorRef.current)setCursor(data.next);
  })();
  const outgoingTask=(async()=>{
   const restored=await api<Sms[]>('outgoing');
   setOutgoing(prev=>reuseRecords(prev,mergeOutgoing(prev,restored)));
   const missing=outRef.current.filter(m=>['accepted','unknown'].includes(m.state)&&!restored.some(r=>r.id===m.id));
   const updates=await Promise.allSettled(missing.map(async m=>({...m,...await api<{state:Sms['state'],error?:string}>('send/'+m.id)})));
   setOutgoing(prev=>reuseRecords(prev,mergeOutgoing(prev,updates.flatMap(r=>r.status==='fulfilled'?[r.value]:[]))));
  })();
  try{
   const results=await Promise.allSettled([historyTask,outgoingTask,metadataTask,simTask,phonesTask]);
   setOnline(results.every(r=>r.status==='fulfilled'));
   for(const result of results)if(result.status==='rejected')fail(result.reason);
  }finally{loading.current=false}
 }
 useEffect(()=>{api('status').then(()=>setPaired(true)).catch(e=>{if(!(e instanceof ApiError&&e.status===401))fail(e)})},[]);
 useEffect(()=>{if(!paired)return;void refresh();
  const timer=setInterval(()=>{if(!document.hidden)void refresh()},8000); const visible=()=>{if(!document.hidden)void refresh()};document.addEventListener('visibilitychange',visible);return()=>{clearInterval(timer);document.removeEventListener('visibilitychange',visible)};
 },[paired]);
 useEffect(()=>{if(!pairing)return; const timer=setInterval(()=>{api<{status:string}>('pair/finish',{}).then(r=>{if(r.status==='ok'){setPairing(false);setPaired(true);setCode('')}}).catch(fail)},2000);const expiry=setTimeout(()=>{setPairing(false);setError('配对已超时，请在安卓重新生成配对码')},180000);return()=>{clearInterval(timer);clearTimeout(expiry)}},[pairing]);
 const reconciled=useMemo(()=>reconcile(rows,outgoing,region),[rows,outgoing,region]);
 const all=useMemo(()=>metadataReady?reconciled.filter(m=>!isRemoved(m,meta.get(keyOf(m.address)))):EMPTY,[metadataReady,reconciled,meta,keyOf]);
 const {groups:conversations,list}=useMemo(()=>groupConversations(all,keyOf),[all,keyOf]);
 const current=active?(conversations.get(active)||EMPTY):EMPTY;
 const title=current.find(m=>m.name)?.name||formatPhone(active||'',region);
 async function openConversation(address:string){const latest=[...(conversations.get(address)||[])].reverse().find(m=>m.incoming);if(latest)setSim(String(latest.sim||''));setActive(address);setScreen('chat');setError('');const time=Date.now();setRows(prev=>prev.map(m=>keyOf(m.address)===address?{...m,read:true}:m));try{await api('read',{address:rows.find(m=>keyOf(m.address)===address)?.address||address,time:String(time)});if(meta.get(address)?.unread)await changeConversation(address,'read')}catch(e){fail(e)}}
 // Fragments never travel to the server. Clear the sender from browser history after reading it.
 const [notificationAddress,setNotificationAddress]=useState<string|null>(null);
 useEffect(()=>{
  const readTarget=()=>{
   const sender=new URLSearchParams(location.hash.slice(1)).get('conversation');
   if(!sender)return;
   history.replaceState(history.state,'',location.pathname+location.search);
   if(sender.length<=100)setNotificationAddress(sender);
  };
  readTarget();window.addEventListener('hashchange',readTarget);
  return ()=>window.removeEventListener('hashchange',readTarget);
 },[]);
 useEffect(()=>{
  if(!paired||!metadataReady||!notificationAddress)return;
  setNotificationAddress(null); setDraft(''); setSheet(false);setDetails(null);
  void openConversation(keyOf(notificationAddress));
 },[notificationAddress,paired,metadataReady]);
 async function saveName(kind:'phones'|'sims',id:string,name:string):Promise<string>{
  await api(kind,{id,name});
  const [devices,lines]=await Promise.all([api<Phone[]>('phones'),api<SimLine[]>('sims')]);
  setPhones(devices);setSims(lines);
  return (kind==='phones'?devices.find(p=>p.id===id)?.name:lines.find(s=>String(s.id)===id)?.simName)??name.trim();
 }
 function messageSource(m:Sms){
  const line=sims.find(s=>s.id===m.sim);
  if(line)return line.phoneName+' · '+line.simName;
  const peer=m.id.startsWith('xia:')||(m.sim||0)>100;
  return (phones.find(p=>p.id===(peer?'peer':'server'))?.name||(peer?'共享手机':'服务器手机'))+' · '+(m.sim?'卡 '+(m.sim>100?m.sim-100:m.sim):'线路未知');
 }
 async function send(existing?:Sms){
  if(sending.current)return;
  const address=active||identity(recipient,region);
  if(!existing&&(!draft.trim()||!address||!sim))return;
  if(!sims.some(s=>s.id===Number(existing?.sim||sim)&&s.online!==false)){setError('所选手机或 SIM 卡离线，请选择可用线路');return}
  const m:Sms=existing||{id:crypto.randomUUID(),address,body:draft,date:Date.now(),incoming:false,read:true,sim:Number(sim),state:'local'};
  if(!existing){setOutgoing(p=>[...p,m]);setDraft('');setActive(address);setScreen('chat')}
  sending.current=true;setBusy(true);setError('');
  try{const result=await api<{state:Sms['state'],error?:string}>('send',{id:m.id,address:m.address,body:m.body,sim:String(m.sim)});setOutgoing(p=>mergeOutgoing(p,[{...m,...result}]))}
  catch(e){setOutgoing(p=>mergeOutgoing(p,[{...m,state:'unknown'}]));fail(e)}finally{sending.current=false;setBusy(false);void refresh()}
 }
 const [filter,setFilter]=useState<'all'|'unread'|'deleted'>('all'),[menu,setMenu]=useState(false),[editing,setEditing]=useState(false);
 const requestPinEdit=useRef(false);
 const [editMenu,setEditMenu]=useState(false),[pinEditing,setPinEditing]=useState(false);
 const [menuSelection,setMessageMenu]=useState<{message:Sms,trigger:MessageMenuTrigger}|null>(null);
 const messageMenu=menuSelection?.message;
 const [messageError,setMessageError]=useState(''),[notice,setNotice]=useState('');
 const messageAnchor=useRef<DOMRect|null>(null),messageSourceRef=useRef<HTMLElement|null>(null);
 const messageDialog=useRef<HTMLDialogElement>(null),lastMessage=useRef<Sms|null>(null);if(messageMenu)lastMessage.current=messageMenu;
 const [swiped,setSwiped]=useState<string|null>(null),[contextKey,setContextKey]=useState<string|null>(null),[deleteKeys,setDeleteKeys]=useState<string[]>([]);
 const actionDialog=useRef<HTMLDialogElement>(null),deleteDialog=useRef<HTMLDialogElement>(null);
 const lastContext=useRef<string|null>(null);if(contextKey)lastContext.current=contextKey;
 const [selected,setSelected]=useState<Set<string>>(new Set()),[details,setDetails]=useState<string|null>(null),[sheet,setSheet]=useState(false);
 const listView=useRef<HTMLDivElement>(null),chatView=useRef<HTMLElement>(null),textarea=useRef<HTMLTextAreaElement>(null),dialog=useRef<HTMLDialogElement>(null),composer=useRef<HTMLFormElement>(null);
 const listPage=useRef<HTMLDivElement>(null),detailPage=useRef<HTMLDivElement>(null),contextAnchor=useRef<DOMRect|null>(null);
 const captureList=useListMotion(listView,conversationStates);
 const openContext=(key:string,anchor?:DOMRect)=>{contextAnchor.current=anchor||null;setContextKey(key)};
 const listScroll=useRef(0),nearBottom=useRef(true),thread=useRef<string|null>(null);
 const pendingAnchor=useRef<{el:HTMLElement,top:number,height:number}|null>(null);
 useLayoutEffect(()=>{const el=textarea.current;if(el){el.style.height='auto';el.style.height=Math.min(el.scrollHeight,128)+'px'}},[draft,screen,paired]);
 useLayoutEffect(()=>{
  const messages=chatView.current,form=composer.current;if(!messages||!form)return;
  let lastHeight=-1;
  const fit=()=>{const height=Math.ceil(form.getBoundingClientRect().height);if(height!==lastHeight){lastHeight=height;messages.style.setProperty('--composer-space',`${height+8}px`)}if(nearBottom.current)messages.scrollTop=messages.scrollHeight};
  fit();const observer=new ResizeObserver(fit);observer.observe(form,{box:'border-box'});observer.observe(messages,{box:'border-box'});return()=>observer.disconnect();
 },[screen,paired]);
 useLayoutEffect(()=>{if(screen==='messages'&&listView.current)listView.current.scrollTop=listScroll.current},[screen]);
 useLayoutEffect(()=>{const el=chatView.current;if(!el)return;if(thread.current!==active||nearBottom.current)el.scrollTop=el.scrollHeight;thread.current=active},[active,current.length,screen]);
 useLayoutEffect(()=>{const anchor=pendingAnchor.current;if(anchor?.el.isConnected)anchor.el.scrollTop=anchor.top+anchor.el.scrollHeight-anchor.height;pendingAnchor.current=null},[rows]);
 useEffect(()=>{if(!notice)return;const t=setTimeout(()=>setNotice(''),1800);return()=>clearTimeout(t)},[notice]);
 const messageMotion=useMessageMenu(menuSelection?.trigger??null,messageDialog,messageAnchor,messageSourceRef,()=>setMessageMenu(null));
 const optionsMotion=useDialogMotion(sheet,dialog,()=>setSheet(false),true);
 const contextMotion=useContextMotion(!!contextKey,actionDialog,contextAnchor,()=>setContextKey(null));
 const deleteMotion=useDialogMotion(!!deleteKeys.length,deleteDialog,()=>{if(!busy)setDeleteKeys([])},true);
 useEffect(()=>{setSwiped(null);setSelected(new Set());setEditing(false);setPinEditing(requestPinEdit.current);requestPinEdit.current=false;setEditMenu(false)},[filter]);
 const deleted=useMemo(()=>conversationStates.filter(s=>s.removedBefore>0).map(s=>({key:s.address,items:reconciled.filter(m=>keyOf(m.address)===s.address&&isRemoved(m,s)).sort((a,b)=>a.date-b.date)})),[conversationStates,reconciled,keyOf]);
 const source=filter==='deleted'?deleted:list;
 const visible=useMemo(()=>source.filter(c=>(filter!=='unread'||isUnread(c.items,meta.get(c.key)))&&(!search||`${c.key} ${c.items.map(m=>`${m.name||''} ${m.address} ${m.body}`).join(' ')}`.toLowerCase().includes(search.toLowerCase()))),[source,filter,meta,search]);
 const pins=useMemo(()=>filter==='all'&&!search&&!editing?conversationStates.filter(s=>s.pinned>0).sort((a,b)=>a.pinned-b.pinned).map(s=>list.find(c=>c.key===s.address)||{key:s.address,items:EMPTY}):[],[filter,search,editing,conversationStates,list]);
 const regular=useMemo(()=>visible.filter(c=>!pins.some(p=>p.key===c.key)),[visible,pins]);
 const unreadCount=list.filter(c=>isUnread(c.items,meta.get(c.key))).length;
 const contextItems=source.find(c=>c.key===(contextKey||lastContext.current))?.items||[],contextName=contextItems.find(m=>m.name)?.name||formatPhone(contextKey||lastContext.current||'',region);
 const lastOutgoing=current.map(m=>m.incoming).lastIndexOf(false);
 const navigation=useNavigation(screen,listPage,detailPage,()=>{setSheet(false);setMessageMenu(null);setMenu(false);setEditMenu(false);setActive(null);setScreen('messages');setError('')});
 const back=navigation.back;
 const newMessage=()=>{setActive(null);setRecipient('');setDraft('');setScreen('new');setError('');setMenu(false);setEditMenu(false);setPinEditing(false)};
 async function markSelected(){
  if(busy||mutation.current)return;mutation.current=true;setBusy(true);
  try{for(const key of selected){const c=list.find(c=>c.key===key);if(!c)continue;const last=c.items.at(-1)!;
   await api('read',{address:last.address,time:String(last.date)});
   if(meta.get(key)?.unread)await changeConversation(key,'read');
   setRows(prev=>prev.map(m=>keyOf(m.address)===key&&m.date<=last.date?{...m,read:true}:m));
   setSelected(prev=>{const next=new Set(prev);next.delete(key);return next});
  }setEditing(false)}catch(e){fail(e)}finally{mutation.current=false;setBusy(false)}
 }
 async function act(keys:string[],action:string){
  if(mutation.current)return;mutation.current=true;setBusy(true);setError('');
  try{for(const key of keys){
   if(action==='pin'&&conversationStates.filter(s=>s.pinned>0).length>=9&&!meta.get(key)?.pinned)throw Error('最多置顶 9 个对话，请先取消一个置顶');
   if(!['remove','restore'].includes(action))setContextKey(null);
   if(action==='read'){const items=list.find(c=>c.key===key)?.items||[];await api('read',{address:items.at(-1)?.address||key,time:String(Date.now())});setRows(prev=>prev.map(m=>keyOf(m.address)===key?{...m,read:true}:m))}
   await changeConversation(key,action);
  }setContextKey(null);setDeleteKeys([]);setSelected(new Set());setEditing(false);setSwiped(null)}catch(e){fail(e)}finally{mutation.current=false;setBusy(false)}
 }
 function selectConversation(key:string){if(editing){setSelected(prev=>{const s=new Set(prev);s.has(key)?s.delete(key):s.add(key);return s})}else if(filter==='deleted'){setContextKey(key)}else{nearBottom.current=true;void openConversation(key)}}
 return <main className={'app screen-'+(paired?screen:'pair')}>
 {!paired?<section className="pair"><div className="app-icon"><Icon name="compose" size={40}/></div><h1>你的短信，随身相伴。</h1><p>连接自己的 Android 手机<br/>在 iPhone 上安全收发短信</p><form onSubmit={async e=>{e.preventDefault();setError('');try{await api('pair',{code,name:'iPhone Safari'});setPairing(true)}catch(e){fail(e)}}}><label>安卓显示的配对码<input value={code} onChange={e=>setCode(e.target.value.trim())} autoComplete="off" autoCapitalize="none" required maxLength={12}/></label><button className="primary" disabled={pairing}>{pairing?'请在安卓确认授权…':'连接我的手机'}</button></form><p className="hint">Safari → 分享 → 添加到主屏幕<br/>只使用你自己的 HTTPS 网址</p></section>:<>
 {['messages','chat','new'].includes(screen)&&<div className="list-page" ref={listPage} aria-hidden={screen!=='messages'} inert={screen!=='messages'}>
  <div className="list-view" ref={listView} onScroll={e=>{listScroll.current=e.currentTarget.scrollTop;setSwiped(null)}}>
   <header className="list-toolbar"><button className="glass edit-button" aria-expanded={editMenu} onClick={()=>{if(editing||pinEditing){setEditing(false);setPinEditing(false)}else setEditMenu(v=>!v);setSelected(new Set());setMenu(false);setSwiped(null)}}>{editing||pinEditing?'完成':'编辑'}</button><h1 className="list-title">{filter==='unread'?'未读信息':filter==='deleted'?'最近删除':'信息'}</h1><button className={'glass circle'+(filter==='unread'?' active-filter':'')} aria-label="筛选与设置" aria-expanded={menu} onClick={()=>{setMenu(v=>!v);setEditMenu(false);setSwiped(null)}}><Icon name="filter"/></button></header>
   {!online&&<button className="offline-banner" onClick={()=>void refresh()}>连接已中断 · 轻点重试</button>}
   {filter==='deleted'&&<p className="deleted-note">仅从助手移除，安卓原始短信仍保留。选择对话可恢复；新短信会正常出现在信息列表中。</p>}
   {!!pins.length&&<section className="pinned-grid" aria-label="置顶会话">{pins.map(c=>{const m=c.items.at(-1),name=m?.name||formatPhone(m?.address||c.key,region),unread=isUnread(c.items,meta.get(c.key));return <div className="pinned-cell" data-motion-key={c.key} data-motion-kind="pin" key={c.key}>{pinEditing&&<button className="unpin-control" aria-label={'取消置顶'+name} disabled={busy} onClick={()=>void act([c.key],'unpin')}><Icon name="minus" size={18}/></button>}<Pinned name={name} avatar={m?.name} unread={unread} muted={!!meta.get(c.key)?.muted} onOpen={()=>{if(!pinEditing)selectConversation(c.key)}} onMenu={anchor=>{if(!pinEditing)openContext(c.key,anchor)}}/></div>})}</section>}
   <section className="conversations" aria-label="会话列表">{regular.map(c=>{const m=c.items.at(-1),unread=filter!=='deleted'&&isUnread(c.items,meta.get(c.key)),name=m?.name||formatPhone(m?.address||c.key,region);return <div className="conversation-slot" data-motion-key={c.key} data-motion-kind="row" key={c.key}><ConversationGesture label={`${name}${unread?'，未读':''}${meta.get(c.key)?.muted?'，已隐藏提醒':''}`} unread={unread} muted={!!meta.get(c.key)?.muted} selected={editing?selected.has(c.key):undefined} onMute={()=>void act([c.key],meta.get(c.key)?.muted?'unmute':'mute')} disabled={editing||pinEditing||filter==='deleted'||busy} open={swiped===c.key} onSwipe={open=>setSwiped(open?c.key:null)} onOpen={()=>{if(pinEditing)void act([c.key],'pin');else selectConversation(c.key)}} onMenu={anchor=>openContext(c.key,anchor)} onDelete={()=>setDeleteKeys([c.key])} onRead={()=>void act([c.key],unread?'read':'unread')}>
    {pinEditing?<span className="pin-control"><Icon name="pin" size={20}/></span>:editing?<span className={'selection-dot '+(selected.has(c.key)?'selected':'')}>{selected.has(c.key)&&<Icon name="check" size={15}/>}</span>:<span className={'unread-dot '+(unread?'unread':'')}/>}
    <Avatar name={m?.name}/><span className="preview"><span className="row-heading"><b>{name}</b>{meta.get(c.key)?.muted&&<span className="muted-mark" aria-label="已隐藏提醒"><Icon name="bell-off" size={14}/></span>}{!!meta.get(c.key)?.pinned&&<Icon name="pin" size={13}/>}<time>{m?listTime(m.date):''}</time><Icon name="chevron" size={12}/></span><span className="snippet">{filter==='deleted'?'已从助手移除 · 轻点恢复':<>{m?.state==='failed'&&!m.incoming?'未发送：':''}{m?.body}</>}</span></span>
   </ConversationGesture></div>})}</section>
   {!visible.length&&!pins.length&&<div className="empty">{!metadataReady?'正在载入…':search?'未找到信息':filter==='unread'?'没有未读信息':filter==='deleted'?'没有最近删除的对话':'还没有信息'}<small>{search?'试试其他姓名、号码或关键词':filter==='deleted'?'移除的对话会保留在这里，直到你恢复':'新收到的短信会显示在这里'}</small></div>}
   {cursor&&<button className="load-more" onClick={()=>void refresh(true)}>加载更早的短信</button>}
  </div>
  {editMenu&&<><button className="menu-scrim" aria-label="关闭编辑菜单" onClick={()=>setEditMenu(false)}/><div className="filter-menu edit-menu glass" role="menu"><button role="menuitem" onClick={()=>{setEditing(true);setEditMenu(false);setSelected(new Set())}}>选择信息<Icon name="check" size={18}/></button>{filter!=='deleted'&&<button role="menuitem" onClick={()=>{requestPinEdit.current=filter!=='all';setFilter('all');setPinEditing(true);setEditMenu(false)}}>编辑置顶<Icon name="pin" size={18}/></button>}</div></>}
  {menu&&<><button className="menu-scrim" aria-label="关闭筛选菜单" onClick={()=>setMenu(false)}/><div className="filter-menu glass" role="menu">
   <button role="menuitemradio" aria-checked={filter==='all'} onClick={()=>{setFilter('all');setMenu(false)}}>所有信息{filter==='all'&&<Icon name="check" size={18}/>}</button>
   <button role="menuitemradio" aria-checked={filter==='unread'} onClick={()=>{setFilter('unread');setMenu(false)}}>未读信息<span>{unreadCount}</span></button>
   <button role="menuitemradio" aria-checked={filter==='deleted'} onClick={()=>{setFilter('deleted');setMenu(false)}}>最近删除<Icon name="trash" size={18}/></button>
   <button role="menuitem" onClick={()=>{setMenu(false);void refresh()}}>刷新信息<Icon name="refresh" size={18}/></button>
   <button role="menuitem" onClick={()=>{setMenu(false);setScreen('settings')}}>设置<Icon name="settings" size={18}/></button>
  </div></>}
  {editing?<nav className="list-dock editing-dock glass"><button onClick={()=>setSelected(new Set(visible.map(c=>c.key)))}>全选</button>{filter==='deleted'?<button disabled={!selected.size||busy} onClick={()=>void act([...selected],'restore')}>恢复{selected.size?`（${selected.size}）`:''}</button>:<><button disabled={!selected.size||busy} onClick={()=>{if([...selected].some(key=>isUnread(list.find(c=>c.key===key)?.items||[],meta.get(key))))void markSelected();else void act([...selected],'unread')}}>{[...selected].some(key=>isUnread(list.find(c=>c.key===key)?.items||[],meta.get(key)))?'标为已读':'标为未读'}{selected.size?`（${selected.size}）`:''}</button><button className="destructive" disabled={!selected.size||busy} onClick={()=>setDeleteKeys([...selected])}>删除</button></>}</nav>:
   <nav className="list-dock" aria-label="信息工具栏"><label className="search glass"><Icon name="search" size={21}/><input aria-label="搜索信息" placeholder="搜索" value={search} onChange={e=>setSearch(e.target.value)}/>{search&&<button aria-label="清除搜索" onClick={()=>setSearch('')}><Icon name="close" size={16}/></button>}</label><button className="glass circle compose-button" aria-label="新建短信" onClick={newMessage}><Icon name="compose" size={23}/></button></nav>}
 </div>}
 {(screen==='chat'||screen==='new')&&<div className="chat-page" ref={detailPage} {...navigation.handlers}>
  {screen==='chat'?<header className="chat-header"><button className="glass circle back" aria-label="返回信息列表" onClick={back}><Icon name="back"/></button><button className="contact-heading" aria-label="联系人与发送线路" onClick={()=>setSheet(true)}><Avatar name={current.find(m=>m.name)?.name} large/><span className="contact-title glass">{title}<Icon name="chevron" size={10}/></span></button></header>:
   <><header className="new-header"><button className="glass circle" aria-label="取消新信息" onClick={back}><Icon name="close"/></button><strong>新信息</strong><span className="header-spacer"/></header><div className="recipient"><label>收件人：<input aria-label="收件人号码" type="tel" placeholder="姓名或电话号码" value={recipient} onChange={e=>setRecipient(e.target.value)}/></label>{recipient&&<small>{formatPhone(recipient,region)}</small>}</div></>}
  <section className="messages" ref={chatView} aria-label="短信内容列表" onScroll={e=>{const el=e.currentTarget;nearBottom.current=el.scrollHeight-el.scrollTop-el.clientHeight<70}}>
   {screen==='new'&&contacts.map(c=><button className="contact-suggestion" key={c.number+c.name} onClick={()=>setRecipient(c.number)}><Avatar name={c.name}/><span>{c.name}<small>{formatPhone(c.number,region)}</small></span></button>)}
   {cursor&&screen==='chat'&&<button className="load-more" onClick={()=>{nearBottom.current=false;void refresh(true)}}>加载更早的短信</button>}
   {screen==='chat'&&<p className="sms-heading">短信 · SMS</p>}
   {current.map((m,i)=>{const tail=groupEnd(m,current[i+1]),stamp=showDate(m,current[i-1]);const expanded=details===m.id,deliveryShown=!m.incoming&&(i===lastOutgoing||['failed','unknown','accepted','local'].includes(m.state));return <React.Fragment key={m.id}>
    {stamp&&<time className="date-divider" dateTime={new Date(m.date).toISOString()}>{sectionTime(m.date)}</time>}
    <article className={(m.incoming?'incoming':'outgoing')+(tail?' group-end':'')+(i>0&&m.incoming!==current[i-1].incoming?' new-sender':'')}>
     <small className={'message-line'+(expanded?' message-details':'')}>{messageSource(m)}{expanded&&!stamp&&<span className="message-detail-time"> · {messageTime(m.date)}</span>}{expanded&&!m.incoming&&!deliveryShown&&<> · {stateLabel[m.state]}</>}</small><MessageBubble body={m.body} tail={tail} expanded={details===m.id} onDetails={()=>setDetails(details===m.id?null:m.id)} onMenu={(anchor,source,trigger)=>{messageAnchor.current=anchor;messageSourceRef.current=source;setMessageError('');setMessageMenu({message:m,trigger})}}/><time className="drag-time" aria-hidden="true">{messageTime(m.date)}</time>
     {deliveryShown&&<small className={'delivery '+(m.state==='failed'?'failed':'')}>{stateLabel[m.state]}{m.error&&<> · {m.error}</>}</small>}
     {!m.incoming&&m.state==='unknown'&&outgoing.some(o=>o.id===m.id)&&<button className="retry" disabled={busy} onClick={()=>void send(m)}>核对 / 重试同一请求</button>}
     {!m.incoming&&m.state==='failed'&&<button className="retry" onClick={()=>{setDraft(m.body);setError('短信可能已有部分送出，请确认后再发送')}}>编辑后重发</button>}
    </article></React.Fragment>})}
   <div ref={end}/>
  </section>
  <form className="composer" ref={composer} onSubmit={e=>{e.preventDefault();nearBottom.current=true;void send()}}>
   <label className="sim-control">发送线路 <select aria-label="发送线路" value={sim} onChange={e=>setSim(e.target.value)}>{!sims.length&&<option value="">无可用 SIM</option>}{sims.map(s=><option value={s.id} key={s.id} disabled={s.online===false}>{s.name}</option>)}</select></label>
   {draft.length>2000&&<p className="draft-limit">超过 2000 字，请删减后发送（当前 {draft.length} 字）</p>}<div className="composer-row"><button type="button" className="glass circle options-button" aria-label="短信选项" onClick={()=>setSheet(true)}><Icon name="plus"/></button><div className="input-capsule glass"><textarea ref={textarea} aria-label="短信内容" rows={1} placeholder={'短信 · '+(sims.find(s=>String(s.id)===sim)?.name||'SMS')} onPointerDown={e=>{if(e.pointerType==='touch'&&document.activeElement!==e.currentTarget)e.currentTarget.focus({preventScroll:true})}} value={draft} maxLength={2000} onChange={e=>setDraft(e.target.value)}/><button aria-label="发送短信" className="send" disabled={busy||!draft.trim()||draft.length>2000||!sims.some(s=>s.id===Number(sim)&&s.online!==false)||(screen==='new'&&!recipient.trim())}><Icon name="send" size={24}/></button></div></div>
  </form>
 </div>}
 {screen==='settings'&&<header className="settings-header"><button className="glass circle" aria-label="返回信息列表" onClick={back}><Icon name="back"/></button><strong>设置</strong><span className="header-spacer"/></header>}
 {screen==='settings'&&<section className="settings"><h1>短信互联助手</h1><div className="card"><h3>号码显示</h3><label>本地号码地区<select value={region} onChange={e=>{setRegion(e.target.value as CountryCode);localStorage.setItem('sms.region',e.target.value)}}>{getCountries().map(r=><option value={r} key={r}>{new Intl.DisplayNames(['zh-CN'],{type:'region'}).of(r)} ({r})</option>)}</select></label><p>国际号码按国家码分段；没有国家码时使用此地区。号码库随应用离线提供。</p></div><div className="card"><h3>手机与 SIM 名称</h3><p>名称最多 30 个字符，清空后保存可恢复默认名称。改名不改变实际发送手机或 SIM 卡。</p>{phones.map(p=><div className="phone-names" key={p.id}><NameEditor label={(p.id==='server'?'服务器手机':'共享手机')+'名称'} value={p.name} onSave={name=>saveName('phones',p.id,name)}/>{sims.filter(s=>s.phoneId===p.id).map(s=><NameEditor key={s.id} label={p.name+' · SIM '+s.slot} value={s.simName} onSave={name=>saveName('sims',String(s.id),name)}/>)}</div>)}</div><div className="card"><h3>连接状态</h3><button onClick={()=>api('status').then(r=>setDiagnostic(JSON.stringify(r,null,2))).catch(fail)}>检查网关</button><pre>{diagnostic}</pre><p>无法连接时请检查证书、DDNS、路由器防火墙，以及 iPhone 当前网络是否支持 IPv6。浏览器无法单独确认是哪一项故障。</p></div><div className="card"><h3>通知</h3><label><input type="checkbox" checked={preview===true} disabled={pushBusy||preview===null} onChange={e=>void (e.target.checked?subscribe(true):disablePreview())}/> 显示短信预览（本设备）</label><p>开启后，通知会显示联系人或号码及短信摘要。点按可打开会话。锁屏显示内容由 iPhone 的“显示预览”设置控制。</p><p role="status">{pushStatus}</p><button disabled={pushBusy||preview===null} onClick={()=>void subscribe()}>开启 / 重新订阅通知</button><button onClick={()=>api<{status:string}>('push/test',{}).then(r=>setPushStatus(r.status)).catch(fail)}>发送测试通知</button><button onClick={()=>api<{status:string}>('push/status').then(r=>setPushStatus(r.status)).catch(fail)}>查看提交结果</button><button onClick={()=>setPushStatus('用户已确认：此设备收到通知')}>我已收到通知</button><button disabled={pushBusy} onClick={async()=>{setPushBusy(true);try{await api('push/unsubscribe',{});setPreview(false);const r=await navigator.serviceWorker.ready;await(await r.pushManager.getSubscription())?.unsubscribe();setPushStatus('已关闭通知')}catch(e){fail(e)}finally{setPushBusy(false)}}}>关闭通知</button></div><div className="card"><h3>隐私</h3><p>不持久保存短信正文或认证密钥。仅缓存界面资源；访问凭证 12 小时轮换，30 天未使用需重新配对。HTTPS 保护访问链路，普通短信不具备端到端加密。</p><button onClick={async()=>{await Promise.all((await caches.keys()).map(k=>caches.delete(k)));localStorage.removeItem('sms.region');setRows([]);setOutgoing([]);setError('本地缓存已清除')}}>清除本地缓存</button><button onClick={()=>api('logout',{}).then(()=>{setPaired(false);setRows([]);setOutgoing([])}).catch(fail)}>退出此设备</button></div></section>}

 {notice&&<div className="toast glass" role="status">{notice}</div>}
 <dialog ref={messageDialog} className="native-context message-context" data-outgoing={(messageMenu||lastMessage.current)?.incoming===false} aria-label="信息操作" {...messageMotion}>
  <div className={'message-preview '+((messageMenu||lastMessage.current)?.incoming?'incoming':'outgoing')}><p className={'bubble'+(messageSourceRef.current?.classList.contains('tail')?' tail':'')}>{(messageMenu||lastMessage.current)?.body}</p></div>
  <div className="context-actions">
  <button onClick={()=>{const body=messageMenu?.body;if(body===undefined)return;if(!navigator.clipboard){setMessageError('无法访问剪贴板，请选择下面的文字拷贝');return}navigator.clipboard.writeText(body).then(()=>{setMessageMenu(null);setNotice('已拷贝')}).catch(()=>setMessageError('无法拷贝，请选择下面的文字拷贝'))}}>拷贝<Icon name="copy"/></button>
  <button onClick={()=>{const m=messageMenu;if(!m)return;setMessageMenu(null);newMessage();setDraft(m.body)}}>转发<Icon name="forward"/></button>
  {messageError&&<><p className="dialog-error">{messageError}</p><textarea className="copy-fallback" aria-label="选择信息文本" readOnly value={messageMenu?.body||''} onFocus={e=>e.currentTarget.select()}/></>}
  </div>
 </dialog>
 <dialog ref={actionDialog} className="native-context" aria-label="对话操作" {...contextMotion}>
  <button className="conversation-preview" aria-label={'打开'+contextName+'的对话'} onClick={()=>{const key=contextKey;if(!key||filter==='deleted')return;setContextKey(null);nearBottom.current=true;void openConversation(key)}}>
   <span className="preview-heading"><Avatar name={contextItems.find(m=>m.name)?.name}/><strong>{contextName}</strong></span>
   <span className="preview-messages">{contextItems.slice(-5).map((m,i,items)=><React.Fragment key={m.id}>{showDate(m,items[i-1])&&<time className="date-divider">{sectionTime(m.date)}</time>}<span className={'preview-message '+(m.incoming?'incoming':'outgoing')}><span className={'bubble'+(groupEnd(m,items[i+1])?' tail':'')}>{m.body}</span></span></React.Fragment>)}{!contextItems.length&&<span className="preview-empty">{filter==='deleted'?'已从助手移除':'还没有信息'}</span>}</span>
  </button>
  <div className="context-actions">
  {filter==='deleted'?<button disabled={busy} onClick={()=>void act([contextKey!],'restore')}>恢复对话<Icon name="restore"/></button>:<>
   <button disabled={busy} onClick={()=>void act([contextKey!],meta.get(contextKey!)?.pinned?'unpin':'pin')}>{meta.get(contextKey!)?.pinned?'取消置顶':'置顶'}<Icon name="pin"/></button>
   <button disabled={busy} onClick={()=>void act([contextKey!],isUnread(contextItems,meta.get(contextKey!))?'read':'unread')}>{isUnread(contextItems,meta.get(contextKey!))?'标为已读':'标为未读'}<Icon name="envelope"/></button>
   <button disabled={busy} onClick={()=>void act([contextKey!],meta.get(contextKey!)?.muted?'unmute':'mute')}>{meta.get(contextKey!)?.muted?'显示提醒':'隐藏提醒'}<Icon name={meta.get(contextKey!)?.muted?'bell':'bell-off'}/></button>
   <button disabled={busy} className="destructive" onClick={()=>{setDeleteKeys([contextKey!]);setContextKey(null)}}>删除<Icon name="trash"/></button>
  </>}
  {error&&<p role="alert" className="dialog-error">{error}</p>}</div>
 </dialog>
 <dialog ref={deleteDialog} className="delete-sheet" aria-label="删除对话确认" {...deleteMotion}>
  <div><h2>{deleteKeys.length>1?`删除这 ${deleteKeys.length} 个对话？`:'删除此对话？'}</h2><p>仅从助手移除，安卓原始短信仍保留。你可以在“最近删除”中恢复。</p>{error&&<p role="alert" className="dialog-error">{error}</p>}<button disabled={busy} className="destructive" onClick={()=>void act(deleteKeys,'remove')}>{busy?'正在移除…':'删除对话'}</button></div><button disabled={busy} className="cancel-delete" onClick={()=>setDeleteKeys([])}>取消</button>
 </dialog>
 <dialog ref={dialog} className="options-sheet" {...optionsMotion}>
  <div className="sheet-content"><button className="sheet-close circle" aria-label="关闭短信选项" onClick={()=>setSheet(false)}><Icon name="close" size={20}/></button><Avatar name={current.find(m=>m.name)?.name} large/><h2>{screen==='chat'?title:'短信选项'}</h2>
  {screen==='chat'&&<p>{formatPhone(active||'',region)}</p>}<label className="sheet-line">发送线路<select aria-label="选项中的发送线路" value={sim} onChange={e=>setSim(e.target.value)}>{!sims.length&&<option value="">无可用 SIM</option>}{sims.map(s=><option value={s.id} key={s.id} disabled={s.online===false}>{s.name}</option>)}</select></label>{screen==='chat'&&<><div className="sheet-line alert-toggle"><span>隐藏提醒</span><button type="button" className="ios-switch" role="switch" aria-label="隐藏提醒" aria-checked={!!meta.get(active!)?.muted} disabled={busy} onClick={()=>void act([active!],meta.get(active!)?.muted?'unmute':'mute')}><span/></button></div><p className="mute-note">只停止此对话在助手中的 iPhone 推送，短信仍会正常接收。安卓本机通知不受影响。</p>{error&&<p className="dialog-error">{error}</p>}</>}<p className="sheet-note">通过 Android 手机发送文字短信。附件、iMessage 与语音暂不支持。</p><button className="primary" onClick={()=>setSheet(false)}>完成</button></div>
 </dialog>
 </>}{error&&<div role="alert" className="error"><span>{error}</span><button aria-label="关闭提示" onClick={()=>setError('')}><Icon name="close" size={18}/></button></div>}
 </main>
}
createRoot(document.getElementById('root')!).render(<App/>);
if('serviceWorker' in navigator)void navigator.serviceWorker.register('/sw.js').catch(()=>{});
