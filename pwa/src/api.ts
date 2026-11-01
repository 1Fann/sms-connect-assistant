export type State='local'|'accepted'|'sent'|'delivered'|'failed'|'unknown'|'received';
export type Sms={id:string,address:string,display?:string,name?:string,body:string,date:number,incoming:boolean,read:boolean,sim?:number,lineId?:string,state:State,creator?:string,error?:string};
export class ApiError extends Error {constructor(public status:number,message:string){super(message)}}
let rotating:Promise<boolean>|null=null;
export async function api<T>(path:string,body?:unknown,retry=true):Promise<T>{
  const r=await fetch('/api/'+path,{method:body===undefined?'GET':'POST',credentials:'same-origin',cache:'no-store',headers:body===undefined?{}:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
  if(r.status===401&&retry){
    rotating??=fetch('/api/refresh',{method:'POST',credentials:'same-origin',signal:AbortSignal.timeout(15000)}).then(r=>r.ok).catch(()=>false).finally(()=>{rotating=null});
    if(await rotating)return api<T>(path,body,false);
  }
  if(!r.ok)throw new ApiError(r.status,({401:'会话已失效，请重新配对',403:'操作未获授权，请检查安卓权限或配对码',429:'操作过于频繁，请稍后再试'} as Record<number,string>)[r.status] || '网关操作失败');
  return r.json();
}
export const stateLabel:Record<State,string>={local:'本地待提交',accepted:'网关已接受',sent:'已发送',delivered:'已送达',failed:'发送失败',unknown:'状态未知，请先核实',received:''};
