// Five-version evolution recording (V1 -> V2 -> V3 -> V4 -> V5), captured from
// the real production app in a real browser. One continuous canvas recording:
// each historical version plays for ~4.5 s, then V5 greets with its full
// entrance and settles into the loop. Output:
//   evidence/current/evolution.webm            (raw recording)
//   evidence/current/versions/<id>.png         (per-version still evidence)
//   media/ukiyoe-evolution.gif                 (compact presentation export)
import {mkdir,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import {serve} from './serve.mjs';

// Some environments (bare node spawns) lack /opt/homebrew/bin on PATH.
const FFMPEG=process.env.FFMPEG_PATH??['ffmpeg','/opt/homebrew/bin/ffmpeg','/usr/local/bin/ffmpeg'].find(path=>{try{execFileSync(path,['-version'],{stdio:'ignore'});return true;}catch{return false;}});
if (!FFMPEG) throw new Error('ffmpeg is required to build the evolution GIF');

const root=new URL('../',import.meta.url);
const output=new URL('evidence/current/',root);
await mkdir(new URL('versions/',output),{recursive:true});
const {server,url}=await serve({port:0,base:'/living_ukiyoe/',quiet:true});
const browser=await chromium.launch();
const page=await browser.newPage({viewport:{width:1440,height:925},deviceScaleFactor:1,locale:'en-US'});
const errors=[];
page.on('pageerror',e=>errors.push(e.message));
const frag=(verId,s={})=>'#u='+encodeURIComponent(JSON.stringify({v:1,ver:verId,s}));
const versionHash=(verId,s={})=>url+frag(verId,s);
const navHash=async (verId,state)=>{await page.evaluate(f=>{location.hash=f;},frag(verId,state));};
const waitVersion=async verId=>{
  try {
    await page.waitForFunction(v=>window.__waveLab.version===v,verId,{timeout:20000});
  } catch (error) {
    const probe=await page.evaluate(()=>({v:window.__waveLab.version,hash:location.hash.slice(0,40),failed:document.getElementById('failure')?.hidden===false})).catch(e=>({probeError:String(e)}));
    throw new Error(`waiting for version ${verId} failed: ${JSON.stringify(probe)} (${error.message.split('\n')[0]})`);
  }
  await page.locator('canvas[data-ready]').waitFor();
  await page.waitForTimeout(600);
};

try {
  await page.goto(versionHash('v1',{playing:true}));
  await page.locator('canvas[data-ready]').waitFor();
  await page.waitForTimeout(600);
  await page.evaluate(()=>{const stream=document.querySelector('canvas').captureStream(24);const recorder=new MediaRecorder(stream,{mimeType:'video/webm;codecs=vp8',videoBitsPerSecond:2000000});const chunks=[];window.recording=new Promise(resolve=>{recorder.ondataavailable=e=>chunks.push(e.data);recorder.onstop=()=>{stream.getTracks().forEach(t=>t.stop());const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.readAsDataURL(new Blob(chunks,{type:recorder.mimeType}));};});recorder.start();setTimeout(()=>recorder.stop(),26000);});
  // V1 -> V3: historical algorithms, each a few seconds of real motion.
  await page.waitForTimeout(3900);
  await page.screenshot({path:new URL('versions/v1-procedural-3d.png',output).pathname});
  await page.evaluate(hash=>{location.hash=hash;},frag('v2',{playing:true}));
  await waitVersion('v2');
  await page.waitForTimeout(3900);
  await page.screenshot({path:new URL('versions/v2-travelling-crests.png',output).pathname});
  await page.evaluate(hash=>{location.hash=hash;},frag('v3',{playing:true}));
  await waitVersion('v3');
  await page.waitForTimeout(3900);
  await page.screenshot({path:new URL('versions/v3-hand-drawn-2d.png',output).pathname});
  // V4: the frozen lab with the print's own sea replaced by the lab's own
  // layers (procedural wash + far/mid/near wavelets, source-sky band 6 off).
  await page.evaluate(hash=>{location.hash=hash;},frag('v4',{playing:true,layers:{sea:true,far:true,mid:true,near:true},clouds:[true,true,true,true,true,false]}));
  await waitVersion('v4');
  await page.waitForTimeout(3900);
  await page.screenshot({path:new URL('versions/v4-print-plus-experiments.png',output).pathname});
  // V5: fresh entrance (no reveal in the hash) then the steady loop.
  await page.evaluate(hash=>{location.hash=hash;},frag('v5',{playing:true}));
  await waitVersion('v5');
  await page.waitForFunction(()=>window.__waveLab.entrance().active===true,null,{timeout:5000}).catch(()=>{});
  await page.waitForTimeout(7800); // entrance (1.5 s) + steady loop
  await page.screenshot({path:new URL('versions/v5-final.png',output).pathname});
  await page.waitForTimeout(6500); // recorder stop window elapses
  const webm=Buffer.from(await page.evaluate(()=>window.recording),'base64');
  await writeFile(new URL('evolution.webm',output),webm);
  assertNoErrors(errors);
  const gif=new URL('media/ukiyoe-evolution.gif',root);
  execFileSync(FFMPEG,['-v','error','-y','-i',fileURLToPath(new URL('evolution.webm',output)),
    '-filter_complex','fps=6,scale=480:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=96[p];[b][p]paletteuse=dither=bayer:bayer_scale=4',
    '-loop','0',fileURLToPath(gif)],{stdio:'inherit'});
  console.log('Recorded the five-version evolution from the real browser canvas: media/ukiyoe-evolution.gif (+ evidence/current/evolution.webm, versions/*.png).');
} finally {
  await browser.close();
  await new Promise(resolve=>server.close(resolve));
}

function assertNoErrors(errors) {
  if (errors.length) throw new Error('page errors during evolution recording: '+errors.join(' | '));
}
