import {useEffect,useRef,type RefObject,type PointerEvent,type MouseEvent} from 'react';

/** Keep a closing dialog in the top layer until its animation ends. A long-press
 * release cannot dismiss the dialog it just opened: dismissal requires a fresh
 * pointer-down on the backdrop. Reduced-motion users get an immediate transition. */
export function useDialogMotion(open:boolean,ref:RefObject<HTMLDialogElement|null>,dismiss:()=>void,sheet=false){
 const backdrop=useRef(false);
 useEffect(()=>{
  const el=ref.current;if(!el)return;let disposed=false;
  const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
  backdrop.current=false;
  if(open&&!el.open)el.showModal();
  if(!el.open)return;
  if(reduced){if(!open)el.close();return}
  const from=sheet?'translateY(40px)':'translateY(8px) scale(.94)';
  const animation=el.animate(open?[{opacity:0,transform:from},{opacity:1,transform:'none'}]:[{opacity:1,transform:'none'},{opacity:0,transform:sheet?'translateY(28px)':'scale(.97)'}],{duration:open?280:170,easing:open?'cubic-bezier(.2,.85,.25,1)':'cubic-bezier(.4,0,1,1)',fill:'both'});
  void animation.finished.then(()=>{if(!disposed){if(!open)el.close();animation.cancel()}}).catch(()=>{});
  return()=>{disposed=true;animation.cancel()};
 },[open,ref,sheet]);
 return {
  'data-closing':!open,
  onPointerDown:(e:PointerEvent<HTMLDialogElement>)=>{backdrop.current=e.target===e.currentTarget},
  onClick:(e:MouseEvent<HTMLDialogElement>)=>{if(backdrop.current&&e.target===e.currentTarget){backdrop.current=false;dismiss()}},
  onCancel:(e:React.SyntheticEvent<HTMLDialogElement>)=>{e.preventDefault();dismiss()}
 };
}
