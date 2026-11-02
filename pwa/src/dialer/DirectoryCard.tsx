import {useLayoutEffect,useMemo,useRef,useState} from 'react';
import {messagesComposeLink} from '../composeLink';
import {formatPhone} from '../phone';
import type {Contact,Line} from './client';
import {DetailSheet} from './DetailSheet';
import {PhoneIcon} from './PhoneIcon';
import './contact-poster.css';

type Props={
 contact:Contact; lines:Line[]; deviceName?:string;
 dial:(number:string,line?:string)=>void; onClose:()=>void; onEdit?:()=>void;
 writable:boolean; onFavorite?:()=>void; busy:boolean; error:string; notice:string;
};

export function DirectoryCard({contact,lines,deviceName,dial,onClose,onEdit,writable,onFavorite,busy,error,notice}:Props){
 const lineKey='phone.line.'+contact.id;
 const [preferred,setPreferred]=useState(()=>localStorage.getItem(lineKey)||'');
 const [picker,setPicker]=useState<'sms'|'call'|null>(null);
 const [shareError,setShareError]=useState('');
 const [sharing,setSharing]=useState(false);
 const shareInFlight=useRef(false);
 const dialog=useRef<HTMLDialogElement>(null);
 const phones=useMemo(()=>contact.numbers.map(raw=>{
  const number=raw.replace(/[\s().-]/g,'');
  const sms=messagesComposeLink(number,location.origin);
  return {raw,number,sms,display:formatPhone(raw),dialable:/^\+?\d{1,24}$/.test(number)};
 }),[contact.numbers]);
 const shareData=useMemo(()=>({text:[contact.name,...phones.map(phone=>phone.display)].filter(Boolean).join('\n')}),[contact.name,phones]);
 const smsNumbers=phones.filter(phone=>phone.sms);
 const callNumbers=phones.filter(phone=>phone.dialable);
 useLayoutEffect(()=>{
  if(picker&&dialog.current&&!dialog.current.open)dialog.current.showModal();
 },[picker]);
 function chooseCall(){
  if(callNumbers.length===1)dial(callNumbers[0].number,preferred);
  else if(callNumbers.length)setPicker('call');
 }
 async function share(){
  if(shareInFlight.current)return;
  shareInFlight.current=true;
  setShareError('');
  try{
   // Keep transient user activation: hand the prepared payload to iOS in this click.
   const pending=navigator.share(shareData);
   setSharing(true);
   await pending;
  }catch(reason){
   if(!(reason instanceof DOMException&&reason.name==='AbortError'))setShareError('共享未完成，可再次点按共享。');
  }finally{
   shareInFlight.current=false;
   setSharing(false);
  }
 }
 const toolbarAction=onEdit&&<button className="directory-edit-pill" onClick={onEdit} disabled={!writable}>编辑</button>;
 return <DetailSheet variant="contact" name={contact.name||phones[0]?.display||'未命名'} photo={contact.photo}
  onClose={onClose} toolbarAction={toolbarAction}
  actions={<>
   {smsNumbers.length===1?<a role="button" aria-label="给联系人发短信" href={smsNumbers[0].sms}><PhoneIcon name="message"/></a>:
    <button aria-label="给联系人发短信" disabled={!smsNumbers.length} onClick={()=>setPicker('sms')}><PhoneIcon name="message"/></button>}
   <button aria-label="拨打联系人" disabled={!callNumbers.length} onClick={chooseCall}><PhoneIcon name="phone"/></button>
  </>}>
  {phones.length>0&&<div className="directory-panel">{phones.map(phone=><button className="directory-phone-row" key={phone.raw}
   disabled={!phone.dialable} onClick={()=>dial(phone.number,preferred)}>
   <span><small>电话</small><b>{phone.display}</b></span><PhoneIcon name="phone" size={16}/>
  </button>)}</div>}
  <div className="directory-panel"><label className="directory-line">
   <span>首选拨出线路</span>
   <select aria-label="首选拨出线路" value={preferred} onChange={e=>{setPreferred(e.target.value);localStorage.setItem(lineKey,e.target.value)}}>
    <option value="">每次选择</option>{preferred&&!lines.some(line=>line.lineId===preferred)&&<option value={preferred} disabled>原线路不可用</option>}
    {lines.map(line=><option key={line.lineId} value={line.lineId}>{line.name}</option>)}
   </select>
  </label></div>
  {(typeof navigator.share==='function'||onFavorite)&&<div className="directory-panel directory-card-actions">
   {typeof navigator.share==='function'&&<button aria-label="共享姓名和号码" aria-busy={sharing} disabled={sharing} onClick={()=>void share()}>{sharing?'正在共享…':'共享姓名和号码'}</button>}
   {onFavorite&&<button disabled={busy} onClick={onFavorite}>{contact.favorite?'从个人收藏移除':'添加到个人收藏'}</button>}
  </div>}
  <p className="directory-provenance">{deviceName?deviceName+' · 安卓通讯录':'安卓通讯录'}{!writable?' · 只读':''}</p>
  {notice&&<p role="status">{notice}</p>}{(error||shareError)&&<p role="alert">{error||shareError}</p>}
  {picker&&<dialog className="directory-number-picker" ref={dialog} aria-label={picker==='sms'?'选择短信号码':'选择拨号号码'}
   onClick={e=>{if(e.target===dialog.current)dialog.current?.close()}} onClose={()=>setPicker(null)}>
   <div className="directory-picker-body">
    <h2>{picker==='sms'?'选择短信号码':'选择拨号号码'}</h2>
    {(picker==='sms'?smsNumbers:callNumbers).map(phone=>picker==='sms'?
     <a key={phone.raw} href={phone.sms} onClick={()=>dialog.current?.close()}>{phone.display}</a>:
     <button key={phone.raw} onClick={()=>{dialog.current?.close();dial(phone.number,preferred)}}>{phone.display}</button>)}
    <button className="directory-picker-cancel" onClick={()=>dialog.current?.close()}>取消</button>
   </div>
  </dialog>}
 </DetailSheet>;
}
