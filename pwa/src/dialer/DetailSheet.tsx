import {useEffect,useRef,useState,type ReactNode} from 'react';
import {createPortal} from 'react-dom';
import {PhoneIcon,PhoneAvatar} from './PhoneIcon';
export function DetailSheet({name,subtitle,onClose,children,actions}:{name:string,subtitle?:string,onClose:()=>void,children:ReactNode,actions?:ReactNode}){
 const [leaving,setLeaving]=useState(false),[drag,setDrag]=useState(0);
 const timer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined),touch=useRef<{x:number,y:number}|null>(null);
 const scroller=useRef<HTMLElement>(null);
 useEffect(()=>()=>{if(timer.current)clearTimeout(timer.current)},[]);
 function close(){if(leaving)return;if(matchMedia('(prefers-reduced-motion: reduce)').matches){onClose();return}setLeaving(true);timer.current=setTimeout(onClose,230)}
 return createPortal(<section ref={scroller} className={'contact-sheet'+(leaving?' leaving':'')+(drag>0?' edge-dragging':'')} aria-label={name+'的详细信息'} style={{transform:drag?'translateX('+drag+'px)':undefined}}
  onPointerDown={e=>{if(e.clientX<28)touch.current={x:e.clientX,y:e.clientY}}}
  onPointerMove={e=>{const p=touch.current;if(!p)return;const dx=e.clientX-p.x;if(Math.abs(e.clientY-p.y)>24){touch.current=null;setDrag(0);return}if(dx>8)setDrag(Math.min(innerWidth,dx))}}
  onPointerUp={()=>{touch.current=null;if(drag>90)close();else setDrag(0)}} onPointerCancel={()=>{touch.current=null;setDrag(0)}}>
   <div className="poster-toolbar"><button className="glass-circle" aria-label="返回" onClick={close}><PhoneIcon name="back"/></button></div>
   <div className="poster-hero"><PhoneAvatar name={name} poster/><h1>{name}</h1>{subtitle&&<p>{subtitle}</p>}{actions&&<div className="poster-actions">{actions}</div>}</div>
   <div className="poster-content">{children}</div>
 </section>,document.body);
}
