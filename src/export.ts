import {Engine} from './engine';
import type {Geometry,Tone} from './engine';
export type ExportResult={url?:string;name:string;bytes:number;cleanup?:()=>Promise<void>};
type Sink={write:(data:Uint8Array)=>Promise<void>;close:()=>Promise<void>;abort:()=>Promise<void>;finish:()=>Promise<ExportResult>};
type SaveHandle={createWritable:()=>Promise<FileSystemWritableFileStream>};
type SaveWindow=Window&{showSaveFilePicker?:(options:unknown)=>Promise<SaveHandle>};
export async function prepareExport(name:string,bytes:number,browserDownload=false):Promise<Sink>{
 const picker=(window as SaveWindow).showSaveFilePicker;
 if(picker&&!browserDownload){
  // Called directly from the click handler, while user activation is live.
  const handle=await picker.call(window,{suggestedName:name,types:[{description:'DVD disc image',accept:{'application/x-iso9660-image':['.iso']}}]});
  const stream=await handle.createWritable();
  return {write:d=>stream.write(d as unknown as BufferSource),close:()=>stream.close(),abort:()=>stream.abort(),finish:async()=>({name,bytes})};
 }
 if(!navigator.storage?.getDirectory)throw Error('Use a current desktop Chrome or Edge browser to save a multi-gigabyte ISO directly to disk.');
 const estimate=await navigator.storage.estimate();
 if(estimate.quota!==undefined&&estimate.quota-(estimate.usage??0)<bytes*1.05)throw Error('There is not enough browser storage for this ISO. Use desktop Chrome or Edge to save directly to disk.');
 const root=await navigator.storage.getDirectory();
 const dir=await root.getDirectoryHandle('dvd-art-exports',{create:true});
 // Remove leftovers from an interrupted export in this tab's session only.
 const key='dvd-art-temp';const previous=sessionStorage.getItem(key);
 if(previous)await dir.removeEntry(previous).catch(()=>{});
 const temp=crypto.randomUUID()+'.iso';sessionStorage.setItem(key,temp);
 const handle=await dir.getFileHandle(temp,{create:true});
 const stream=await handle.createWritable();
 const cleanup=async()=>{await dir.removeEntry(temp).catch(()=>{});if(sessionStorage.getItem(key)===temp)sessionStorage.removeItem(key)};
 return {write:d=>stream.write(d as unknown as BufferSource),close:()=>stream.close(),abort:async()=>{await stream.abort().catch(()=>{});await cleanup()},finish:async()=>{
  const file=await handle.getFile();const url=URL.createObjectURL(file);
  return {name,bytes,url,cleanup:async()=>{URL.revokeObjectURL(url);await cleanup()}};
 }};
}
export async function generate(engine:Engine,sink:Sink,pixels:ImageData|null,tone:Tone,config:Geometry,count:number,signal:AbortSignal,progress:(bytes:number)=>void,pattern?:'bands'|'line'){
 try{
  if(signal.aborted)throw Error('Export cancelled');
  if(pattern)await engine.request('calibration-start',{config:{...config,outputSectors:count},pattern});
  else {if(!pixels)throw Error('Missing artwork');const raw=pixels.data.buffer;await engine.request('start',{pixels:raw,size:pixels.width,tone,config:{...config,outputSectors:count}},[raw]);}
  for(let start=0;start<count;start+=256){
   if(signal.aborted)throw Error('Export cancelled');
   const chunk=await engine.request<Uint8Array>('chunk',{start,count:Math.min(256,count-start)});
   if(signal.aborted)throw Error('Export cancelled');
   await sink.write(chunk);progress((start+chunk.length/2048)*2048);
  }
  if(signal.aborted)throw Error('Export cancelled');
  await sink.close();return await sink.finish();
 }catch(error){await sink.abort().catch(()=>{});throw error}
 finally{await engine.request('release').catch(()=>{})}
}
