import {useEffect,useRef} from 'react';
import {gesture} from './conversations';
import {SpringMotion} from './gestureMotion';

type TimeSurface={motion:SpringMotion,owner:symbol|null};
const surfaces=new WeakMap<HTMLElement,TimeSurface>();
function timeSurface(container:HTMLElement):TimeSurface{
 let surface=surfaces.get(container);if(surface)return surface;
 let visible=false;
 const motion=new SpringMotion(value=>{
  if(!container.isConnected){motion.destroy();return}
  const x=Math.max(0,value),show=x>.1;
  container.style.setProperty('--time-drag',`${x}px`);
  container.style.setProperty('--time-opacity',`${Math.min(1,x/70)}`);
  container.classList.toggle('showing-times',show);
  if(show!==visible){visible=show;container.querySelectorAll('.drag-time').forEach(el=>el.setAttribute('aria-hidden',String(!show)))}
 });
 surface={motion,owner:null};surfaces.set(container,surface);return surface;
}

export function MessageBubble({body,tail,expanded,onDetails,onMenu}:{body:string,tail:boolean,expanded:boolean,onDetails:()=>void,onMenu:(anchor:DOMRect)=>void,onTimeDrag?:(distance:number)=>void}){
 const element=useRef<HTMLParagraphElement>(null),owner=useRef(Symbol('time-gesture')),surface=useRef<TimeSurface|null>(null);
 const timer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined),start=useRef<{id:number,x:number,y:number,origin:number,mode:'horizontal'|'vertical'|null}|null>(null),suppress=useRef(false);
 const cancel=()=>{clearTimeout(timer.current);start.current=null;element.current?.classList.remove('pressing')};
 const release=()=>{if(surface.current?.owner===owner.current){surface.current.owner=null;surface.current.motion.springTo(0)}};
 const menu=()=>{cancel();release();suppress.current=true;const anchor=element.current?.getBoundingClientRect();if(anchor)onMenu(anchor)};
 useEffect(()=>()=>{cancel();release()},[]);
 return <p ref={element} className={'bubble'+(tail?' tail':'')} tabIndex={0} role="button" aria-expanded={expanded} title="轻点查看详情，长按拷贝或转发，向左拖动查看时间"
  onPointerDown={e=>{if(e.button!==0)return;cancel();suppress.current=false;const container=e.currentTarget.closest<HTMLElement>('.messages');if(container){surface.current=timeSurface(container);surface.current.motion.interrupt();surface.current.owner=owner.current}start.current={id:e.pointerId,x:e.clientX,y:e.clientY,origin:surface.current?.motion.position||0,mode:null};element.current?.classList.add('pressing');timer.current=setTimeout(menu,480)}}
  onPointerMove={e=>{const t=start.current;if(!t||t.id!==e.pointerId)return;const dx=e.clientX-t.x,dy=e.clientY-t.y;t.mode=t.mode||gesture(dx,dy);if(t.mode){clearTimeout(timer.current);element.current?.classList.remove('pressing');suppress.current=true}if(t.mode==='vertical'){cancel();release();return}if(t.mode==='horizontal'&&surface.current?.owner===owner.current){if(!e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.setPointerCapture(e.pointerId);surface.current.motion.dragTo(Math.max(0,Math.min(70,t.origin-dx)),e.timeStamp)}}}
  onPointerUp={()=>{cancel();release()}} onPointerCancel={()=>{suppress.current=true;cancel();release()}}
  onContextMenu={e=>{e.preventDefault();menu()}}
  onClick={e=>{if(suppress.current&&e.detail!==0){suppress.current=false;return}onDetails()}}
  onKeyDown={e=>{if(e.key==='ContextMenu'||e.shiftKey&&e.key==='F10'){e.preventDefault();onMenu(element.current!.getBoundingClientRect())}else if(e.key==='Enter'||e.key===' '){e.preventDefault();onDetails()}}}>{body}</p>
}
