import {useEffect,useRef,useState,type CSSProperties} from 'react';
import {api,err,type Device,type CallRecord,type PbxCall} from './client';
import {formatPhone,identity} from '../phone';
import {PhoneIcon,PhoneAvatar} from './PhoneIcon';
import {DetailSheet} from './DetailSheet';
import {callSourceLabel} from './callSource';
type Row=CallRecord&{key:string,source:'android'|'pbx'};
const types:Record<string,string>={incoming:'呼入',outgoing:'呼出',missed:'未接来电',rejected:'已拒接',blocked:'已拦截',other:'通话'};
function dateLabel(value:number){
 const d=new Date(value),today=new Date(),yesterday=new Date();yesterday.setDate(today.getDate()-1);
 if(d.toDateString()===today.toDateString())return d.toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'});
 if(d.toDateString()===yesterday.toDateString())return '昨天';
 return d.toLocaleDateString('zh-CN',{month:'numeric',day:'numeric',...(d.getFullYear()===today.getFullYear()?{}:{year:'numeric'})});
}
function SwipeRow({row,device,editing,chosen,toggle,open,remove,dial,openKey,onOpened}:{row:Row,device:string,editing:boolean,chosen:boolean,toggle:()=>void,open:()=>void,remove:()=>void,dial:()=>void,openKey:string|null,onOpened:(key:string|null)=>void}){
 const [offset,setOffset]=useState(0),[moving,setMoving]=useState(false);
 const start=useRef<{x:number,y:number,offset:number}|null>(null),swiped=useRef(false);
 useEffect(()=>{if(openKey!==row.key)setOffset(0)},[openKey,row.key]);
 const [removed,setRemoved]=useState(false);
 const timer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
 useEffect(()=>()=>{if(timer.current)clearTimeout(timer.current)},[]);
 function drop(){if(removed)return;setRemoved(true);timer.current=setTimeout(remove,matchMedia('(prefers-reduced-motion: reduce)').matches?0:210)}
 return <div className={'call-swipe'+(removed?' removing':'')} style={{'--swipe':offset+'px'} as CSSProperties}>
  <div className="call-swipe-actions" inert={offset===0}><button aria-label="查看通话记录" onClick={open}><PhoneIcon name="clock"/></button><button className="delete-action" aria-label="移除此通话记录" onClick={drop}><PhoneIcon name="trash"/></button></div>
  <div className={'call-swipe-front'+(moving?' dragging':'')}
   onPointerDown={e=>{if(editing||e.button>0)return;start.current={x:e.clientX,y:e.clientY,offset};swiped.current=false}}
   onPointerMove={e=>{const s=start.current;if(!s)return;const dx=e.clientX-s.x,dy=e.clientY-s.y;if(!moving&&Math.abs(dy)>9&&Math.abs(dy)>Math.abs(dx)){start.current=null;return}if(Math.abs(dx)>10){if(!moving)onOpened(row.key);setMoving(true);swiped.current=true;setOffset(Math.max(-136,Math.min(0,s.offset+dx)));e.currentTarget.setPointerCapture(e.pointerId)}}}
   onPointerUp={()=>{if(start.current)setOffset(offset < -52?-136:0);start.current=null;setMoving(false)}}
   onPointerCancel={()=>{start.current=null;setMoving(false);setOffset(0)}}
   onClickCapture={e=>{if(swiped.current){e.preventDefault();e.stopPropagation();swiped.current=false}else if(offset){e.preventDefault();e.stopPropagation();setOffset(0);onOpened(null)}}}>
   {editing&&<button className={'record-select'+(chosen?' checked':'')} aria-label={chosen?'取消选择记录':'选择记录'} onClick={toggle}><PhoneIcon name={chosen?'check':'plus'} size={17}/></button>}
   <button className="call-row-main" onClick={editing?toggle:open}><PhoneAvatar name={row.name}/><span className="call-row-copy"><b className={row.type==='missed'?'missed':''}>{row.name||formatPhone(row.number)||'匿名来电'}</b><small><PhoneIcon name={row.type==='outgoing'?'arrow':'phone'} size={11}/>{device} · {types[row.type]||row.type}</small></span><time>{dateLabel(row.date)}</time></button>
   {!editing&&<button className="row-phone" aria-label="使用此号码拨号" disabled={!row.number} onClick={dial}><PhoneIcon name="phone" size={17}/></button>}
  </div>
 </div>;
}
export function Recent({devices,dial,installation,query,searching,settings,contacts}:{devices:Device[],dial:(n:string)=>void,installation:string,query:string,searching:boolean,settings:()=>void,contacts:()=>void}){
 const [mode,setMode]=useState<'all'|'missed'|'removed'>(location.hash==='#missed'?'missed':'all'),[filter,setFilter]=useState(''),[rows,setRows]=useState<CallRecord[]>([]),[pbx,setPbx]=useState<PbxCall[]>([]);
 const [next,setNext]=useState<number|null>(null),[offset,setOffset]=useState(0),[detail,setDetail]=useState<Row|null>(null),[history,setHistory]=useState(false),[error,setError]=useState(''),[reload,refresh]=useState(0);
 const [openKey,setOpenKey]=useState<string|null>(null);
 useEffect(()=>{const target=document.getElementById('phone-app'),close=()=>setOpenKey(null);target?.addEventListener('scroll',close,{passive:true});return()=>target?.removeEventListener('scroll',close)},[]);
 const [menu,setMenu]=useState(false),[editing,setEditing]=useState(false),[selected,setSelected]=useState<string[]>([]);
 const storage='phone.hidden-calls.'+installation;
 const [hidden,setHidden]=useState<string[]>(()=>{try{const r=JSON.parse(localStorage.getItem(storage)||'[]');return Array.isArray(r)?r.filter(v=>typeof v==='string'):[]}catch{return []}});
 function hiddenChange(ids:string[]){setHidden(ids);localStorage.setItem(storage,JSON.stringify(ids))}
 useEffect(()=>{let active=true;async function load(){
   try{const page=await api<{items:CallRecord[],next:number|null}>('call-history?offset='+offset+(filter?'&deviceId='+encodeURIComponent(filter):''));if(active){setRows(p=>offset?[...p,...page.items]:page.items);setNext(page.next);setError('')}}
   catch(e){if(active)setError(err(e))}
   try{const r=await api<PbxCall[]>('voice/history');if(active)setPbx(r)}catch{if(active)setPbx([])}
 }void load();return()=>{active=false}},[filter,offset,reload]);
 useEffect(()=>{const f=()=>{if(!document.hidden){setOffset(0);refresh(v=>v+1)}};document.addEventListener('visibilitychange',f);return()=>document.removeEventListener('visibilitychange',f)},[]);
 useEffect(()=>{const f=()=>{if(location.hash==='#missed')setMode('missed')};window.addEventListener('hashchange',f);return()=>window.removeEventListener('hashchange',f)},[]);
 const label=(id?:string)=>devices.find(d=>d.deviceId===id)?.name||'互联通话';
 const all:Row[]=[...rows.map(r=>({...r,key:'android:'+r.deviceId+':'+r.id,source:'android' as const})),...(!filter?pbx.map(c=>({id:c.id,key:'pbx:'+c.id,source:'pbx' as const,deviceId:c.device,slot:c.slot,number:c.number,date:c.created,duration:c.answeredAt?Math.max(0,Math.floor(((c.endedAt||Date.now())-c.answeredAt)/1000)):0,type:c.direction==='incoming'?(c.answeredAt||c.state!=='CALL_ENDED'?'incoming':'missed'):'outgoing'})):[])].sort((a,b)=>b.date-a.date);
 const sourceLabel=(row:Row)=>callSourceLabel(row,devices)+(row.source==='pbx'?' · 互联通话':'');
 const visible=all.filter(r=>(mode==='removed'?hidden.includes(r.key):!hidden.includes(r.key))&&(mode!=='missed'||r.type==='missed')&&(!query||(r.name||'').toLowerCase().includes(query.toLowerCase())||r.number.replace(/\s/g,'').includes(query.replace(/\s/g,''))));
 const title=mode==='removed'?'最近移除':mode==='missed'?'未接来电':'通话';
 const same=detail?all.filter(r=>detail.number?identity(r.number)===identity(detail.number):r.key===detail.key):[];
 function remove(ids:string[]){setHidden(old=>{const next=[...new Set([...old,...ids])];localStorage.setItem(storage,JSON.stringify(next));return next});setSelected([]);setEditing(false);setOpenKey(null)}
 return <><header className="phone-toolbar"><button className="glass-text" onClick={()=>{setEditing(!editing);setSelected([])}}>{editing?'完成':'编辑'}</button><h1>{title}</h1><button className={'glass-circle'+(menu?' selected':'')} aria-label="筛选通话" aria-expanded={menu} onClick={()=>setMenu(!menu)}><PhoneIcon name="filter"/></button></header>
 {menu&&<><button className="menu-dismiss" aria-label="关闭筛选" onClick={()=>setMenu(false)}/><div className="phone-menu" role="menu">
  <div className="menu-caption">显示通话</div>{([['all','calls','全部通话'],['missed','phone','未接来电'],['removed','trash','最近移除']] as const).map(([id,icon,text])=><button role="menuitem" key={id} onClick={()=>{setMode(id);setMenu(false);setEditing(false)}}><PhoneIcon name={icon} size={20}/>{text}{mode===id&&<PhoneIcon name="check" size={18}/>}</button>)}
  <div className="menu-caption">来源设备</div><button role="menuitem" onClick={()=>{setFilter('');setOffset(0);setMenu(false)}}>全部设备{!filter&&<PhoneIcon name="check" size={18}/>}</button>{devices.map(d=><button role="menuitem" key={d.deviceId} onClick={()=>{setFilter(d.deviceId);setOffset(0);setMenu(false)}}>{d.name}{filter===d.deviceId&&<PhoneIcon name="check" size={18}/>}</button>)}
  <div className="menu-divider"/><button role="menuitem" onClick={()=>{contacts();setMenu(false)}}><PhoneIcon name="person" size={20}/>个人收藏</button><button role="menuitem" onClick={()=>{setMenu(false);settings()}}><PhoneIcon name="settings" size={20}/>互联设置</button>
 </div></>}
 {searching&&<p className="search-scope">搜索已载入的通话记录</p>}
 {mode==='removed'&&<p className="section-note">仅从本设备的助手列表移除，安卓原始通话记录仍保留。</p>}
 {filter&&<p className="source-caption">{label(filter)}</p>}
 {error&&<p role="alert">{error}</p>}
 <div className="call-list">{visible.map(r=><SwipeRow key={r.key} row={r} openKey={openKey} onOpened={setOpenKey} device={sourceLabel(r)} editing={editing} chosen={selected.includes(r.key)} toggle={()=>setSelected(p=>p.includes(r.key)?p.filter(v=>v!==r.key):[...p,r.key])} open={()=>{setHistory(false);setDetail(r)}} remove={()=>remove([r.key])} dial={()=>dial(r.number)}/>)}</div>
 {!visible.length&&<div className="phone-empty"><PhoneIcon name={searching?'search':'calls'} size={46}/><h2>{query?'无结果':mode==='removed'?'没有已移除记录':'暂无通话'}</h2><p>{query?'请尝试其他姓名或号码':'共享安卓通话记录后会显示在这里'}</p></div>}
 {next!==null&&<button className="load-more" onClick={()=>setOffset(next)}>载入更多</button>}
 {editing&&selected.length>0&&<div className="selection-bar"><span>已选择 {selected.length} 项</span><button className="danger" onClick={()=>mode==='removed'?(hiddenChange(hidden.filter(id=>!selected.includes(id))),setSelected([]),setEditing(false)):remove(selected)}>{mode==='removed'?'恢复':'从助手移除'}</button></div>}
 {detail&&<DetailSheet name={detail.name||formatPhone(detail.number)||'匿名来电'} subtitle={sourceLabel(detail)} onClose={()=>{setDetail(null);setHistory(false)}} actions={<><button aria-label="拨打此号码" disabled={!detail.number} onClick={()=>{dial(detail.number);setDetail(null)}}><PhoneIcon name="phone"/></button><button aria-label="查看全部通话记录" onClick={()=>setHistory(true)}><PhoneIcon name="clock"/></button></>}>
  <button className="poster-row" onClick={()=>setHistory(!history)}><b>通话记录</b><PhoneIcon name="back" size={16}/></button>
  <div className="poster-card">{(history?same:[detail]).map(r=><div className="history-entry" key={r.key}><div><b>{types[r.type]||r.type}</b><small>{sourceLabel(r)}</small><small>{r.duration?Math.floor(r.duration/60)+' 分 '+r.duration%60+' 秒':r.type==='missed'?'未接听':'未记录时长'}</small></div><time>{new Date(r.date).toLocaleString('zh-CN')}</time></div>)}</div>
  {detail.number&&<button className="poster-card number-card" onClick={()=>{dial(detail.number);setDetail(null)}}><span><small>电话 · {sourceLabel(detail)}</small>{formatPhone(detail.number)}</span><PhoneIcon name="phone" size={20}/></button>}
  <button className="poster-row danger" onClick={()=>{if(mode==='removed')hiddenChange(hidden.filter(k=>k!==detail.key));else remove([detail.key]);setDetail(null)}}>{mode==='removed'?'恢复到通话列表':'从助手移除此记录'}</button>
  {history&&<button className="poster-row" onClick={()=>setHistory(false)}>收起通话记录</button>}
 </DetailSheet>}</>;
}
