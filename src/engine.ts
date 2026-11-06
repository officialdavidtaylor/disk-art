export type Tone={brightness:number;contrast:number;gamma:number;threshold:number;dither:boolean;invert:boolean};
export type Geometry={sectors:number;inner:number;outer:number;bitLength:number;pitchLinear:number;pitchQuadratic:number;pitchCubic:number;startAngle:number};
export type LoadState={ready:boolean;received:number;total:number};
export class Engine {
 private worker=new Worker('/encoder-worker.js');
 private id=0;
 private closed=false;
 private pending=new Map<number,{resolve:(v:unknown)=>void;reject:(e:Error)=>void}>();
 constructor(onLoad:(state:LoadState)=>void) {
  this.worker.onmessage=({data})=>{
   if(data.type==='loading')onLoad({ready:false,received:data.received,total:data.total});
   else if(data.type==='ready')onLoad({ready:true,received:data.bytes,total:data.bytes});
   else if(data.type==='fatal')this.fail(new Error(data.error));
   else {const p=this.pending.get(data.id);if(!p)return;this.pending.delete(data.id);if(data.error)p.reject(new Error(data.error));else p.resolve(data.result);}
  };
  this.worker.onerror=()=>this.fail(new Error('The encoder stopped unexpectedly. Reload and try again.'));
 }
 private fail(error:Error){for(const p of this.pending.values())p.reject(error);this.pending.clear()}
 request<T>(type:string,args:Record<string,unknown>={},transfer:Transferable[]=[]):Promise<T>{
  if(this.closed)return Promise.reject(new Error('Export cancelled'));
  return new Promise((resolve,reject)=>{const id=++this.id;this.pending.set(id,{resolve:resolve as (v:unknown)=>void,reject});this.worker.postMessage({id,type,...args},transfer)});
 }
 close(){this.closed=true;this.fail(new Error('Export cancelled'));this.worker.terminate()}
}
