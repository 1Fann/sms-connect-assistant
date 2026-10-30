import {useLayoutEffect,useRef,type RefObject} from 'react';
type Snapshot={rect:DOMRect,kind:string,avatar:HTMLElement|null,avatarRect:DOMRect|null};
export function useListMotion(root:RefObject<HTMLElement|null>,revision:unknown){
 const previous=useRef<Map<string,Snapshot>|null>(null),running=useRef<Animation[]>([]),ghosts=useRef<HTMLElement[]>([]);
 const hidden=useRef(new Map<HTMLElement,{ghost:HTMLElement,opacity:string}>());
 const clear=()=>{for(const [target,s] of hidden.current)target.style.opacity=s.opacity;hidden.current.clear();running.current.forEach(a=>a.cancel());running.current=[];ghosts.current.forEach(g=>g.remove());ghosts.current=[]};
 const snapshot=()=>{
  const result=new Map<string,Snapshot>();
  root.current?.querySelectorAll<HTMLElement>('[data-motion-key]').forEach(el=>{const rect=el.getBoundingClientRect();if(rect.bottom<0||rect.top>innerHeight)return;const avatar=el.querySelector<HTMLElement>('.avatar'),flight=ghosts.current.find(g=>g.dataset.motionGhost===el.dataset.motionKey&&g.isConnected);result.set(el.dataset.motionKey!,{rect,kind:el.dataset.motionKind||'row',avatar:avatar?.cloneNode(true) as HTMLElement|null,avatarRect:flight?.getBoundingClientRect()||avatar?.getBoundingClientRect()||null})});
  return result;
 };
 const capture=()=>{if(!matchMedia('(prefers-reduced-motion: reduce)').matches)previous.current=snapshot()};
 useLayoutEffect(()=>{
  const before=previous.current;previous.current=null;if(!before)return;
  clear();
  root.current?.querySelectorAll<HTMLElement>('[data-motion-key]').forEach(el=>{
   const old=before.get(el.dataset.motionKey!);if(!old)return;const rect=el.getBoundingClientRect();
   if(old.kind===(el.dataset.motionKind||'row')){
    const dx=old.rect.left-rect.left,dy=old.rect.top-rect.top;if(Math.abs(dx)+Math.abs(dy)<1)return;
    running.current.push(el.animate([{transform:`translate3d(${dx}px,${dy}px,0)`},{transform:'none'}],{duration:380,easing:'cubic-bezier(.2,.85,.22,1)'}));
   }else if(old.avatar&&old.avatarRect){
    const target=el.querySelector<HTMLElement>('.avatar');if(!target)return;const end=target.getBoundingClientRect(),start=old.avatarRect,ghost=old.avatar;
    Object.assign(ghost.style,{position:'fixed',left:start.left+'px',top:start.top+'px',width:start.width+'px',height:start.height+'px',margin:'0',zIndex:'30',pointerEvents:'none',transformOrigin:'top left',transform:'none',opacity:'1'});ghost.dataset.motionGhost=el.dataset.motionKey;ghost.setAttribute('aria-hidden','true');document.body.appendChild(ghost);ghosts.current.push(ghost);hidden.current.set(target,{ghost,opacity:target.style.opacity});target.style.opacity='0';
    const a=ghost.animate([{transform:'none'},{transform:`translate3d(${end.left-start.left}px,${end.top-start.top}px,0) scale(${end.width/start.width})`}],{duration:380,easing:'cubic-bezier(.2,.85,.22,1)',fill:'both'});running.current.push(a);void a.finished.catch(()=>{}).finally(()=>{ghost.remove();const s=hidden.current.get(target);if(s?.ghost===ghost){target.style.opacity=s.opacity;hidden.current.delete(target)}});
   }
  });
 },[revision,root]);
 useLayoutEffect(()=>()=>clear(),[]);
 return capture;
}
