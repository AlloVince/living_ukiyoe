// Optional real-window Chrome measurement, separate from the busy screenshot/E2E run.
import {chromium} from 'playwright';
import {serve} from './serve.mjs';
import {writeFile,mkdir} from 'node:fs/promises';
const root=new URL('../',import.meta.url),output=new URL('evidence/current/',root);await mkdir(output,{recursive:true});
const {server,url}=await serve({port:0,base:'/living_ukiyoe/',quiet:true});
const browser=await chromium.launch({channel:'chrome',headless:false});
const report={browser:browser.version(),mode:'headed Chrome, separate local measurement',samples:[]};
async function sample(page,name,target,referenceSize=false){
  await page.goto(target);await page.locator('canvas[data-ready]').waitFor();
  if(referenceSize)await page.addStyleTag({content:'#artwork{position:fixed;inset:0;width:1440px;height:925px;min-height:0;z-index:5}'});
  await page.waitForTimeout(1000);
  const data=await page.evaluate(()=>new Promise(resolve=>{
    const canvas=document.querySelector('canvas'),gl=canvas.getContext('webgl2'),ext=gl.getExtension('WEBGL_debug_renderer_info');
    const gpu=ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER);
    const gaps=[],start=performance.now();let prev=start;
    function frame(now){gaps.push(now-prev);prev=now;if(now-start<4000)requestAnimationFrame(frame);else resolve({gpu,canvas:[canvas.width,canvas.height],cssCanvas:[canvas.clientWidth,canvas.clientHeight],viewport:[innerWidth,innerHeight],frames:gaps.length,elapsedMs:now-start,averageFps:gaps.length/((now-start)/1000),p95FrameMs:gaps.sort((a,b)=>a-b)[Math.floor(gaps.length*.95)]});}requestAnimationFrame(frame);
  }));
  report.samples.push({name,...data});console.log(JSON.stringify({name,...data}));
}
try{
  const page=await browser.newPage({viewport:{width:1440,height:925},deviceScaleFactor:1});
  await sample(page,'public desktop layout',url);
  await page.screenshot({path:new URL('chrome-desktop.png',output).pathname});
  await sample(page,'public reference-sized canvas',url,true);
  await page.setViewportSize({width:390,height:844});await sample(page,'public phone layout',url);
}finally{await writeFile(new URL('performance-chrome.json',output),JSON.stringify(report,null,2)+'\n');await browser.close();await new Promise(r=>server.close(r));}
