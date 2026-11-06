import type {Geometry} from './engine';
export type Pattern='bands'|'line';
export type Point={x:number;y:number};
export type Fit={geometry:Geometry;rms:number;maxError:number;rotation:number;warnings:string[];curve?:Point[]};
export type BurnRecord={kind:'dvd-art-calibration';version:1;id:string;created:string;pattern:Pattern;geometry:Geometry;media:string;burner:string;speed:string;exportedAt?:string;radii:string[];points:Point[];fitPitch:boolean};
export type Profile={kind:'dvd-art-profile';version:1;id:string;name:string;created:string;geometry:Geometry;media:string;burner:string;speed:string;stage:Pattern;rms:number;record:BurnRecord};
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
 return r.kind==='dvd-art-calibration'&&r.version===1&&string(r.id)&&string(r.created)&&!Number.isNaN(Date.parse(r.created))&&(r.pattern==='bands'||r.pattern==='line')&&validGeometry(r.geometry)&&string(r.media)&&string(r.burner)&&string(r.speed)&&Array.isArray(r.radii)&&r.radii.length===6&&r.radii.every(x=>string(x,30))&&Array.isArray(r.points)&&r.points.length<=2000&&r.points.every(p=>p&&typeof p.x==='number'&&typeof p.y==='number'&&Number.isFinite(p.x)&&Number.isFinite(p.y)&&Math.hypot(p.x,p.y)<=65)&&typeof r.fitPitch==='boolean';
}
export function validateProfile(v:unknown):v is Profile{
 if(!v||typeof v!=='object')return false;const p=v as Profile;
 return p.kind==='dvd-art-profile'&&p.version===1&&string(p.id)&&string(p.name)&&string(p.created)&&string(p.media)&&string(p.burner)&&string(p.speed)&&validGeometry(p.geometry)&&(p.stage==='bands'||p.stage==='line')&&Number.isFinite(p.rms)&&p.rms>=0&&validateRecord(p.record);
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
