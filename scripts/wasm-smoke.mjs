import {readFileSync,openSync,writeSync,closeSync} from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
await import('../public/wasm_exec.js');
const go=new Go();const wasm=await WebAssembly.instantiate(readFileSync('public/encoder.wasm'),go.importObject);go.run(wasm.instance);
const config={sectors:2295104,inner:24,outer:58,bitLength:133.3,pitchLinear:0,pitchQuadratic:0,pitchCubic:0,startAngle:0};
const baseline={...config,inner:24.01779148781394,outer:57.82313919831214};
const sweepPlan=JSON.parse(dvdSweepPlan(JSON.stringify(baseline)));assert.equal(sweepPlan.bands.length,63);
assert.equal(sweepPlan.bands[10].ppm,0);assert.ok(dvdSweepPlan(JSON.stringify({...config,outer:40})).error);
const sweepFit=JSON.parse(dvdSweepFit(JSON.stringify({basis:baseline,continuous:true,observations:[1,2,3].map(zone=>({zone,candidate:11,innerAngle:37,outerAngle:37}))})));
assert.ok(Math.abs(sweepFit.geometry.inner-baseline.inner)<1e-7);
assert.ok(dvdSweepFit(JSON.stringify({basis:baseline,continuous:false,observations:[]})).error);
const strataConfig={...config,sectors:2297888};
for(const halfRangePPM of [10000,1000,100,0]){
 const options={halfRangePPM,readCompatibility:'write-safe-light-v1'};
 const p=JSON.parse(dvdStrataPlan(JSON.stringify({config:strataConfig,options})));
 assert.equal(p.bands.length,4);assert.equal(p.compatibilityChanges,(strataConfig.sectors-32)*512);
 assert.equal(dvdStrataStart(JSON.stringify({config:strataConfig,options})),true);
 const first=dvdChunk(0,32);assert.equal(new DataView(first.buffer).getUint32(16*2048+80,true),strataConfig.sectors);
 assert.ok(dvdChunk(strataConfig.sectors-16,16) instanceof Uint8Array);dvdRelease();
 // Under constant pitch, source and actual geometry match at each chirp midpoint.
 if(halfRangePPM){
  const radii=p.bands.map(b=>(b.inner+b.outer)/2);
  const fit=JSON.parse(dvdStrataFit(JSON.stringify({basis:strataConfig,options,radii,confirmed:true})));
  assert.ok(Math.abs(fit.geometry.inner-24)<1e-7);assert.ok(Math.abs(fit.geometry.outer-58)<1e-7);
 }
 assert.ok(dvdStrataFit(JSON.stringify({basis:strataConfig,options,radii:[],confirmed:false})).error);
}
assert.ok(dvdStrataStart(JSON.stringify({config:{...strataConfig,outputSectors:32768},options:{halfRangePPM:10000,readCompatibility:'write-safe-light-v1'}})).error);
// Exercise the actual photo-derived verification geometry through the encoder.
const photoProfile=JSON.parse(readFileSync('src/baselines/verbatim-5317b6a2.json','utf8'));
const verificationOptions={halfRangePPM:0,readCompatibility:'write-safe-light-v1'};
const verificationPlan=JSON.parse(dvdStrataPlan(JSON.stringify({config:photoProfile.geometry,options:verificationOptions})));
assert.equal(verificationPlan.bands.length,4);
assert.equal(dvdStrataStart(JSON.stringify({config:photoProfile.geometry,options:verificationOptions})),true);
assert.equal(new DataView(dvdChunk(0,32).buffer).getUint32(16*2048+80,true),2297888);
for(const band of verificationPlan.bands){
 assert.ok(band.fromPPM===0&&band.toPPM===0);
 for(const lba of [band.start-1,band.start,Math.floor((band.start+band.end)/2),band.end-1,band.end]){
  const chunk=dvdChunk(lba,16);assert.ok(chunk instanceof Uint8Array);
  assert.deepEqual(chunk.slice(0,2048),dvdChunk(lba,1));
 }
}
assert.ok(dvdChunk(2297888-16,16) instanceof Uint8Array);dvdRelease();
const radii=[35,170,305,510,705,955].map(p=>Math.sqrt(24.12**2+(57.94**2-24.12**2)*Math.ceil(config.sectors*p/1000)/config.sectors));
const fitted=JSON.parse(dvdCalibrate(JSON.stringify({mode:'bands',basis:config,radii})));
assert.ok(Math.abs(fitted.geometry.inner-24.12)<1e-8);
assert.ok(Math.abs(fitted.geometry.outer-57.94)<1e-8);
assert.ok(dvdCalibrationStart(JSON.stringify({...config,outputSectors:32768}),'bands').error);
for(const pattern of ['bands','line','triangles-v1','sweep-v1']){
 assert.equal(dvdCalibrationStart(JSON.stringify(config),pattern),true);
 const header=dvdChunk(16,1);assert.equal(new DataView(header.buffer).getUint32(80,true),config.sectors);
 assert.ok(dvdChunk(config.sectors-16,16) instanceof Uint8Array);dvdRelease();
}
assert.equal(dvdCalibrationStart(JSON.stringify(config),'bands','off'),true);
const pure=dvdChunk(32,1),metadata=dvdChunk(0,32);
assert.equal(dvdCalibrationStart(JSON.stringify(config),'bands','write-safe-light-v1'),true);
const mixed=dvdChunk(32,1);assert.deepEqual(dvdChunk(0,32),metadata);
assert.equal(mixed.reduce((n,v,i)=>n+(v!==pure[i]),0),512);
assert.ok(dvdCalibrationStart(JSON.stringify(config),'bands','unknown').error);assert.ok(dvdChunk(32,1).error);
const trianglePoints=Array.from({length:40},(_,i)=>{const x=25.2+31.8*i/39;return {x,y:4*(57.4-x)/32.8}});
const triangleFit=JSON.parse(dvdCalibrate(JSON.stringify({mode:'triangles-v1',basis:config,triangleEdge:'clockwise',fitPitch:true,points:trianglePoints})));
assert.ok(Math.abs(triangleFit.geometry.inner-config.inner)<1e-6);
assert.ok(Math.abs(triangleFit.diagnostics.driftDegrees)<.001);
assert.ok(dvdCalibrate(JSON.stringify({mode:'triangles-v1',basis:config,points:trianglePoints})).error);
const size=128,pixels=new Uint8Array(size*size*4);for(let y=0;y<size;y++)for(let x=0;x<size;x++){const i=(y*size+x)*4;const v=(Math.floor(x/16)+Math.floor(y/16))%2?255:0;pixels.set([v,v,v,255],i)}
const tone={brightness:0,contrast:1,gamma:1,threshold:.5,dither:false,invert:false};
const exportConfig=process.argv.includes('--baseline=verbatim-95137')?{...config,sectors:2297888}:process.argv.includes('--baseline=maxell-e3ff7e7e')?baseline:config;
const count=process.argv.includes('--full')?exportConfig.sectors:32768;
const pattern=process.argv.find(a=>a.startsWith('--pattern='))?.split('=')[1];
if(pattern==='strata-v1')assert.equal(dvdStrataStart(JSON.stringify({config:{...exportConfig,outputSectors:count},options:{halfRangePPM:10000,readCompatibility:'write-safe-light-v1'}})),true);
else if(pattern)assert.equal(dvdCalibrationStart(JSON.stringify({...exportConfig,outputSectors:count}),pattern),true);
else assert.equal(dvdStart(pixels,size,JSON.stringify(tone),JSON.stringify({...config,outputSectors:count})),true);
const hash=createHash('sha256');const start=performance.now();let bytes=0;const save=process.env.TEST_ISO;const fd=save?openSync(save,'w'):null;
for(let lba=0;lba<count;lba+=256){
 const data=dvdChunk(lba,Math.min(256,count-lba));assert.ok(data instanceof Uint8Array);
 if(lba===0){assert.equal(new TextDecoder().decode(data.slice(16*2048+1,16*2048+6)),'CD001');assert.equal(new DataView(data.buffer).getUint32(16*2048+80,true),count)}
 hash.update(data);bytes+=data.length;if(fd!==null)writeSync(fd,data);
 if(process.argv.includes('--full')&&lba%131072===0)console.log(Math.round(lba/count*100)+'%');
}
if(fd!==null)closeSync(fd);
assert.equal(bytes,count*2048);assert.ok(dvdChunk(count,1).error);dvdRelease();
console.log(JSON.stringify({pattern:pattern||'checkerboard',bytes,sha256:hash.digest('hex'),seconds:((performance.now()-start)/1000).toFixed(2),wasmBytes:readFileSync('public/encoder.wasm').length}));
process.exit(0);
