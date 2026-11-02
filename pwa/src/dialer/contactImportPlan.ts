import type {Contact} from './client';
import type {ImportContact} from './vcard';
export type NameRepair={id:string,revision:number,name:string,previousName:string,numbers:string[]};
export type ImportPlan={contacts:ImportContact[],repairs:NameRepair[],review:number};
const phoneKey=(numbers:string[])=>JSON.stringify([...new Set(numbers.map(n=>n.replace(/[ ()-]/g,'').toLowerCase()))].sort());
const nameKey=(name:string)=>name.normalize('NFC');
/** Only repair one unambiguous, source-free assistant card still bearing the legacy imported name. */
export function planContactImport(input:ImportContact[],existing:Contact[]):ImportPlan{
 const contacts:ImportContact[]=[],repairs:NameRepair[]=[];let review=0;
 const used=new Set<string>(),index=new Map<string,Contact[]>();
 for(const row of existing){const key=phoneKey(row.numbers);index.set(key,[...(index.get(key)||[]),row])}
 for(const row of input){
  if(!row.previousName){contacts.push({name:row.name,numbers:row.numbers});continue}
  const same=index.get(phoneKey(row.numbers))||[];
  const old=same.filter(c=>nameKey(c.name)===nameKey(row.previousName!));
  if(!old.length){contacts.push({name:row.name,numbers:row.numbers});continue}
  if(old.length!==1||old[0].sources.length||used.has(old[0].id)||same.some(c=>nameKey(c.name)===nameKey(row.name))){review++;continue}
  const before=old[0];used.add(before.id);
  repairs.push({id:before.id,revision:before.revision,name:row.name,previousName:before.name,numbers:before.numbers});
 }
 return {contacts,repairs,review};
}
