// Reproduce the photo-derived baseline with the same Go/WASM fitter as the app.
import {readFileSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
await import('../public/wasm_exec.js');
const go=new Go();
const wasm=await WebAssembly.instantiate(readFileSync('public/encoder.wasm'),go.importObject);
go.run(wasm.instance);
const evidence=JSON.parse(readFileSync('calibration-data/verbatim-5317b6a2-edges.json','utf8'));
const mean=a=>a.reduce((s,v)=>s+v,0)/a.length;
const traces=evidence.photos.map(p=>{
 const angles=p.samples.map(s=>(s[1]+s[2])/2),rotation=mean(angles);
 return {image:p.image,samples:p.samples.map((s,i)=>[s[0],angles[i]-rotation])};
});
const training=traces.filter(p=>evidence.fitImages.includes(p.image));
assert.equal(training.length,2);
const samples=training[0].samples.map(([r],i)=>{
 assert.ok(training.every(p=>p.samples[i][0]===r));
 return [r,mean(training.map(p=>p.samples[i][1]))];
});
const points=samples.map(([r,a])=>({x:r*Math.cos(a*Math.PI/180),y:r*Math.sin(a*Math.PI/180)}));
// A zero-sweep stratum's two edges have phases 0 and pi. Subtracting pi
// from the opposite edge and absorbing photo rotation gives linePhase exactly.
// Coordinates are clockwise as viewed from the recording side (image y down).
const fit=fitPitch=>{
 const raw=dvdCalibrate(JSON.stringify({mode:'line',basis:evidence.sourceRecord.geometry,points,fitPitch}));
 if(typeof raw!=='string')throw Error(JSON.stringify(raw));
 return JSON.parse(raw);
};
const fixed=fit(false),result=fit(true);
assert.ok(result.rms<.06&&result.rms<fixed.rms/3);
// Evaluate the selected fit on a third image, never used in the optimization.
const curve=result.curve.map(p=>[Math.hypot(p.x,p.y),Math.atan2(p.y,p.x)*180/Math.PI]);
function predicted(r){
 let i=1;while(i<curve.length-1&&curve[i][0]<r)i++;
 const a=curve[i-1],b=curve[i];return a[1]+(b[1]-a[1])*(r-a[0])/(b[0]-a[0]);
}
const validation=traces.map(t=>{
 const residual=t.samples.map(([r,a])=>a-predicted(r));
 const rotation=mean(residual),aligned=residual.map(a=>a-rotation);
 return {image:'IMG_'+t.image+'.HEIC',usedForFit:evidence.fitImages.includes(t.image),rmsDegrees:Math.sqrt(mean(aligned.map(a=>a*a))),maxDegrees:Math.max(...aligned.map(Math.abs))};
});
assert.ok(validation.every(v=>v.rmsDegrees<.15&&v.maxDegrees<.45));
const profile={kind:'dvd-art-profile',version:1,id:'photo-5317b6a2-v1',name:'Verbatim 95137 · GP60NB50 · 4× · photo refinement 1',created:evidence.created,
 geometry:result.geometry,media:evidence.sourceRecord.media,burner:evidence.sourceRecord.burner,speed:evidence.sourceRecord.speed,
 stage:'strata-v1',fitMethod:'verification-edges-v1',rms:result.rms,readCompatibility:'write-safe-light-v1',
 record:{...evidence.sourceRecord,points,fitPitch:true},diagnostics:result.diagnostics};
const report={sourceRecordId:evidence.sourceRecord.id,profileId:profile.id,fitImages:evidence.fitImages.map(id=>'IMG_'+id+'.HEIC'),holdoutImage:'IMG_'+evidence.holdoutImage+'.HEIC',
 sampleCount:points.length,radiusRangeMM:[samples[0][0],samples.at(-1)[0]],constantPitchRMSMM:fixed.rms,variablePitchRMSMM:result.rms,maxErrorMM:result.maxError,validation,
 method:'Average opposite-edge angles in each independently rectified image, remove one constant rotation per image, then average the two training images. Fit inner/outer radii and cubic pitch with Go/WASM. Check the held-out image after removing only its constant rotation.',
 limits:'Approximate planar rectification; no calibrated lens/refraction model. Residuals measure agreement with traced edges, not absolute accuracy or disc-to-disc repeatability. New physical verification required.'};
if(process.argv.includes('--write')){
 writeFileSync('src/baselines/verbatim-5317b6a2.json',JSON.stringify(profile,null,2)+'\n');
 writeFileSync('calibration-data/verbatim-5317b6a2-fit.json',JSON.stringify(report,null,2)+'\n');
}else{
 const saved=JSON.parse(readFileSync('src/baselines/verbatim-5317b6a2.json','utf8'));
 for(const key of Object.keys(result.geometry))assert.ok(Math.abs(saved.geometry[key]-result.geometry[key])<1e-10,`Reproduced ${key}`);
}
console.log(JSON.stringify({geometry:result.geometry,...report},null,2));
process.exit(0);
