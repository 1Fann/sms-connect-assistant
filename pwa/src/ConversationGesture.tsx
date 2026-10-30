import {useEffect,useRef,useState,type ReactNode} from 'react';
import {Icon,Avatar} from './Icons';
import {gesture} from './conversations';

// Lock the gesture only after a horizontal intention is clear; vertical scrolling
// cancels long-press and never activates a conversation action.
export function ConversationGesture({children,label,disabled=false,unread,onOpen,onMenu,onDelete,onRead,open,onSwipe}:{children:ReactNode,label:string,disabled?:boolean,unread:boolean,onOpen:()=>void,onMenu:()=>void,onDelete:()=>void,onRead:()=>void,open:boolean,onSwipe:(open:boolean)=>void}){
 const [offset,setOffset]=useState(0),[dragging,setDragging]=useState(false);
 const tracking=useRef<{x:number,y:number,start:number,mode:'horizontal'|'vertical'|null}|null>(null);
 const timer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined),suppress=useRef(false),distance=useRef(0);
 const clear=()=>{clearTimeout(timer.current);timer.current=undefined};
 useEffect(()=>()=>clear(),[]);
 useEffect(()=>{if(!open){setOffset(0);distance.current=0}},[open]);
 const reset=()=>{clear();tracking.current=null;setDragging(false)};
 return <div className={'swipe-row'+(dragging?' dragging':'')+(open?' revealed':'')}>
  <div className="swipe-actions"><button className="swipe-read" tabIndex={open&&offset>0?0:-1} aria-hidden={!(open&&offset>0)} aria-label={unread?'标为已读':'标为未读'} onClick={()=>{onSwipe(false);onRead()}}><Icon name="envelope"/><span>{unread?'已读':'未读'}</span></button><button className="swipe-delete" tabIndex={open&&offset<0?0:-1} aria-hidden={!(open&&offset<0)} aria-label={'删除'+label} onClick={()=>{onSwipe(false);onDelete()}}><Icon name="trash"/><span>删除</span></button></div>
  <button className="conversation" aria-label={label} style={{transform:`translateX(${offset}px)`}}
   onPointerDown={e=>{if(disabled||e.button!==0)return;clear();suppress.current=false;tracking.current={x:e.clientX,y:e.clientY,start:offset,mode:null};timer.current=setTimeout(()=>{suppress.current=true;tracking.current=null;setOffset(0);onSwipe(false);onMenu()},500)}}
   onPointerMove={e=>{const t=tracking.current;if(!t)return;const dx=e.clientX-t.x,dy=e.clientY-t.y;if(!t.mode)t.mode=gesture(dx,dy);if(t.mode){clear();suppress.current=true}if(t.mode==='vertical'){tracking.current=null;return}if(t.mode==='horizontal'){e.currentTarget.setPointerCapture(e.pointerId);setDragging(true);const x=Math.max(-92,Math.min(92,t.start+dx));distance.current=x;setOffset(x)}}}
   onPointerUp={()=>{const t=tracking.current;reset();if(t?.mode==='horizontal'){const x=distance.current;setOffset(Math.abs(x)>38?Math.sign(x)*82:0);onSwipe(Math.abs(x)>38)}}}
   onPointerCancel={()=>{reset();suppress.current=true;setOffset(0);onSwipe(false)}}
   onContextMenu={e=>{if(disabled)return;e.preventDefault();reset();suppress.current=true;setOffset(0);onSwipe(false);onMenu()}}
   onKeyDown={e=>{if(!disabled&&(e.key==='ContextMenu'||(e.shiftKey&&e.key==='F10'))){e.preventDefault();onMenu()}else if(e.key==='Escape'){setOffset(0);onSwipe(false)}}}
   onClick={e=>{if(suppress.current&&e.detail!==0){suppress.current=false;return}if(open){setOffset(0);onSwipe(false);return}onOpen()}}>{children}</button>
 </div>
}

export function Pinned({name,avatar,unread,onOpen,onMenu}:{name:string,avatar?:string,unread:boolean,onOpen:()=>void,onMenu:()=>void}){
 const timer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined),start=useRef<{x:number,y:number}|null>(null),suppressed=useRef(false);
 const cancel=()=>{clearTimeout(timer.current);start.current=null};
 useEffect(()=>()=>cancel(),[]);
 return <button className="pinned-conversation" aria-label={`${name}${unread?'，未读':''}，已置顶`} onPointerDown={e=>{if(e.button!==0)return;cancel();suppressed.current=false;start.current={x:e.clientX,y:e.clientY};timer.current=setTimeout(()=>{suppressed.current=true;onMenu()},500)}} onPointerMove={e=>{if(start.current&&Math.hypot(e.clientX-start.current.x,e.clientY-start.current.y)>10){suppressed.current=true;cancel()}}} onPointerUp={cancel} onPointerCancel={()=>{suppressed.current=true;cancel()}} onContextMenu={e=>{e.preventDefault();cancel();suppressed.current=true;onMenu()}} onKeyDown={e=>{if(e.key==='ContextMenu'||e.shiftKey&&e.key==='F10'){e.preventDefault();onMenu()}}} onClick={e=>{if(suppressed.current&&e.detail!==0){suppressed.current=false;return}onOpen()}}><span className="pinned-avatar"><Avatar name={avatar} large/>{unread&&<span className="pin-unread"/>}</span><span className="pinned-name">{name}</span></button>
}
