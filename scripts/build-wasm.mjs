import { execFileSync } from 'node:child_process';
import { mkdirSync, copyFileSync, statSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
const go = process.env.GO_BIN || 'go';
mkdirSync('public', { recursive: true });
let goroot;
try { goroot = execFileSync(go, ['env', 'GOROOT'], { encoding: 'utf8' }).trim(); }
catch { console.error('Install Go 1.23+ or set GO_BIN to your Go executable.'); process.exit(1); }
execFileSync(go, ['build', '-trimpath', '-ldflags=-s -w', '-o', 'public/encoder.wasm', './cmd/wasm'], {
 stdio: 'inherit', env: { ...process.env, GOOS: 'js', GOARCH: 'wasm', GOCACHE: process.env.GOCACHE || '/tmp/dvd-art-go-cache' },
});
const runtime = [join(goroot, 'lib/wasm/wasm_exec.js'), join(goroot, 'misc/wasm/wasm_exec.js')].find(existsSync);
if (!runtime) throw Error('Cannot locate the matching Go WebAssembly runtime');
copyFileSync(runtime, 'public/wasm_exec.js');
copyFileSync(join(goroot,'LICENSE'), 'public/GO-LICENSE');
copyFileSync('LICENSE', 'public/LICENSE');
copyFileSync('NOTICE', 'public/NOTICE');
const bytes=statSync('public/encoder.wasm').size;
writeFileSync('public/encoder-meta.json', JSON.stringify({bytes, sha256:createHash('sha256').update(readFileSync('public/encoder.wasm')).digest('hex')}));
console.log('Go WebAssembly: '+(bytes/1e6).toFixed(2)+' MB');
