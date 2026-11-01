export function detailBackIntent(dx:number,dy:number,elapsed:number):boolean {
 if(Math.abs(dy)>Math.max(16,dx*.7))return false;
 return dx>=44 || (dx>=18&&dx/Math.max(1,elapsed)>=.35);
}
