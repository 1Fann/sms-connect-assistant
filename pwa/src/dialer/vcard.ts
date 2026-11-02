export type ImportContact={name:string,numbers:string[]};
export type VCardPreview={contacts:ImportContact[],cards:number,skipped:number,duplicates:number};
const unescapeText=(value:string)=>value.replace(/\\([nN,;\\])/g,(_,c:string)=>c.toLowerCase()==='n'?' ':c);
function splitValue(value:string,separator:string){
 const parts:string[]=[];let current='',escaped=false;
 for(const ch of value){if(ch===separator&&!escaped){parts.push(current);current='';continue}current+=ch;if(ch==='\\'&&!escaped)escaped=true;else escaped=false}
 parts.push(current);return parts;
}
function property(line:string):{key:string,value:string}|null{
 let quoted=false,index=-1;
 for(let i=0;i<line.length;i++){if(line[i]==='"')quoted=!quoted;else if(line[i]===':'&&!quoted){index=i;break}}
 if(index<0)return null;
 const header=line.slice(0,index),key=header.split(';')[0].split('.').at(-1)!.toUpperCase();
 if(!['FN','N','TEL'].includes(key))return null;
 let value=line.slice(index+1);
 if(/(?:^|;)ENCODING=QUOTED-PRINTABLE(?:;|$)/i.test(header)){
  const charset=header.match(/(?:^|;)CHARSET="?([^;"]+)/i)?.[1]||'utf-8';
  const bytes:number[]=[];
  for(let i=0;i<value.length;i++){if(value[i]==='='&&/^[0-9a-f]{2}$/i.test(value.slice(i+1,i+3))){bytes.push(parseInt(value.slice(i+1,i+3),16));i+=2}else bytes.push(...new TextEncoder().encode(value[i]))}
  value=new TextDecoder(charset,{fatal:true}).decode(new Uint8Array(bytes));
 }
 return {key,value};
}
/** vCard 2.1/3.0/4.0 name and telephone fields only. Photos, notes and accounts are ignored. */
export function parseVCard(text:string):VCardPreview{
 if(new TextEncoder().encode(text).byteLength>10*1024*1024)throw Error('文件超过 10 MB，请导出时只保留姓名和电话号码');
 const contacts:ImportContact[]=[],known=new Set<string>();let cards=0,skipped=0,duplicates=0;
 let card:{fn:string,n:string,numbers:string[],invalid:boolean}|null=null;
 const finish=()=>{
  if(!card)return;
  const name=(card.fn||card.n).replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim();
  const numbers=[...new Set(card.numbers.map(n=>n.trim()).filter(n=>n.length>0&&n.length<=96&&!/[\u0000-\u001f\u007f]/.test(n)&&/\d/.test(n)))];
  if(card.invalid||name.length>200||!numbers.length||numbers.length>32){skipped++;card=null;return}
  const key=JSON.stringify([name.normalize('NFC'),[...new Set(numbers.map(n=>n.replace(/[ ()-]/g,'').toLowerCase()))].sort()]);
  if(known.has(key))duplicates++;else{known.add(key);contacts.push({name,numbers})}
  card=null;
 };
 const physical=text.replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n').split('\n'),lines:string[]=[];
 for(const raw of physical){
  const last=lines.at(-1);
  if(last!==undefined&&/ENCODING=QUOTED-PRINTABLE/i.test(last)&&last.endsWith('='))lines[lines.length-1]=last.slice(0,-1)+raw.replace(/^[ \t]/,'');
  else if(last!==undefined&&/^[ \t]/.test(raw))lines[lines.length-1]=last+raw.slice(1);
  else lines.push(raw);
 }
 for(const line of lines){
  if(/^BEGIN:VCARD$/i.test(line.trim())){if(card){card.invalid=true;finish()}cards++;if(cards>5000)throw Error('一次最多导入 5000 条联系人');card={fn:'',n:'',numbers:[],invalid:false};continue}
  if(/^END:VCARD$/i.test(line.trim())){finish();continue}
  if(!card)continue;
  try{
   const field=property(line);if(!field)continue;
   if(field.key==='FN')card.fn=unescapeText(field.value);
   else if(field.key==='N')card.n=splitValue(field.value,';').map(unescapeText).filter(Boolean).join(' ');
   else{
    let phone=unescapeText(field.value);
    if(/^tel:/i.test(phone)){phone=phone.slice(4);try{phone=decodeURIComponent(phone)}catch{card.invalid=true}}
    card.numbers.push(phone);
   }
  }catch{card.invalid=true}
 }
 if(card){card.invalid=true;finish()}
 if(!cards)throw Error('没有找到联系人，请选择从 iPhone 导出的 .vcf 文件');
 return {contacts,cards,skipped,duplicates};
}
