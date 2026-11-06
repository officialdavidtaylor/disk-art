// Used with a scoped Cloudflare assets-upload-session, supplied through stdin.
// Never persist or log the input. The caller must capture/redact the final JWT.
import {createInterface} from 'node:readline';
import {readFileSync} from 'node:fs';
import {extname} from 'node:path';
import {assets} from './asset-manifest.mjs';
console.error('Ready for upload-session JSON on stdin.');
const input=createInterface({input:process.stdin,crlfDelay:Infinity});
const line=await new Promise(resolve=>input.once('line',resolve));input.close();
const session=JSON.parse(line);
const manifest=assets(),byHash=Object.fromEntries(Object.entries(manifest).map(([p,v])=>[v.hash,p]));
const mime={'.html':'text/html','.css':'text/css','.js':'application/javascript','.json':'application/json','.wasm':'application/wasm','.svg':'image/svg+xml'};
let completion=session.buckets.length===0?session.jwt:undefined;
for(const bucket of session.buckets){
 const body=new FormData();
 for(const hash of bucket){
  const path=byHash[hash];if(!path)throw Error('Upload session does not match the local build');
  body.append(hash,new Blob([readFileSync('dist'+path).toString('base64')],{type:mime[extname(path)]||'text/plain'}),hash);
 }
 const response=await fetch('https://api.cloudflare.com/client/v4/accounts/'+session.accountId+'/workers/assets/upload?base64=true',{method:'POST',headers:{Authorization:'Bearer '+session.jwt},body});
 const data=await response.json();if(!response.ok||!data.success)throw Error('Asset upload failed: '+JSON.stringify(data.errors));
 if(data.result?.jwt)completion=data.result.jwt;
 console.error('Uploaded '+bucket.length+' assets.');
}
if(!completion)throw Error('Cloudflare did not issue an asset completion token');
console.log(JSON.stringify({jwt:completion}));
