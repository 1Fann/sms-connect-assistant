export type SimLine = {
 id:number; lineId?:string; isDefault?:boolean; confirmed?:boolean; name:string;
 online?:boolean; smsAvailable?:boolean; phoneId:string; phoneName:string; slot:number; simName:string;
};
export const lineKey=(line:SimLine)=>line.lineId ?? String(line.id);
export const canSendOn=(line:SimLine)=>line.confirmed!==false && line.online!==false && line.smsAvailable!==false;

export function preferredSmsLine(lines:SimLine[],lastUsed:string|null):string {
 const primary=lines.find(line=>line.isDefault);
 if(primary)return lineKey(primary);
 // Keep an unavailable preference visible and disabled until the user chooses a new SIM.
 if(lastUsed)return lastUsed;
 const first=lines.find(canSendOn);
 return first ? lineKey(first) : '';
}
