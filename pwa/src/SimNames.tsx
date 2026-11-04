import {NameEditor} from './NameEditor';
import {isPresentSim,lineStatus,type SimLine} from './lines';

export function SimNames({phone,lines,onSave}:{phone:{id:string,name:string},lines:SimLine[],onSave:(id:number,name:string)=>Promise<string>}){
 const current=lines.filter(line=>line.phoneId===phone.id).filter(isPresentSim);
 const editor=(line:SimLine)=><div className="sim-name-row" key={line.lineId??line.id}>
  <NameEditor label={phone.name+' · SIM '+line.slot} value={line.simName} onSave={name=>onSave(line.id,name)}/>
  {lineStatus(line)&&<p className="sim-line-status">{lineStatus(line)}</p>}
 </div>;
 return <>
  {current.map(editor)}
 </>;
}
