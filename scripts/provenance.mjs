// Inventory only; this command cannot clear rights or rewrite visual baselines.
import {readFile,writeFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const root=new URL('../',import.meta.url);
const files=[];
for(const dir of ['assets/generated','assets/source']) for(const name of (await readdir(new URL(dir+'/',root))).sort()) {
  if(dir==='assets/source'&&!['kanagawa-inscription-scan.webp','kanagawa-vector-manifest.json'].includes(name))continue;
  const path=dir+'/'+name;
  files.push({path,sha256:createHash('sha256').update(await readFile(new URL(path,root))).digest('hex'),rights:name.includes('inscription')?'Met Public Domain scan derivative':name==='kanagawa-vector-manifest.json'?'provenance metadata':'third-party trace derivative or supporting data'});
}
await writeFile(new URL('assets/provenance.json',root),JSON.stringify({
  schemaVersion:1,
  checkedAt:new Date().toISOString().slice(0,10),
  sourcePage:'https://wp270302.wpx.jp/Hokusai/drawing-process.html',
  metObject:'https://www.metmuseum.org/art/collection/search/39799',
  metScan:'https://images.metmuseum.org/CRDImages/as/original/DP141042.jpg',
  metScanSha256:'b410eeec0473c4e63eef12434a5a7c4613401c6e18670718d7727f36a441495c',
  traceSource:{
    redistributed:false,
    sourcePage:'https://wp270302.wpx.jp/Hokusai/drawing-process.html',
    sha256:'82c419defe0293c8b240dd0aecd0438b39a63dd103df999b246462f063d2fb50',
    canvas:[2800,1914],
    fillPaths:31877
  },
  files
},null,2)+'\n');
