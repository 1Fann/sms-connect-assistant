import type {CallRecord,Device} from './client';

/** Use the recorded slot, never infer a historical SIM from today's line order or account ID. */
export function callSourceLabel(record:Pick<CallRecord,'deviceId'|'slot'>,devices:Device[]):string {
 const device=devices.find(d=>d.deviceId===record.deviceId)?.name||'互联通话';
 const sim=typeof record.slot==='number'&&Number.isInteger(record.slot)&&record.slot>0?'SIM '+record.slot:'SIM 未知';
 return device+' · '+sim;
}
