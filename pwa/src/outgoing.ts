import type {Sms} from './api';

/** Preserve terminal outcomes when an earlier POST/poll response arrives late. */
export function mergeOutgoing(current:Sms[],updates:Sms[]):Sms[]{
 const rank={local:0,unknown:1,accepted:1,sent:3,delivered:4,failed:5,received:4};
 const merged=new Map(current.map(m=>[m.id,m]));
 for(const update of updates){
  const previous=merged.get(update.id);
  if(!previous||rank[update.state]>=rank[previous.state])merged.set(update.id,{...previous,...update});
 }
 return [...merged.values()];
}
