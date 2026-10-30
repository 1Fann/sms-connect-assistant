import type {Sms} from './api';
export function listTime(timestamp:number,now=new Date()):string {
 const date=new Date(timestamp),today=new Date(now.getFullYear(),now.getMonth(),now.getDate());
 const day=new Date(date.getFullYear(),date.getMonth(),date.getDate());
 const days=Math.round((today.getTime()-day.getTime())/86400000);
 if(days===0)return date.toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',hour12:false});
 if(days===1)return '昨天';
 if(days>1&&days<7)return date.toLocaleDateString('zh-CN',{weekday:'long'});
 return date.toLocaleDateString('zh-CN',{...(date.getFullYear()!==now.getFullYear()?{year:'numeric' as const}:{}),month:'numeric',day:'numeric'});
}
export function groupEnd(message:Sms,next?:Sms):boolean {
 return !next || next.incoming!==message.incoming || next.sim!==message.sim || next.date-message.date>120000 || ['failed','unknown','local','accepted'].includes(message.state);
}
export function showDate(message:Sms,previous?:Sms):boolean {
 return !previous || message.date-previous.date>300000 || new Date(message.date).toDateString()!==new Date(previous.date).toDateString();
}
export function sectionTime(timestamp:number):string {
 const date=new Date(timestamp);
 return `${date.toLocaleDateString('zh-CN',{month:'long',day:'numeric'})} ${date.toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',hour12:false})}`;
}
