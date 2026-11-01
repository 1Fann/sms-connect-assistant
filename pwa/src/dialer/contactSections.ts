const collator=new Intl.Collator('zh-CN',{usage:'sort',sensitivity:'base'});
const initials=[['A','阿'],['B','八'],['C','嚓'],['D','搭'],['E','蛾'],['F','发'],['G','旮'],['H','哈'],['J','击'],['K','喀'],['L','垃'],['M','妈'],['N','拿'],['O','哦'],['P','啪'],['Q','期'],['R','然'],['S','撒'],['T','塌'],['W','挖'],['X','昔'],['Y','压'],['Z','匝']];
export function contactSection(name:string):string{
 const first=name.trim().charAt(0);if(/[a-z]/i.test(first))return first.toUpperCase();
 if(!/[\u3400-\u9fff]/.test(first))return '#';
 for(let i=initials.length-1;i>=0;i--)if(collator.compare(first,initials[i][1])>=0)return initials[i][0];
 return '#';
}
export function sectionContacts<T extends {name:string,id:string}>(rows:T[]){
 const sorted=[...rows].sort((a,b)=>collator.compare(a.name,b.name)||a.id.localeCompare(b.id));
 const groups=new Map<string,T[]>();for(const row of sorted){const key=contactSection(row.name);groups.set(key,[...(groups.get(key)||[]),row])}
 return [...groups].sort(([a],[b])=>a==='#'?1:b==='#'?-1:a.localeCompare(b));
}
