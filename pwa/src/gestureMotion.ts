export type SpringState={position:number,velocity:number};

/** Bounded integration steps preserve damping at 60/120 Hz and after a delayed frame. */
export function stepSpring(state:SpringState,target:number,seconds:number):SpringState{
 const duration=Math.max(0,Math.min(seconds,.064)),steps=Math.max(1,Math.ceil(duration/(1/240))),dt=duration/steps;
 let {position,velocity}=state;
 for(let i=0;i<steps;i++){velocity+=(520*(target-position)-42*velocity)*dt;position+=velocity*dt}
 return {position,velocity};
}
export function rubberBand(distance:number,extent=120):number{
 return distance===0?0:Math.sign(distance)*extent*(1-1/(Math.abs(distance)*.35/extent+1));
}

/** Transient gesture frames stay out of React. Interrupting preserves the displayed position and velocity. */
export class SpringMotion {
 private x:number;
 private v=0;
 private frame:number|null=null;
 private dragTime:number|null=null;
 private destroyed=false;
 constructor(private readonly write:(position:number)=>void,initial=0){this.x=initial}
 get position(){return this.x}
 get velocity(){return this.v}
 private cancel(){if(this.frame!==null)cancelAnimationFrame(this.frame);this.frame=null}
 interrupt():SpringState{this.cancel();this.dragTime=performance.now();return {position:this.x,velocity:this.v}}
 dragTo(position:number,time=performance.now()){
  if(this.destroyed)return;
  if(this.dragTime!==null){const dt=(time-this.dragTime)/1000;if(dt>0&&dt<.12){const next=(position-this.x)/dt;this.v=Math.max(-2400,Math.min(2400,.3*this.v+.7*next))}else this.v=0}
  this.x=position;this.dragTime=time;
  if(this.frame===null)this.frame=requestAnimationFrame(()=>{this.frame=null;if(!this.destroyed)this.write(this.x)});
 }
 springTo(target:number,velocity=this.v){
  if(this.destroyed)return;
  this.cancel();this.dragTime=null;this.v=Math.max(-2400,Math.min(2400,velocity));
  if(Math.abs(this.x-target)<.12&&Math.abs(this.v)<1.5){this.jumpTo(target);return}
  if(typeof matchMedia==='function'&&matchMedia('(prefers-reduced-motion: reduce)').matches){this.jumpTo(target);return}
  let previous=performance.now();
  const tick=(now:number)=>{
   this.frame=null;if(this.destroyed)return;
   const next=stepSpring({position:this.x,velocity:this.v},target,(now-previous)/1000);previous=now;this.x=next.position;this.v=next.velocity;
   if(Math.abs(this.x-target)<.12&&Math.abs(this.v)<1.5){this.x=target;this.v=0;this.write(target);return}
   this.write(this.x);if(!this.destroyed)this.frame=requestAnimationFrame(tick);
  };
  this.frame=requestAnimationFrame(tick);
 }
 jumpTo(position:number){this.cancel();this.dragTime=null;this.x=position;this.v=0;if(!this.destroyed)this.write(position)}
 destroy(){this.cancel();this.destroyed=true}
}
