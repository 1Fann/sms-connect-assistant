import {useLayoutEffect,useRef,type RefObject,type PointerEvent,type MouseEvent,type SyntheticEvent} from 'react';
import {SpringMotion} from './gestureMotion';

type ContextSurface={dialog:HTMLDialogElement,preview:HTMLElement,actions:HTMLElement|null,content:HTMLElement|null,motion:SpringMotion,retarget:()=>void};
const clamp=(value:number)=>Math.max(0,Math.min(1,value));
const ease=(value:number)=>{const t=clamp(value);return t*t*(3-2*t)};

/** A preview grows from the pressed row, while its separate menu follows it.
 * The same spring reverses on dismissal, including a dismissal during opening. */
export function useContextMotion(open:boolean,ref:RefObject<HTMLDialogElement|null>,anchorRef:RefObject<DOMRect|null>,dismiss:()=>void,beforeClose?:()=>void){
 const current=useRef({open,dismiss,beforeClose});current.current={open,dismiss,beforeClose};
 const surface=useRef<ContextSurface|null>(null),backdrop=useRef(false),freshPress=useRef(false);
 const reset=(s:ContextSurface)=>{
  s.preview.style.transform='';s.preview.style.opacity='';s.preview.style.willChange='';
  if(s.actions){s.actions.style.transform='';s.actions.style.opacity='';s.actions.style.willChange=''}
  if(s.content)s.content.style.opacity='';
 };
 useLayoutEffect(()=>()=>{
  const s=surface.current;if(!s)return;s.motion.destroy();reset(s);s.dialog.style.removeProperty('--context-dim');if(s.dialog.open){current.current.beforeClose?.();s.dialog.close()};surface.current=null;
 },[ref]);
 useLayoutEffect(()=>{
  const dialog=ref.current;if(!dialog)return;backdrop.current=false;freshPress.current=false;
  const reduced=typeof matchMedia==='function'&&matchMedia('(prefers-reduced-motion: reduce)').matches;
  if(reduced){
   if(surface.current){surface.current.motion.destroy();reset(surface.current);surface.current=null}
   dialog.style.setProperty('--context-dim',open?'1':'0');
   if(open&&!dialog.open)dialog.showModal();else if(!open&&dialog.open){current.current.beforeClose?.();dialog.close()};
   return;
  }
  if(open){
   if(!dialog.open){dialog.style.setProperty('--context-dim','0');dialog.showModal()}
   if(!surface.current){
    const preview=dialog.querySelector<HTMLElement>('.conversation-preview,.message-preview');
    if(!preview){dialog.style.setProperty('--context-dim','1');return}
    const actions=dialog.querySelector<HTMLElement>('.context-actions');
    const content=preview.querySelector<HTMLElement>('.preview-transcript,.preview-messages,.preview-content');
    const message=preview.classList.contains('message-preview');
    let dx=0,dy=12,sx=.96,sy=.96;
    const retarget=()=>{
     const origin=dialog.getBoundingClientRect();
     // offset geometry excludes the spring transform and long-text scroll position.
     const destination=message?new DOMRect(origin.left+preview.offsetLeft,origin.top+preview.offsetTop,preview.offsetWidth,preview.offsetHeight):preview.getBoundingClientRect();
     const anchor=anchorRef.current;
     if(!anchor||anchor.width<=0||anchor.height<=0)return;
     dx=anchor.left-destination.left;dy=anchor.top-destination.top;
     sx=anchor.width/Math.max(1,destination.width);
     // Clipping a long message must never stretch its glyphs vertically.
     sy=message?sx:anchor.height/Math.max(1,destination.height);
    };
    retarget();
    const motion=new SpringMotion(value=>{
     const s=surface.current;if(!s||s.motion!==motion)return;
     if(!dialog.isConnected){motion.destroy();surface.current=null;return}
     // Use a 1,000-unit range so the spring's pixel convergence threshold does
     // not truncate a normalized 0..1 transition near its beginning.
     const t=value/1000,remainder=1-t,menu=ease((t-.38)/.62);
     preview.style.transform=t===1?'none':`translate3d(${dx*remainder}px,${dy*remainder}px,0) scale(${sx+(1-sx)*t},${sy+(1-sy)*t})`;
     preview.style.opacity=String(message?1:clamp(t*7));
     if(actions){actions.style.transform=`translate3d(0,${(message?(dialog.dataset.menuAbove==='true'?-10:10):14)*(1-menu)}px,0) scale(${.96+.04*menu})`;actions.style.opacity=String(menu)}
     if(content)content.style.opacity=String(ease((t-.2)/.6));
     if(current.current.open&&value>0)dialog.style.setProperty('--context-dim','1');
     if(value===1000){preview.style.willChange='';if(actions)actions.style.willChange=''}
     if(value===0&&!current.current.open){if(dialog.open){current.current.beforeClose?.();dialog.close()};motion.destroy();reset(s);surface.current=null}
    });
    surface.current={dialog,preview,actions,content,motion,retarget};motion.jumpTo(0);
   }
   const s=surface.current;if(s){if(s.preview.classList.contains('message-preview'))s.retarget();s.preview.style.willChange='transform,opacity';if(s.actions)s.actions.style.willChange='transform,opacity';s.motion.springTo(1000)}
  }else{
   dialog.style.setProperty('--context-dim','0');
   const s=surface.current;
   if(s){if(s.preview.classList.contains('message-preview'))s.retarget();s.preview.style.willChange='transform,opacity';if(s.actions)s.actions.style.willChange='transform,opacity';s.motion.springTo(0)}
   else if(dialog.open){current.current.beforeClose?.();dialog.close()};
  }
 },[open,ref,anchorRef]);
 return {
  'data-closing':!open,
  onPointerDownCapture:()=>{freshPress.current=true},
  // The finger that opened this menu still belongs to the underlying row.
  // Its synthetic release-click must not activate the preview moving under it.
  onClickCapture:(e:MouseEvent<HTMLDialogElement>)=>{const allowed=freshPress.current;freshPress.current=false;if(e.detail!==0&&!allowed){e.preventDefault();e.stopPropagation()}},
  onPointerDown:(e:PointerEvent<HTMLDialogElement>)=>{backdrop.current=e.target===e.currentTarget},
  onPointerCancel:()=>{backdrop.current=false;freshPress.current=false},
  onClick:(e:MouseEvent<HTMLDialogElement>)=>{const outside=backdrop.current&&e.target===e.currentTarget;backdrop.current=false;if(outside)current.current.dismiss()},
  onCancel:(e:SyntheticEvent<HTMLDialogElement>)=>{e.preventDefault();current.current.dismiss()}
 };
}
