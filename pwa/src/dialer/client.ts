export class PhoneError extends Error {
  constructor(public status:number,message:string){super(message)}
}
let rotation:Promise<boolean>|null=null;
export async function request<T>(path:string,body?:unknown,method=body===undefined?'GET':'POST',retry=true):Promise<T>{
  const response=await fetch('/api/'+path,{method,credentials:'same-origin',cache:'no-store',
    headers:body===undefined?{}:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),
    signal:AbortSignal.timeout(15000)});
  if(response.status===401 && retry && !['refresh','pair','pair/finish'].includes(path)){
    rotation??=fetch('/api/refresh',{method:'POST',credentials:'same-origin',signal:AbortSignal.timeout(10000)}).then(r=>r.ok).catch(()=>false).finally(()=>{rotation=null});
    if(await rotation)return request<T>(path,body,method,false);
  }
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw new PhoneError(response.status,typeof data.error==='string'?data.error:
    ({401:'请重新配对互联电话',403:'当前安装未获授权',409:'记录已变更，请刷新',429:'请求频繁，请稍后再试',503:'服务尚未就绪'} as Record<number,string>)[response.status]||'请求未完成');
  return data as T;
}
export const api=<T,>(path:string,body?:unknown)=>request<T>('v2/'+path,body);
export type Session={installationId:string,permissions:string[]};
export type Device={deviceId:string,name:string,online:boolean};
export type Line={lineId:string,deviceId:string,name:string,slot:number,lineOnline?:boolean,confirmed:boolean,online:boolean};
export type ContactSource={deviceId:string,rawId:string,contactId:string,revision:string|number,name:string,numbers:string[],readOnly:boolean};
export type Contact={id:string,name:string,numbers:string[],revision:number,favorite:boolean,conflict:boolean,sources:ContactSource[]};
export type CallRecord={id:string,deviceId?:string,number:string,name?:string,date:number,duration:number,type:string,accountId?:string};
export type PbxCall={id:string,lineId:string,number:string,state:string,direction:string,created:number,answeredAt?:number,endedAt?:number,reason?:string,target?:string};
export const err=(e:unknown)=>e instanceof Error?e.message:'操作未完成';
