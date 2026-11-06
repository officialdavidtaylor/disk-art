import {readFileSync,openSync,writeSync,closeSync} from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
await import('../public/wasm_exec.js');
const go=new Go();const wasm=await WebAssembly.instantiate(readFileSync('public/encoder.wasm'),go.importObject);go.run(wasm.instance);
const config={sectors:2295104,inner:24,outer:58,bitLength:133.3,pitchLinear:0,pitchQuadratic:0,pitchCubic:0,startAngle:0};
const radii=[35,170,305,510,705,955].map(p=>Math.sqrt(24.12**2+(57.94**2-24.12**2)*Math.ceil(config.sectors*p/1000)/config.sectors));
const fitted=JSON.parse(dvdCalibrate(JSON.stringify({mode:'bands',basis:config,radii})));
assert.ok(Math.abs(fitted.geometry.inner-24.12)<1e-8);
assert.ok(Math.abs(fitted.geometry.outer-57.94)<1e-8);
assert.ok(dvdCalibrationStart(JSON.stringify({...config,outputSectors:32768}),'bands').error);
for(const pattern of ['bands','line']){
 assert.equal(dvdCalibrationStart(JSON.stringify(config),pattern),true);
 const header=dvdChunk(16,1);assert.equal(new DataView(header.buffer).getUint32(80,true),config.sectors);
 assert.ok(dvdChunk(config.sectors-16,16) instanceof Uint8Array);dvdRelease();
}
const size=128,pixels=new Uint8Array(size*size*4);for(let y=0;y<size;y++)for(let x=0;x<size;x++){const i=(y*size+x)*4;const v=(Math.floor(x/16)+Math.floor(y/16))%2?255:0;pixels.set([v,v,v,255],i)}
const tone={brightness:0,contrast:1,gamma:1,threshold:.5,dither:false,invert:false};
const count=process.argv.includes('--full')?config.sectors:32768;
assert.equal(dvdStart(pixels,size,JSON.stringify(tone),JSON.stringify({...config,outputSectors:count})),true);
const hash=createHash('sha256');const start=performance.now();let bytes=0;const save=process.env.TEST_ISO;const fd=save?openSync(save,'w'):null;
for(let lba=0;lba<count;lba+=256){
 const data=dvdChunk(lba,Math.min(256,count-lba));assert.ok(data instanceof Uint8Array);
 if(lba===0){assert.equal(new TextDecoder().decode(data.slice(16*2048+1,16*2048+6)),'CD001');assert.equal(new DataView(data.buffer).getUint32(16*2048+80,true),count)}
 hash.update(data);bytes+=data.length;if(fd!==null)writeSync(fd,data);
 if(process.argv.includes('--full')&&lba%131072===0)console.log(Math.round(lba/count*100)+'%');
}
if(fd!==null)closeSync(fd);
assert.equal(bytes,count*2048);assert.ok(dvdChunk(count,1).error);dvdRelease();
console.log(JSON.stringify({bytes,sha256:hash.digest('hex'),seconds:((performance.now()-start)/1000).toFixed(2),wasmBytes:readFileSync('public/encoder.wasm').length}));
process.exit(0);
