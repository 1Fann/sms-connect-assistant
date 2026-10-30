import {useEffect,useRef} from 'react';
import {gesture} from './conversations';

export function MessageBubble({body,tail,expanded,onDetails,onMenu,onTimeDrag}:{body:string,tail:boolean,expanded:boolean,onDetails:()=>void,onMenu:()=>void,onTimeDrag:(distance:number)=>void}){
 const timer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined),start=useRef<{x:number,y:number,mode:'horizontal'|'vertical'|null}|null>(null),suppress=useRef(false);
 const cancel=()=>{clearTimeout(timer.current);start.current=null};
 useEffect(()=>()=>cancel(),[]);
 return <p className={'bubble'+(tail?' tail':'')} tabIndex={0} role="button" aria-expanded={expanded} title="轻点查看详情，长按拷贝或转发，向左拖动查看时间"
  onPointerDown={e=>{if(e.button!==0)return;cancel();suppress.current=false;start.current={x:e.clientX,y:e.clientY,mode:null};timer.current=setTimeout(()=>{suppress.current=true;start.current=null;onMenu()},500)}}
  onPointerMove={e=>{const t=start.current;if(!t)return;const dx=e.clientX-t.x,dy=e.clientY-t.y;t.mode=t.mode||gesture(dx,dy);if(t.mode){clearTimeout(timer.current);suppress.current=true}if(t.mode==='vertical'){start.current=null;return}if(t.mode==='horizontal'){e.currentTarget.setPointerCapture(e.pointerId);onTimeDrag(Math.max(0,Math.min(70,-dx)))}}}
  onPointerUp={()=>{cancel();onTimeDrag(0)}} onPointerCancel={()=>{suppress.current=true;cancel();onTimeDrag(0)}}
  onContextMenu={e=>{e.preventDefault();cancel();suppress.current=true;onMenu()}}
  onClick={e=>{if(suppress.current&&e.detail!==0){suppress.current=false;return}onDetails()}}
  onKeyDown={e=>{if(e.key==='ContextMenu'||e.shiftKey&&e.key==='F10'){e.preventDefault();onMenu()}else if(e.key==='Enter'||e.key===' '){e.preventDefault();onDetails()}}}>{body}</p>
}
