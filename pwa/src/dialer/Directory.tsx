import {useEffect,useRef,useState} from 'react';
import {api,err,type Contact,type Device,type Line} from './client';
type Target={deviceId:string,rawId?:string,revision?:string|number,action:'create'|'update'|'delete'};
type Job={id:string,deviceId:string,action:string,state:string,detail:string};
const states:Record<string,string>={queued:'等待目标设备',done:'已写入',conflict:'来源有冲突',denied:'目标拒绝',failed:'失败',revoked:'设备已撤销'};
export function Directory({devices,canEdit,favorites,dial,lines}:{devices:Device[],canEdit:boolean,favorites:boolean,dial:(n:string,id?:string)=>void,lines:Line[]}){
 const [rows,setRows]=useState<Contact[]>([]),[selected,setSelected]=useState<Contact|null>(null),[query,setQuery]=useState('');
 const [editing,setEditing]=useState(false),[name,setName]=useState(''),[numbers,setNumbers]=useState(''),[targets,setTargets]=useState<Target[]>([]);
 const [error,setError]=useState(''),[busy,setBusy]=useState(false),[refresh,bump]=useState(0),[next,setNext]=useState<number|null>(null),[offset,setOffset]=useState(0);
 const [trash,setTrash]=useState(false),[other,setOther]=useState(''),[jobs,setJobs]=useState<Job[]>([]);
 const [defaultLine,setDefaultLine]=useState('');
 const [mergeQuery,setMergeQuery]=useState(''),[mergeResults,setMergeResults]=useState<Contact[]>([]);
 const [preferred,setPreferred]=useState(''),[updateGlobal,setUpdateGlobal]=useState(false);
 const [writeName,setWriteName]=useState(true),[writeNumbers,setWriteNumbers]=useState(false);
 const intent=useRef<{key:string,id:string}|null>(null),lock=useRef(false);
 const reload=()=>{setOffset(0);bump(v=>v+1)};
 useEffect(()=>{
   if(editing||selected||offset!==0)return;
   const timer=setInterval(()=>{if(!document.hidden)bump(v=>v+1)},15000);
   return()=>clearInterval(timer)
 },[editing,selected,offset]);
 useEffect(()=>{
   let active=true;const t=setTimeout(()=>{api<{items:Contact[],next:number|null}>('contacts?q='+encodeURIComponent(query)+'&offset='+offset+(trash?'&deleted=true':'')+(favorites?'&favorite=true':''))
     .then(r=>{if(active){setRows(prev=>offset?[...prev,...r.items]:r.items);setNext(r.next)}}).catch(e=>{if(active)setError(err(e))})},150);
   return()=>{active=false;clearTimeout(t)};
 },[query,offset,trash,refresh,favorites]);
 useEffect(()=>{if(!selected){setJobs([]);return}
   setDefaultLine(localStorage.getItem('phone.line.'+selected.id)||'');
   setJobs([]);if(!canEdit)return;
   let active=true;async function load(){try{const data=await api<{items:Job[]}>('contact-sync/jobs?contactId='+encodeURIComponent(selected!.id));if(active)setJobs(data.items)}catch(e){if(active)setError(err(e))}}
   void load();const t=setInterval(()=>{if(!document.hidden)void load()},5000);return()=>{active=false;clearInterval(t)};
 },[selected,canEdit]);
 useEffect(()=>{
   if(!selected||!mergeQuery.trim()){setMergeResults([]);return}
   let valid=true;const timer=setTimeout(()=>{api<{items:Contact[]}>('contacts?q='+encodeURIComponent(mergeQuery.trim())).then(r=>{
     if(valid)setMergeResults(r.items.filter(c=>c.id!==selected.id))
   }).catch(e=>{if(valid)setError(err(e))})},180);
   return()=>{valid=false;clearTimeout(timer)}
 },[selected,mergeQuery]);
 const deviceName=(id:string)=>devices.find(d=>d.deviceId===id)?.name||id;
 const writable=(id:string)=>(devices.find(d=>d.deviceId===id) as (Device&{contactsWrite?:boolean})|undefined)?.contactsWrite!==false;
 function edit(c:Contact|null){setSelected(c);setName(c?.name||'');setNumbers(c?.numbers.join('\n')||'');setTargets([]);setPreferred((c as (Contact&{preferredDeviceId?:string})|null)?.preferredDeviceId||'');setUpdateGlobal(false);setWriteName(true);setWriteNumbers(false);setEditing(true);setError('')}
 async function recheck(){if(!selected)return;try{
   const latest=await api<Contact>('contacts/'+encodeURIComponent(selected.id));setSelected(latest);setTargets([]);
   setError('已读取来源的当前版本。请核对下面的值并重新勾选写回目标。');
 }catch(e){setError(err(e))}}
 function toggle(t:Target){setTargets(prev=>prev.some(x=>x.deviceId===t.deviceId&&x.rawId===t.rawId)?prev.filter(x=>x.deviceId!==t.deviceId||x.rawId!==t.rawId):[...prev,t])}
 async function save(action:string,fields:Record<string,unknown>={}){
   if(lock.current)return;lock.current=true;setBusy(true);setError('');
   const body={...(selected?{id:selected.id,revision:selected.revision}:{}),...fields};
   const key=JSON.stringify([action,body]);if(intent.current?.key!==key)intent.current={key,id:crypto.randomUUID()};
   try{await api('contacts/'+action,{...body,requestId:intent.current.id});intent.current=null;setEditing(false);setSelected(null);reload()}
   catch(e){setError(err(e))}finally{lock.current=false;setBusy(false)}
 }
 const hint=error&&<p role="alert">{error}</p>;
 if(editing)return <><button onClick={()=>{setEditing(false);setTargets([])}}>取消</button><h1>{selected?'编辑联系人':'新建联系人'}</h1>
   <label>姓名或备注<input value={name} maxLength={200} onChange={e=>setName(e.target.value)}/></label>
   <label>电话号码（每行一个）<textarea value={numbers} rows={4} onChange={e=>setNumbers(e.target.value)}/></label>
   <h2>写回目标</h2><p className="hint">不勾选设备时，只修改统一通讯录。</p>
   {selected?.sources.map(s=><label key={s.deviceId+':'+s.rawId}><input type="checkbox" checked={targets.some(t=>t.deviceId===s.deviceId&&t.rawId===s.rawId)} disabled={s.readOnly||!writable(s.deviceId)} onChange={()=>toggle({deviceId:s.deviceId,rawId:s.rawId,revision:s.revision,action:'update'})}/>修改 {deviceName(s.deviceId)} · {s.name} · {s.numbers.join('、')}{s.readOnly?'（只读）':!writable(s.deviceId)?'（未授权写回）':''}</label>)}
   {devices.filter(d=>!selected?.sources.some(s=>s.deviceId===d.deviceId)).map(d=><label key={d.deviceId}><input type="checkbox" disabled={!writable(d.deviceId)} checked={targets.some(t=>t.deviceId===d.deviceId&&t.action==='create')} onChange={()=>toggle({deviceId:d.deviceId,action:'create'})}/>在 {d.name} 创建副本{!writable(d.deviceId)?'（未授权写回）':!d.online?'（离线排队）':''}</label>)}
   {selected&&targets.length>0&&<label><input type="checkbox" checked={updateGlobal} onChange={e=>setUpdateGlobal(e.target.checked)}/>同时修改统一备注和号码</label>}
   {targets.some(t=>t.action==='update')&&<fieldset><legend>修改已有来源的字段</legend>
     <label><input type="checkbox" checked={writeName} onChange={e=>setWriteName(e.target.checked)}/>写入姓名</label>
     <label><input type="checkbox" checked={writeNumbers} onChange={e=>setWriteNumbers(e.target.checked)}/>用上面填写的号码替换所选来源的号码</label></fieldset>}
   {selected&&(!targets.length||updateGlobal)&&<label>优先采用的姓名来源<select value={preferred} onChange={e=>setPreferred(e.target.value)}><option value="">自动选择</option>{[...new Set(selected.sources.map(s=>s.deviceId))].map(id=><option key={id} value={id}>{deviceName(id)}</option>)}</select><small>清空姓名可使用来源备注。</small></label>}
   <button className="primary" disabled={busy||(!name.trim()&&!numbers.trim())||(targets.some(t=>t.action==='update')&&!writeName&&!writeNumbers)} onClick={()=>void save(selected?'edit':'create',{name:name.trim(),numbers:numbers.split('\n').map(s=>s.trim()).filter(Boolean),targets:targets.map(t=>t.action==='update'?{...t,fields:[...(writeName?['name']:[]),...(writeNumbers?['numbers']:[])]}:t),preferredDeviceId:preferred,updateGlobal})}>保存</button>
   {selected&&error&&<button onClick={()=>void recheck()}>重新读取来源并核对</button>}
   {selected&&<button className="danger" disabled={busy||targets.some(t=>t.action==='create')} onClick={()=>{const list=targets.map(t=>deviceName(t.deviceId)).join('、');if(confirm(list?'删除以下设备上选中的来源联系人？\n'+list:'将此统一联系人移入最近删除？'))void save('delete',{confirm:true,targets:targets.map(t=>({...t,action:'delete'}))})}}>删除{targets.length?'选中的来源':'统一联系人'}</button>}
   {hint}</>;
 if(selected)return <><button onClick={()=>setSelected(null)}>‹ 通讯录</button><div className="monogram">{selected.name.slice(0,1)||'人'}</div><h1>{selected.name||'未命名'}</h1>
   {selected.conflict&&<p className="hint">同号码有不同来源，请核对后再合并。</p>}
   {selected.numbers.map(n=><button className="row" key={n} onClick={()=>dial(n,defaultLine)}>{n}<span>拨号 ›</span></button>)}
   <label>首选拨出线路<select value={defaultLine} onChange={e=>{setDefaultLine(e.target.value);localStorage.setItem('phone.line.'+selected.id,e.target.value)}}><option value="">每次选择</option>{lines.map(l=><option key={l.lineId} value={l.lineId}>{l.name}</option>)}</select></label>
   {canEdit&&(trash?<button disabled={busy} onClick={()=>void save('restore')}>恢复统一联系人</button>:<div className="controls"><button onClick={()=>edit(selected)}>编辑</button><button disabled={busy} onClick={()=>void save('edit',{favorite:!selected.favorite})}>{selected.favorite?'移出收藏':'加入收藏'}</button></div>)}
   <h2>来源</h2>{selected.sources.map(s=><article className="card" key={s.deviceId+s.rawId}><b>{deviceName(s.deviceId)}</b><p>{s.name} · {s.numbers.join('、')}</p><small>联系人 {s.contactId} · 来源 {s.rawId}{s.readOnly?' · 只读':''}</small>
   {!trash&&canEdit&&selected.sources.length>1&&<button disabled={busy} onClick={()=>{if(confirm('将这个来源拆分为独立联系人？'))void save('split',{deviceId:s.deviceId,rawId:s.rawId})}}>拆分</button>}</article>)}
   {!trash&&canEdit&&<details><summary>手动合并</summary><input type="search" aria-label="搜索待合并联系人" value={mergeQuery} onChange={e=>{setMergeQuery(e.target.value);setOther('')}} placeholder="搜索待合并联系人"/><select value={other} onChange={e=>setOther(e.target.value)}><option value="">选择另一联系人</option>{(mergeQuery.trim()?mergeResults:rows).filter(c=>c.id!==selected.id).map(c=><option key={c.id} value={c.id}>{c.name} · {c.numbers.join('、')}</option>)}</select><button disabled={!other||busy} onClick={()=>{const c=(mergeQuery.trim()?mergeResults:rows).find(r=>r.id===other);if(c&&confirm('核对号码与来源后，合并这两个联系人？'))void save('merge',{otherId:c.id,otherRevision:c.revision})}}>合并</button></details>}
   {!!jobs.length&&<><h2>同步记录</h2>{jobs.map(j=><p key={j.id}>{deviceName(j.deviceId)} · {states[j.state]||j.state} {j.detail}</p>)}
    {!trash&&jobs.some(j=>['conflict','failed','denied'].includes(j.state))&&<button onClick={()=>{edit(selected);void recheck()}}>核对后重新提交</button>}</>}{hint}</>;
 return <><div className="title"><h1>{favorites?'个人收藏':trash?'最近删除':'通讯录'}</h1>{canEdit&&!trash&&<button onClick={()=>edit(null)} aria-label="新建联系人">＋</button>}</div>
   <input type="search" placeholder="搜索姓名或号码" value={query} onChange={e=>{setQuery(e.target.value);setOffset(0)}}/>
   {!favorites&&<button className="subtle" onClick={()=>{setTrash(!trash);setOffset(0)}}>{trash?'返回通讯录':'最近删除'}</button>}
   {hint}{rows.filter(c=>!favorites||c.favorite).map(c=><button className="row" key={c.id} onClick={()=>{setOther('');setSelected(c)}}><b>{c.name||c.numbers[0]||'未命名'}</b><span>{c.conflict?'待核对':'›'}</span></button>)}
   {!rows.some(c=>!favorites||c.favorite)&&<p className="hint">{favorites?'还没有收藏联系人':query||trash?'没有匹配的联系人':'还没有联系人。请在需要共享的 Android 手机上打开「通讯数据授权」，开启通讯录共享。'}</p>}
   {next!==null&&<button onClick={()=>setOffset(next)}>载入更多</button>}<button onClick={reload}>刷新</button></>
}
