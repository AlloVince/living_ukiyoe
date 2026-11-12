import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {chromium} from 'playwright';
import {PNG} from 'pngjs';
import {serve} from './serve.mjs';
import {encode,freshConfig} from '../demo/src/config.js';
import {coverFrame,frameFor} from '../demo/src/versions/v5/framing.js';
const root=new URL('../',import.meta.url);
const output=new URL('evidence/current/',root);await mkdir(output,{recursive:true});
const {server,url}=await serve({port:0,base:'/living_ukiyoe/',quiet:true});
const browser=await chromium.launch();
const report={base:url,checks:[],screenshots:[],visual:[],errors:[],requests:[],shareSample:null,performance:null};
const ok=label=>{report.checks.push(label);console.log('PASS '+label);};
const paused=(time=0)=>encode({...freshConfig(),playing:false,time});
async function ready(page,target=url+paused()) {await page.goto('about:blank');await page.goto(target);await page.locator('canvas[data-ready]').waitFor();}
const setLanguage=async(page,lang)=>{await page.locator('#language').click();await page.locator(`#language-menu [data-lang="${lang}"]`).click();};
const panelWidth=page=>page.locator('#panel').evaluate(x=>x.getBoundingClientRect().width);
const panelSettles=async(page,open)=>{await page.waitForFunction(want=>{const w=document.querySelector('#panel').getBoundingClientRect().width;return want?w>200:w<1;},open,{timeout:4000});return panelWidth(page);};
const togglePanel=async(page,open=false)=>{await page.locator('#panel-toggle').click();return panelSettles(page,open);};
async function screenshot(page,name) {
  const path=new URL(name+'.png',output).pathname;
  for(const fullPage of [true,false]) {
    try {await page.screenshot({path,fullPage});report.screenshots.push(name+'.png');return;}
    catch(error) {console.warn(`screenshot ${name} (${fullPage?'fullPage':'viewport'}) failed: ${error.message}`);await page.waitForTimeout(300);}
  }
  console.warn(`screenshot ${name} unavailable; evidence skipped`);
}
function pixelDifference(a,b) {
  const x=PNG.sync.read(a),y=PNG.sync.read(b);assert.equal(x.width,y.width);assert.equal(x.height,y.height);
  let pixels=0,max=0,total=0;
  for(let i=0;i<x.data.length;i+=4) {
    let different=false;for(let c=0;c<4;c++){const d=Math.abs(x.data[i+c]-y.data[i+c]);max=Math.max(max,d);total+=d;if(d)different=true;}
    if(different)pixels++;
  }
  return {pixels,maxChannelDifference:max,meanChannelDifference:total/x.data.length};
}
try {
  const context=await browser.newContext({viewport:{width:1440,height:925},deviceScaleFactor:1,locale:'en-US',reducedMotion:'no-preference',permissions:['clipboard-read','clipboard-write']});
  const page=await context.newPage();
  page.on('pageerror',e=>report.errors.push(e.message));
  page.on('requestfailed',r=>report.errors.push('request: '+r.url()+' '+r.failure()?.errorText));
  page.on('response',r=>{report.requests.push({url:r.url(),status:r.status()});if(r.status()>=400)report.errors.push('HTTP '+r.status()+' '+r.url());});
  await ready(page);
  assert.equal(await page.locator('#panel').isVisible(),true);
  assert.equal(await page.locator('#spray-distance').inputValue(),'50');assert.equal(await page.locator('#spray-count').inputValue(),'100');
  ok('default visit exposes creative controls and preserves 50/100');
  await page.addStyleTag({content:'#artwork{position:fixed;inset:0;width:1440px;height:925px;min-height:0;z-index:5}#panel-toggle{display:none}'});
  for(const time of [0,7,14,21,27.99]) {
    await page.evaluate(hash=>{location.hash=hash;},paused(time));
    await page.waitForFunction(t=>document.querySelector('#timeline').value===String(t)||Number(document.querySelector('#timeline').value)===t,time);
    await page.waitForTimeout(80);
    const shot=await page.locator('canvas').screenshot({path:new URL(`frame-${time}.png`,output).pathname});
    const difference=pixelDifference(shot,await readFile(new URL(`evidence/baseline/frame-${time}.png`,root)));
    report.visual.push({time,...difference});
    if(process.env.VISUAL_MODE!=='portable')assert.equal(difference.pixels,0,`visual drift at ${time}: ${JSON.stringify(difference)}`);
  }
  ok(process.env.VISUAL_MODE==='portable'?'five frames measured (portable GPU mode; source hashes checked separately)':'all five approved keyframes match pixel-for-pixel');
  await ready(page);
  await page.locator('details').filter({has:page.locator('#swell-push')}).last().evaluate(x=>x.open=true);
  await page.locator('#swell-push').fill('1.45');
  await page.locator('details').filter({has:page.locator('#spray-count')}).last().evaluate(x=>x.open=true);
  await page.locator('#spray-count').fill('111');
  await page.locator('#composition').selectOption('safe');
  await page.locator('details').filter({has:page.locator('#layer-boat-far')}).last().evaluate(x=>x.open=true);
  await page.locator('#layer-boat-far').uncheck();
  await setLanguage(page,'zh');
  assert.equal(await page.locator('#swell-push').inputValue(),'1.45');
  assert.equal(await page.locator('#spray-count').inputValue(),'111');
  await setLanguage(page,'ja');
  assert.equal(await page.locator('#layer-boat-far').isChecked(),false);
  assert.equal(await page.locator('html').getAttribute('lang'),'ja');
  ok('language changes preserve edited artwork');
  await page.locator('#share').click();
  const xHref=await page.locator('#share-menu [data-share=x]').getAttribute('href');
  assert(xHref.startsWith('https://twitter.com/intent/tweet?')&&xHref.includes(encodeURIComponent('#u=')),'the X intent carries the versioned link');
  assert(decodeURIComponent(xHref).includes('浮世絵が動いたら'),'the share copy follows the interface language');
  assert.deepEqual(await page.evaluate(()=>[...document.querySelectorAll('#share-menu [data-share]')].map(a=>a.dataset.share)),['x','facebook','telegram','weibo','email','copy']);
  assert.equal(await page.locator('#share-menu [data-share=system]').count(),0);
  await page.locator('#language').click();
  assert.equal(await page.locator('#share-menu').isVisible(),false,'only one popover may be open');
  assert.equal(await page.locator('#language-menu').isVisible(),true);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#language-menu').isVisible(),false);
  ok('share menu offers the common social intents with the versioned link');
  await page.locator('#share').click();
  await page.locator('#share-menu [data-share=copy]').click();
  await page.waitForTimeout(150);
  const link=await page.evaluate(()=>navigator.clipboard.readText());
  assert(new URL(link).pathname==='/living_ukiyoe/'&&link.includes('#u='));report.shareSample=link.replace(new URL(link).origin,'https://example.invalid');
  const newContext=await browser.newContext({viewport:{width:390,height:844},locale:'en-US'});
  const restored=await newContext.newPage();await ready(restored,link);
  assert.equal(await restored.locator('#swell-push').inputValue(),'1.45');assert.equal(await restored.locator('#spray-count').inputValue(),'111');assert.equal(await restored.locator('#composition').inputValue(),'safe');
  assert.equal(await restored.locator('#layer-boat-far').isChecked(),false);
  await restored.reload();await restored.locator('canvas[data-ready]').waitFor();assert.equal(await restored.locator('#spray-count').inputValue(),'111');
  ok('real clipboard link restores in fresh browser context and after refresh under project path');
  await newContext.close();
  await page.reload();await page.locator('canvas[data-ready]').waitFor();assert.equal(await page.locator('html').getAttribute('lang'),'ja');
  ok('manual language persists after reload');
  await page.locator('#reset').click();assert.equal(await page.locator('#spray-count').inputValue(),'100');
  const resetHash=new URL(page.url()).hash;
  assert(resetHash===''||resetHash.startsWith('#u='),'reset leaves a clean or version-default fragment');
  ok('reset restores the current version\'s own defaults');
  for(const [bad,speed] of [['#u=%','3'],['#u='+encodeURIComponent('{"v":99,"sprayCount":150}'),'3'],['#u='+encodeURIComponent('{"v":1,"sprayCount":9999,"speed":"bad"}'),'1']]) {
    // Invalid fragments land on V5; a malformed legacy fragment still falls back to V4.
    await ready(page,url+bad);assert.equal(await page.locator('#spray-count').inputValue(),'100');assert.equal(await page.locator('#swell-speed').inputValue(),speed);
  }
  await page.evaluate(hash=>{location.hash=hash;},encode({...freshConfig(),playing:false,push:1.8}));await page.waitForFunction(()=>document.querySelector('#swell-push').value==='1.8');
  await page.goBack();await page.waitForFunction(()=>document.querySelector('#swell-push').value==='1');
  await page.goForward();await page.waitForFunction(()=>document.querySelector('#swell-push').value==='1.8');
  ok('invalid/versioned links default safely; fragment history restores edits');
  for(const lang of ['en','zh','ja']) for(const [name,width,height] of [['desktop',1440,925],['ultrawide',2520,1080],['ipad',1024,768],['phone',390,844],['narrow',320,740],['landscape',844,390]]) {
    await page.setViewportSize({width,height});await ready(page);
    await setLanguage(page,lang);
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${lang} ${name} overflow`);
    const rects=await page.evaluate(()=>['artwork','panel'].map(id=>{const r=document.getElementById(id).getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom};}));
    assert(rects[0].right<=rects[1].left+.5||rects[0].bottom<=rects[1].top+.5,`${lang} ${name} panel covers art`);
    await screenshot(page,`${lang}-${name}`);
    if (width > 900) { // the splitter only exists in the side-by-side layout
      assert.equal(await togglePanel(page),0);
      await screenshot(page,`${lang}-${name}-collapsed`);
      assert((await togglePanel(page,true))>200);
    } else {
      assert.equal(await page.locator('#panel-toggle').isVisible(),false);
    }
    await page.locator('#reset').click();
  }
  ok('EN/ZH/JA × desktop/21:9/4:3/390px/320px/landscape; floating toggle, scrolling and reset');
  await page.setViewportSize({width:1440,height:925});await ready(page);
  assert.equal(await togglePanel(page),0);
  assert.equal(await page.locator('#panel-toggle').isVisible(),true);
  await page.reload();await page.locator('canvas[data-ready]').waitFor();
  assert.equal(await panelWidth(page),0,'closed panel stays closed after reload');
  assert((await togglePanel(page,true))>200);
  ok('floating toggle closes the panel to a single button and remembers the state');
  await page.evaluate(()=>localStorage.removeItem('living-ukiyoe.panel'));
  await page.reload();await page.locator('canvas[data-ready]').waitFor();
  const touchContext=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:2,locale:'zh-CN'});
  const touch=await touchContext.newPage();await ready(touch);
  assert.equal(await touch.locator('#panel-toggle').isVisible(),false);
  assert.equal(await touch.locator('#panel').isVisible(),true);
  await touch.setViewportSize({width:844,height:390});await touch.evaluate(()=>dispatchEvent(new Event('orientationchange')));
  assert(await touch.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await screenshot(touch,'touch-orientation');await touchContext.close();
  ok('touch taps and portrait-to-landscape resize/orientationchange');
  const reducedContext=await browser.newContext({viewport:{width:1440,height:925},reducedMotion:'reduce',locale:'en-US'});
  const reduced=await reducedContext.newPage();await ready(reduced,url);
  assert.equal(await reduced.locator('#play').textContent(),'Play');
  const still=await reduced.locator('canvas').screenshot();await reduced.waitForTimeout(300);assert(still.equals(await reduced.locator('canvas').screenshot()));
  await screenshot(reduced,'reduced-motion');await reduced.locator('#play').click();assert.equal(await reduced.locator('#play').textContent(),'Pause');
  await reduced.waitForTimeout(200);assert(!still.equals(await reduced.locator('canvas').screenshot()));await reducedContext.close();
  ok('reduced motion is static and complete; explicit playback opt-in works');
  const fallbackContext=await browser.newContext({viewport:{width:390,height:844},locale:'ja-JP'});
  await fallbackContext.addInitScript(()=>{HTMLCanvasElement.prototype.getContext=function(){return null;};});
  const fallback=await fallbackContext.newPage();await fallback.goto(url);await fallback.locator('#failure').waitFor();
  assert.equal(await fallback.locator('#fallback').isVisible(),true);assert(await fallback.locator('#fallback').evaluate(x=>x.complete&&x.naturalWidth>0));
  await screenshot(fallback,'webgl-unavailable');await fallbackContext.close();ok('WebGL unavailable shows a complete local still and retry');
  const webshareContext=await browser.newContext();
  await webshareContext.addInitScript(()=>{Object.defineProperty(navigator,'share',{value:async data=>{window.sharedData=data;}});});
  const webshare=await webshareContext.newPage();await ready(webshare);await webshare.locator('#share').click();
  await webshare.locator('#share-menu [data-share=system]').click();await webshare.waitForTimeout(150);
  assert.equal(new URL(await webshare.evaluate(()=>window.sharedData.url)).pathname,'/living_ukiyoe/');await webshareContext.close();ok('system share sheet stays available as a menu entry (stubbed)');
  const deniedContext=await browser.newContext();
  await deniedContext.addInitScript(()=>{Object.defineProperty(navigator,'share',{value:undefined});Object.defineProperty(navigator,'clipboard',{value:{writeText:async()=>{throw Error('denied')}}});});
  const denied=await deniedContext.newPage();await ready(denied);await denied.locator('#share').click();
  await denied.locator('#share-menu [data-share=copy]').click();await denied.locator('#manual-copy').waitFor({state:'visible'});
  assert((await denied.locator('#share-link').inputValue()).includes('/living_ukiyoe/'));await deniedContext.close();ok('clipboard denial offers a selected, manually copyable link');
  await page.setViewportSize({width:1440,height:925});await ready(page);
  await page.locator('#play').focus();await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement.id),'ctl-version');
  await page.locator('#panel-toggle').focus();await page.keyboard.press('Enter');assert.equal(await panelSettles(page,false),0);
  await page.keyboard.press('Enter');assert((await panelSettles(page,true))>200);
  await page.evaluate(()=>document.documentElement.style.fontSize='28px');
  await page.setViewportSize({width:720,height:600});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await screenshot(page,'text-200-percent');
  ok('keyboard toolbar and enlarged text reflow');
  await ready(page);await page.setViewportSize({width:1440,height:925});
  await page.locator('#play').click();
  report.performance=await page.evaluate(()=>new Promise(resolve=>{const times=[];const start=performance.now();function step(now){times.push(now);if(now-start<2500)requestAnimationFrame(step);else resolve({viewport:[innerWidth,innerHeight],elapsedMs:now-start,frames:times.length,averageFps:times.length/((now-start)/1000),renderer:'Three.js WebGL2',devicePixelRatio});}requestAnimationFrame(step);}));
  // The showcase recording and wall-clock loop check are local-only: CI
  // runners rasterize below real time, so a fixed 32 s window can be a false
  // negative. The 28 s loop itself is still covered by the source constants.
  if (!process.env.CI) {
    await page.goto('about:blank');await page.goto(url);
    await page.bringToFront();
    await page.locator('canvas[data-ready]').waitFor();
    await page.locator('details').filter({has:page.locator('#timeline')}).last().evaluate(x=>x.open=true);
    await page.evaluate(()=>{const stream=document.querySelector('canvas').captureStream(24);const recorder=new MediaRecorder(stream,{mimeType:'video/webm;codecs=vp8',videoBitsPerSecond:2000000});const chunks=[];window.recording=new Promise(resolve=>{recorder.ondataavailable=e=>chunks.push(e.data);recorder.onstop=()=>{stream.getTracks().forEach(t=>t.stop());const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.readAsDataURL(new Blob(chunks,{type:recorder.mimeType}));};});recorder.start();setTimeout(()=>recorder.stop(),32000);});
    await page.waitForFunction(()=>window.__waveLab?.entrance().active===false,null,{timeout:60000});
    let previous=Number(await page.locator('#timeline').inputValue()),wrapped=false;
    for(let i=0;i<9;i++){await page.waitForTimeout(3900);const current=Number(await page.locator('#timeline').inputValue());if(current<previous)wrapped=true;previous=current;}
    assert(wrapped,'live playback must cross 28 second loop after the entrance');
    await writeFile(new URL('live-cycle.webm',output),Buffer.from(await page.evaluate(()=>window.recording),'base64'));
    ok('32 second real recording: paper opening, part-by-part entrance, observed 28 second wrap');
  }
  assert.equal((await page.request.get(url+'does-not-exist')).status(),404);ok('unknown project paths return 404');

  // ---- Five-version acceptance (V1..V5) ----
  const versionHash=(verId,s={})=>url+'#u='+encodeURIComponent(JSON.stringify({v:1,ver:verId,s}));
  const diag=()=>page.evaluate(()=>window.__waveLab.diagnostics());
  const pick=async verId=>{await page.locator('#ctl-version').selectOption(verId);await page.waitForFunction(v=>window.__waveLab.version===v,verId);await page.waitForTimeout(350);};
  // V5 opens on the complete print (full-art framing) at every common aspect;
  // Radio's pigment-box cover stays one composition away.
  const framingEquals=(actual,expected)=>Math.abs(actual.frameX-expected.x)<=1&&Math.abs(actual.frameY-expected.y)<=1
    &&Math.abs(actual.frameWidth-expected.width)<=1&&Math.abs(actual.frameHeight-expected.height)<=1;
  for(const [name,width,height] of [['21:9',2520,1080],['32:9',3440,1440],['4:3',1024,768],['phone',390,844],['landscape',844,390],['narrow',320,740]]) {
    await page.setViewportSize({width,height});
    await ready(page,versionHash('v5',{playing:false}));
    await page.waitForTimeout(600); // framing eases in the render loop
    // The Lab canvas excludes the panel column; framing applies to the canvas
    // aspect, so compute expectations from the live canvas rect.
    const rect=await page.locator('canvas').evaluate(x=>({w:x.clientWidth,h:x.clientHeight}));
    const aspect=rect.w/Math.max(rect.h,1);
    const full=frameFor(aspect,1);
    const d=await diag();
    assert(framingEquals(d,full),`${name} default framing ${JSON.stringify(d)} vs full ${JSON.stringify(full)} (canvas ${rect.w}x${rect.h})`);
    await page.locator('#composition').selectOption('cover');
    await page.waitForTimeout(600);
    const covered=await diag();
    const cover=coverFrame(aspect);
    assert(framingEquals(covered,cover),`${name} cover framing ${JSON.stringify(covered)} vs ${JSON.stringify(cover)}`);
  }
  ok('V5 opens on full art and equals Radio coverFrame when selected at 21:9/32:9/4:3/phone/landscape/narrow');
  await page.setViewportSize({width:1440,height:925});
  await ready(page,versionHash('v5',{playing:false,reveal:1}));
  assert.equal(await page.locator('#swell-speed').inputValue(),'3');
  assert.equal(await page.locator('#swell-push').inputValue(),'1');
  assert.equal(await page.locator('#swell-lift').inputValue(),'0.3');
  assert.equal(await page.locator('#layer-spray-source').isChecked(),false);
  const flecksOff=await page.locator('canvas').screenshot();
  await page.locator('#layer-spray-source').check();await page.waitForTimeout(400);
  const flecksOn=await page.locator('canvas').screenshot();
  assert(!flecksOff.equals(flecksOn),'the original flecks layer must paint the print');
  await page.locator('#layer-spray-source').uncheck();
  ok('V5 opens at 3x speed / 1 push / 0.3 swell with the print\'s own flecks layer off');
  // Entrance choreography: pinned reveal -> exact part counts. Radio's 19-plate
  // table plus the Owner-added inscription (delay 0.20) = 20 parts.
  for(const [reveal,expected] of [[0.2,1],[0.35,7],[0.45,10],[0.6,17],[1,20]]) {
    await ready(page,versionHash('v5',{playing:false,reveal}));
    const d=await diag();
    assert.equal(d.partsVisible,expected,`entrance parts at reveal ${reveal}: ${d.partsVisible} != ${expected}`);
  }
  ok('V5 pinned entrance reveals 1/7/10/17/20 parts in Radio order (+ Owner-added inscription)');
  // Fresh load plays the entrance once and settles into the loop.
  await ready(page,url);
  await page.waitForFunction(()=>window.__waveLab.entrance().active===true,null,{timeout:5000});
  await page.waitForFunction(()=>window.__waveLab.entrance().active===false,null,{timeout:8000});
  assert.equal((await diag()).partsVisible,20);ok('V5 fresh load runs the entrance once and reaches the full print');
  // V4 opens on the lab's own ground: paper/sea wash, its far/mid/near
  // wavelets and the print's flecks; the original sky, Fuji, upper wave,
  // boats and moving spray stay off. Layers come first and are expanded, the
  // wave rhythm is closed, and the historical layer preset is gone.
  await page.setViewportSize({width:1440,height:925});
  await ready(page,url);
  await pick('v4');
  await page.waitForTimeout(300);
  const v4layers=await page.evaluate(()=>Object.fromEntries([...document.querySelectorAll('#panel-body input[data-kind=layer]')].map(i=>[i.dataset.name,i.checked])));
  assert.deepEqual(v4layers,{
    'sky':true,'sea':true,'source-sky':false,'fuji':false,'far':true,'mid':true,'near':true,
    'hero':true,'hero-flow':true,'upper-wave':false,'lower-left':true,'lower-center':true,
    'lower-right':true,'spray-source':true,'spray-motion':false,'boat-left':false,
    'boat-near':false,'boat-far':false,'inscription':false
  });
  assert.deepEqual(await page.evaluate(()=>[...document.querySelectorAll('#panel-body details')].slice(0,2).map(d=>d.open)),[true,false]);
  assert.equal(await page.locator('#preview').count(),0,'V4 must not carry a layer preset');
  ok('V4 opens on its lab ground with layers expanded, rhythm closed and no preset');
  // Version switching: no residue, per-version states stay separated.
  await page.setViewportSize({width:1440,height:925});
  await ready(page,versionHash('v5',{playing:false}));
  await page.locator('details').filter({has:page.locator('#spray-count')}).last().evaluate(x=>x.open=true);
  await page.locator('#spray-count').fill('111');
  await pick('v1');
  const v1a=await page.locator('canvas').screenshot();await page.waitForTimeout(1200);
  const v1b=await page.locator('canvas').screenshot();
  assert(!v1a.equals(v1b),'V1 procedural wave must move');
  await page.locator('#ctl-action-replay').click();
  await pick('v3');
  const v3a=await page.locator('canvas').screenshot();await page.waitForTimeout(1200);
  const v3b=await page.locator('canvas').screenshot();
  assert(!v3a.equals(v3b),'V3 sea bands must move');
  await pick('v2');
  assert((await page.locator('#panel input[type=range]').count())>=13,'V2 exposes its historical parameters');
  await pick('v5');
  assert.equal(await page.locator('#spray-count').inputValue(),'111','V5 state survives version switches');
  await pick('v4');
  await page.locator('details').filter({has:page.locator('#spray-count')}).last().evaluate(x=>x.open=true);
  await page.locator('#spray-count').fill('77');
  await pick('v5');
  assert.equal(await page.locator('#spray-count').inputValue(),'111','historical state must not pollute V5');
  ok('V1/V2/V3 restore alive, replay works, switching leaves no residue or state pollution');
  // Versioned share link restores the right version in a fresh context.
  await page.locator('details').filter({has:page.locator('#spray-count')}).last().evaluate(x=>x.open=true);
  await page.locator('#spray-count').fill('111');
  await page.locator('#share').click();
  await page.locator('#share-menu [data-share=copy]').click();
  await page.waitForTimeout(150);
  const versionedLink=await page.evaluate(()=>navigator.clipboard.readText());
  assert(versionedLink.includes('%22ver%22%3A%22v5%22'),'versioned link carries the version identity');
  const versionContext=await browser.newContext({viewport:{width:390,height:844},locale:'en-US'});
  const versioned=await versionContext.newPage();await ready(versioned,versionedLink);
  assert.equal(await versioned.locator('#ctl-version').inputValue(),'v5');
  assert.equal(await versioned.locator('#spray-count').inputValue(),'111');
  await versionContext.close();
  ok('versioned share link restores V5 and its state in a fresh context');
  await ready(page,url+'#u='+encodeURIComponent('{"v":1,"ver":"v9","s":{}}'));
  assert.equal(await page.locator('#ctl-version').inputValue(),'v5');ok('unknown version marker falls back to the final artwork');
  assert.equal(report.errors.length,0,JSON.stringify(report.errors));ok('zero page errors / failed resources on the main test page');
  await context.close();
} finally {
  await writeFile(new URL('report.json',output),JSON.stringify(report,null,2)+'\n');
  await browser.close();await new Promise(resolve=>server.close(resolve));
}
