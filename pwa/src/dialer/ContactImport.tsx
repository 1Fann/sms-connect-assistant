import {useEffect,useRef,useState} from 'react';
import {api,err,type Contact} from './client';
import {parseVCard,type VCardPreview} from './vcard';
import {planContactImport,type ImportPlan} from './contactImportPlan';
import {PhoneIcon} from './PhoneIcon';

type Batch={path:'contacts/import'|'contacts/edit',body:Record<string,unknown>,count:number};
export function ContactImport({canImport,onClose,onDone}:{canImport:boolean,onClose:()=>void,onDone:(message:string)=>void}){
 const [preview,setPreview]=useState<VCardPreview|null>(null),[fileName,setFileName]=useState(''),[error,setError]=useState('');
 const [plan,setPlan]=useState<ImportPlan|null>(null);
 const [busy,setBusy]=useState(false),[reading,setReading]=useState(false),[progress,setProgress]=useState(0);
 const input=useRef<HTMLInputElement>(null),alive=useRef(true),stop=useRef(false),active=useRef(false);
 const pending=useRef<{batches:Batch[],next:number,added:number,skipped:number,repaired:number,processed:number}|null>(null);
 const readGeneration=useRef(0);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;stop.current=true;++readGeneration.current}},[]);
 async function read(file:File){
  const generation=++readGeneration.current;setError('');setPreview(null);setPlan(null);pending.current=null;setFileName(file.name);setReading(true);setProgress(0);
  try{
   if(file.size>10*1024*1024)throw Error('文件超过 10 MB，请在导出时只保留姓名和电话号码');
   const bytes=new Uint8Array(await file.arrayBuffer());
   const charset=bytes[0]===255&&bytes[1]===254?'utf-16le':bytes[0]===254&&bytes[1]===255?'utf-16be':'utf-8';
   const result=parseVCard(new TextDecoder(charset,{fatal:true}).decode(bytes));
   const existing:Contact[]=[];let offset:number|null=0;const visited=new Set<number>();
   // Read every authorised page; a partial snapshot must not produce duplicate repair imports.
   while(offset!==null){
    if(!alive.current||generation!==readGeneration.current)return;
    if(visited.has(offset))throw Error('联系人分页异常，请稍后重试');visited.add(offset);
    const page:{items:Contact[],next:number|null}=await api('contacts?offset='+offset);
    existing.push(...page.items);offset=page.next;
   }
   if(alive.current&&generation===readGeneration.current){setPlan(planContactImport(result.contacts,existing));setPreview(result);if(!result.contacts.length)setError('文件里没有可导入的电话号码')}
  }catch(e){if(alive.current&&generation===readGeneration.current)setError(err(e))}
  finally{if(alive.current&&generation===readGeneration.current)setReading(false)}
 }
 async function start(){
  if(active.current||!canImport||!preview||!plan||!plan.contacts.length&&!plan.repairs.length)return;
  active.current=true;stop.current=false;setBusy(true);setError('');
  if(!pending.current){
   const batches:Batch[]=plan.repairs.map(row=>({path:'contacts/edit',count:1,body:{requestId:crypto.randomUUID(),id:row.id,revision:row.revision,name:row.name,targets:[]}}));
   for(let i=0;i<plan.contacts.length;i+=100){const contacts=plan.contacts.slice(i,i+100);batches.push({path:'contacts/import',count:contacts.length,body:{requestId:crypto.randomUUID(),contacts}})}
   pending.current={batches,next:0,added:0,skipped:0,repaired:0,processed:0};
  }
  const work=pending.current;
  try{
   while(work.next<work.batches.length){
    if(stop.current)break;
    const batch=work.batches[work.next];
    const result=await api<{added:number,skipped:number}>(batch.path,batch.body);
    if(batch.path==='contacts/edit')work.repaired++;else{work.added+=result.added;work.skipped+=result.skipped}
    work.processed+=batch.count;work.next++;
    if(alive.current)setProgress(work.processed);
   }
   if(!alive.current)return;
   if(work.next===work.batches.length)onDone('导入完成：新增 '+work.added+' 条'+(work.repaired?'，更正姓名 '+work.repaired+' 条':'')+'，跳过 '+(work.skipped+preview.duplicates)+' 条重复联系人'+(preview.skipped?'，另有 '+preview.skipped+' 条无有效电话或格式不支持':'')+(plan.review?'，'+plan.review+' 条需在联系人详情中核对':''));
  }catch(e){if(alive.current)setError(err(e)+'。可点「继续导入」重试当前批次，不会重复创建。')}
  finally{active.current=false;if(alive.current)setBusy(false)}
 }
 return <section className="contact-import">
  <header className="phone-toolbar"><button className="glass-circle" aria-label="返回联系人" disabled={busy} onClick={onClose}><PhoneIcon name="back"/></button><h1>导入联系人</h1><span className="toolbar-spacer"/></header>
  <p className="hint">仅将姓名和电话号码保存到助手，供已获通讯录权限的安装使用，不写入 iPhone 或安卓系统通讯录。</p>
  <div className="card"><b>先从 iPhone 导出</b><p className="hint">打开「通讯录 → 列表」，长按联系人列表，选择「导出」，保留姓名和电话号码，再「存储到文件」。</p></div>
  <input ref={input} className="sr-only" aria-label="联系人文件" type="file" accept=".vcf,text/vcard,text/x-vcard" disabled={busy||reading} onChange={e=>{const file=e.target.files?.[0];e.target.value='';if(file)void read(file)}}/>
  <button className="import-select" disabled={busy||reading} onClick={()=>input.current?.click()}>{reading?'正在读取…':preview?'重新选择联系人文件':'选择联系人文件 (.vcf)'}</button>
  {fileName&&<p className="hint import-file-name">{fileName}</p>}
  {preview&&<><h2>导入预览</h2><p>可导入 {preview.contacts.length} 条 · 文件内重复 {preview.duplicates} 条 · 跳过 {preview.skipped} 条</p>
   <p className="hint">中文姓名根据独立的姓、名字段显示为姓在前；英文名、自定义显示名和公司名保持原样。同名、同号码会跳过。</p>
   {!!plan?.repairs.length&&<><p role="status">可更正 {plan.repairs.length} 条已导入的姓名；确认后保留原联系人、号码和收藏。</p><div className="import-preview">{plan.repairs.slice(0,5).map(row=><div className="card" key={row.id}><small>{row.previousName} →</small><b>{row.name}</b></div>)}</div></>}
   {!!plan?.review&&<p role="alert">{plan.review} 条匹配不唯一或关联了系统来源，暂不导入，请在联系人详情中核对。</p>}
   <div className="import-preview">{preview.contacts.slice(0,5).map((row,i)=><div className="card" key={i}><b>{row.name||'未命名'}</b><small>{row.numbers.join('、')}</small></div>)}</div>
   {preview.contacts.length>5&&<p className="hint">仅预览前 5 条。</p>}
   {!canImport&&<p role="alert">当前安装没有联系人编辑权限，请在安卓的已授权安装中开启。</p>}
   <button className="primary" disabled={!canImport||busy||!plan||!plan.contacts.length&&!plan.repairs.length} onClick={()=>void start()}>{pending.current?'继续导入':plan?.repairs.length?'确认导入并更正姓名':'确认导入到助手'}</button>
   {busy&&<button onClick={()=>{stop.current=true}}>当前批次完成后暂停</button>}
   {(busy||progress>0)&&<p role="status">已处理 {progress} / {(plan?.contacts.length||0)+(plan?.repairs.length||0)} 条</p>}
  </>}
  {error&&<p role="alert">{error}</p>}
 </section>;
}
