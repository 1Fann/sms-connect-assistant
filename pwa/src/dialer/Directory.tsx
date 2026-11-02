import {useEffect,useRef,useState,type PointerEvent} from 'react';
import {api,err,type Contact,type Device,type Line} from './client';
import {PhoneIcon,PhoneAvatar} from './PhoneIcon';
import {DirectoryCard} from './DirectoryCard';
import {formatPhone} from '../phone';
import {sectionContacts} from './contactSections';
import './contact-list.css';
import {CallContactEditor} from './CallContactEditor';
import {writableContact} from './androidContacts';

const directoryLetters = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ#'];

function DirectoryIndex({letters}: {letters: string[]}) {
 const lastSection = useRef('');

 function jumpTo(letter: string) {
  const section = document.getElementById('contact-section-' + letter);
  const pane = section?.closest('main');
  const toolbar = pane?.querySelector('.directory-toolbar');
  if (section && pane && toolbar) {
   pane.scrollTop += section.getBoundingClientRect().top - toolbar.getBoundingClientRect().bottom;
  }
 }

 function trackFinger(event: PointerEvent<HTMLElement>) {
  const {top, height} = event.currentTarget.getBoundingClientRect();
  const fraction = (event.clientY - top) / height;
  const index = Math.max(0, Math.min(directoryLetters.length - 1, Math.floor(fraction * directoryLetters.length)));
  const letter = letters.find(key => directoryLetters.indexOf(key) >= index) ?? letters[letters.length - 1];
  if (letter && lastSection.current !== letter) {
   lastSection.current = letter;
   jumpTo(letter);
  }
 }

 return <aside className="directory-index" aria-label="联系人索引"
  onPointerDown={event=>{
   if (!event.isPrimary || event.button !== 0) return;
   event.preventDefault();
   event.currentTarget.setPointerCapture(event.pointerId);
   lastSection.current = '';
   trackFinger(event);
  }}
  onPointerMove={event=>{
   if (event.currentTarget.hasPointerCapture(event.pointerId)) trackFinger(event);
  }}>
  {directoryLetters.map(letter => letters.includes(letter)
   ? <button key={letter} aria-label={'跳到 '+letter+' 分组'} onClick={event=>{if (event.detail === 0) jumpTo(letter)}}>{letter}</button>
   : <span aria-hidden="true" key={letter}>{letter}</span>)}
 </aside>;
}

export function Directory({devices,canEdit,favorites,dial,lines,searchQuery,settings,allContacts}:{devices:Device[],canEdit:boolean,favorites:boolean,dial:(n:string,id?:string)=>void,lines:Line[],searchQuery?:string,settings:()=>void,allContacts:()=>void}){
 const [rows,setRows]=useState<Contact[]>([]),[selected,setSelected]=useState<Contact|null>(null),[query,setQuery]=useState('');
 const [editor,setEditor]=useState<'create'|'edit'|null>(null),[syncError,setSyncError]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [next,setNext]=useState<number|null>(null),[offset,setOffset]=useState(0),[refresh,bump]=useState(0);
 const favoriteIntent=useRef<{key:string,id:string}|null>(null),lock=useRef(false);
 const [busy,setBusy]=useState(false);
 useEffect(()=>{setQuery(searchQuery||'');setOffset(0)},[searchQuery]);
 const reload=()=>{setOffset(0);bump(value=>value+1)};
 useEffect(()=>{
  let active=true;const timer=setTimeout(()=>{api<{items:Contact[],next:number|null,syncError?:string}>('contacts?q='+encodeURIComponent(query)+'&offset='+offset+(favorites?'&favorite=true':''))
   .then(page=>{if(active){setRows(previous=>offset?[...previous,...page.items]:page.items);setNext(page.next);setSyncError(page.syncError||'');setError('')}}).catch(e=>{if(active)setError(err(e))})},150);
  return()=>{active=false;clearTimeout(timer)}
 },[query,offset,refresh,favorites]);
 useEffect(()=>{if(editor)return;const timer=setInterval(()=>{if(!document.hidden&&offset===0)bump(v=>v+1)},15000);return()=>clearInterval(timer)},[editor,offset]);
 useEffect(()=>{
  if(!selected||editor)return;let alive=true;
  const timer=setInterval(()=>{if(!document.hidden)void api<Contact>('contacts/'+encodeURIComponent(selected.id)).then(row=>{if(alive)setSelected(row)}).catch(e=>{if(alive)setError(err(e))})},5000);
  return()=>{alive=false;clearInterval(timer)}
 },[selected?.id,editor]);
 async function favorite(){
  if(!selected||lock.current)return;lock.current=true;setBusy(true);setError('');
  const body={destination:'android',id:selected.id,revision:selected.revision,favorite:!selected.favorite};
  const key=JSON.stringify(body);if(favoriteIntent.current?.key!==key)favoriteIntent.current={key,id:crypto.randomUUID()};
  try{await api('contacts/native/favorite',{...body,requestId:favoriteIntent.current.id});favoriteIntent.current=null;setSelected(current=>current?.id===selected.id?{...current,favorite:!selected.favorite}:current);reload()}
  catch(e){setError(err(e))}finally{lock.current=false;setBusy(false)}
 }
 const groups=sectionContacts(rows),canCreate=canEdit&&devices.some(d=>d.contactsWrite===true);
 return <><header className="phone-toolbar directory-toolbar">
  <button className="glass-circle" aria-label={favorites?'返回联系人':'个人收藏'} onClick={allContacts}><PhoneIcon name="back"/></button>
  <h1>{favorites?'个人收藏':'联系人'}</h1>
  {canEdit
   ? <button className="glass-circle" disabled={!canCreate} aria-label="新建联系人" onClick={()=>{setSelected(null);setEditor('create')}}><PhoneIcon name="plus" size={26}/></button>
   : <button className="glass-circle" aria-label="互联设置" onClick={settings}><PhoneIcon name="settings"/></button>}
 </header>
  {notice&&<p role="status">{notice}</p>}{syncError&&<p role="alert">{syncError}</p>}{error&&<p role="alert">{error}</p>}
  <div className="contact-groups directory-groups">
   {groups.map(([letter,cards])=><section key={letter} id={'contact-section-'+letter}>
    <h2>{letter}</h2>
    {cards.map(card=><button className="row contact-list-row" key={card.id} onClick={()=>{setSelected(card);setError('');setNotice('')}}>
     <PhoneAvatar name={card.name} photo={card.photo}/>
     <span className="contact-list-name">
      <b>{card.name||formatPhone(card.numbers[0]||'')||'未命名'}</b>
      {devices.length>1&&<small>{devices.find(d=>d.deviceId===card.deviceId)?.name||'安卓联系人'}</small>}
     </span>
    </button>)}
   </section>)}
  </div>
  {!selected&&!editor&&!query&&(groups.length>1||rows.length>8)&&<DirectoryIndex letters={groups.map(([letter])=>letter)}/>}
  {!rows.length&&!syncError&&!error&&<p className="hint">{favorites?'还没有收藏联系人':query?'没有匹配的安卓联系人':'安卓系统通讯录暂无联系人。请先在安卓手机添加或导入联系人，并开启「共享本机通讯录」，网页会自动同步。'}</p>}
  <div className="directory-paging">
   {next!==null&&<button onClick={()=>setOffset(next)}>载入更多</button>}
   <button onClick={reload}>刷新</button>
  </div>
  {selected&&<DirectoryCard key={selected.id} contact={selected} lines={lines} deviceName={devices.find(d=>d.deviceId===selected.deviceId)?.name} dial={dial}
   onClose={()=>{setSelected(null);setError('')}} onEdit={canEdit?()=>setEditor('edit'):undefined} writable={writableContact(selected,devices)}
   onFavorite={canEdit?favorite:undefined} busy={busy} error={error} notice={notice}/>}
  {editor&&<CallContactEditor mode={editor} contact={editor==='edit'?selected||undefined:undefined} devices={devices} onClose={()=>setEditor(null)} onSaved={()=>{setEditor(null);setNotice('已写入安卓通讯录，列表将自动同步。');reload()}}/>}
 </>;
}
