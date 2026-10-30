import type {Sms} from './api';
export type ConversationState={address:string,pinned:number,removedBefore:number,unread:boolean,muted?:boolean,region?:string};
export function isRemoved(message:Sms,state?:ConversationState){return !!state&&state.removedBefore>0&&message.date<=state.removedBefore}
export function isUnread(items:Sms[],state?:ConversationState){return !!state?.unread||items.some(m=>m.incoming&&!m.read)}
export function gesture(dx:number,dy:number):'horizontal'|'vertical'|null{
 if(Math.max(Math.abs(dx),Math.abs(dy))<10)return null;
 return Math.abs(dx)>Math.abs(dy)*1.25?'horizontal':'vertical';
}
