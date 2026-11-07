import type {Geometry} from './engine';
export type Pattern='bands'|'line'|'triangles-v1'|'sweep-v1';
export type TriangleEdge='clockwise'|'counterclockwise';
export type AngularDiagnostics={innerDeltaMM:number;outerDeltaMM:number;driftDegrees:number;peakToPeakDegrees:number;innerPitchNM:number;outerPitchNM:number;photoRotationDegrees:number;stations:{radius:number;degrees:number}[]};
export const patternName=(p:Pattern)=>p==='sweep-v1'?'Coarse angular sweep':p==='bands'?'Broad rings':p==='triangles-v1'?'Triangle spokes':'Single line';
export const triangleShape=(g:Geometry)=>({base:g.inner+.6,tip:g.outer-.6,halfBase:4});
export type Point={x:number;y:number};
export type Fit={geometry:Geometry;rms:number;maxError:number;rotation:number;warnings:string[];curve?:Point[];diagnostics?:AngularDiagnostics};
export type BurnRecord={kind:'dvd-art-calibration';version:1;id:string;created:string;pattern:Pattern;geometry:Geometry;media:string;burner:string;speed:string;exportedAt?:string;radii:string[];points:Point[];fitPitch:boolean;triangleEdge?:TriangleEdge;baselineId?:string;sweep?:SweepMeasurements};
export type Profile={kind:'dvd-art-profile';version:1;id:string;name:string;created:string;geometry:Geometry;media:string;burner:string;speed:string;stage:Pattern;rms?:number;angularRmsDegrees?:number;record:BurnRecord;diagnostics?:AngularDiagnostics};
export type CalibrationStore={records:BurnRecord[];profiles:Profile[]};
export const storageKey='dvd-art-calibration-v1';
export const edgeLabels=['Band 1 · inner edge','Band 1 · outer edge','Band 2 · inner edge','Band 2 · outer edge','Band 3 · inner edge','Band 3 · outer edge'];
export const maxell:Geometry={sectors:2295104,inner:24,outer:58,bitLength:133.3,pitchLinear:0,pitchQuadratic:0,pitchCubic:0,startAngle:0};
export const bandFractions=(sectors:number)=>[35,170,305,510,705,955].map(p=>Math.ceil(sectors*p/1000)/sectors);
export function validGeometry(value:unknown):value is Geometry{
 if(!value||typeof value!=='object')return false;
 const g=value as Geometry;
 return ['sectors','inner','outer','bitLength','pitchLinear','pitchQuadratic','pitchCubic','startAngle'].every(k=>typeof g[k as keyof Geometry]==='number'&&Number.isFinite(g[k as keyof Geometry]))&&Number.isInteger(g.sectors)&&g.sectors>=256&&g.sectors<=2298496&&g.sectors%16===0&&g.inner>=20&&g.outer<=59&&g.outer>g.inner&&g.bitLength>=120&&g.bitLength<=150&&Math.abs(g.pitchLinear)+Math.abs(g.pitchQuadratic)+Math.abs(g.pitchCubic)<=.05;
}
const string=(v:unknown,max=160)=>typeof v==='string'&&v.length<=max;
export function validateRecord(v:unknown):v is BurnRecord{
 if(!v||typeof v!=='object')return false;const r=v as BurnRecord;
 return r.kind==='dvd-art-calibration'&&r.version===1&&string(r.id)&&string(r.created)&&!Number.isNaN(Date.parse(r.created))&&(r.baselineId===undefined||string(r.baselineId))&&(r.pattern==='bands'||r.pattern==='line'||(r.pattern==='sweep-v1'&&r.geometry?.outer-r.geometry?.inner>=28&&validSweepMeasurements(r.sweep))||(r.pattern==='triangles-v1'&&(r.triangleEdge==='clockwise'||r.triangleEdge==='counterclockwise')&&r.geometry?.outer-r.geometry?.inner>=10))&&validGeometry(r.geometry)&&string(r.media)&&string(r.burner)&&string(r.speed)&&Array.isArray(r.radii)&&r.radii.length===6&&r.radii.every(x=>string(x,30))&&Array.isArray(r.points)&&r.points.length<=2000&&r.points.every(p=>p&&typeof p.x==='number'&&typeof p.y==='number'&&Number.isFinite(p.x)&&Number.isFinite(p.y)&&Math.hypot(p.x,p.y)<=65)&&typeof r.fitPitch==='boolean';
}
export function validateProfile(v:unknown):v is Profile{
 if(!v||typeof v!=='object')return false;const p=v as Profile;
 return p.kind==='dvd-art-profile'&&p.version===1&&string(p.id)&&string(p.name)&&string(p.created)&&string(p.media)&&string(p.burner)&&string(p.speed)&&validGeometry(p.geometry)&&(p.stage==='bands'||p.stage==='line'||p.stage==='triangles-v1'||p.stage==='sweep-v1')&&(p.stage==='sweep-v1'?typeof p.angularRmsDegrees==='number'&&Number.isFinite(p.angularRmsDegrees)&&p.angularRmsDegrees>=0:typeof p.rms==='number'&&Number.isFinite(p.rms)&&p.rms>=0)&&validateRecord(p.record)&&(p.diagnostics===undefined||validDiagnostics(p.diagnostics));
}

export function validDiagnostics(v:unknown):v is AngularDiagnostics{
 if(!v||typeof v!=='object')return false;const d=v as AngularDiagnostics;
 return ['innerDeltaMM','outerDeltaMM','driftDegrees','peakToPeakDegrees','innerPitchNM','outerPitchNM','photoRotationDegrees'].every(k=>typeof d[k as keyof AngularDiagnostics]==='number'&&Number.isFinite(d[k as keyof AngularDiagnostics]))&&Array.isArray(d.stations)&&d.stations.length>=2&&d.stations.length<=256&&d.stations.every(s=>s&&Number.isFinite(s.radius)&&Number.isFinite(s.degrees));
}
export function saveTriangleTarget(record:BurnRecord){
 const t=triangleShape(record.geometry);
 const triangles=[0,90,180,270].map(angle=>`<polygon points="${t.base},-${t.halfBase} ${t.tip},0 ${t.base},${t.halfBase}" transform="rotate(${angle})"/>`).join('');
 const titleID=record.id.replace(/[<>&]/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;'}[c]!));
 const content=`<svg xmlns="http://www.w3.org/2000/svg" width="120mm" height="120mm" viewBox="-60 -60 120 120"><title>DVD Art triangle target ${titleID}; ideal recording-side layout, not a burn simulation</title><circle r="59.8" fill="white" stroke="#888" stroke-width=".2"/><circle r="7.5" fill="#eee" stroke="#888" stroke-width=".2"/><g fill="black">${triangles}</g></svg>`;
 const url=URL.createObjectURL(new Blob([content],{type:'image/svg+xml'}));const a=document.createElement('a');a.href=url;a.download=`triangle-target-${record.id}.svg`;a.click();setTimeout(()=>URL.revokeObjectURL(url),2000);
}

export function loadCalibration():CalibrationStore{
 const raw=localStorage.getItem(storageKey);if(!raw)return {records:[],profiles:[]};const data=JSON.parse(raw);
 if(!Array.isArray(data.records)||!Array.isArray(data.profiles)||!data.records.every(validateRecord)||!data.profiles.every(validateProfile))throw Error('Saved calibration data could not be read. Import your backup JSON to recover it.');
 return {records:data.records.slice(-40),profiles:data.profiles.slice(-40)};
}
export function saveJSON(value:BurnRecord|Profile){
 const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'}));
 const a=document.createElement('a');a.href=url;a.download=(value.kind==='dvd-art-profile'?'profile':'calibration')+'-'+value.id+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),2000);
}
export function photoFrame(rim:Point[]){
 if(rim.length!==4)return null;
 const [l,r,t,b]=rim;const width=r.x-l.x,height=b.y-t.y;
 if(width<=0||height<=0)throw Error('Mark the physical rim in this order: left, right, top, bottom.');
 const center={x:(l.x+r.x+t.x+b.x)/4,y:(l.y+r.y+t.y+b.y)/4};
 const scale=(width+height)/240;
 if(Math.abs(width/height-1)>.015||Math.hypot((l.x+r.x-t.x-b.x)/2,(l.y+r.y-t.y-b.y)/2)/scale>.5)throw Error('The rim is not circular or centred. Use a straight-on photo, then mark the four outermost rim points again.');
 return {center,scale};
}

export type SweepReading={candidate:number|null;innerAngle:string;outerAngle:string};
export type SweepMeasurements={readings:SweepReading[];continuous:boolean};
export const emptySweep=():SweepMeasurements=>({readings:Array.from({length:3},()=>({candidate:null,innerAngle:'',outerAngle:''})),continuous:false});
export function validSweepMeasurements(v:unknown):v is SweepMeasurements {
 if(!v||typeof v!=='object')return false;const s=v as SweepMeasurements;
 return typeof s.continuous==='boolean'&&Array.isArray(s.readings)&&s.readings.length===3&&s.readings.every(r=>r&&(r.candidate===null||Number.isInteger(r.candidate)&&r.candidate>=1&&r.candidate<=21)&&[r.innerAngle,r.outerAngle].every(a=>typeof a==='string'&&a.length<30&&(a===''||a.trim()!==''&&Number.isFinite(Number(a))&&Math.abs(Number(a))<=360)));
}
