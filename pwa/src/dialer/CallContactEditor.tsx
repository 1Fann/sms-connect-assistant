import {useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {api,err,type Contact} from './client';
import {PhoneAvatar,PhoneIcon} from './PhoneIcon';
import {formatPhone,identity} from '../phone';

export function CallContactEditor({number,mode,onClose,onSaved}:{number:string,mode:'create'|'choose',onClose:()=>void,onSaved:(name:string)=>void}){
 const [step,setStep]=useState<'create'|'choose'|'append'>(mode),[name,setName]=useState(''),[phone,setPhone]=useState(number);
 const [query,setQuery]=useState(''),[rows,setRows]=useState<Contact[]>([]),[next,setNext]=useState<number|null>(null),[offset,setOffset]=useState(0);
 const [selected,setSelected]=useState<Contact|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(false),[busy,setBusy]=useState(false);
 const dialog=useRef<HTMLElement>(null),active=useRef(true),lock=useRef(false),intent=useRef<{key:string,id:string}|null>(null);
 useEffect(()=>{
  active.current=true;
  const previous=document.activeElement as HTMLElement|null;
  const background=[...document.querySelectorAll<HTMLElement>('#root,.contact-sheet')].map(element=>({element,inert:element.inert}));
  background.forEach(({element})=>{element.inert=true});
  dialog.current?.querySelector<HTMLButtonElement>('button')?.focus({preventScroll:true});
  return()=>{active.current=false;background.forEach(({element,inert})=>{element.inert=inert});if(previous?.isConnected)previous.focus({preventScroll:true})}
 },[]);
 useEffect(()=>{
  if(step!=='choose')return;
  let alive=true;setLoading(true);if(offset===0)setRows([]);
  const timer=setTimeout(()=>{api<{items:Contact[],next:number|null}>('contacts?q='+encodeURIComponent(query)+'&offset='+offset)
   .then(page=>{if(alive){setRows(old=>offset?[...old,...page.items]:page.items);setNext(page.next);setError('')}})
   .catch(e=>{if(alive)setError(err(e))}).finally(()=>{if(alive)setLoading(false)})},180);
  return()=>{alive=false;clearTimeout(timer)}
 },[step,query,offset]);
 const validPhone=phone.trim().length>0&&phone.trim().length<=96&&/\d/.test(phone)&&!/[\u0000-\u001f\u007f]/.test(phone);
 const duplicate=selected?.numbers.some(n=>identity(n)===identity(number))===true;
 const full=!!selected&&selected.numbers.length>=32;
 async function save(){
  if(lock.current||!validPhone||step==='choose'||step==='append'&&(!selected||duplicate||full))return;
  const action=step==='create'?'create':'edit';
  const body=step==='create'?{name:name.trim(),numbers:[phone.trim()],targets:[]}:
   {id:selected!.id,revision:selected!.revision,numbers:[...selected!.numbers,number],targets:[]};
  const key=JSON.stringify([action,body]);if(intent.current?.key!==key)intent.current={key,id:crypto.randomUUID()};
  lock.current=true;setBusy(true);setError('');
  try{await api('contacts/'+action,{...body,requestId:intent.current.id});if(active.current)onSaved(step==='create'?name.trim():selected!.name)}
  catch(e){if(active.current)setError(err(e)+'。可重试；若联系人已变更，请返回列表重新选择。')}
  finally{lock.current=false;if(active.current)setBusy(false)}
 }
 const title=step==='create'?'新建联系人':step==='choose'?'添加到现有联系人':'添加电话号码';
 return createPortal(<section ref={dialog} className="call-contact-editor" onKeyDown={e=>{
  if(e.key!=='Tab')return;
  const items=[...e.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),[tabindex="0"]')];
  const first=items[0],last=items.at(-1);
  if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus()}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus()}
 }} role="dialog" aria-modal="true" aria-label={title}>
  <header className="phone-toolbar"><button disabled={busy} onClick={()=>{if(step==='append'){setOffset(0);setRows([]);setNext(null);setStep('choose');setError('');setSelected(null)}else onClose()}}>{step==='append'?'返回':'取消'}</button><h1>{title}</h1>
   {step==='choose'?<span className="toolbar-spacer"/>:<button disabled={busy||!validPhone||step==='append'&&(duplicate||full)} onClick={()=>void save()}>{busy?'保存中…':'完成'}</button>}</header>
  {step==='choose'?<>
   <p className="hint">选择联系人，将 {formatPhone(number)} 添加到助手名片。</p>
   <input className="contact-pick-search" type="search" aria-label="搜索现有联系人" placeholder="搜索姓名或号码" value={query} onChange={e=>{setQuery(e.target.value);setOffset(0)}}/>
   {rows.map(row=><button className="row contact-list-row" disabled={loading} key={row.id} onClick={()=>{setSelected(row);setStep('append');setError('')}}><PhoneAvatar name={row.name}/><span className="contact-list-name"><b>{row.name||'未命名'}</b><small className="contact-pick-number">{row.numbers.map(n=>formatPhone(n)).join('、')}</small></span><PhoneIcon name="plus" size={19}/></button>)}
   {!rows.length&&!loading&&<p className="hint">没有匹配的联系人</p>}
   {loading&&<p role="status">正在读取联系人…</p>}{next!==null&&<button disabled={loading} className="load-more" onClick={()=>setOffset(next)}>载入更多</button>}
  </>:<>
   <div className="contact-editor-avatar"><PhoneAvatar name={step==='create'?name:selected?.name}/></div>
   {step==='create'?<><label>姓名或备注<input aria-label="姓名或备注" maxLength={200} readOnly={busy} autoComplete="off" value={name} onChange={e=>setName(e.target.value)}/></label>
    <label>电话号码<input aria-label="联系人电话号码" type="tel" maxLength={96} readOnly={busy} autoComplete="off" value={phone} onChange={e=>setPhone(e.target.value)}/></label></>:
    <><div className="card"><b>{selected?.name||'未命名'}</b>{selected?.numbers.map(n=><small key={n}>{formatPhone(n)}</small>)}</div><div className="card"><small>将添加的电话</small><b>{formatPhone(number)}</b></div>
     {duplicate&&<p role="status">此联系人已包含该号码</p>}{full&&<p role="alert">此联系人已有 32 个号码，请先在联系人详情中整理。</p>}</>}
   <p className="hint">仅保存到助手通讯录，不写入手机系统通讯录。</p>
  </>}
  {error&&<p role="alert">{error}</p>}
 </section>,document.body);
}
