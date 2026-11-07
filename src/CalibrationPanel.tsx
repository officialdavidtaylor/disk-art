import {useEffect,useRef,useState} from 'react';
import type {MouseEvent as ReactMouseEvent} from 'react';
import {ArrowDownToLine,Check,Disc3,Download,FolderOpen,Plus,RotateCcw,Target,Upload} from 'lucide-react';
import type {Engine,Geometry} from './engine';
import {bandFractions,edgeLabels,maxell,patternName,photoFrame,saveJSON,saveTriangleTarget,triangleShape,validGeometry,validateProfile,validateRecord} from './calibration';
import type {BurnRecord,CalibrationStore,Fit,Pattern,Point,Profile,TriangleEdge} from './calibration';

import AngularResult from './AngularResult';

type Props={geometry:Geometry;engine:Engine|null;ready:boolean;busy:boolean;store:CalibrationStore;setStore:(store:CalibrationStore)=>void;onExport:(record:BurnRecord)=>Promise<boolean>;onApply:(profile:Profile)=>void;onError:(error:string)=>void;browserDownload:boolean;setBrowserDownload:(value:boolean)=>void};

function PatternPreview({record}:{record:BurnRecord}){
 const g=record.geometry;const triangle=triangleShape(g);const edges=bandFractions(g.sectors).map(f=>Math.sqrt(g.inner*g.inner+(g.outer*g.outer-g.inner*g.inner)*f));
 return <svg className="cal-pattern" viewBox="-62 -62 124 124" role="img" aria-label={record.pattern==='bands'?'Three broad dark rings at known sector addresses':record.pattern==='triangles-v1'?'Four outward-pointing triangle spokes, with one example trace edge highlighted':'One straight radial line, the ideal result of a calibrated burn'}>
  <circle r="60" fill="#dce1d2" stroke="#9ba78f" strokeWidth=".4"/><circle r={g.outer} fill="#f3f4e9"/>
  {record.pattern==='bands'?edges.filter((_,i)=>i%2===0).map((r,i)=><circle key={r} r={(r+edges[i*2+1])/2} fill="none" stroke="#52624a" strokeWidth={edges[i*2+1]-r}/>):record.pattern==='triangles-v1'?<>{[0,90,180,270].map(angle=><polygon key={angle} points={`${triangle.base},-${triangle.halfBase} ${triangle.tip},0 ${triangle.base},${triangle.halfBase}`} transform={`rotate(${angle})`} fill="#52624a"/>)}<path d={`M ${triangle.base} ${record.triangleEdge==='counterclockwise'?-triangle.halfBase:triangle.halfBase} L ${triangle.tip} 0`} stroke="#df7951" strokeWidth=".55"/></>:<path d={`M ${g.inner} 0 H ${g.outer}`} stroke="#52624a" strokeWidth="1.2"/>}
  <circle r={g.inner} fill="#dce1d2"/><circle r="7.5" fill="#fafaf6" stroke="#9ba78f" strokeWidth=".3"/>
 </svg>;
}

function PhotoMeasure({record,fit,onChange,onError}:{record:BurnRecord;fit:Fit|null;onChange:(patch:Partial<BurnRecord>)=>void;onError:(error:string)=>void}){
 const [photo,setPhoto]=useState<{url:string;width:number;height:number;name:string}|null>(null);
 const [rim,setRim]=useState<Point[]>([]);const [zoom,setZoom]=useState(1);const input=useRef<HTMLInputElement>(null);
 useEffect(()=>()=>{if(photo)URL.revokeObjectURL(photo.url)},[photo]);
 let frame:ReturnType<typeof photoFrame>=null;let frameError='';try{frame=photoFrame(rim)}catch(e){frameError=(e as Error).message}
 async function open(file?:File){
  if(!file)return;
  if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>40*1024*1024){onError('Choose a JPEG, PNG or WebP photo smaller than 40 MB.');return}
  const url=URL.createObjectURL(file);const img=new Image();img.src=url;
  try{await img.decode();if(img.width*img.height>64e6)throw Error('Choose a photo under 64 million pixels.');setPhoto({url,width:img.width,height:img.height,name:file.name});setRim([]);setZoom(1);onChange({radii:Array(6).fill(''),points:[]});}
  catch(e){URL.revokeObjectURL(url);onError('Could not read photo. '+(e as Error).message)}finally{if(input.current)input.current.value=''}
 }
 function mark(e:ReactMouseEvent<SVGSVGElement>){
  if(!photo||e.button!==0||e.currentTarget.closest('fieldset')?.disabled)return;
  const bounds=e.currentTarget.getBoundingClientRect();const p={x:(e.clientX-bounds.left)/bounds.width*photo.width,y:(e.clientY-bounds.top)/bounds.height*photo.height};
  if(rim.length<4){setRim(v=>[...v,p]);return}
  if(!frame)return;
  const point={x:(p.x-frame.center.x)/frame.scale,y:(p.y-frame.center.y)/frame.scale};const radius=Math.hypot(point.x,point.y);
  if(radius<20||radius>59){onError('Choose a point inside the recording area, 20–59 mm from the centre.');return}
  if(record.pattern==='bands'){
   const next=record.radii.findIndex(v=>v==='');if(next<0)return;
   if(next>0&&radius<=Number(record.radii[next-1])){onError('Mark the six band edges from the centre outward.');return}
   onChange({radii:record.radii.map((v,i)=>i===next?radius.toFixed(4):v)});
  }else{
   if(record.points.length>=2000){onError('Maximum 2000 trace points.');return}
   if(record.points.length&&radius<=Math.hypot(record.points.at(-1)!.x,record.points.at(-1)!.y)+.01){onError('Follow the same line outward. The next point must be farther from the centre.');return}
   onChange({points:[...record.points,point]});
  }
 }
 const prompts=['leftmost rim','rightmost rim','topmost rim','bottommost rim'];
 const nextEdge=record.radii.findIndex(v=>v==='');
 return <div className="photo-measure">
  <div className="cal-actions"><button className="small-button" onClick={()=>input.current?.click()}><Upload size={14}/>{photo?'Replace photo':'Open a burn photo'}</button><input ref={input} hidden type="file" accept="image/jpeg,image/png,image/webp" onChange={e=>void open(e.target.files?.[0])}/><span>Photos stay in this browser.</span></div>
  <p className="cal-hint">Photograph the recording side straight on, with the entire 120 mm physical rim visible. Use even light, a long camera distance and no mirrored image. Tilt or lens distortion makes the fit unreliable. Replacing the photo clears its measurements.</p>
  {photo&&<>
   <div className="photo-toolbar"><strong aria-live="polite">{rim.length<4?`${rim.length+1}/4 · Mark the ${prompts[rim.length]}`:frameError?'Reset the rim points':record.pattern==='bands'?(nextEdge<0?'All six edges measured':`Mark ${edgeLabels[nextEdge].toLowerCase()}`):`Trace ${record.pattern==='triangles-v1'?'one '+record.triangleEdge+' edge':'the line'} outward · ${record.points.length} points`}</strong><label>Zoom <input aria-label="Photo zoom" type="range" min={1} max={4} step={.25} value={zoom} onChange={e=>setZoom(Number(e.target.value))}/></label></div>
   <div className="photo-scroll" style={{maxWidth:Math.min(600,600*photo.width/photo.height)}}><svg style={{width:zoom*100+'%',maxWidth:'none'}} viewBox={`0 0 ${photo.width} ${photo.height}`} onClick={mark} role="img" aria-label="Calibration photo. Click the four rim extremes, then the requested measurements. Manual entry is available below.">
    <image href={photo.url} width={photo.width} height={photo.height}/>
    {rim.map((p,i)=><g key={i}><circle cx={p.x} cy={p.y} r={photo.width/130/zoom} fill="#db6b49" stroke="white" strokeWidth={photo.width/700/zoom}/><text x={p.x+photo.width/80/zoom} y={p.y} fontSize={photo.width/40/zoom} fill="white">{i+1}</text></g>)}
    {frame&&<g transform={`translate(${frame.center.x},${frame.center.y}) scale(${frame.scale})`}>
     <circle r="60" fill="none" stroke="#eec868" strokeWidth={.2/zoom}/><path d="M -2 0 H 2 M 0 -2 V 2" stroke="#eec868" strokeWidth={.2/zoom}/>
     {record.pattern==='bands'?record.radii.map((r,i)=>r!==''&&<circle key={i} r={Number(r)} stroke="#eec868" fill="none" strokeWidth={.15/zoom}/>):<>{fit?.curve&&<polyline points={fit.curve.map(p=>`${p.x},${p.y}`).join(' ')} stroke="#7fffba" fill="none" strokeWidth={.25/zoom}/>} {record.points.map((p,i)=><circle key={i} cx={p.x} cy={p.y} r={.35/zoom} fill="#ffba79" stroke="white" strokeWidth={.07/zoom}/>)}</>}
    </g>}
   </svg></div>
   {frameError&&<p className="cal-warning" role="alert">{frameError}</p>}
   <div className="cal-actions"><button className="small-button" onClick={()=>{setRim([]);onChange({radii:Array(6).fill(''),points:[]})}}><RotateCcw size={13}/>Reset photo scale</button><button className="small-button" disabled={!rim.length} onClick={()=>{if(rim.length<4||frameError){setRim(v=>v.slice(0,-1));return}if(record.pattern!=='bands')onChange({points:record.points.slice(0,-1)});else {const i=record.radii.map(v=>v!=='').lastIndexOf(true);onChange({radii:record.radii.map((v,j)=>j===i?'':v)})}}}>Undo last point</button></div>
  </>}
 </div>;
}

export default function Calibration({geometry,engine,ready,busy,store,setStore,onExport,onApply,onError,browserDownload,setBrowserDownload}:Props){
 const [selected,setSelected]=useState(store.records.at(-1)?.id??'');const [pattern,setPattern]=useState<Pattern>('bands');const [basis,setBasis]=useState('maxell');
 const [media,setMedia]=useState(store.records.at(-1)?.media||'Maxell DVD+R · 4.7 GB');const [burner,setBurner]=useState(store.records.at(-1)?.burner||'');const [speed,setSpeed]=useState(store.records.at(-1)?.speed||'4×');
 const [fit,setFit]=useState<Fit|null>(null);const [fitting,setFitting]=useState(false);const [profileName,setProfileName]=useState('Maxell DVD+R');const [notice,setNotice]=useState('');const [csv,setCSV]=useState('');
 const startingGeometry=basis==='maxell'?maxell:basis.startsWith('profile:')?store.profiles.find(p=>'profile:'+p.id===basis)?.geometry:geometry;
 const upload=useRef<HTMLInputElement>(null);const record=store.records.find(r=>r.id===selected);const disabled=busy||fitting;
 useEffect(()=>{setFit(null);setNotice('');setCSV(record?.points.map(p=>`${Math.hypot(p.x,p.y).toFixed(5)}, ${(Math.atan2(p.y,p.x)*180/Math.PI).toFixed(5)}`).join('\n')??'')},[record]);
 function update(patch:Partial<BurnRecord>){if(!record)return;setStore({...store,records:store.records.map(r=>r.id===record.id?{...r,...patch}:r)})}
 function create(){
  if(pattern==='triangles-v1'&&startingGeometry&&startingGeometry.outer-startingGeometry.inner<10){onError('Triangle calibration needs at least a 10 mm recording width.');return}
  if(!validGeometry(startingGeometry)){onError('The current artwork geometry is invalid. Correct it under Fine-tune your disc before creating a burn record.');return}
  const r:BurnRecord={kind:'dvd-art-calibration',version:1,id:crypto.randomUUID().slice(0,8),created:new Date().toISOString(),pattern,geometry:{...startingGeometry!},media:media.trim()||'Maxell DVD+R',burner:burner.trim(),speed:speed.trim(),radii:Array(6).fill(''),points:[],fitPitch:pattern==='triangles-v1',...(pattern==='triangles-v1'?{triangleEdge:'clockwise' as const}:{})};
  setStore({...store,records:[...store.records,r].slice(-40)});setSelected(r.id);setProfileName(r.media+(r.burner?' · '+r.burner:''));
 }
 async function importJSON(file?:File){
  if(!file)return;
  try{
   if(file.size>2e6)throw Error('Calibration JSON must be smaller than 2 MB.');const data=JSON.parse(await file.text());
   if(validateProfile(data)){setStore({...store,profiles:[...store.profiles.filter(p=>p.id!==data.id),data].slice(-40),records:[...store.records.filter(r=>r.id!==data.record.id),data.record].slice(-40)});setSelected(data.record.id);setProfileName(data.name);setNotice('Profile imported. Choose it in Your blank disc, or refit this burn record.');}
   else if(validateRecord(data)){setStore({...store,records:[...store.records.filter(r=>r.id!==data.id),data].slice(-40)});setSelected(data.id)}
   else throw Error('This is not a supported DVD Art calibration record or profile.');
  }catch(e){onError((e as Error).message)}finally{if(upload.current)upload.current.value=''}
 }
 async function solve(){
  if(!record||!engine)return;
  setFitting(true);setFit(null);setNotice('');onError('');
  try{
   if(record.pattern==='bands'&&record.radii.some(v=>v.trim()===''||!Number.isFinite(Number(v))))throw Error('Enter all six edge radii in millimetres.');
   const result=await engine.request<Fit>('calibrate',{request:{mode:record.pattern,basis:record.geometry,radii:record.radii.map(Number),points:record.points,fitPitch:record.fitPitch,triangleEdge:record.triangleEdge}});setFit(result);
  }catch(e){onError((e as Error).message)}finally{setFitting(false)}
 }
 function apply(){
  if(!fit||!record)return;
  const p:Profile={kind:'dvd-art-profile',version:1,id:crypto.randomUUID().slice(0,8),name:profileName.trim()||record.media,created:new Date().toISOString(),geometry:fit.geometry,media:record.media,burner:record.burner,speed:record.speed,stage:record.pattern,rms:fit.rms,record:structuredClone(record),...(fit.diagnostics?{diagnostics:fit.diagnostics}:{})};
  setStore({...store,profiles:[...store.profiles,p].slice(-40)});onApply(p);setBasis('current');setPattern('triangles-v1');setNotice('Profile saved and applied to artwork. Create a new triangle or line record above to verify it on another blank disc at the same write speed.');
 }
 const allRadii=record?.radii.every(v=>v.trim()!==''&&Number.isFinite(Number(v)));
 return <section className="calibration" aria-label="Disc calibration">
  <div className="cal-intro"><div><div className="eyebrow">A FIT FOR YOUR BURNER & YOUR BLANKS</div><h2>Find your disc’s geometry.</h2><p>Measure the rings. Untwist the triangles. Verify with a line. Keep a profile for this burner, media batch and write speed.</p></div><Target size={42} strokeWidth={1.2}/></div>
  <fieldset disabled={disabled}>
  <div className="cal-card">
   <div className="cal-heading"><span className="step-number">1</span><div><h3>Prepare a test burn</h3><p>Maxell DVD+R starts with nominal geometry. It is not a measured Maxell preset.</p></div></div>
   <div className="cal-form-grid"><label>Test pattern<select aria-label="Calibration pattern" value={pattern} onChange={e=>{setPattern(e.target.value as Pattern);if(e.target.value!=='bands')setBasis('current')}}><option value="bands">1 · Broad rings — measure recording area</option><option value="triangles-v1">2 · Triangle spokes — angular / pitch calibration</option><option value="line">3 · Single line — refine / verify geometry</option></select></label><label>Starting geometry<select aria-label="Calibration starting geometry" value={basis} onChange={e=>setBasis(e.target.value)}><option value="maxell">Maxell DVD+R · nominal 24–58 mm</option><option value="current">Current artwork geometry / applied profile</option>{store.profiles.map(p=><option key={p.id} value={'profile:'+p.id}>{p.name} · saved profile</option>)}</select></label><label>Disc brand / batch<input aria-label="Disc brand or batch" maxLength={160} value={media} onChange={e=>setMedia(e.target.value)}/></label><label>Burner model<input aria-label="Burner model" maxLength={160} placeholder="e.g. ASUS SDRW…" value={burner} onChange={e=>setBurner(e.target.value)}/></label><label>Write speed<input aria-label="Write speed" maxLength={160} placeholder="e.g. 4× · use this speed again" value={speed} onChange={e=>setSpeed(e.target.value)}/></label><label>Save method<select aria-label="Calibration save method" value={browserDownload?'download':'direct'} onChange={e=>setBrowserDownload(e.target.value==='download')}><option value="direct">Save directly · recommended</option><option value="download">Browser download · uses local storage</option></select></label></div>
   <p className="cal-hint">Use a single-layer 120 mm DVD+R. Confirm its capacity in your burning app; the nominal Maxell starting point uses 2,295,104 sectors (4.70 GB). Adjust capacity under Fine-tune your disc and choose current geometry if yours differs. DVD+R is write-once: each test needs a new blank.</p>
   {pattern==='triangles-v1'&&<div className="triangle-guidance"><strong>Rings measure radius. Triangles reveal angular drift.</strong><p>A successful ring burn alone does not calibrate geometry. Fit its six measured edges, save the profile, then select that profile above. Use the same burner, batch and successful write speed.</p><p>Four solid triangles span the recording area, with 8 mm bases and outward tips. Follow one long edge continuously; its curve constrains radii and optional cubic pitch. A constant rotation alone cannot explain artwork turning into rings.</p></div>}
   {startingGeometry&&<p className="cal-hint">Selected geometry: {startingGeometry.inner.toFixed(6)}–{startingGeometry.outer.toFixed(6)} mm · {startingGeometry.sectors.toLocaleString()} sectors. Existing records below retain their original settings.</p>}
   <div className="cal-actions"><button className="cal-primary" onClick={create}><Plus size={15}/>Create burn record</button><button className="small-button" onClick={()=>upload.current?.click()}><FolderOpen size={14}/>Import record or profile</button><input hidden ref={upload} type="file" accept="application/json,.json" onChange={e=>void importJSON(e.target.files?.[0])}/></div>
  </div>
  {store.records.length>0&&<label className="record-select">BURN RECORD<select aria-label="Burn record" value={selected} onChange={e=>setSelected(e.target.value)}>{[...store.records].reverse().map(r=><option key={r.id} value={r.id}>{r.id} · {patternName(r.pattern)} · {r.media} · {new Date(r.created).toLocaleDateString()}</option>)}</select></label>}
  {record&&<>
   <div className="cal-card cal-burn">
    <PatternPreview record={record}/><div><div className="cal-heading"><span className="step-number">2</span><div><h3>Burn {record.pattern==='bands'?'the broad rings':record.pattern==='triangles-v1'?'the triangle spokes':'the single line'}</h3><p>Record <strong>{record.id}</strong> · {(record.geometry.sectors*2048/1e9).toFixed(2)} GB · full disc</p></div></div>
    <p className="cal-hint">{record.pattern==='bands'?'The three dark rings use fixed sector addresses. Measure their six transitions even if the initial geometry is inaccurate.':record.pattern==='triangles-v1'?'With correct geometry, all four triangles have straight sides. Bowed or winding edges reveal accumulated angular error. The orange preview edge is a tracing guide; it is not a separate colour on the disc.':'A correct fit produces one straight 1.2 mm radial line. Curvature reveals geometry error. Trace its midpoint continuously, including every turn; if it is too tangled, improve the broad-ring measurements first.'}</p>
    <p className="cal-hint">Save this record beside the ISO. Burn as a disc image, finalize the disc, and label it with <strong>{record.id}</strong>. Keep the same burner and write speed. The recording contains the same minimal data volume as your artwork.</p>
    <div className="cal-actions"><button className="export-button" disabled={!ready} onClick={()=>{onError('');void onExport(record).then(ok=>{if(ok)update({exportedAt:new Date().toISOString()})})}}><ArrowDownToLine size={16}/>Generate test ISO</button><button className="small-button" onClick={()=>saveJSON(record)}><Download size={14}/>Save burn record</button>{record.pattern==='triangles-v1'&&<button className="small-button" onClick={()=>saveTriangleTarget(record)}><Download size={14}/>Save target SVG</button>}</div>
    <p className="cal-hint">{record.exportedAt?'ISO generated '+new Date(record.exportedAt).toLocaleString()+'.':'Record prepared · ISO has not been generated in this record yet.'} Geometry is frozen for this record; new settings require a new record.</p></div>
   </div>
   <div className="cal-card">
    <div className="cal-heading"><span className="step-number">3</span><div><h3>Measure this burned disc</h3><p>Use the photo matching record {record.id}, or enter measurements below. Millimetres are measured from the disc centre.</p></div></div>
    {record.pattern==='triangles-v1'&&<div className="triangle-measure"><label>Edge to follow<select aria-label="Triangle trace edge" value={record.triangleEdge} onChange={e=>update({triangleEdge:e.target.value as TriangleEdge,points:[]})}><option value="clockwise">Clockwise long edge</option><option value="counterclockwise">Counterclockwise long edge</option></select></label><p className="cal-hint">Choose any one triangle and follow the same long edge from base toward tip. At a given radius, the clockwise edge has the dark triangle immediately counterclockwise of it. The orange ideal edge above illustrates this. Changing the chosen edge clears the trace.</p><p className="cal-hint">Keep steps under 60° and never jump to another spoke or skip a whole turn. Avoid the short base and the last 0.5 mm near the pointed tip. If individual edges cannot be followed, improve the broad-ring measurements before fitting.</p></div>}
    <PhotoMeasure key={record.id} record={record} fit={fit} onChange={update} onError={onError}/>
    {record.pattern==='bands'?<>
     <p className="cal-hint">Mark the inner and outer edge of each dark ring, from the centre outward. Use the same radial direction for all six edges. If using calipers, enter the radius (half the diameter).</p>
     <div className="cal-form-grid cal-radii">{edgeLabels.map((label,i)=><label key={label}>{label}<div className="unit-input"><input aria-label={label+' radius'} type="number" min={20} max={59} step="0.001" placeholder="Radius" value={record.radii[i]} onChange={e=>update({radii:record.radii.map((v,j)=>j===i?e.target.value:v)})}/><span>mm</span></div></label>)}</div>
    </>:<>
     <p className="cal-hint">Mark at least {record.fitPitch?'24':'12'} points from inner to outer radius, covering at least {record.fitPitch?'85':'65'}% of the recording width. Add points so each step follows less than {record.pattern==='triangles-v1'?'60°':'a quarter turn'}. Skipped turns cannot be detected automatically. {record.pattern==='triangles-v1'?'Measure the selected triangle boundary, not its centre. The fit includes the edge’s known taper.':'Measure the middle of the dark line, not its edge.'}</p>
     <div className="trace-summary"><strong>{record.points.length} trace points</strong><button className="small-button" disabled={!record.points.length} onClick={()=>update({points:record.points.slice(0,-1)})}>Undo trace point</button><button className="small-button" disabled={!record.points.length} onClick={()=>update({points:[]})}>Clear trace</button></div>
     <label className="cal-checkbox"><input type="checkbox" checked={record.fitPitch} onChange={e=>update({fitPitch:e.target.checked})}/>Fit variable pitch too · requires 24 points and 85% coverage</label>
     <details className="cal-manual"><summary>Enter trace measurements manually</summary><p className="cal-hint">One radius (mm), angle (degrees) pair per line, inside outward. Angles increase clockwise from the right. Photo rotation is fitted automatically.</p><textarea aria-label="Manual trace points" value={csv} onChange={e=>setCSV(e.target.value)} placeholder={'25.0, 12.5\n27.0, 15.0\n…'}/><button className="small-button" onClick={()=>{try{const points=csv.trim().split(/\n/).map(line=>{const pair=line.trim().split(/[,\s]+/).map(Number);if(pair.length!==2||!pair.every(Number.isFinite)||pair[0]<20||pair[0]>59)throw Error('Each line needs a radius from 20–59 mm and an angle in degrees.');return {x:pair[0]*Math.cos(pair[1]*Math.PI/180),y:pair[0]*Math.sin(pair[1]*Math.PI/180)}});if(points.length>2000)throw Error('Maximum 2000 trace points.');update({points});}catch(e){onError((e as Error).message)}}}>Use trace measurements</button></details>
    </>}
    <div className="cal-actions"><button className="cal-primary" disabled={!ready||(record.pattern==='bands'?!allRadii:record.points.length<(record.fitPitch?24:12))} onClick={()=>void solve()}><Target size={16}/>{fitting?'Fitting geometry…':'Fit geometry'}</button><button className="small-button" onClick={()=>saveJSON(record)}><Download size={14}/>Save record + measurements</button></div>
    {fit&&<div className="cal-result"><div className="cal-result-title"><Check size={20}/><h3>{record.pattern==='bands'?'Recording area measured':record.pattern==='triangles-v1'?'Triangle geometry fitted':'Line geometry fitted'}</h3></div><dl><div><dt>Inner radius</dt><dd>{fit.geometry.inner.toFixed(6)} mm</dd></div><div><dt>Outer radius</dt><dd>{fit.geometry.outer.toFixed(6)} mm</dd></div><div><dt>Fit residual · RMS</dt><dd>{fit.rms.toFixed(4)} mm</dd></div><div><dt>Largest residual</dt><dd>{fit.maxError.toFixed(4)} mm</dd></div></dl><p className="cal-hint">These are fit residuals, not absolute accuracy. Photo scale and disc centring affect the result.{record.pattern!=='bands'?' The green overlay shows the fitted curve when a photo is open.':''}</p><AngularResult fit={fit} record={record}/>{fit.warnings.map(w=><p className="cal-warning" key={w}>{w}</p>)}<label className="profile-name">Profile name<input aria-label="Calibration profile name" maxLength={160} value={profileName} onChange={e=>setProfileName(e.target.value)}/></label><button className="cal-primary" onClick={apply}><Check size={15}/>Save & apply profile</button></div>}
   </div>
  </>}
  {notice&&<p className="cal-notice" role="status">{notice}</p>}
  {store.profiles.length>0&&<div className="cal-card"><div className="cal-heading"><Disc3 size={23}/><div><h3>Your saved profiles</h3><p>Keeps the 40 most recent profiles and burn records in this browser. Export JSON backups to keep them.</p></div></div><div className="profile-list">{[...store.profiles].reverse().map(p=><div key={p.id}><div><strong>{p.name}</strong><span>{p.stage==='bands'?'Coarse · needs angular refinement':p.stage==='triangles-v1'?'Triangle fitted · verify with another burn':'Line fitted · verify with another burn'} · {p.burner||'Burner unspecified'} · {p.speed||'Speed unspecified'}</span></div><button className="small-button" onClick={()=>{onApply(p);setBasis('current');setPattern('triangles-v1');setNotice('Applied '+p.name+' to artwork and the current starting geometry.')}}>Apply</button><button className="small-button" aria-label={'Export profile '+p.name} onClick={()=>saveJSON(p)}><Download size={14}/>Export</button></div>)}</div></div>}
  </fieldset>
  <p className="cal-footnote">Calibration is specific to the burner, media batch and speed. After applying a fit, make another triangle or line burn; straight edges are the physical check. Channel-bit length stays fixed. Start-angle rotation does not correct spiral distortion. Based on the <a href="https://github.com/JiaFeiMiao-K-Cat/DiscImageStudio/blob/main/docs/CALIBRATION.md" target="_blank" rel="noreferrer">DiscImageStudio calibration approach</a>.</p>
 </section>;
}
