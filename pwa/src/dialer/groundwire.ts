import type {Line} from './client';
export type NativeRoute={lineId:string,prefix:string};
export function groundwireUri(number:string,line:Line|undefined,routes:NativeRoute[],enabled:boolean):string|undefined {
  if(!enabled||!line||line.present===false||line.enabled===false||!(line.lineOnline??line.online)||!line.confirmed)return;
  if(!/^\+?\d{3,20}$/.test(number)||['110','112','119','120','911'].includes(number.replace(/^\+/,'')))return;
  const route=routes.find(r=>r.lineId===line.lineId);
  if(!route||!/^\*\d{2,8}\*$/.test(route.prefix))return;
  return 'groundwire:'+route.prefix+number+'?dialAction=voiceCall';
}
