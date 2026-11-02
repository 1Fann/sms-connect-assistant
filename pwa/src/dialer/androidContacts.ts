import {api,type Contact,type ContactSource,type Device} from './client';
import {identity} from '../phone';
export type AndroidWrite={id:string,deviceId:string,jobId:string|null,state:string};
export function primarySource(contact:Contact):ContactSource|undefined{
 return contact.sources.find(s=>s.rawId===contact.primaryRawId&&!s.readOnly)||contact.sources.find(s=>!s.readOnly);
}
export function writableContact(contact:Contact,devices:Device[]){
 return contact.sources.some(s=>!s.readOnly&&devices.some(d=>d.deviceId===s.deviceId&&d.contactsWrite===true));
}
export function createAndroidContact(deviceId:string,name:string,numbers:string[]){
 if(!deviceId)throw Error('请选择保存到哪台安卓手机');
 return {destination:'android',deviceId,name:name.trim(),numbers:numbers.map(n=>n.trim()).filter(Boolean)};
}
export function editAndroidContact(contact:Contact,source:ContactSource,fields:{name?:string,numbers?:string[]}){
 if(source.readOnly||!contact.sources.some(s=>s.deviceId===source.deviceId&&s.rawId===source.rawId&&s.revision===source.revision))throw Error('该联系人来源不可编辑，请刷新');
 return {destination:'android',id:contact.id,revision:contact.revision,deviceId:source.deviceId,rawId:source.rawId,sourceRevision:source.revision,...fields};
}
export function appendAndroidNumber(contact:Contact,source:ContactSource,number:string){
 if(contact.numbers.some(n=>identity(n)===identity(number)))throw Error('此联系人已包含该号码');
 if(source.numbers.length>=32)throw Error('此联系人来源已有 32 个号码');
 return editAndroidContact(contact,source,{numbers:[...source.numbers,number]});
}
/** A queued gateway receipt is not a successful Android write. Never issue a new POST while checking. */
export async function checkAndroidWrite(result:AndroidWrite,alive:()=>boolean,onStatus:(message:string)=>void):Promise<boolean>{
 if(result.state==='done')return true;
 if(!result.jobId)throw Error('没有收到安卓写入任务，请返回后核对');
 const query=new URLSearchParams({contactId:result.id,jobId:result.jobId});
 // Check a fast local save promptly, then give slower/offline devices more time between reads.
 const waits=[0,150,300,550,1000,1500,2000,2500,3000,4000];
 for(const wait of waits){
  if(!alive())return false;
  if(wait)await new Promise(resolve=>setTimeout(resolve,wait));
  if(!alive())return false;
  const response=await api<{items:{id:string,state:string,detail:string}[]}>('contact-sync/jobs?'+query);
  if(!alive())return false;
  const job=response.items.find(item=>item.id===result.jobId);
  if(job?.state==='done')return true;
  if(job&&job.state!=='queued')throw Error(job.detail||'安卓未能保存，请返回并核对权限或当前联系人');
  onStatus('已提交到安卓，正在等待手机确认写入…');
 }
 return false;
}
