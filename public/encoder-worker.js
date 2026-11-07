/* SPDX-License-Identifier: GPL-3.0-or-later */
let boot;
async function ready() {
 if (!boot) boot = (async () => {
  importScripts('/wasm_exec.js');
  const metaResponse=await fetch('/encoder-meta.json', {cache:'no-cache'});
  if(!metaResponse.ok) throw Error('Could not load encoder metadata');
  const meta=await metaResponse.json();
  const response=await fetch('/encoder.wasm?v='+meta.sha256);
  if(!response.ok||!response.body) throw Error('Could not download the Go encoder');
  const reader=response.body.getReader();const chunks=[];let received=0;
  while(true) { const {value,done}=await reader.read();if(done)break;chunks.push(value);received+=value.length;postMessage({type:'loading',received,total:meta.bytes}); }
  const bytes=new Uint8Array(received);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length}
  const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
  if(digest!==meta.sha256)throw Error('Encoder download was incomplete or stale. Reload to try again.');
  const go=new Go();const result=await WebAssembly.instantiate(bytes,go.importObject);
  go.run(result.instance).catch(error=>postMessage({type:'fatal',error:error.message}));
  postMessage({type:'ready',bytes:received});
 })();
 return boot;
}
// Serial processing keeps initialization, preview, and export state ordered.
let queue=Promise.resolve();
onmessage=({data})=>{
 queue=queue.then(async()=>{
  try {
   await ready();
   let result;
   if(data.type==='load')result=true;
   else if(data.type==='preview')result=dvdPreview(new Uint8Array(data.pixels),data.size,JSON.stringify(data.tone));
   else if(data.type==='start')result=dvdStart(new Uint8Array(data.pixels),data.size,JSON.stringify(data.tone),JSON.stringify(data.config));
   else if(data.type==='calibration-start')result=dvdCalibrationStart(JSON.stringify(data.config),data.pattern);
   else if(data.type==='sweep-plan'){result=dvdSweepPlan(JSON.stringify(data.config));if(typeof result==='string')result=JSON.parse(result)}
   else if(data.type==='sweep-fit'){result=dvdSweepFit(JSON.stringify(data.request));if(typeof result==='string')result=JSON.parse(result)}
   else if(data.type==='calibrate'){result=dvdCalibrate(JSON.stringify(data.request));if(typeof result==='string')result=JSON.parse(result)}
   else if(data.type==='chunk')result=dvdChunk(data.start,data.count);
   else if(data.type==='release')result=dvdRelease();
   else throw Error('Unknown encoder command');
   if(result?.error)throw Error(result.error);
   if(result instanceof Uint8Array)postMessage({id:data.id,result},[result.buffer]);
   else postMessage({id:data.id,result});
  } catch(error){postMessage({id:data.id,error:error.message||String(error)});}
 });
};
