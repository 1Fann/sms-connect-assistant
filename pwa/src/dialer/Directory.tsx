import {useEffect,useMemo,useRef,useState,type PointerEvent} from 'react';
import {api,err,PhoneError,type Contact,type Device,type Line} from './client';
import {PhoneIcon,PhoneAvatar} from './PhoneIcon';
import {DirectoryCard} from './DirectoryCard';
import {formatPhone} from '../phone';
import {sectionContacts} from './contactSections';
import './contact-list.css';
import {CallContactEditor} from './CallContactEditor';
import {writableContact} from './androidContacts';

const directoryLetters = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ#'];
type ContactsPage={items:Contact[],next:number|null,version:string,syncError?:string};
type DirectoryList={key:string,rows:Contact[],pages:number,next:number|null,version:string,syncError:string};
type RefreshAction='check'|'reload'|'more';

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
 const [list,setList]=useState<DirectoryList|null>(null),[selected,setSelected]=useState<Contact|null>(null);
 const [editor,setEditor]=useState<'create'|'edit'|null>(null),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const cache=useRef<DirectoryList|null>(null),detailVersion=useRef(''),refresh=useRef<((action:RefreshAction)=>void)|null>(null);
 const query=searchQuery||'',key=JSON.stringify([favorites,query]),selectedId=selected?.id;
 const current=list?.key===key?list:null,rows=current?.rows??[],syncError=current?.syncError||'';
 const favoriteIntent=useRef<{key:string,id:string}|null>(null),lock=useRef(false);
 const [busy,setBusy]=useState(false);
 useEffect(()=>{
  if(editor)return;
  let active=true,running=false,pending:RefreshAction|null=null;
  const cached=()=>cache.current?.key===key?cache.current:null;
  const readPage=(offset:number)=>api<ContactsPage>('contacts?q='+encodeURIComponent(query)+'&offset='+offset+(favorites?'&favorite=true':''));

  async function readList(append:boolean){
   const previous=cached();
   if(append&&previous?.next==null)return;
   const targetDepth=(previous?.pages??1)+(append?1:0);
   let base=append?previous:null;
   let page=await readPage(base?.next??0);
   if(!active)return;
   // An insertion before the old cursor would otherwise skip a card or repeat one.
   if(base&&base.version!==page.version){base=null;page=await readPage(0)}
   const version=base?.version??page.version;
   const items=new Map(base?.rows.map(card=>[card.id,card]));
   let pages=base?.pages??0;
   while(active){
    for(const card of page.items)items.set(card.id,card);
    pages++;
    if(pages>=targetDepth||page.next===null)break;
    page=await readPage(page.next);
   }
   if(active){
    const result={key,rows:[...items.values()],pages,next:page.next,version,syncError:page.syncError||''};
    cache.current=result;setList(result);
   }
  }
  async function update(action:RefreshAction){
   if(selectedId){
    const {version}=await api<{version:string}>('contacts/version');
    if(!active||action==='check'&&detailVersion.current===version)return;
    const card=await api<Contact>('contacts/'+encodeURIComponent(selectedId));
    if(active){detailVersion.current=version;setSelected(card)}
   }else{
    if(action==='check'&&cached()?.version){
     const {version}=await api<{version:string}>('contacts/version');
     if(!active||cached()?.version===version)return;
    }
    if(active)await readList(action==='more');
   }
  }
  function request(action:RefreshAction){
   if(!active||document.hidden)return;
   if(running){if(action!=='check')pending=action;return}
   running=true;
   void update(action).then(()=>{if(active)setError('')}).catch(e=>{
    if(!active)return;
    if(e instanceof PhoneError&&(e.status===401||e.status===403||selectedId&&e.status===404)){
     cache.current=null;setList(null);setSelected(null);
    }
    setError(err(e));
   }).finally(()=>{
    running=false;
    if(pending){const action=pending;pending=null;request(action)}
   })
  }
  refresh.current=request;
  const check=()=>request('check');
  const initial=query&&!cached()&&!selectedId?window.setTimeout(check,150):undefined;
  if(initial===undefined)check();
  const interval=window.setInterval(check,3000);
  document.addEventListener('visibilitychange',check);
  window.addEventListener('pageshow',check);
  window.addEventListener('online',check);
  return ()=>{
   active=false;refresh.current=null;
   window.clearInterval(interval);window.clearTimeout(initial);
   document.removeEventListener('visibilitychange',check);
   window.removeEventListener('pageshow',check);
   window.removeEventListener('online',check);
  }
 },[editor,selectedId,key,query,favorites]);
 function invalidate(){
  if(cache.current)cache.current={...cache.current,version:''};
  detailVersion.current='';
 }
 async function favorite(){
  if(!selected||lock.current)return;lock.current=true;setBusy(true);setError('');
  const body={destination:'android',id:selected.id,revision:selected.revision,favorite:!selected.favorite};
  const key=JSON.stringify(body);if(favoriteIntent.current?.key!==key)favoriteIntent.current={key,id:crypto.randomUUID()};
  try{await api('contacts/native/favorite',{...body,requestId:favoriteIntent.current.id});favoriteIntent.current=null;setSelected(current=>current?.id===selected.id?{...current,favorite:!selected.favorite}:current);invalidate();refresh.current?.('reload')}
  catch(e){setError(err(e))}finally{lock.current=false;setBusy(false)}
 }
 const groups=useMemo(()=>sectionContacts(current?.rows??[]),[current]),canCreate=canEdit&&devices.some(d=>d.contactsWrite===true);
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
    {cards.map(card=><button className="row contact-list-row" key={card.id} onClick={()=>{detailVersion.current=current?.version||'';setSelected(card);setError('');setNotice('')}}>
     <PhoneAvatar name={card.name} photo={card.photo}/>
     <span className="contact-list-name">
      <b>{card.name||formatPhone(card.numbers[0]||'')||'未命名'}</b>
      {devices.length>1&&<small>{devices.find(d=>d.deviceId===card.deviceId)?.name||'安卓联系人'}</small>}
     </span>
    </button>)}
   </section>)}
  </div>
  {!selected&&!editor&&!query&&(groups.length>1||rows.length>8)&&<DirectoryIndex letters={groups.map(([letter])=>letter)}/>}
  {!current&&!error&&<p className="hint" role="status">正在读取安卓联系人…</p>}
  {current&&!rows.length&&!syncError&&!error&&<p className="hint">{favorites?'还没有收藏联系人':query?'没有匹配的安卓联系人':'安卓系统通讯录暂无联系人。请先在安卓手机添加或导入联系人，并开启「共享本机通讯录」，网页会自动同步。'}</p>}
  <div className="directory-paging">
   {current?.next!=null&&<button onClick={()=>refresh.current?.('more')}>载入更多</button>}
   <button onClick={()=>refresh.current?.('reload')}>刷新</button>
  </div>
  {selected&&<DirectoryCard key={selected.id} contact={selected} lines={lines} deviceName={devices.find(d=>d.deviceId===selected.deviceId)?.name} dial={dial}
   onClose={()=>{setSelected(null);setError('')}} onEdit={canEdit?()=>setEditor('edit'):undefined} writable={writableContact(selected,devices)}
   onFavorite={canEdit?favorite:undefined} busy={busy} error={error} notice={notice}/>}
  {editor&&<CallContactEditor mode={editor} contact={editor==='edit'?selected||undefined:undefined} devices={devices} onClose={()=>setEditor(null)} onSaved={()=>{invalidate();setEditor(null);setNotice('已写入安卓通讯录，列表将自动同步。')}}/>}
 </>;
}
