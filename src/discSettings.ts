import {validGeometry} from './calibration.ts';
import type {Geometry} from './engine';
export const discSettingsKey='dvd-art-active-disc-v1';
export type DiscSettings={version:1;preset:string;geometry:Geometry};
export function readDiscSettings(raw:string|null,fallback:DiscSettings,choices:{id:string;geometry:Geometry}[]):DiscSettings {
 if(raw===null)return structuredClone(fallback);
 const d=JSON.parse(raw) as DiscSettings;
 if(!d||d.version!==1||typeof d.preset!=='string'||!validGeometry(d.geometry))throw Error('Saved active disc settings were invalid. Select and apply your measured profile before exporting.');
 const match=choices.find(p=>p.id===d.preset);
 const same=match&&Object.keys(fallback.geometry).every(k=>match.geometry[k as keyof Geometry]===d.geometry[k as keyof Geometry]);
 return {version:1,preset:same?d.preset:'custom',geometry:{...d.geometry}};
}
