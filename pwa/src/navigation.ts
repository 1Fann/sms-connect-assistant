import {useLayoutEffect,useRef,type RefObject,type PointerEvent,type MouseEvent} from 'react';
import {SpringMotion} from './gestureMotion';

/** Navigation uses the same pixel / pixels-per-second units as SpringMotion. */
export function navigationFrame(position:number,width:number){
 const w=Math.max(1,width),x=Math.max(0,Math.min(w,position));
 return {detail:x,list:(x-w)*.27,dim:(1-x/w)*.08};
}

export function completeBack(position:number,velocity:number,width:number,idleMilliseconds=0){
 const w=Math.max(1,width),v=idleMilliseconds>100?0:velocity;
 if(v < -250)return false;
 return position>w*.38||(position>w*.08&&v>650);
}

type EdgeDrag={id:number,x:number,y:number,origin:number,horizontal:boolean,lastMove:number,target:Element|null};

export function useNavigation(screen:string,list:RefObject<HTMLDivElement|null>,detail:RefObject<HTMLDivElement|null>,onBack:()=>void){
 const complete=useRef(onBack);complete.current=onBack;
 const previous=useRef(false),closing=useRef(false),drag=useRef<EdgeDrag|null>(null);
 const suppressClick=useRef(false),cancellingChild=useRef(false),width=useRef(390);
 const motion=useRef<SpringMotion|null>(null);
 if(!motion.current)motion.current=new SpringMotion(position=>{
  const frame=navigationFrame(position,width.current);
  if(detail.current)detail.current.style.transform=`translate3d(${frame.detail}px,0,0)`;
  if(list.current){list.current.style.transform=`translate3d(${frame.list}px,0,0)`;list.current.style.setProperty('--nav-dim',String(frame.dim))}
  // Only the settled, exact spring target completes navigation, not overshoot.
  if(closing.current&&position===width.current){closing.current=false;complete.current()}
 },390);
 useLayoutEffect(()=>{
  const active=screen==='chat'||screen==='new';
  const measured=detail.current?.clientWidth||list.current?.clientWidth||390;
  width.current=measured;
  if(active&&!previous.current){motion.current!.jumpTo(measured);motion.current!.springTo(0)}
  else if(!active){drag.current=null;closing.current=false;suppressClick.current=false;motion.current!.jumpTo(measured)}
  previous.current=active;
  const element=detail.current;
  if(!active||!element||typeof ResizeObserver==='undefined')return;
  const observer=new ResizeObserver(()=>{
   const next=element.clientWidth;if(!next||next===width.current)return;
   const state=motion.current!.interrupt(),ratio=next/width.current;width.current=next;
   if(drag.current){drag.current=null;closing.current=false}
   motion.current!.jumpTo(state.position*ratio);
   motion.current!.springTo(closing.current?next:0,state.velocity*ratio);
  });
  observer.observe(element);return ()=>observer.disconnect();
 },[screen]);
 useLayoutEffect(()=>()=>motion.current?.destroy(),[]);
 const back=()=>{
  if(!detail.current||!previous.current){complete.current();return}
  if(closing.current)return;
  drag.current=null;closing.current=true;motion.current!.springTo(width.current);
 };
 const cancel=()=>{drag.current=null;closing.current=false;motion.current!.springTo(0)};
 const cancelChild=(e:PointerEvent<HTMLDivElement>,target:Element|null)=>{
  if(!target)return;
  // Capture transfers future events, but the bubble also needs cancellation now
  // to clear its pending long-press and its independent timestamp gesture.
  cancellingChild.current=true;
  try{target.dispatchEvent(new window.PointerEvent('pointercancel',{bubbles:true,pointerId:e.pointerId,pointerType:e.pointerType,isPrimary:e.isPrimary,clientX:e.clientX,clientY:e.clientY}))}
  finally{cancellingChild.current=false}
 };
 return {back,handlers:{
  onPointerDownCapture:(e:PointerEvent<HTMLDivElement>)=>{
   if(e.button!==0||!e.isPrimary)return;
   suppressClick.current=false;
   const edge=e.clientX-e.currentTarget.getBoundingClientRect().left;
   if(drag.current||!previous.current||edge<0||edge>26||e.target instanceof Element&&e.target.closest('input,textarea,select,[contenteditable="true"]'))return;
   const state=motion.current!.interrupt();closing.current=false;
   drag.current={id:e.pointerId,x:e.clientX,y:e.clientY,origin:state.position,horizontal:false,lastMove:e.timeStamp,target:e.target instanceof Element?e.target:null};
  },
  onPointerMoveCapture:(e:PointerEvent<HTMLDivElement>)=>{
   const d=drag.current;if(!d||d.id!==e.pointerId)return;
   const dx=e.clientX-d.x,dy=e.clientY-d.y;
   if(!d.horizontal){
    if(Math.abs(dy)>10&&Math.abs(dy)>=Math.abs(dx)||dx < -10){cancel();return}
    if(dx<10||dx<Math.abs(dy)*1.25)return;
    d.horizontal=true;suppressClick.current=true;cancelChild(e,d.target);e.currentTarget.setPointerCapture(e.pointerId);
   }
   e.preventDefault();e.stopPropagation();d.lastMove=e.timeStamp;
   motion.current!.dragTo(Math.max(0,Math.min(width.current,d.origin+dx)),e.timeStamp);
  },
  onPointerUpCapture:(e:PointerEvent<HTMLDivElement>)=>{
   const d=drag.current;if(!d||d.id!==e.pointerId)return;drag.current=null;
   if(!d.horizontal){motion.current!.springTo(0);return}
   e.preventDefault();e.stopPropagation();
   if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);
   const state=motion.current!,idle=e.timeStamp-d.lastMove,velocity=idle>100?0:state.velocity;
   closing.current=completeBack(state.position,velocity,width.current,idle);
   state.springTo(closing.current?width.current:0,velocity);
  },
  onPointerCancelCapture:(e:PointerEvent<HTMLDivElement>)=>{
   if(cancellingChild.current||drag.current?.id!==e.pointerId)return;
   if(drag.current.horizontal){suppressClick.current=true;e.stopPropagation()}
   cancel();
  },
  onLostPointerCaptureCapture:(e:PointerEvent<HTMLDivElement>)=>{
   // A child's implicit capture is released when the page claims this pointer.
   if(e.target!==e.currentTarget||drag.current?.id!==e.pointerId)return;
   if(drag.current.horizontal)suppressClick.current=true;
   cancel();
  },
  onClickCapture:(e:MouseEvent<HTMLDivElement>)=>{
   if(!suppressClick.current||e.detail===0)return;
   suppressClick.current=false;e.preventDefault();e.stopPropagation();
  }
 }};
}
