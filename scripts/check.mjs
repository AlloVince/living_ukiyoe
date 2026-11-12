import assert from 'node:assert/strict';
import {readFile,realpath,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {DEFAULT,cloudDefaults} from '../demo/src/config.js';
const root=new URL('../',import.meta.url);
assert.equal(process.versions.node.split('.')[0],'24');
const manifest=JSON.parse(await readFile(new URL('evidence/baseline/manifest.json',root),'utf8'));
assert.deepEqual(DEFAULT.layers,manifest.defaults);
assert.equal(DEFAULT.sprayDistance,manifest.sprayDistance);assert.equal(DEFAULT.sprayCount,manifest.sprayLimit);assert.deepEqual(cloudDefaults,manifest.cloudStrengths);
for(const [path,hash] of Object.entries(manifest.hashes)) assert.equal(createHash('sha256').update(await readFile(new URL(path,root))).digest('hex'),hash,`Protected art or algorithm drift: ${path}`);
const require=createRequire(import.meta.url);
for(const dep of ['three','esbuild','playwright','pngjs']) {
  const path=await realpath(require.resolve(dep));
  assert(path.startsWith(fileURLToPath(new URL('node_modules/',root))),`Parent dependency: ${dep} ${path}`);
}
const inputs=JSON.parse(await readFile(new URL('dist/build-inputs.json',root),'utf8'));
for(const input of inputs) assert(!input.startsWith('../') && !input.includes('/Users/'),`Outside build input: ${input}`);
const html=await readFile(new URL('dist/index.html',root),'utf8');
for(const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) assert(match[1].startsWith('./')||/^https:\/\//.test(match[1]),`Root-relative asset: ${match[1]}`);
const js=await readFile(new URL('dist/app.js',root),'utf8');
assert(!js.includes('/Users/')&&!js.includes('cloveread.web/node_modules'),'Local path leaked');
assert(!html.includes('debug=')&&!html.includes('验收'));
assert.deepEqual((await readdir(new URL('dist/',root))).sort(),['THIRD-PARTY-NOTICES.txt','THREE-LICENSE.txt','app.css','app.js','build-inputs.json','credits.html','favicon.svg','index.html','still.png'].sort());
for(const dir of ['app','demo/src','scripts','tests']) for(const name of await readdir(new URL(dir+'/',root))) {
  if(!/\.m?js$/.test(name))continue;
  const result=spawnSync(process.execPath,['--check',fileURLToPath(new URL(dir+'/'+name,root))],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);
}
console.log('check: protected art hashes/defaults, local dependencies, build inputs, relative URLs, syntax and production output PASS.');
