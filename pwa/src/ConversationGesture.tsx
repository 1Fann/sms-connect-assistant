import {useEffect,useLayoutEffect,useRef,useState,type ReactNode} from 'react';
import {Icon,Avatar} from './Icons';
import {gesture} from './conversations';
import {SpringMotion,rubberBand} from './gestureMotion';

const TRAILING=136,LEADING=76;
type Tracking={id:number,x:number,y:number,origin:number,width:number,mode:'horizontal'|'vertical'|null};

export function ConversationGesture({children,label,disabled=false,unread,muted=false,selected,onOpen,onMenu,onDelete,onRead,onMute,open,onSwipe}:{children:ReactNode,label:string,disabled?:boolean,unread:boolean,muted?:boolean,selected?:boolean,onOpen:()=>void,onMenu:(anchor:DOMRect)=>void,onDelete:()=>void,onRead:()=>void,onMute:()=>void,open:boolean,onSwipe:(open:boolean)=>void}){
 const root=useRef<HTMLDivElement>(null),surface=useRef<HTMLButtonElement>(null),motion=useRef<SpringMotion|null>(null);
 const [side,setSide]=useState<'leading'|'trailing'|null>(null);
 const tracking=useRef<Tracking|null>(null),timer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined),suppress=useRef(false);
 const clear=()=>{clearTimeout(timer.current);timer.current=undefined;root.current?.classList.remove('pressing')};
 const controller=()=>{
  if(!motion.current)motion.current=new SpringMotion(x=>{
   if(!root.current||!surface.current)return;
   surface.current.style.transform=`translate3d(${x}px,0,0)`;
   root.current.style.setProperty('--swipe-x',`${x}px`);
   root.current.style.setProperty('--swipe-distance',`${Math.max(LEADING,x)}px`);
   root.current.style.setProperty('--swipe-reveal',`${Math.min(1,Math.abs(x)/(x<0?TRAILING:LEADING))}`);
   root.current.dataset.swipeSide=x<-.1?'trailing':x>.1?'leading':'';
  });
  return motion.current;
 };
 useLayoutEffect(()=>{controller().jumpTo(0);return()=>{clear();motion.current?.destroy();motion.current=null}},[]);
 useEffect(()=>{if(!open){setSide(null);controller().springTo(0)}},[open]);
 const reset=()=>{clear();tracking.current=null;root.current?.classList.remove('dragging')};
 useEffect(()=>{if(disabled){reset();suppress.current=false;setSide(null);controller().springTo(0);if(open)onSwipe(false)}},[disabled]);
 const menu=()=>{const anchor=root.current?.getBoundingClientRect();reset();suppress.current=true;controller().springTo(0);onSwipe(false);if(anchor)onMenu(anchor)};
 const close=()=>{setSide(null);controller().springTo(0);onSwipe(false)};
 return <div ref={root} className={'swipe-row'+(open?' revealed':'')}>
  <div className="swipe-actions"><button className="swipe-read" tabIndex={open&&side==='leading'?0:-1} aria-hidden={!(open&&side==='leading')} aria-label={unread?'标为已读':'标为未读'} onClick={()=>{close();onRead()}}><Icon name="envelope"/><span>{unread?'已读':'未读'}</span></button><div className="swipe-trailing"><button className="swipe-mute" tabIndex={open&&side==='trailing'?0:-1} aria-hidden={!(open&&side==='trailing')} aria-label={muted?'显示提醒':'隐藏提醒'} onClick={()=>{close();onMute()}}><Icon name={muted?'bell':'bell-off'}/><span>{muted?'显示提醒':'隐藏提醒'}</span></button><button className="swipe-delete" tabIndex={open&&side==='trailing'?0:-1} aria-hidden={!(open&&side==='trailing')} aria-label={'删除'+label} onClick={()=>{close();onDelete()}}><Icon name="trash"/><span>删除</span></button></div></div>
  <button ref={surface} className="conversation" aria-label={label} aria-pressed={selected}
   onPointerDown={e=>{if(e.button!==0)return;clear();suppress.current=false;if(disabled)return;const m=controller();m.interrupt();tracking.current={id:e.pointerId,x:e.clientX,y:e.clientY,origin:m.position,width:e.currentTarget.getBoundingClientRect().width,mode:null};root.current?.classList.add('pressing');timer.current=setTimeout(menu,480)}}
   onPointerMove={e=>{const t=tracking.current;if(!t||t.id!==e.pointerId)return;const dx=e.clientX-t.x,dy=e.clientY-t.y;if(!t.mode)t.mode=gesture(dx,dy);if(t.mode){clear();suppress.current=true}if(t.mode==='vertical'){reset();controller().springTo(open?(side==='trailing'?-TRAILING:LEADING):0);return}if(t.mode==='horizontal'){if(!e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.setPointerCapture(e.pointerId);root.current?.classList.add('dragging');const raw=t.origin+dx;const x=raw < -TRAILING ? -TRAILING-rubberBand(-raw-TRAILING,80) : Math.min(t.width*.85,raw);controller().dragTo(x,e.timeStamp)}}}
   onPointerUp={()=>{const t=tracking.current;reset();if(t?.mode==='horizontal'){const m=controller(),x=m.position;if(x>t.width*.55){setSide(null);m.springTo(0);onSwipe(false);onRead()}else{const projected=x+m.velocity*.08,next=x<0?'trailing':'leading';const reveal=next==='trailing'?projected < -32:projected>32;setSide(reveal?next:null);m.springTo(reveal?(next==='trailing'?-TRAILING:LEADING):0);onSwipe(reveal)}}else if(t){controller().springTo(open?(side==='trailing'?-TRAILING:LEADING):0)}}}
   onPointerCancel={()=>{reset();suppress.current=true;close()}}
   onContextMenu={e=>{e.preventDefault();if(!disabled)menu()}}
   onKeyDown={e=>{if(!disabled&&(e.key==='ContextMenu'||e.shiftKey&&e.key==='F10')){e.preventDefault();menu()}else if(e.key==='Escape')close()}}
   onClick={e=>{if(suppress.current&&e.detail!==0){suppress.current=false;return}if(disabled){onOpen();return}if(open||Math.abs(controller().position)>1){close();return}onOpen()}}>{children}</button>
 </div>
}

export function Pinned({name,avatar,unread,muted=false,onOpen,onMenu}:{name:string,avatar?:string,unread:boolean,muted?:boolean,onOpen:()=>void,onMenu:(anchor:DOMRect)=>void}){
 const element=useRef<HTMLButtonElement>(null),timer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined),start=useRef<{x:number,y:number}|null>(null),suppressed=useRef(false);
 const cancel=()=>{clearTimeout(timer.current);start.current=null;element.current?.classList.remove('pressing')};
 const menu=()=>{cancel();suppressed.current=true;const anchor=element.current?.getBoundingClientRect();if(anchor)onMenu(anchor)};
 useEffect(()=>()=>cancel(),[]);
 return <button ref={element} className="pinned-conversation" aria-label={`${name}${unread?'，未读':''}，已置顶${muted?'，已隐藏提醒':''}`} onPointerDown={e=>{if(e.button!==0)return;cancel();suppressed.current=false;start.current={x:e.clientX,y:e.clientY};element.current?.classList.add('pressing');timer.current=setTimeout(menu,480)}} onPointerMove={e=>{if(start.current&&Math.hypot(e.clientX-start.current.x,e.clientY-start.current.y)>10){suppressed.current=true;cancel()}}} onPointerUp={cancel} onPointerCancel={()=>{suppressed.current=true;cancel()}} onContextMenu={e=>{e.preventDefault();menu()}} onKeyDown={e=>{if(e.key==='ContextMenu'||e.shiftKey&&e.key==='F10'){e.preventDefault();menu()}}} onClick={e=>{if(suppressed.current&&e.detail!==0){suppressed.current=false;return}onOpen()}}><span className="pinned-avatar"><Avatar name={avatar} large/>{unread&&<span className="pin-unread"/>}</span><span className="pinned-name">{name}{muted&&<Icon name="bell-off" size={12}/>}</span></button>
}
