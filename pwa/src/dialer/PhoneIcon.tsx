import type {ReactNode} from 'react';
export type PhoneIconName='calls'|'person'|'keypad'|'search'|'back'|'close'|'plus'|'filter'|'phone'|'delete'|'info'|'trash'|'clock'|'settings'|'message'|'arrow'|'check'|'mute'|'speaker'|'handoff'|'hold';
const paths:Record<PhoneIconName,ReactNode>={
 calls:<><circle cx="12" cy="12" r="9" fill="currentColor" stroke="none"/><path d="M12 5v7H7" stroke="var(--icon-cutout,#fff)" strokeWidth="1.7"/></>,
 person:<><circle cx="12" cy="12" r="10" fill="currentColor" stroke="none"/><circle cx="12" cy="8" r="3.1" fill="var(--icon-cutout,#fff)" stroke="none"/><path d="M5.5 18c.6-3.4 3.1-5 6.5-5s5.9 1.6 6.5 5c-3.5 2.5-9.5 2.5-13 0" fill="var(--icon-cutout,#fff)" stroke="none"/></>,
 keypad:<>{[5,12,19].flatMap(y=>[5,12,19].map(x=><circle key={x+':'+y} cx={x} cy={y} r="2.35" fill="currentColor" stroke="none"/>))}</>,
 search:<><circle cx="10.5" cy="10.5" r="6.4"/><path d="m15.5 15.5 5 5"/></>,
 back:<path d="m14.5 5-7 7 7 7"/>,close:<path d="m6 6 12 12M6 18 18 6"/>,plus:<path d="M12 4v16M4 12h16"/>,
 filter:<path d="M4 6h16M7 12h10M10 18h4"/>,
 phone:<path d="M6.4 2.8c.8-.4 1.4 0 1.7.8l1.6 3.7c.3.7.2 1.2-.4 1.7l-1.8 1.5c1.5 3 3.3 4.8 6.3 6.3l1.5-1.8c.5-.6 1-.7 1.7-.4l3.7 1.6c.8.3 1.2.9.8 1.7-.9 2.2-2.2 3.5-4.4 3.2C10.4 20.2 3.8 13.6 2.8 7.2c-.3-2.2 1-3.5 3.6-4.4" fill="currentColor" stroke="none"/>,
 delete:<><path d="M9 5h12v14H9l-7-7Z"/><path d="m12 9 6 6m-6 0 6-6"/></>,
 info:<><circle cx="12" cy="12" r="9"/><path d="M12 11v6"/><circle cx="12" cy="7" r="1" fill="currentColor" stroke="none"/></>,
 trash:<><path d="M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7"/></>,
 clock:<><circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/></>,
 message:<path d="M21 11.5c0 4.7-4 8.5-9 8.5-1.5 0-3-.3-4.2-.9L3 21l1.3-4.1A8.1 8.1 0 0 1 3 12c0-4.7 4-8.5 9-8.5s9 3.6 9 8Z" fill="currentColor" stroke="none"/>,
 settings:<><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 1v3m0 16v3M1 12h3m16 0h3M4 4l2 2m12 12 2 2M4 20l2-2M18 6l2-2"/></>,
 arrow:<path d="M5 19 19 5M7 5h12v12"/>,check:<path d="m5 12 4.5 5L20 6"/>,
 mute:<><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M6 10v2a6 6 0 0 0 12 0v-2M12 18v4M3 3l18 18"/></>,
 speaker:<><path d="M3 9h4l6-5v16l-6-5H3ZM17 8a6 6 0 0 1 0 8M20 5a10 10 0 0 1 0 14"/></>,
 handoff:<><rect x="3" y="4" width="9" height="16" rx="2"/><path d="M15 8h7m-3-3 3 3-3 3M22 16h-7m3-3-3 3 3 3"/></>,
 hold:<><path d="M8 5v14M16 5v14" strokeWidth="4"/></>
};
export function PhoneIcon({name,size=24}:{name:PhoneIconName,size?:number}){
 return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}
export function PhoneAvatar({name,poster=false}:{name?:string,poster?:boolean}){
 return <span aria-hidden="true" className={poster?'poster-avatar':'phone-avatar'}>{name&&!/^\+?[\d\s()-]+$/.test(name)?name.slice(0,1):poster?<svg width="156" height="156" viewBox="0 0 100 100" fill="currentColor"><circle cx="50" cy="33" r="19"/><path d="M12 84c2-19 17-28 38-28s36 9 38 28c-20 16-56 16-76 0"/></svg>:<PhoneIcon name="person" size={40}/>}</span>;
}
