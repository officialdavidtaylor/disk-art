import {readdirSync,readFileSync,statSync} from 'node:fs';
import {join,relative,resolve} from 'node:path';
import {createHash} from 'node:crypto';
export function assets(root=resolve('dist')){
 const result={};
 function walk(dir){for(const name of readdirSync(dir)){const file=join(dir,name);if(statSync(file).isDirectory())walk(file);else{
  const path='/'+relative(root,file).split('\\').join('/');if(path==='/_headers'||path==='/_redirects')continue;
  const content=readFileSync(file);result[path]={hash:createHash('md5').update(content).digest('hex'),size:content.length};
 }}}
 walk(root);return result;
}
if(process.argv[1]&&resolve(process.argv[1])===resolve('scripts/asset-manifest.mjs'))console.log(JSON.stringify({manifest:assets(),headers:readFileSync('dist/_headers','utf8')}));
