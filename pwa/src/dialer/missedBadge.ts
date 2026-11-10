import {useCallback,useEffect,useRef,useState} from 'react';
import {api} from './client';

export function useMissedBadge(installation:string|undefined,enabled:boolean){
 const [count,setCount]=useState(0),running=useRef(false),revision=useRef(0);
 const viewed=useCallback((value:number)=>{
  ++revision.current;setCount(value);
  const change=value>0?navigator.setAppBadge?.(value):navigator.clearAppBadge?.();void change?.catch(()=>{});
 },[]);
 const refresh=useCallback(async()=>{
  if(!installation||!enabled||running.current)return;
  const generation=revision.current;running.current=true;
  try{
   const result=await api<{count:number}>('call-history/missed');
   if(generation!==revision.current||document.hidden)return;
   if(!Number.isSafeInteger(result.count)||result.count<0)return;
   setCount(result.count);
   if(result.count>0)await navigator.setAppBadge?.(result.count).catch(()=>{});
   else await navigator.clearAppBadge?.().catch(()=>{});
  }catch{/* Keep the last known badge when offline. */}
  finally{running.current=false}
 },[installation,enabled]);
 useEffect(()=>{
  ++revision.current;running.current=false;
  // Missing installation also means startup or temporarily unavailable authentication.
  if(!installation){setCount(0);return}
  if(!enabled){setCount(0);void navigator.clearAppBadge?.().catch(()=>{});return}
  const visible=()=>{if(!document.hidden)void refresh()};
  const message=(event:MessageEvent)=>{if(event.data?.type==='phone-missed-updated')visible()};
  visible();const timer=setInterval(visible,10000);
  document.addEventListener('visibilitychange',visible);window.addEventListener('pageshow',visible);window.addEventListener('focus',visible);navigator.serviceWorker?.addEventListener('message',message);
  return()=>{++revision.current;clearInterval(timer);document.removeEventListener('visibilitychange',visible);window.removeEventListener('pageshow',visible);window.removeEventListener('focus',visible);navigator.serviceWorker?.removeEventListener('message',message)};
 },[installation,enabled,refresh]);
 return {count,refresh,viewed};
}
