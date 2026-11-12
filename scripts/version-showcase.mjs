// Record V1–V4 individually and export compact README-sized GIFs.
// Run `pnpm build` first: this serves the production build in dist/.
import {mkdir,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import {serve} from './serve.mjs';

const FFMPEG=process.env.FFMPEG_PATH??['ffmpeg','/opt/homebrew/bin/ffmpeg','/usr/local/bin/ffmpeg'].find(path=>{try{execFileSync(path,['-version'],{stdio:'ignore'});return true;}catch{return false;}});
if (!FFMPEG) throw new Error('ffmpeg is required to build the version GIFs');

const root=new URL('../',import.meta.url);
const output=new URL('evidence/current/version-gifs/',root);
await mkdir(output,{recursive:true});

const DURATION=6500; // entrance/startup settles first; export ~6.5 s like the README loop
const versions=[
  ['v1','procedural-3d'],
  ['v2','travelling-crests'],
  ['v3','hand-drawn-2d'],
  ['v4','print-plus-experiments']
];

const {server,url}=await serve({port:0,base:'/living_ukiyoe/',quiet:true});
const browser=await chromium.launch();
const context=await browser.newContext({viewport:{width:1440,height:925},deviceScaleFactor:1,locale:'en-US'});
const page=await context.newPage();
const errors=[];
page.on('pageerror',e=>errors.push(e.message));
try {
  // Start from a plain load, then switch through the public version control.
  // This applies each version's own defaultState(), including V4's layer
  // closure; a partial share fragment would be padded from the generic
  // defaults instead.
  await page.goto(url);
  await page.locator('canvas[data-ready]').waitFor({timeout:30000});
  for(const [id,name] of versions) {
    await page.selectOption('#ctl-version',id);
    await page.waitForFunction(v=>window.__waveLab.version===v,id,{timeout:20000});
    await page.waitForFunction(()=>window.__waveLab?.entrance().active===false,null,{timeout:30000});
    await page.waitForTimeout(700);
    await page.evaluate(ms=>{
      const stream=document.querySelector('canvas').captureStream(24);
      const recorder=new MediaRecorder(stream,{mimeType:'video/webm;codecs=vp8',videoBitsPerSecond:2000000});
      const chunks=[];
      window.recording=new Promise(resolve=>{
        recorder.ondataavailable=e=>chunks.push(e.data);
        recorder.onstop=()=>{stream.getTracks().forEach(t=>t.stop());const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.readAsDataURL(new Blob(chunks,{type:recorder.mimeType}));};
      });
      recorder.start();
      setTimeout(()=>recorder.stop(),ms);
    },DURATION+500);
    const webm=Buffer.from(await page.evaluate(()=>window.recording),'base64');
    const webmPath=new URL(`${id}.webm`,output);
    await writeFile(webmPath,webm);
    if(errors.length) throw new Error(`${id} page errors: ${errors.join(' | ')}`);
    const gif=new URL(`media/${id}-${name}.gif`,root);
    execFileSync(FFMPEG,['-v','error','-y','-i',fileURLToPath(webmPath),'-t',String(DURATION/1000),'-filter_complex','fps=6,scale=400:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=96[p];[b][p]paletteuse=dither=bayer:bayer_scale=4','-loop','0',fileURLToPath(gif)],{stdio:'inherit'});
    console.log(`wrote media/${id}-${name}.gif`);
  }
} finally {
  await browser.close();
  await new Promise(resolve=>server.close(resolve));
}
