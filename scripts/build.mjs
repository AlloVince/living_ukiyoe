import { build } from 'esbuild';
import { readFile, writeFile, readdir, mkdir, copyFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
if (process.versions.node.split('.')[0] !== '24') throw Error('Use Node.js 24.x.');
const root = new URL('../',import.meta.url);
const out = new URL('dist/',root);
await mkdir(out,{recursive:true});
const plates = new URL('assets/generated/',root);
const atlas = {};
const archived = new Set(['boats.webp','spray-source.webp','spray.webp']);
for (const name of (await readdir(plates)).filter(x=>x.endsWith('.webp')&&!archived.has(x)).sort()) atlas[name.slice(0,-5)]='data:image/webp;base64,'+(await readFile(new URL(name,plates))).toString('base64');
const windows = JSON.parse(await readFile(new URL('plate-windows.json',plates),'utf8'));
const skyGroups = JSON.parse(await readFile(new URL('sky-groups.json',plates),'utf8')).map(({name,color})=>({name,color}));
const motion = JSON.parse(await readFile(new URL('integrated-motion.json',plates),'utf8'));
const result=await build({
  absWorkingDir:fileURLToPath(root),entryPoints:['app/main.js'],bundle:true,minify:true,format:'iife',target:['es2022'],
  outfile:fileURLToPath(new URL('app.js',out)),legalComments:'eof',metafile:true,
  plugins:[{name:'texture-plates',setup(b){
    b.onResolve({filter:/^virtual:assets$/},()=>({path:'assets',namespace:'plates'}));
    b.onLoad({filter:/.*/,namespace:'plates'},()=>({contents:`export default ${JSON.stringify(atlas)};export const plateWindows=${JSON.stringify(windows)};export const skyGroups=${JSON.stringify(skyGroups)};export const integratedMotion=${JSON.stringify(motion)};`,loader:'js'}));
  }}]
});
await writeFile(new URL('build-inputs.json',out),JSON.stringify(Object.keys(result.metafile.inputs),null,2)+'\n');
for (const [from,to] of [['index.html','index.html'],['app/style.css','app.css'],['favicon.svg','favicon.svg'],['evidence/baseline/reduced-motion.png','still.png'],['credits.html','credits.html']]) await copyFile(new URL(from,root),new URL(to,out));
const require=createRequire(import.meta.url);
const threeRoot=dirname(dirname(require.resolve('three')));
await copyFile(join(threeRoot,'LICENSE'),new URL('THREE-LICENSE.txt',out));
await copyFile(new URL('licenses/THIRD-PARTY-NOTICES.txt',root),new URL('THIRD-PARTY-NOTICES.txt',out));
console.log('Built standalone dist/. All browser resources use relative paths.');
