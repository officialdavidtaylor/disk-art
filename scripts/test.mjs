import {execFileSync} from 'node:child_process';
execFileSync(process.env.GO_BIN||'go',['test','./internal/...'],{stdio:'inherit',env:{...process.env,GOCACHE:process.env.GOCACHE||'/tmp/dvd-art-go-cache'}});
execFileSync(process.execPath,['scripts/calibration-test.mjs'],{stdio:'inherit'});
execFileSync(process.execPath,['scripts/wasm-smoke.mjs'],{stdio:'inherit'});
