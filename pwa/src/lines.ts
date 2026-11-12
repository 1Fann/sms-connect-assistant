export type SimLine = {
 id:number; lineId?:string; followSlot?:boolean; isDefault?:boolean; confirmed?:boolean; name:string;
 online?:boolean; smsAvailable?:boolean; present?:boolean; enabled?:boolean; deviceOnline?:boolean;
 phoneId:string; phoneName:string; slot:number; simName:string;
};
export const slotSelectionKey=(line:{followSlot?:boolean;deviceId?:string;phoneId?:string;slot:number})=>
 line.followSlot?'slot:'+(line.deviceId??line.phoneId)+':'+line.slot:undefined;
export const lineKey=(line:SimLine)=>slotSelectionKey(line)??line.lineId??String(line.id);
export const isPresentSim=(line:{present?:boolean})=>line.present!==false;
export const canSendOn=(line:SimLine)=>line.present!==false && line.enabled!==false && line.confirmed!==false && line.online!==false && line.smsAvailable!==false;

export function lineStatus(line:Pick<SimLine,'present'|'enabled'|'confirmed'|'online'|'smsAvailable'|'deviceOnline'>):string {
 if(line.present===false)return '历史线路 · 已不在位';
 const states:string[]=[];
 if(line.confirmed===false)states.push('待确认');
 if(line.enabled===false)states.push('已停用');
 if(line.deviceOnline===false)states.push('手机离线');
 else if(line.confirmed!==false && line.enabled!==false && (line.online===false || line.smsAvailable===false))states.push('暂不可用');
 return states.join(' · ');
}

export function lineOptionName(line:SimLine):string {
 const status=lineStatus(line);
 return line.name+(status?'（'+status+'）':'');
}

export function preferredSmsLine(lines:SimLine[],lastUsed:string|null):string {
 const primary=lines.find(line=>line.isDefault);
 if(primary)return lineKey(primary);
 // Keep an unavailable preference visible and disabled until the user chooses a new SIM.
 if(lastUsed){const old=lines.find(l=>l.lineId===lastUsed);return old?lineKey(old):lastUsed;}
 const first=lines.find(canSendOn);
 return first ? lineKey(first) : '';
}
