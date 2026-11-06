import {useEffect,useRef,useState} from 'react';
import type {CSSProperties,PointerEvent,ReactNode} from 'react';
import {ArrowDownToLine,ArrowUpRight,Check,ChevronDown,Disc3,Expand,FlipHorizontal2,ImagePlus,Info,Move,RotateCcw,ShieldCheck,SlidersHorizontal,Upload,X,Plus,Minus,Grid2X2,Settings2} from 'lucide-react';
import {Engine} from './engine';
import type {Geometry,LoadState,Tone} from './engine';
import {compose,paintGray,sampleArtwork} from './canvas';
import type {Placement} from './canvas';
import {generate,prepareExport} from './export';
import type {ExportResult} from './export';
import presets from './presets.json';
import Calibration from './CalibrationPanel';
import {loadCalibration,storageKey,validGeometry as geometryIsValid} from './calibration';
import type {BurnRecord,CalibrationStore,Profile} from './calibration';

const initialPlacement:Placement={x:0,y:0,scale:1,rotation:0,mirror:false};
const initialTone:Tone={brightness:0,contrast:1,gamma:1,threshold:.5,dither:true,invert:false};
const prettyBytes=(b:number)=>b>=1e9?(b/1e9).toFixed(2)+' GB':(b/1e6).toFixed(1)+' MB';
function Slider({label,value,min,max,step=1,onChange,display}:{label:string;value:number;min:number;max:number;step?:number;onChange:(v:number)=>void;display?:string}){
 return <label className="slider-field"><span>{label}<output>{display??value}</output></span><input aria-label={label} type="range" min={min} max={max} step={step} value={value} onChange={e=>onChange(Number(e.target.value))}/></label>;
}
function Section({number,title,children}:{number:string;title:string;children:ReactNode}){
 return <section className="control-section"><div className="section-title"><span className="step-number">{number}</span><h2>{title}</h2></div>{children}</section>;
}
export default function App(){
 const [source,setSource]=useState(()=>({image:sampleArtwork() as CanvasImageSource,width:1600,height:1600,name:'Contour study',sample:true}));
 const [placement,setPlacement]=useState<Placement>(initialPlacement);
 const [tone,setTone]=useState<Tone>(initialTone);
 const [preset,setPreset]=useState(presets[0].id);
 const [view,setView]=useState<'artwork'|'calibration'>('artwork');
 const [saved]=useState(()=>{try{return {data:loadCalibration(),error:''}}catch(e){return {data:{records:[],profiles:[]} as CalibrationStore,error:(e as Error).message}}});
 const [calibration,setCalibration]=useState<CalibrationStore>(saved.data);
 const [exportBytes,setExportBytes]=useState(0);
 const [geometry,setGeometry]=useState<Geometry>(presets[0].geometry);
 const [physical,setPhysical]=useState(true);
 const [grid,setGrid]=useState(false);
 const [load,setLoad]=useState<LoadState>({ready:false,received:0,total:0});
 const [error,setError]=useState(saved.error);
 const [busy,setBusy]=useState(false);
 const [completed,setCompleted]=useState(0);
 const [started,setStarted]=useState(0);
 const [phase,setPhase]=useState('Preparing artwork…');
 const [result,setResult]=useState<ExportResult|null>(null);
 const [size,setSize]=useState(4096);
 const [proof,setProof]=useState(false);
 const [browserDownload,setBrowserDownload]=useState(false);
 const [help,setHelp]=useState(false);
 const [dragging,setDragging]=useState(false);
 const canvas=useRef<HTMLCanvasElement>(null);
 const input=useRef<HTMLInputElement>(null);
 const engine=useRef<Engine|null>(null);
 const exportEngine=useRef<Engine|null>(null);
 const abort=useRef<AbortController|null>(null);
 const preview=useRef<Uint8Array|null>(null);
 const resultRef=useRef<ExportResult|null>(null);
 const drag=useRef<{x:number;y:number;origin:Placement;size:number}|null>(null);
 const count=proof?32768:geometry.sectors;
 const total=busy?exportBytes:count*2048;
 useEffect(()=>{if(calibration===saved.data)return;try{localStorage.setItem(storageKey,JSON.stringify(calibration))}catch{setError('Could not save calibration in this browser. Export a JSON backup before leaving.')}},[calibration,saved]);
 function applyProfile(profile:Profile){setGeometry({...profile.geometry});setPreset('profile:'+profile.id)}

 useEffect(()=>{
  let disposed=false;
  const e=new Engine(setLoad);engine.current=e;e.request('load').catch(e=>{if(!disposed)setError(e.message)});
  return()=>{disposed=true;e.close();engine.current=null;abort.current?.abort();exportEngine.current?.close();void resultRef.current?.cleanup?.()};
 },[]);
 useEffect(()=>{
  if(!load.ready||busy)return;
  let cancelled=false;
  const timer=setTimeout(async()=>{
   try{
    const image=compose(source.image,source.width,source.height,placement,768);const pixels=image.data.buffer;
    const gray=await engine.current!.request<Uint8Array>('preview',{pixels,size:768,tone},[pixels]);
    if(!cancelled&&canvas.current){preview.current=gray;paintGray(canvas.current,gray,768,physical)}
   }catch(e){if(!cancelled)setError((e as Error).message)}
  },100);
  return()=>{cancelled=true;clearTimeout(timer)};
 },[source,placement,tone,load.ready,busy,physical]);
 useEffect(()=>{const handler=(e:BeforeUnloadEvent)=>{if(busy){e.preventDefault();e.returnValue=''}};window.addEventListener('beforeunload',handler);return()=>window.removeEventListener('beforeunload',handler)},[busy]);
 useEffect(()=>{if(!help)return;const onKey=(e:KeyboardEvent)=>{if(e.key==='Escape')setHelp(false)};document.addEventListener('keydown',onKey);return()=>document.removeEventListener('keydown',onKey)},[help]);
 const changePlacement=(p:Partial<Placement>)=>setPlacement(v=>({...v,...p}));
 const changeTone=(p:Partial<Tone>)=>setTone(v=>({...v,...p}));
 async function importFile(file?:File){
  if(!file||busy)return;setError('');
  if(!['image/png','image/jpeg','image/webp','image/gif','image/bmp'].includes(file.type)){setError('Choose a PNG, JPEG, WebP, GIF, or BMP image.');return}
  if(file.size>40*1024*1024){setError('Choose an image smaller than 40 MB.');return}
  const url=URL.createObjectURL(file);const img=new Image();
  try{
   img.src=url;await img.decode();
   if(img.naturalWidth*img.naturalHeight>64e6)throw Error('Choose an image with fewer than 64 million pixels.');
   // Freeze animated formats at import and bound the decoded source retained by the editor.
   const ratio=Math.min(1,4096/Math.max(img.naturalWidth,img.naturalHeight));
   const frozen=document.createElement('canvas');frozen.width=Math.round(img.naturalWidth*ratio);frozen.height=Math.round(img.naturalHeight*ratio);
   frozen.getContext('2d')!.drawImage(img,0,0,frozen.width,frozen.height);
   setSource({image:frozen,width:frozen.width,height:frozen.height,name:file.name,sample:false});setPlacement(initialPlacement);
  }catch(e){setError('Could not open this image. '+(e as Error).message)}finally{URL.revokeObjectURL(url);if(input.current)input.current.value=''}
 }
 function pointerDown(e:PointerEvent<HTMLDivElement>){
  if(busy)return;e.currentTarget.setPointerCapture(e.pointerId);
  drag.current={x:e.clientX,y:e.clientY,origin:placement,size:e.currentTarget.getBoundingClientRect().width};setDragging(true);
 }
 function pointerMove(e:PointerEvent<HTMLDivElement>){
  const d=drag.current;if(!d)return;
  changePlacement({x:Math.max(-100,Math.min(100,d.origin.x+(e.clientX-d.x)/d.size*100)),y:Math.max(-100,Math.min(100,d.origin.y+(e.clientY-d.y)/d.size*100))});
 }
 async function exportISO(record?:BurnRecord):Promise<boolean>{
  if(busy||!load.ready)return false;
  const exportCount=record?record.geometry.sectors:count;const exportGeometry=record?record.geometry:geometry;const bytes=exportCount*2048;setExportBytes(bytes);
  setError('');setCompleted(0);setBusy(true);setStarted(Date.now());setPhase(browserDownload?'Preparing local download…':'Choose a save location…');
  const controller=new AbortController();abort.current=controller;
  let sink:Awaited<ReturnType<typeof prepareExport>>|undefined;
  let e:Engine|undefined;
  try{
   const filename=record?`calibration-${record.id}-${record.pattern}.iso`:(source.name.replace(/\.[^.]+$/,'').replace(/[^a-z0-9_-]+/gi,'-').toLowerCase()||'dvd-art')+(proof?'-inner-ring-test':'')+'.iso';
   sink=await prepareExport(filename,bytes,browserDownload);
   setPhase('Preparing artwork…');
   if(controller.signal.aborted){await sink.abort();return false}
   await resultRef.current?.cleanup?.();setResult(null);resultRef.current=null;
   e=new Engine(()=>{});exportEngine.current=e;
   const pixels=record?null:compose(source.image,source.width,source.height,placement,size);
   const saved=await generate(e,sink,pixels,tone,exportGeometry,exportCount,controller.signal,(bytes)=>{setPhase(record?'Encoding calibration disc':'Encoding your disc');setCompleted(bytes)},record?.pattern);
   resultRef.current=saved;setResult(saved);return true;
  }catch(error){
   if(!e)await sink?.abort().catch(()=>{});
   if(!controller.signal.aborted&&(error as Error).name!=='AbortError')setError((error as Error).message);
   return false;
  }finally{e?.close();exportEngine.current=null;setBusy(false);abort.current=null}
 }
 const percent=Math.min(100,completed/total*100);
 const elapsed=(Date.now()-started)/1000;
 const remaining=completed>0?Math.max(0,elapsed*(total-completed)/completed):0;
 const validGeometry=geometryIsValid(geometry);
 return <div className="app">
  <header className="header"><a className="brand" href="/"><Disc3 size={29} strokeWidth={1.6}/><span>dvd<span className="brand-light">art</span><span className="brand-dot">.</span></span></a><div className="header-caption">A NEW LIFE FOR BLANK DISCS</div><div className="header-right"><span className="private-label"><span className="status-dot"/>Made locally. Stays local.</span><button className="text-button" onClick={()=>setHelp(true)}>How it works <ArrowUpRight size={15}/></button></div></header>
  <main>
   <div className="intro"><div><div className="eyebrow">THE DISC IS YOUR CANVAS</div><h1>Give your image a spin.</h1><p>Turn an ordinary DVD into something worth keeping.</p></div><div className="version-badge"><span className="small-disc"/>DVD STUDIO <span className="version">01</span></div></div>
   <nav className="studio-tabs" aria-label="Studio mode"><button className={view==='artwork'?'active':''} aria-pressed={view==='artwork'} disabled={busy} onClick={()=>setView('artwork')}><ImagePlus size={16}/>Artwork</button><button className={view==='calibration'?'active':''} aria-pressed={view==='calibration'} disabled={busy} onClick={()=>setView('calibration')}><Settings2 size={16}/>Calibrate your discs</button></nav>
   <div hidden={view!=='calibration'}><Calibration geometry={geometry} engine={engine.current} ready={load.ready} busy={busy} store={calibration} setStore={setCalibration} onExport={exportISO} onApply={applyProfile} onError={setError} browserDownload={browserDownload} setBrowserDownload={setBrowserDownload}/></div>
   <div className="studio" hidden={view!=='artwork'}>
    <aside className="controls"><fieldset disabled={busy}>
     <Section number="01" title="Your image">
      <button className="upload-area" onClick={()=>input.current?.click()} onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();void importFile(e.dataTransfer.files[0])}}><span className="upload-icon"><Upload size={20}/></span><strong>Drop an image, or browse</strong><span>PNG, JPG, WebP, GIF or BMP · up to 40 MB</span></button>
      <input ref={input} type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/bmp" hidden onChange={e=>void importFile(e.target.files?.[0])}/>
      <div className="file-row"><div className="file-icon"><ImagePlus size={17}/></div><div><strong title={source.name}>{source.name}</strong><span>{source.sample?'Sample artwork':source.width+' × '+source.height+' px'}</span></div><button className="icon-button" aria-label="Replace image" onClick={()=>input.current?.click()}><RotateCcw size={15}/></button></div>
     </Section>
     <Section number="02" title="Make it fit">
      <Slider label="Scale" value={placement.scale} min={.1} max={3} step={.01} display={Math.round(placement.scale*100)+'%'} onChange={v=>changePlacement({scale:v})}/>
      <Slider label="Rotation" value={placement.rotation} min={-180} max={180} display={placement.rotation+'°'} onChange={v=>changePlacement({rotation:v})}/>
      <div className="position-fields"><label>Horizontal <input aria-label="Horizontal position" type="number" min={-100} max={100} step={1} value={Number(placement.x.toFixed(1))} onChange={e=>changePlacement({x:Math.max(-100,Math.min(100,Number(e.target.value)))})}/></label><label>Vertical <input aria-label="Vertical position" type="number" min={-100} max={100} step={1} value={Number(placement.y.toFixed(1))} onChange={e=>changePlacement({y:Math.max(-100,Math.min(100,Number(e.target.value)))})}/></label></div>
      <div className="button-pair"><button className="small-button" onClick={()=>setPlacement(initialPlacement)}><Expand size={14}/>Reset position</button><button className={'small-button '+(placement.mirror?'selected':'')} aria-pressed={placement.mirror} onClick={()=>changePlacement({mirror:!placement.mirror})}><FlipHorizontal2 size={15}/>Mirror</button></div>
     </Section>
     <Section number="03" title="Find your contrast">
      <div className="segmented"><button className={tone.dither?'active':''} aria-pressed={tone.dither} onClick={()=>changeTone({dither:true})}>Dithered</button><button className={!tone.dither?'active':''} aria-pressed={!tone.dither} onClick={()=>changeTone({dither:false})}>Black & white</button></div>
      <p className="control-note">{tone.dither?'Fine dots preserve the tones in photos.':'Clean, solid shapes for logos and line art.'}</p>
      <Slider label="Contrast" value={tone.contrast} min={.2} max={2} step={.01} display={Math.round(tone.contrast*100)+'%'} onChange={v=>changeTone({contrast:v})}/>
      <Slider label="Brightness" value={tone.brightness} min={-.5} max={.5} step={.01} display={(tone.brightness>0?'+':'')+Math.round(tone.brightness*100)} onChange={v=>changeTone({brightness:v})}/>
      <details className="tone-more"><summary>More tone controls <ChevronDown size={13}/></summary><Slider label="Gamma" value={tone.gamma} min={.3} max={3} step={.05} onChange={v=>changeTone({gamma:v})}/><Slider label="Threshold" value={tone.threshold} min={.05} max={.95} step={.01} display={Math.round(tone.threshold*100)+'%'} onChange={v=>changeTone({threshold:v})}/></details>
      <label className="switch-row"><span>Invert light & dark</span><input type="checkbox" checked={tone.invert} onChange={e=>changeTone({invert:e.target.checked})}/><span className="switch"/></label>
     </Section>
    </fieldset></aside>
    <section className="workspace" aria-label="Disc editor">
     <div className="workspace-top"><div className="view-switch"><button className={physical?'active':''} onClick={()=>setPhysical(true)}>Disc preview</button><button className={!physical?'active':''} onClick={()=>setPhysical(false)}>Artwork</button></div><button className={'icon-button '+(grid?'selected':'')} aria-label="Toggle alignment guides" aria-pressed={grid} onClick={()=>setGrid(v=>!v)}><Grid2X2 size={17}/></button></div>
     <div className={'disc-stage '+(grid?'show-grid':'')} onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();void importFile(e.dataTransfer.files[0])}}>
      <div className="dimension dimension-top"><span>120 MM</span></div>
      <div className={'disc '+(!physical?'flat-disc ':'')+(dragging?'dragging':'')} role="img" aria-label="Artwork positioned on the DVD recording surface. Drag to reposition, or use the position controls." onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={()=>{drag.current=null;setDragging(false)}} onPointerCancel={()=>{drag.current=null;setDragging(false)}} style={{'--hole':geometry.inner/geometry.outer*50+'%','--drawing-size':geometry.outer/60*100+'%'} as CSSProperties}>
       <canvas ref={canvas} className="disc-art"/><div className="disc-sheen"/><div className="disc-inner" style={{width:geometry.inner/60*100+'%',height:geometry.inner/60*100+'%'}}><div className="hub-ring"/><div className="hub"><span/></div></div><div className="guide-cross"/>
      </div>
      {!load.ready&&<div className="loading-card" role="status"><Disc3 className="spinning" size={22}/><strong>Preparing your studio</strong><span>Loading the Go encoder{load.total?' · '+prettyBytes(load.received)+' / '+prettyBytes(load.total):'…'}</span><progress max={load.total||1} value={load.received}/></div>}
      <div className="dimension dimension-bottom"><span>RECORDING SIDE · {geometry.inner.toFixed(1)}–{geometry.outer.toFixed(1)} MM</span></div>
     </div>
     <div className="canvas-actions"><span><Move size={14}/>Drag artwork to reposition</span><div><button className="icon-button" aria-label="Zoom out artwork" disabled={busy} onClick={()=>changePlacement({scale:Math.max(.1,placement.scale-.1)})}><Minus size={16}/></button><span>{Math.round(placement.scale*100)}%</span><button className="icon-button" aria-label="Zoom in artwork" disabled={busy} onClick={()=>changePlacement({scale:Math.min(3,placement.scale+.1)})}><Plus size={16}/></button></div></div>
     <div className="preview-note"><Info size={15}/><span>A layout preview. Disc material, calibration and light shape the final result.</span></div>
    </section>
   </div>
   <section className={'export-section '+(view==='calibration'?'cal-export-status':'')} hidden={view==='calibration'&&!busy&&!result&&!error}>
    <div hidden={view!=='artwork'}>
    <div className="export-heading"><span className="step-number">04</span><div><h2>Ready for the real thing?</h2><p>Build your ISO. Burn it. Hold your artwork.</p></div></div>
    <div className="export-options"><label className="select-field">YOUR BLANK DISC<select aria-label="Disc preset" disabled={busy} value={preset} onChange={e=>{setPreset(e.target.value);const p=calibration.profiles.find(p=>'profile:'+p.id===e.target.value)??presets.find(p=>p.id===e.target.value);if(p)setGeometry({...p.geometry})}}>{presets.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}{calibration.profiles.map(p=><option key={p.id} value={'profile:'+p.id}>{p.name} · {p.stage==='bands'?'coarse':'line fitted'}</option>)}</select></label><label className="select-field">EXPORT<select aria-label="Export size" disabled={busy} value={proof?'proof':'full'} onChange={e=>setProof(e.target.value==='proof')}><option value="full">Full disc · {prettyBytes(geometry.sectors*2048)}</option><option value="proof">Inner-ring test · 67.1 MB</option></select></label><button className="export-button" onClick={()=>void exportISO()} disabled={busy||!load.ready||!validGeometry}><ArrowDownToLine size={18}/>{busy?'Creating your ISO…':'Generate ISO'}<span>{prettyBytes(total)}</span></button></div>
    {proof&&<p className="proof-note"><Info size={14}/>The test ISO writes only a narrow inner ring. Use full disc for the complete artwork.</p>}
    </div>
    {busy&&<div className="export-progress" role="status" aria-live="polite"><div><strong>{phase} <span>{percent.toFixed(1)}%</span></strong><button className="text-button" onClick={()=>{setPhase('Cancelling…');abort.current?.abort();exportEngine.current?.close()}}>Cancel <X size={14}/></button></div><progress max={total} value={completed}/><p>{prettyBytes(completed)} of {prettyBytes(total)} · {completed>0?'about '+Math.max(1,Math.ceil(remaining/60))+' min remaining':'Keep this tab open'} · streaming to disk</p></div>}
    {result&&!busy&&<div className="success-message" role="status"><Check size={19}/><div><strong>{result.url?'Your ISO is ready':'ISO saved to your computer'}</strong><span>{result.name} · {prettyBytes(result.bytes)}. Burn as a disc image and finalize the disc.</span></div>{result.url&&<a className="small-button" href={result.url} download={result.name}>Download ISO <ArrowDownToLine size={15}/></a>}</div>}
    {error&&<div className="error-message" role="alert"><Info size={18}/><span>{error}</span><button className="icon-button" aria-label="Dismiss error" onClick={()=>setError('')}><X size={16}/></button></div>}
    <div className="export-details" hidden={view!=='artwork'}><span><ShieldCheck size={15}/>Your image never leaves this browser</span><span><Disc3 size={15}/>Art first. No audio or video.</span><details><summary><Settings2 size={14}/>Fine-tune your disc <ChevronDown size={13}/></summary><div className="advanced"><p>Accurate media geometry makes the difference. Measured presets are from DiscImageStudio; generic values need a test burn. Advanced edits apply for this session. Use Calibrate your discs to measure and save a burner / media profile.</p><div className="geometry-fields">{([['inner','Inner radius (mm)'],['outer','Outer radius (mm)'],['bitLength','Channel bit (nm)'],['sectors','Sector capacity'],['pitchLinear','Pitch · linear'],['pitchQuadratic','Pitch · quadratic'],['pitchCubic','Pitch · cubic'],['startAngle','Start angle (°)']] as const).map(([key,label])=><label key={key}>{label}<input aria-label={label} type="number" step="any" disabled={busy} value={geometry[key]} onChange={e=>{const n=Number(e.target.value);if(Number.isFinite(n))setGeometry(g=>({...g,[key]:n}))}}/></label>)}<label>Save method<select aria-label="Save method" disabled={busy} value={browserDownload?"download":"direct"} onChange={e=>setBrowserDownload(e.target.value==="download")}><option value="direct">Save directly · recommended</option><option value="download">Browser download · uses local storage</option></select></label><label>Artwork resolution<select aria-label="Artwork resolution" disabled={busy} value={size} onChange={e=>setSize(Number(e.target.value))}><option value={4096}>4096 × 4096 · highest detail</option><option value={2048}>2048 × 2048 · lower memory</option></select></label></div></div></details></div>
   </section>
   <section className="how-strip"><div><span className="strip-number">1</span><p><strong>Make it yours.</strong><br/>Photos, illustrations, a happy accident.</p></div><div><span className="strip-number">2</span><p><strong>Let the pattern do the work.</strong><br/>Carefully chosen data becomes visible art.</p></div><div><span className="strip-number">3</span><p><strong>Burn a little something different.</strong><br/>A regular burner. A blank DVD. Your image.</p></div></section>
  </main>
  <footer><span>Made for the joy of making.</span><div><span>{load.ready?'Go + WebAssembly · '+prettyBytes(load.total):'Go + WebAssembly'}</span><a href="https://github.com/officialdavidtaylor/disk-art" target="_blank" rel="noreferrer">Source <ArrowUpRight size={12}/></a><a href="/LICENSE" target="_blank" rel="noreferrer">GPL-3.0+</a></div></footer>
  {help&&<div className="modal-backdrop" onClick={()=>setHelp(false)}><div className="modal" role="dialog" aria-modal="true" aria-labelledby="help-title" onClick={e=>e.stopPropagation()}><button className="icon-button close-modal" autoFocus aria-label="Close instructions" onClick={()=>setHelp(false)}><X size={20}/></button><Disc3 size={34} className="orange"/><h2 id="help-title">An image, written in data.</h2><p>DVD Art chooses data patterns that create contrasting textures on the recording side of a DVD. Your burner handles the physical writing.</p><ol><li>Import an image, then position it in the recording ring. Bold shapes work well. Use dithering for photographs.</li><li>Choose your actual blank media. Geometry is sensitive: a generic preset can produce a curved or distorted image. Use a measured preset or open Calibrate your discs for guided test burns and saved profiles.</li><li>Generate a full-disc ISO. Desktop Chrome or Edge can save directly to disk; other supported browsers use temporary local storage. Leave at least 5 GB free.</li><li>Use your burning application's <strong>burn disc image</strong> mode, select this ISO, and finalize a blank single-layer DVD. Copying the ISO as a file will not work.</li></ol><p>The disc mounts as a minimal data volume with README.TXT and WEBSITE.URL. It contains no playable media; standalone players may report “no playable content” or reject it.</p><p>Physical contrast and readback depend on the recorder and media. This MVP prioritizes artwork textures; a hardware burn has not yet been validated. The preview is not an optical simulation.</p><a href="https://github.com/JiaFeiMiao-K-Cat/DiscImageStudio" target="_blank" rel="noreferrer">Based on research from DiscImageStudio <ArrowUpRight size={14}/></a></div></div>}
 </div>;
}
