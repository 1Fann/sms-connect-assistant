import {useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {api,err,PhoneError,type Contact,type Device,type ContactSource} from './client';
import {PhoneAvatar,PhoneIcon} from './PhoneIcon';
import {formatPhone,identity} from '../phone';
import {primarySource,createAndroidContact,editAndroidContact,appendAndroidNumber,checkAndroidWrite,type AndroidWrite} from './androidContacts';

export function CallContactEditor({number='',mode,contact,devices,onClose,onSaved}:{number?:string,mode:'create'|'choose'|'edit',contact?:Contact,devices:Device[],onClose:()=>void,onSaved:(name:string)=>void}){
 const initial=contact?primarySource(contact):undefined;
 const [step,setStep]=useState<'create'|'choose'|'append'|'edit'>(mode),[name,setName]=useState(initial?.name||''),[phone,setPhone]=useState(number);
 const [numbers,setNumbers]=useState(initial?.numbers.join('\n')||''),[raw,setRaw]=useState(initial?.rawId||'');
 const writableDevices=devices.filter(d=>d.contactsWrite===true);
 const [device,setDevice]=useState(()=>writableDevices.length===1?writableDevices[0].deviceId:'');
 const [query,setQuery]=useState(''),[rows,setRows]=useState<Contact[]>([]),[next,setNext]=useState<number|null>(null),[offset,setOffset]=useState(0);
 const [selected,setSelected]=useState<Contact|null>(contact||null),[error,setError]=useState(''),[status,setStatus]=useState('');
 const [loading,setLoading]=useState(false),[busy,setBusy]=useState(false),[submitted,setSubmitted]=useState(false);
 const dialog=useRef<HTMLElement>(null),active=useRef(true),lock=useRef(false),intent=useRef<{key:string,id:string}|null>(null),pending=useRef<AndroidWrite|null>(null);
 useEffect(()=>{
  active.current=true;const previous=document.activeElement as HTMLElement|null;
  const background=[...document.querySelectorAll<HTMLElement>('#root,.contact-sheet')].map(element=>({element,inert:element.inert}));
  background.forEach(({element})=>{element.inert=true});dialog.current?.querySelector<HTMLButtonElement>('button')?.focus({preventScroll:true});
  return()=>{active.current=false;background.forEach(({element,inert})=>{element.inert=inert});if(previous?.isConnected)previous.focus({preventScroll:true})}
 },[]);
 useEffect(()=>{
  if(step!=='choose')return;let alive=true;setLoading(true);if(offset===0)setRows([]);
  const timer=setTimeout(()=>{api<{items:Contact[],next:number|null}>('contacts?q='+encodeURIComponent(query)+'&offset='+offset)
   .then(page=>{if(alive){setRows(old=>offset?[...old,...page.items]:page.items);setNext(page.next);setError('')}})
   .catch(e=>{if(alive)setError(err(e))}).finally(()=>{if(alive)setLoading(false)})},180);
  return()=>{alive=false;clearTimeout(timer)}
 },[step,query,offset]);
 const source=selected?.sources.find(s=>s.rawId===raw);
 const canWriteSource=!!source&&!source.readOnly&&devices.some(d=>d.deviceId===source.deviceId&&d.contactsWrite===true);
 const duplicate=selected?.numbers.some(n=>identity(n)===identity(number))===true,full=!!source&&source.numbers.length>=32;
 const values=step==='edit'?numbers.split('\n').map(n=>n.trim()).filter(Boolean):phone.trim()?[phone.trim()]:[];
 const valid=step==='create'?(!!device&&(!!name.trim()||values.length>0)):step==='edit'?canWriteSource&&(!!name.trim()||values.length>0):step==='append'?canWriteSource&&!duplicate&&!full:false;
 const validData=(step==='append'||name.length<=200&&!/[\u0000-\u001f\u007f]/.test(name))&&values.length<=32&&values.every(n=>n.length<=96&&!/[\u0000-\u001f\u007f]/.test(n));
 function sourceChange(value:string,card=selected){
  const s=card?.sources.find(s=>s.rawId===value);setRaw(value);setName(s?.name||'');setNumbers(s?.numbers.join('\n')||'');
 }
 function choose(card:Contact){setSelected(card);sourceChange(primarySource(card)?.rawId||'',card);setStep('append');setError('')}
 function back(){
  if(step==='append'&&!submitted){setOffset(0);setRows([]);setNext(null);setStep('choose');setError('');setSelected(null)}
  else onClose();
 }
 async function save(){
  if(lock.current||(!submitted&&(!valid||!validData))||step==='choose')return;
  lock.current=true;setBusy(true);setError('');setStatus('');
  try{
   if(!pending.current){
    const action=step==='create'?'create':'edit';
    const body=step==='create'?createAndroidContact(device,name,values):step==='append'?appendAndroidNumber(selected!,source!,number):
     editAndroidContact(selected!,source!,{name:name.trim(),numbers:values});
    const key=JSON.stringify([action,body]);if(intent.current?.key!==key)intent.current={key,id:crypto.randomUUID()};
    setSubmitted(true);
    pending.current=await api<AndroidWrite>('contacts/native/'+action,{...body,requestId:intent.current.id});
   }
   const done=await checkAndroidWrite(pending.current,()=>active.current,message=>{if(active.current)setStatus(message)});
   if(active.current){if(done)onSaved(step==='create'||step==='edit'?name.trim():selected!.name);else setStatus('已排队，等待安卓手机写入。可点「检查进度」继续查看；关闭页面不会撤回任务。')}
  }catch(e){
   if(active.current){
    if(e instanceof PhoneError&&[400,403,404,409,410].includes(e.status)&&!pending.current){setSubmitted(false);intent.current=null}
    setError(err(e)+(pending.current?'。请返回后核对安卓联系人和授权。':'。可重试；联系人已改变时请先重新读取。'));
   }
  }finally{lock.current=false;if(active.current)setBusy(false)}
 }
 async function reread(){
  if(!selected||busy||pending.current)return;
  try{const fresh=await api<Contact>('contacts/'+encodeURIComponent(selected.id));setSelected(fresh);sourceChange(primarySource(fresh)?.rawId||'',fresh);intent.current=null;setSubmitted(false);setError('');setStatus('已读取安卓联系人，请核对后保存。')}catch(e){setError(err(e))}
 }
 const title=step==='create'?'新建联系人':step==='choose'?'添加到现有联系人':step==='edit'?'编辑联系人':'添加电话号码';
 const sourcePicker=selected&&selected.sources.length>1&&<label>保存位置<select aria-label="联系人保存位置" disabled={busy||submitted} value={raw} onChange={e=>sourceChange(e.target.value)}>{selected.sources.map(s=><option key={s.rawId} value={s.rawId} disabled={s.readOnly}>{s.name||'未命名'} · {s.readOnly?'只读':'可编辑'}</option>)}</select><small>此联系人来自多个账号，仅修改所选来源，其他来源保留。</small></label>;
 return createPortal(<section ref={dialog} className="call-contact-editor" role="dialog" aria-modal="true" aria-label={title} onKeyDown={e=>{
  if(e.key!=='Tab')return;const items=[...e.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled)')];
  if(e.shiftKey&&document.activeElement===items[0]){e.preventDefault();items.at(-1)?.focus()}else if(!e.shiftKey&&document.activeElement===items.at(-1)){e.preventDefault();items[0]?.focus()}
 }}>
  <header className="phone-toolbar"><button disabled={busy} onClick={back}>{step==='append'||submitted?'返回':'取消'}</button><h1>{title}</h1>
   {step==='choose'?<span className="toolbar-spacer"/>:<button disabled={busy||!submitted&&(!valid||!validData)} onClick={()=>void save()}>{busy?'保存中…':pending.current?'检查进度':submitted?'重试':'完成'}</button>}</header>
  {step==='choose'?<>
   <p className="hint">选择安卓联系人，添加 {formatPhone(number)}。</p>
   <input className="contact-pick-search" type="search" aria-label="搜索现有联系人" placeholder="搜索姓名或号码" value={query} onChange={e=>{setQuery(e.target.value);setOffset(0)}}/>
   {rows.map(row=><button className="row contact-list-row" disabled={loading} key={row.id} onClick={()=>choose(row)}><PhoneAvatar name={row.name}/><span className="contact-list-name"><b>{row.name||'未命名'}</b><small className="contact-pick-number">{row.numbers.map(n=>formatPhone(n)).join('、')}</small></span><PhoneIcon name="plus" size={19}/></button>)}
   {!rows.length&&!loading&&<p className="hint">没有匹配的安卓联系人</p>}{loading&&<p role="status">正在读取联系人…</p>}{next!==null&&<button disabled={loading} className="load-more" onClick={()=>setOffset(next)}>载入更多</button>}
  </>:<>
   <div className="contact-editor-avatar"><PhoneAvatar name={step==='create'||step==='edit'?name:selected?.name}/></div>
   {step==='create'?<label>保存到安卓手机<select aria-label="保存到安卓手机" disabled={busy||submitted} value={device} onChange={e=>setDevice(e.target.value)}><option value="">选择手机</option>{writableDevices.map(d=><option key={d.deviceId} value={d.deviceId}>{d.name}{d.online?'':'（离线，等待连接）'}</option>)}</select></label>:sourcePicker}
   {step==='create'||step==='edit'?<><label>姓名<input aria-label="姓名" maxLength={200} readOnly={busy||submitted} value={name} onChange={e=>setName(e.target.value)}/></label>
    <label>{step==='edit'?'电话号码（每行一个）':'电话号码'}{step==='edit'?<textarea aria-label="联系人电话号码" rows={4} readOnly={busy||submitted} value={numbers} onChange={e=>setNumbers(e.target.value)}/>:<input aria-label="联系人电话号码" type="tel" maxLength={96} readOnly={busy||submitted} value={phone} onChange={e=>setPhone(e.target.value)}/>}</label></>:
    <><div className="card"><b>{selected?.name||'未命名'}</b>{selected?.numbers.map(n=><small key={n}>{formatPhone(n)}</small>)}</div><div className="card"><small>将添加的电话</small><b>{formatPhone(number)}</b></div>
     {duplicate&&<p role="status">此联系人已包含该号码</p>}{full&&<p role="alert">所选来源已有 32 个号码，请先整理。</p>}</>}
   <p className="hint">{step==='create'?'保存到所选安卓手机的系统通讯录。':'保存后会修改安卓手机系统通讯录。'}</p>
   {(step==='create'?!writableDevices.length:!canWriteSource)&&<p role="alert">请在目标安卓手机开启「通讯数据授权 → 允许远程编辑通讯录」。只读账号无法修改。</p>}
   {submitted&&<p className="hint">已提交或正在确认结果，关闭页面不会撤回已提交的任务。</p>}
   {!!error&&selected&&!pending.current&&<button disabled={busy} onClick={()=>void reread()}>重新读取联系人</button>}
  </>}
  {status&&<p role="status">{status}</p>}{error&&<p role="alert">{error}</p>}
 </section>,document.body);
}
