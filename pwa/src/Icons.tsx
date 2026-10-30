import type {CSSProperties,ReactNode} from 'react';

export type IconName='back'|'chevron'|'search'|'compose'|'filter'|'plus'|'send'|'person'|'close'|'check'|'settings'|'refresh'|'pin'|'trash'|'envelope'|'restore'|'bell'|'bell-off'|'copy'|'forward'|'minus';
const paths:Record<IconName,ReactNode>={
 bell:<><path d="M5 16v-5a7 7 0 0 1 14 0v5l2 2H3ZM10 21h4M12 2v2"/></>,
 'bell-off':<><path d="m3 3 18 18M9 4.7A7 7 0 0 1 19 11v4M5 8v8l-2 2h14M10 21h4M12 2v2"/></>,
 copy:<><rect x="8" y="7" width="12" height="14" rx="2"/><path d="M16 4V3H4v14h1"/></>,
 forward:<><path d="m14 4 7 7-7 7v-4C7 14 5 16 3 20c0-8 3-12 11-12Z"/></>,
 minus:<path d="M6 12h12"/>,
 pin:<><path d="m15 3 6 6-4 1-3 5-2-2-5 5-1-1 5-5-2-2 5-3Z"/><path d="m6 18-3 3"/></>,
 trash:<><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/></>,
 envelope:<><rect x="3" y="5" width="18" height="14" rx="3"/><path d="m4 7 8 6 8-6"/></>,
 restore:<><path d="M4 10a8 8 0 1 1 1 8M4 3v7h7M12 7v6l3 2"/></>,
 back:<path d="m15 4-8 8 8 8"/>,chevron:<path d="m9 5 7 7-7 7"/>,
 search:<><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></>,
 compose:<><path d="M12 4H5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-7M14 4l3 3M10 15l-1 1 1-5L20 1l3 3-10 10Z"/></>,
 filter:<><path d="M3 6h18M6 12h12M9 18h6"/></>,plus:<path d="M12 4v16M4 12h16"/>,send:<path d="M12 20V4m-6 6 6-6 6 6"/>,
 person:<><circle cx="12" cy="8" r="4" fill="currentColor" stroke="none"/><path d="M3 23v-3a9 9 0 0 1 18 0v3" fill="currentColor" stroke="none"/></>,
 close:<path d="m6 6 12 12M6 18 18 6"/>,check:<path d="m5 12 4 4L20 5"/>,
 settings:<><circle cx="12" cy="12" r="4"/><path d="m10 2-.5 3-3 1-2.5-1-2 4 2.5 2v3L2 16l2 4 3-1 2.5 1 .5 3h4l.5-3 3-1 2.5 1 2-4-2.5-2v-3L22 9l-2-4-3 1-2.5-1-.5-3Z"/></>,
 refresh:<><path d="M20 10a8 8 0 1 0-1 8M20 3v7h-7"/></>
};
export function Icon({name,size=24}:{name:IconName,size?:number}){return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>}
export function Avatar({name,large=false}:{name?:string,large?:boolean}){
 const hue=name?[...name].reduce((n,c)=>n+c.charCodeAt(0),0)%360:220;
 return <span aria-hidden="true" className={'avatar'+(large?' large':'')} style={{'--avatar-hue':hue} as CSSProperties}>{name?name.slice(0,1):<Icon name="person" size={large?44:34}/>}</span>;
}
