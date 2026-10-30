import type {Sms} from './api';
import type {ConversationState} from './conversations';

/** Keep unchanged poll results referentially stable so focus/drag/dialog renders
 * don't rebuild the whole inbox. All scalar fields participate in comparison. */
export function reuseRecords<T extends object>(previous:T[],next:T[]):T[]{
 if(previous.length!==next.length)return next;
 return previous.every((a,i)=>{const b=next[i];const keys=new Set([...Object.keys(a),...Object.keys(b)]);return [...keys].every(k=>Object.is(Reflect.get(a,k),Reflect.get(b,k)))})?previous:next;
}
export function groupConversations(messages:Sms[],keyOf:(raw:string)=>string){
 const groups=new Map<string,Sms[]>();
 for(const message of messages){const key=keyOf(message.address);let items=groups.get(key);if(!items){items=[];groups.set(key,items)}items.push(message)}
 for(const items of groups.values())items.sort((a,b)=>a.date-b.date);
 return {groups,list:[...groups].map(([key,items])=>({key,items})).sort((a,b)=>b.items.at(-1)!.date-a.items.at(-1)!.date)};
}
export function optimisticConversation(states:ConversationState[],address:string,action:string):ConversationState[]|null{
 const current=states.find(s=>s.address===address)||{address,pinned:0,removedBefore:0,unread:false};
 let next:ConversationState;
 switch(action){case 'pin':next={...current,pinned:current.pinned||Date.now()};break;case 'unpin':next={...current,pinned:0};break;case 'mute':case 'unmute':next={...current,muted:action==='mute'};break;case 'read':case 'unread':next={...current,unread:action==='unread'};break;default:return null}
 return [...states.filter(s=>s.address!==address),next];
}
const clockFormat=new Intl.DateTimeFormat('zh-CN',{hour:'2-digit',minute:'2-digit',hour12:false});
export const messageTime=(date:number)=>clockFormat.format(date);
