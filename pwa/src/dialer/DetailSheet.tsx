import {useEffect,useLayoutEffect,useRef,useState,type ReactNode} from 'react';
import {createPortal} from 'react-dom';
import {PhoneIcon,PhoneAvatar} from './PhoneIcon';
import {detailBackIntent} from './detailGesture';
type SheetProps={
 name:string; subtitle?:string; onClose:()=>void; children:ReactNode; actions?:ReactNode;
 variant?:'contact'|'call'; photo?:string; toolbarAction?:ReactNode;
};
export function DetailSheet({name,subtitle,onClose,children,actions,variant='call',photo,toolbarAction}:SheetProps){
 const isContact=variant==='contact';
 const [leaving,setLeaving]=useState(false),[dragging,setDragging]=useState(false);
 const timer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined),frame=useRef<number|undefined>(undefined);
 const touch=useRef<{x:number,y:number,time:number,locked:boolean}|null>(null),offset=useRef(0),swallowed=useRef(false);
 const scroller=useRef<HTMLElement>(null);
 useEffect(()=>()=>{if(timer.current)clearTimeout(timer.current);if(frame.current!==undefined)cancelAnimationFrame(frame.current)},[]);
 useLayoutEffect(()=>{
  if(!isContact)return;
  const main=document.getElementById('phone-app');
  if(!main)return;
  const sheet=scroller.current;
  const trigger=document.activeElement instanceof HTMLElement?document.activeElement:null;
  const previous=main.inert;
  main.inert=true;
  sheet?.querySelector<HTMLButtonElement>('.poster-toolbar button')?.focus({preventScroll:true});
  return()=>{
   main.inert=previous;
   if(trigger?.isConnected && (sheet?.contains(document.activeElement)||document.activeElement===document.body))
    trigger.focus({preventScroll:true});
  };
 },[isContact]);
 function writeOffset(value:number){offset.current=value;if(frame.current!==undefined)return;frame.current=requestAnimationFrame(()=>{frame.current=undefined;if(scroller.current)scroller.current.style.transform=offset.current?'translateX('+offset.current+'px)':''})}
 function settle(){if(frame.current!==undefined)cancelAnimationFrame(frame.current);frame.current=undefined;offset.current=0;setDragging(false);if(scroller.current)scroller.current.style.transform=''}
 function close(){if(leaving)return;if(matchMedia('(prefers-reduced-motion: reduce)').matches){onClose();return}setLeaving(true);timer.current=setTimeout(onClose,230)}
 return createPortal(<section ref={scroller} className={'contact-sheet'+(isContact?' directory-poster':'')+(leaving?' leaving':'')+(dragging?' edge-dragging':'')} aria-label={name+'的详细信息'}
  onPointerDown={e=>{swallowed.current=false;if(leaving||e.button>0||(e.target as HTMLElement).closest('input,textarea,select,dialog,[contenteditable=true]'))return;touch.current={x:e.clientX,y:e.clientY,time:performance.now(),locked:false}}}
  onPointerMove={e=>{const p=touch.current;if(!p)return;const dx=e.clientX-p.x,dy=e.clientY-p.y;
   if(!p.locked&&(Math.abs(dy)>10&&Math.abs(dy)>Math.abs(dx)||dx < -12)){touch.current=null;settle();return}
   if(dx>6&&Math.abs(dx)>Math.abs(dy)*1.3){if(!p.locked){p.locked=true;setDragging(true);e.currentTarget.setPointerCapture(e.pointerId)}writeOffset(Math.min(innerWidth,dx))}
  }}
  onPointerUp={e=>{const p=touch.current;touch.current=null;if(!p?.locked)return;swallowed.current=true;
   if(detailBackIntent(e.clientX-p.x,e.clientY-p.y,performance.now()-p.time)){if(frame.current!==undefined)cancelAnimationFrame(frame.current);frame.current=undefined;if(scroller.current)scroller.current.style.transform='translateX('+offset.current+'px)';setDragging(false);close()}else settle()
  }}
  onPointerCancel={()=>{touch.current=null;settle()}}
  onClickCapture={e=>{if(swallowed.current){e.preventDefault();e.stopPropagation();swallowed.current=false}}}>
   <div className="poster-toolbar"><button className="glass-circle" aria-label="返回" onClick={close}><PhoneIcon name="back"/></button>{toolbarAction}</div>
   <div className="poster-hero"><PhoneAvatar name={name} photo={photo} poster silhouette={isContact}/><h1>{name}</h1>{subtitle&&<p>{subtitle}</p>}{actions&&<div className="poster-actions">{actions}</div>}</div>
   <div className="poster-content">{children}</div>
 </section>,isContact?(document.getElementById('root')||document.body):document.body);
}
