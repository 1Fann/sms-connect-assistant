import {useLayoutEffect} from 'react';

export type ViewportSample={
 layoutWidth:number;
 layoutHeight:number;
 visualHeight:number;
 offsetTop:number;
 scale:number;
 editable:boolean;
};
export type ViewportGeometry={
 width:number;
 height:number;
 top:number;
 inset:number;
 keyboardOpen:boolean;
 zoomed:boolean;
};
const positive=(value:number,fallback:number)=>Number.isFinite(value)&&value>0?value:fallback;

/** Keep the shell at its pre-keyboard height. Its offset compensates visual
 * viewport panning, so bottom avoidance is H - visualHeight (not H - top - h).
 * Keyboard presence is inferred from editable focus and viewport occlusion;
 * it is not an assertion that a particular system keyboard is available. */
export function resolveViewport(sample:ViewportSample,previous?:ViewportGeometry):ViewportGeometry{
 const width=positive(sample.layoutWidth,previous?.width||390);
 const layoutHeight=positive(sample.layoutHeight,previous?.height||844);
 const visible=positive(sample.visualHeight,layoutHeight);
 const zoomed=Math.abs(positive(sample.scale,1)-1)>.01;
 if(zoomed)return previous?{...previous,zoomed:true}:{width,height:layoutHeight,top:0,inset:0,keyboardOpen:false,zoomed:true};
 const changedWidth=!!previous&&Math.abs(width-previous.width)>1;
 // A new layout width means rotation/window resize, not keyboard occlusion.
 // Layout height provides the new full-size baseline if the keyboard remains.
 const baseline=!previous||changedWidth?(sample.editable?Math.max(layoutHeight,visible):visible):previous.height;
 const gap=Math.max(0,baseline-visible);
 // Keep avoiding the keyboard after blur while its dismissal is in progress.
 // A two-pixel tolerance ignores visual-viewport rounding noise.
 const keyboardOpen=(sample.editable||!!previous?.keyboardOpen&&!changedWidth)&&gap>2;
 if(!keyboardOpen)return {width,height:visible,top:0,inset:0,keyboardOpen:false,zoomed:false};
 const rawTop=Number.isFinite(sample.offsetTop)?sample.offsetTop:0;
 return {width,height:baseline,top:Math.max(0,Math.min(gap,rawTop)),inset:gap,keyboardOpen:true,zoomed:false};
}

function editableFocus(){
 const element=document.activeElement;
 if(element instanceof HTMLTextAreaElement)return !element.disabled&&!element.readOnly;
 if(element instanceof HTMLInputElement)return !element.disabled&&!element.readOnly&&!['button','submit','reset','checkbox','radio','range','color','file','image','hidden'].includes(element.type);
 if(element instanceof HTMLSelectElement)return !element.disabled;
 return element instanceof HTMLElement&&element.isContentEditable;
}

/** Coalesce geometry updates without React renders or changing document scroll.
 * A short focus/resize sampling window also catches late WebKit viewport values;
 * no polling remains once the keyboard transition has settled. */
export function useViewport(){
 useLayoutEffect(()=>{
  const root=document.documentElement,viewport=window.visualViewport;
  const names=['--height','--viewport-top','--keyboard-inset'];
  const originals=new Map(names.map(name=>[name,{value:root.style.getPropertyValue(name),priority:root.style.getPropertyPriority(name)}]));
  const originalKeyboard=root.getAttribute('data-keyboard-open'),applied=new Map<string,string>();
  let previous:ViewportGeometry|undefined,frame:number|null=null,sampleUntil=0,orientationUntil=0,disposed=false;
  const write=(name:string,value:number)=>{const css=`${Math.round(value*1000)/1000}px`;if(applied.get(name)!==css){root.style.setProperty(name,css);applied.set(name,css)}};
  const update=()=>{
   frame=null;if(disposed)return;
   const layoutHeight=Math.max(root.clientHeight,window.innerHeight);
   const sample={layoutWidth:root.clientWidth||window.innerWidth,layoutHeight,visualHeight:viewport?.height||window.innerHeight,offsetTop:viewport?.offsetTop||0,scale:viewport?.scale||1,editable:editableFocus()};
   // iOS can report the new orientation width before its new layout height.
   // Rebase throughout that short transition rather than retaining a stale H.
   const rotating=performance.now()<orientationUntil&&Math.abs(sample.scale-1)<=.01;
   previous=resolveViewport(sample,rotating?undefined:previous);
   write('--height',previous.height);write('--viewport-top',previous.top);write('--keyboard-inset',previous.inset);
   const keyboard=String(previous.keyboardOpen);if(root.dataset.keyboardOpen!==keyboard)root.dataset.keyboardOpen=keyboard;
   if(performance.now()<sampleUntil)frame=requestAnimationFrame(update);
  };
  const schedule=(milliseconds:number)=>{sampleUntil=Math.max(sampleUntil,performance.now()+milliseconds);if(frame===null&&!disposed)frame=requestAnimationFrame(update)};
  const geometry=()=>schedule(180),focus=()=>schedule(500),orientation=()=>{orientationUntil=performance.now()+600;schedule(600)};
  const visible=()=>{if(!document.hidden)schedule(350)};
  viewport?.addEventListener('resize',geometry);viewport?.addEventListener('scroll',geometry);
  window.addEventListener('resize',geometry);window.addEventListener('orientationchange',orientation);window.addEventListener('pageshow',visible);
  document.addEventListener('focusin',focus);document.addEventListener('focusout',focus);document.addEventListener('visibilitychange',visible);
  update();
  return()=>{
   disposed=true;if(frame!==null)cancelAnimationFrame(frame);
   viewport?.removeEventListener('resize',geometry);viewport?.removeEventListener('scroll',geometry);
   window.removeEventListener('resize',geometry);window.removeEventListener('orientationchange',orientation);window.removeEventListener('pageshow',visible);
   document.removeEventListener('focusin',focus);document.removeEventListener('focusout',focus);document.removeEventListener('visibilitychange',visible);
   for(const [name,original] of originals){if(root.style.getPropertyValue(name)!==applied.get(name))continue;if(original.value)root.style.setProperty(name,original.value,original.priority);else root.style.removeProperty(name)}
   if(root.getAttribute('data-keyboard-open')===String(previous?.keyboardOpen)){if(originalKeyboard===null)root.removeAttribute('data-keyboard-open');else root.setAttribute('data-keyboard-open',originalKeyboard)}
  };
 },[]);
}
