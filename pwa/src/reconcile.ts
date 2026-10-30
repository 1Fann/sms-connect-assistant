import type {Sms} from './api';
import {identity,type CountryCode} from './phone';
/** Only hide system copies explicitly attributed to this APK. Preserve ambiguous records. */
export function reconcile(system:Sms[],gateway:Sms[],region:CountryCode):Sms[]{
 const available=new Set(gateway.filter(m=>['accepted','sent','delivered','failed'].includes(m.state)));
 return [...system.filter(m=>{
  if(m.incoming||m.creator!=='me.capcom.smsgateway.iphone')return true;
  const copy=[...available].find(o=>o.body===m.body&&identity(o.address,region)===identity(m.address,region)&&o.sim===m.sim&&Math.abs(o.date-m.date)<120000);
  if(!copy)return true;
  available.delete(copy);return false;
 }),...gateway];
}
