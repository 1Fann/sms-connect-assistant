import {NameEditor} from './NameEditor';
import {lineStatus,type SimLine} from './lines';

export function SimNames({phone,lines,onSave}:{phone:{id:string,name:string},lines:SimLine[],onSave:(id:number,name:string)=>Promise<string>}){
 const own=lines.filter(line=>line.phoneId===phone.id);
 const current=own.filter(line=>line.present!==false),history=own.filter(line=>line.present===false);
 const editor=(line:SimLine)=><div className="sim-name-row" key={line.lineId??line.id}>
  <NameEditor label={phone.name+' · SIM '+line.slot+(line.present===false?'（历史线路）':'')} value={line.simName} onSave={name=>onSave(line.id,name)}/>
  <p className="sim-line-status">{line.present===false?lineStatus(line):['当前卡',lineStatus(line)].filter(Boolean).join(' · ')}</p>
 </div>;
 return <>
  {current.map(editor)}
  {!current.length&&<p className="sim-line-status">当前未上报在位 SIM</p>}
  {!!history.length&&<details className="sim-history"><summary>历史线路（{history.length}）</summary>
   <p className="sim-line-status">保留用于识别历史短信，不能用于发送。换卡后的新线路需要单独确认。</p>
   {history.map(editor)}
  </details>}
 </>;
}
