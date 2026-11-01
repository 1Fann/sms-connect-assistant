import {useLayoutEffect,useRef,type RefObject} from 'react';
import {useContextMotion} from './contextMotion';

export type MessageMenuTrigger = 'pointer' | 'keyboard';

/** Position the message near its source and leave room for real actions and text selection. */
export function useMessageMenu(
 trigger:MessageMenuTrigger|null,
 dialogRef:RefObject<HTMLDialogElement|null>,
 anchorRef:RefObject<DOMRect|null>,
 sourceRef:RefObject<HTMLElement|null>,
 dismiss:()=>void
){
 const lifted=useRef<{element:HTMLElement,visibility:string,priority:string}|null>(null);
 const restore=()=>{
  const saved=lifted.current;
  if(!saved)return;
  if(saved.visibility)saved.element.style.setProperty('visibility',saved.visibility,saved.priority);
  else saved.element.style.removeProperty('visibility');
  lifted.current=null;
 };
 useLayoutEffect(()=>{
  const dialog=dialogRef.current;
  if(!dialog)return;
  // Native close events are asynchronous. An old event must not reveal a newly lifted source.
  const closed=()=>{if(!dialog.open)restore()};
  dialog.addEventListener('close',closed);
  return()=>{dialog.removeEventListener('close',closed);restore()};
 },[dialogRef]);
 useLayoutEffect(()=>{
  const dialog=dialogRef.current;
  if(!dialog)return;
  if(!trigger){
   const source=sourceRef.current;
   if(source?.isConnected)anchorRef.current=source.getBoundingClientRect();
   // Freeze an in-flight layout transition before the closing spring takes over.
   for(const element of dialog.querySelectorAll<HTMLElement>('.message-preview,.context-actions')){
    const style=getComputedStyle(element);
    element.style.left=style.left;element.style.top=style.top;
   }
   delete dialog.dataset.placed;
   return;
  }
  const source=sourceRef.current;
  restore();
  // A long press opens the menu without selecting an action. Tab can then reach Copy.
  dialog.autofocus = trigger === 'pointer';
  if(!dialog.open)dialog.showModal();
  const initialFocus = trigger === 'pointer'
   ? dialog
   : dialog.querySelector<HTMLButtonElement>('.context-actions > button');
  if (initialFocus && document.activeElement !== initialFocus) {
   initialFocus.focus({preventScroll:true});
  }
  if(source){
   lifted.current={element:source,visibility:source.style.getPropertyValue('visibility'),priority:source.style.getPropertyPriority('visibility')};
   source.style.visibility='hidden';
  }
  const preview=dialog.querySelector<HTMLElement>('.message-preview');
  const actions=dialog.querySelector<HTMLElement>('.context-actions');
  if(!preview||!actions)return;
  preview.scrollTop=0;
  delete dialog.dataset.placed;
  let frame:number|null=null;
  const place=()=>{
   frame=null;
   const anchor=anchorRef.current;
   if(!anchor)return;
   const viewport=window.visualViewport;
   const left=viewport?.offsetLeft||0,top=viewport?.offsetTop||0;
   const width=viewport?.width||window.innerWidth,height=viewport?.height||window.innerHeight;
   const bounds=dialog.getBoundingClientRect(),style=getComputedStyle(dialog);
   const safeTop=parseFloat(style.getPropertyValue('--menu-safe-top'))||0;
   const keyboard=document.documentElement.dataset.keyboardOpen==='true';
   const safeBottom=keyboard?0:parseFloat(style.getPropertyValue('--menu-safe-bottom'))||0;
   const edge=16,gap=12,minY=top+safeTop+edge,maxY=top+height-safeBottom-edge;
   const available=Math.max(0,maxY-minY);
   const menuWidth=Math.max(1,Math.min(250,width-edge*2));
   actions.style.width=menuWidth+'px';
   actions.style.maxHeight=Math.max(1,available*.55)+'px';
   const menuHeight=actions.offsetHeight;
   // Measure the unscaled source width so press feedback cannot rewrap the copied text.
   const sourceWidth=source?.isConnected?parseFloat(getComputedStyle(source).width):anchor.width;
   const naturalWidth=Number.isFinite(sourceWidth)?sourceWidth:anchor.width;
   preview.style.width=Math.max(1,Math.min(naturalWidth,width-edge*2))+'px';
   preview.style.maxHeight=Math.max(1,available-menuHeight-gap)+'px';
   const bubbleHeight=preview.offsetHeight;
   preview.dataset.scrollable=String(preview.scrollHeight>preview.clientHeight+1);
   const clampedTop=Math.max(minY,Math.min(anchor.top,maxY-bubbleHeight));
   const below=clampedTop+bubbleHeight+gap+menuHeight<=maxY;
   const above=!below&&clampedTop-gap-menuHeight>=minY;
   const y=above?clampedTop:Math.max(minY,Math.min(clampedTop,maxY-menuHeight-gap-bubbleHeight));
   const x=Math.max(left+edge,Math.min(anchor.left-(naturalWidth-anchor.width)/2,left+width-edge-preview.offsetWidth));
   const outgoing=dialog.dataset.outgoing==='true';
   const menuX=outgoing?x+preview.offsetWidth-menuWidth:x;
   preview.style.left=(x-bounds.left)+'px';preview.style.top=(y-bounds.top)+'px';
   actions.style.left=(Math.max(left+edge,Math.min(menuX,left+width-edge-menuWidth))-bounds.left)+'px';
   actions.style.top=((above?y-gap-menuHeight:y+bubbleHeight+gap)-bounds.top)+'px';
   actions.style.transformOrigin=(above?'bottom':'top')+(outgoing?' right':' left');
   dialog.dataset.menuAbove=String(above);
  };
  const schedule=()=>{if(frame===null)frame=requestAnimationFrame(place)};
  place();
  const placed=requestAnimationFrame(()=>{dialog.dataset.placed='true'});
  const observer=new ResizeObserver(schedule);
  observer.observe(actions);observer.observe(preview);
  window.visualViewport?.addEventListener('resize',schedule);
  window.visualViewport?.addEventListener('scroll',schedule);
  window.addEventListener('resize',schedule);
  return()=>{
   cancelAnimationFrame(placed);if(frame!==null)cancelAnimationFrame(frame);
   observer.disconnect();
   window.visualViewport?.removeEventListener('resize',schedule);
   window.visualViewport?.removeEventListener('scroll',schedule);
   window.removeEventListener('resize',schedule);
  };
 },[trigger,dialogRef,anchorRef,sourceRef]);
 return useContextMotion(trigger !== null,dialogRef,anchorRef,dismiss,restore);
}
