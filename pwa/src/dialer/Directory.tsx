import {useEffect,useRef,useState} from 'react';
import {api,err,type Contact,type Device,type Line} from './client';
import {PhoneIcon,PhoneAvatar} from './PhoneIcon';
import {DetailSheet} from './DetailSheet';
import {formatPhone} from '../phone';
import {sectionContacts} from './contactSections';
import {CallContactEditor} from './CallContactEditor';
import {writableContact} from './androidContacts';

export function Directory({devices,canEdit,favorites,dial,lines,searchQuery,settings,allContacts}:{devices:Device[],canEdit:boolean,favorites:boolean,dial:(n:string,id?:string)=>void,lines:Line[],searchQuery?:string,settings:()=>void,allContacts:()=>void}){
 const [rows,setRows]=useState<Contact[]>([]),[selected,setSelected]=useState<Contact|null>(null),[query,setQuery]=useState('');
 const [editor,setEditor]=useState<'create'|'edit'|null>(null),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [next,setNext]=useState<number|null>(null),[offset,setOffset]=useState(0),[refresh,bump]=useState(0),[defaultLine,setDefaultLine]=useState('');
 const favoriteIntent=useRef<{key:string,id:string}|null>(null),lock=useRef(false);
 const [busy,setBusy]=useState(false);
 useEffect(()=>{setQuery(searchQuery||'');setOffset(0)},[searchQuery]);
 const reload=()=>{setOffset(0);bump(value=>value+1)};
 useEffect(()=>{
  let active=true;const timer=setTimeout(()=>{api<{items:Contact[],next:number|null}>('contacts?q='+encodeURIComponent(query)+'&offset='+offset+(favorites?'&favorite=true':''))
   .then(page=>{if(active){setRows(previous=>offset?[...previous,...page.items]:page.items);setNext(page.next);setError('')}}).catch(e=>{if(active)setError(err(e))})},150);
  return()=>{active=false;clearTimeout(timer)}
 },[query,offset,refresh,favorites]);
 useEffect(()=>{if(editor)return;const timer=setInterval(()=>{if(!document.hidden&&offset===0)bump(v=>v+1)},15000);return()=>clearInterval(timer)},[editor,offset]);
 useEffect(()=>{
  if(!selected||editor)return;let alive=true;
  setDefaultLine(localStorage.getItem('phone.line.'+selected.id)||'');
  const timer=setInterval(()=>{if(!document.hidden)void api<Contact>('contacts/'+encodeURIComponent(selected.id)).then(row=>{if(alive)setSelected(row)}).catch(e=>{if(alive)setError(err(e))})},5000);
  return()=>{alive=false;clearInterval(timer)}
 },[selected?.id,editor]);
 async function favorite(){
  if(!selected||lock.current)return;lock.current=true;setBusy(true);setError('');
  const body={destination:'android',id:selected.id,revision:selected.revision,favorite:!selected.favorite};
  const key=JSON.stringify(body);if(favoriteIntent.current?.key!==key)favoriteIntent.current={key,id:crypto.randomUUID()};
  try{await api('contacts/native/favorite',{...body,requestId:favoriteIntent.current.id});favoriteIntent.current=null;setSelected({...selected,favorite:!selected.favorite});reload()}
  catch(e){setError(err(e))}finally{lock.current=false;setBusy(false)}
 }
 const groups=sectionContacts(rows),canCreate=canEdit&&devices.some(d=>d.contactsWrite===true);
 return <><header className="phone-toolbar"><button className="glass-circle" aria-label={favorites?'返回联系人':'个人收藏'} onClick={allContacts}><PhoneIcon name="back"/></button><h1>{favorites?'个人收藏':'联系人'}</h1>{canEdit?<button className="glass-circle" disabled={!canCreate} aria-label="新建联系人" onClick={()=>{setSelected(null);setEditor('create')}}><PhoneIcon name="plus"/></button>:<button className="glass-circle" aria-label="互联设置" onClick={settings}><PhoneIcon name="settings"/></button>}</header>
  {notice&&<p role="status">{notice}</p>}{error&&<p role="alert">{error}</p>}
  <div className="contact-groups">{groups.map(([letter,cards])=><section key={letter} id={'contact-section-'+letter}><h2>{letter}</h2>{cards.map(card=><button className="row contact-list-row" key={card.id} onClick={()=>{setSelected(card);setError('')}}><PhoneAvatar name={card.name}/><span className="contact-list-name"><b>{card.name||formatPhone(card.numbers[0]||'')||'未命名'}</b>{devices.length>1&&<small>{devices.find(d=>d.deviceId===card.deviceId)?.name||'安卓联系人'}</small>}</span></button>)}</section>)}</div>
  {rows.length>8&&<aside className="contact-alphabet" aria-label="联系人索引">{groups.map(([letter])=><button key={letter} aria-label={'跳到 '+letter+' 分组'} onClick={()=>document.getElementById('contact-section-'+letter)?.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'start'})}>{letter}</button>)}</aside>}
  {!rows.length&&<p className="hint">{favorites?'还没有收藏联系人':query?'没有匹配的安卓联系人':'安卓系统通讯录暂无联系人。请先在安卓手机添加或导入联系人，并开启「共享本机通讯录」，网页会自动同步。'}</p>}
  {next!==null&&<button className="load-more" onClick={()=>setOffset(next)}>载入更多</button>}<button className="load-more" onClick={reload}>刷新</button>
  {selected&&<DetailSheet name={selected.name||'未命名'} subtitle={devices.find(d=>d.deviceId===selected.deviceId)?.name||'安卓联系人'} onClose={()=>{setSelected(null);setError('')}} actions={<><button aria-label="拨打联系人" disabled={!selected.numbers.length} onClick={()=>dial(selected.numbers[0],defaultLine)}><PhoneIcon name="phone"/></button>{canEdit&&<button aria-label="编辑联系人" disabled={!writableContact(selected,devices)} onClick={()=>setEditor('edit')}><PhoneIcon name="person"/></button>}</>}>
   {selected.numbers.map(n=><button className="row" key={n} onClick={()=>dial(n,defaultLine)}>{formatPhone(n)}<span>拨号 ›</span></button>)}
   <label>首选拨出线路<select value={defaultLine} onChange={e=>{setDefaultLine(e.target.value);localStorage.setItem('phone.line.'+selected.id,e.target.value)}}><option value="">每次选择</option>{lines.map(line=><option key={line.lineId} value={line.lineId}>{line.name}</option>)}</select></label>
   {canEdit&&<div className="controls"><button disabled={!writableContact(selected,devices)} onClick={()=>setEditor('edit')}>编辑</button><button disabled={busy} onClick={()=>void favorite()}>{selected.favorite?'移出收藏':'加入收藏'}</button></div>}
   <p className="hint">来自安卓系统通讯录，网页编辑会写回手机。</p>
   {!writableContact(selected,devices)&&<p className="hint">此联系人只读，或手机尚未开启远程编辑。</p>}
   {error&&<p role="alert">{error}</p>}
  </DetailSheet>}
  {editor&&<CallContactEditor mode={editor} contact={editor==='edit'?selected||undefined:undefined} devices={devices} onClose={()=>setEditor(null)} onSaved={()=>{setEditor(null);setSelected(null);setNotice('已写入安卓通讯录，列表将自动同步。');reload()}}/>}
 </>;
}
