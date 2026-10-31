import {useEffect,useRef,useState} from 'react';

export function NameEditor({label,value,onSave}:{label:string,value:string,onSave:(name:string)=>Promise<string>}){
 const [draft,setDraft]=useState(value),[busy,setBusy]=useState(false),[error,setError]=useState(''),[saved,setSaved]=useState(false);
 const dirty=useRef(false);
 useEffect(()=>{if(!dirty.current)setDraft(value)},[value]);
 return <form className="name-editor" onSubmit={async e=>{
  e.preventDefault();if(busy)return;setBusy(true);setError('');setSaved(false);
  try{const name=await onSave(draft);dirty.current=false;setDraft(name);setSaved(true)}
  catch(e){setError(e instanceof Error?e.message:'保存失败，请重试')}
  finally{setBusy(false)}
 }}><label>{label}<input value={draft} maxLength={30} disabled={busy} onChange={e=>{dirty.current=true;setDraft(e.target.value);setSaved(false)}}/></label>
 <button type="submit" disabled={busy}>{busy?'保存中…':'保存'}</button>
 {saved&&<small role="status">已保存</small>}{error&&<small role="alert">{error}</small>}
 </form>
}
