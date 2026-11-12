import * as THREE from 'three';
import { VERSIONS, DEFAULT_VERSION, versionById } from '../demo/src/versions/registry.js';
import { selectLanguage } from '../demo/src/config.js';
import { t } from '../demo/src/i18n.js';
import assetUrls, { plateWindows, skyGroups, integratedMotion } from 'virtual:assets';

const $ = id => document.getElementById(id);
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const isObject = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const LOOP_SECONDS = 28;
let savedLanguage;
try { savedLanguage = localStorage.getItem('living-ukiyoe.language'); } catch { /* storage can be unavailable */ }
let lang = selectLanguage(savedLanguage, navigator.languages);
let userMotionChoice = false;
let ver = DEFAULT_VERSION;
let state = null;          // current version's state (owned by the version schema)
let versionStates = new Map(); // per-version states; history never leaks across versions
let instance = null;
let renderer, frameId, failed = false;
let previous = performance.now();
let seconds = 0;           // unbounded motion clock (host-owned)
let envelope = 0;          // Radio's playMotion envelope: tau 1.35 s up, 2.16 s down
let entranceActive = false;
let activationClock = 0;
let mounted = false;
let dirty = true;
const say = key => { $('feedback').textContent = key ? t(lang,key) : ''; };
const tr = key => t(lang,key);

// ---- Fragment protocol ----------------------------------------------------
// v4 keeps the legacy flat fragment (every link written before the version
// registry targeted the frozen lab, so no marker means v4). All other
// versions carry their identity: {v:1, ver, s:{delta}}.
function decodeHash(hash) {
  const fresh = () => ({ ver: DEFAULT_VERSION, state: null, valid: true, pinned: new Set() });
  if (!hash) return fresh();
  if (!hash.startsWith('#u=') || hash.length > 12000) return { ...fresh(), valid: false };
  try {
    const value = JSON.parse(decodeURIComponent(hash.slice(3)));
    if (!isObject(value) || value.v !== 1) throw Error('version');
    if (value.ver && value.ver !== 'v4') {
      const def = versionById(value.ver);
      if (!def) throw Error('unknown-version');
      const restored = def.validate(value.s ?? {});
      return { ver: def.id, state: restored, valid: true, pinned: new Set(Object.keys(value.s ?? {})) };
    }
    const def = versionById('v4');
    const restored = def.validate(value);
    return { ver: 'v4', state: restored, valid: true, pinned: new Set(Object.keys(value).filter(k => k !== 'v')) };
  } catch {
    return { ...fresh(), valid: false };
  }
}
function encodeHash() {
  const def = versionById(ver);
  const delta = def.encode(state);
  if (def.id === 'v4') {
    if (!Object.keys(delta).length) return '';
    return '#u=' + encodeURIComponent(JSON.stringify({ v: 1, ...delta }));
  }
  const payload = { v: 1, ver: def.id };
  if (Object.keys(delta).length) payload.s = delta;
  return '#u=' + encodeURIComponent(JSON.stringify(payload));
}
function updateURL() {
  try { history.replaceState(null,'',location.pathname + location.search + encodeHash()); } catch { /* file preview may restrict history */ }
}

// ---- Assets ---------------------------------------------------------------
// Decoded images are immutable and shared; every version activation builds
// its own THREE.Texture wrappers (same strategy as the Radio theme), so
// switching versions never re-decodes a plate and disposal stays honest.
const decodedImages = new Map();
function decodeImage(url) {
  let pending = decodedImages.get(url);
  if (pending) return pending;
  pending = new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`plate failed to load: ${url}`));
    image.src = url;
  });
  decodedImages.set(url, pending);
  pending.catch(() => decodedImages.delete(url));
  return pending;
}
async function loadPlates(spec) {
  const names = spec === 'all' ? Object.keys(assetUrls) : spec;
  const missing = names.filter(name => !assetUrls[name]);
  if (missing.length) throw new Error(`unknown plates: ${missing.join(', ')}`);
  const textures = {};
  await Promise.all(names.map(async name => {
    const image = await decodeImage(assetUrls[name]);
    const texture = new THREE.Texture(image);
    texture.colorSpace = THREE.NoColorSpace;
    texture.premultiplyAlpha = true;
    texture.needsUpdate = true;
    if (name === 'source-sky-index') {
      texture.minFilter = THREE.NearestFilter;
      texture.magFilter = THREE.NearestFilter;
      texture.generateMipmaps = false;
    }
    textures[name] = texture;
  }));
  return textures;
}

// ---- Playback -------------------------------------------------------------
function motionEnabled() { return state.motion && (!reduced.matches || userMotionChoice); }
function activeNow() { return !failed && instance && state.playing && motionEnabled() && !document.hidden; }

// ---- Panel ----------------------------------------------------------------
// Stable, semantic control ids shared by every version's panel (the e2e
// suite and screenshots address controls by these ids).
const CONTROL_IDS = {
  motion: 'motion', speed: 'swell-speed', push: 'swell-push', lift: 'swell-lift',
  ink: 'ribbon-ink', inkStrength: 'ribbon-strength', inkContour: 'ribbon-contour',
  cloudMotion: 'cloud-motion', cloudStrength: 'cloud-strength',
  sprayDistance: 'spray-distance', sprayCount: 'spray-count',
  time: 'timeline', reveal: 'reveal', composition: 'composition'
};
const idFor = key => {
  const [head, rest] = key.split('.');
  if (rest !== undefined) {
    if (head === 'phases') return `phase-${rest}`;
    return `ctl-${key.replace(/\./g, '-')}`;
  }
  return CONTROL_IDS[key] ?? `ctl-${key}`;
};
const labelOf = control => control.labelKey ? tr(control.labelKey) : control.label ?? '';
const trSafe = key => { try { return tr(key); } catch { return String(key); } };
const controlHtml = (control) => {
  switch (control.kind) {
    case 'check': {
      const value = getPath(control.key);
      const id = idFor(control.key);
      return `<label class="check" for="${id}"><input type="checkbox" id="${id}" data-key="${control.key}" ${value?'checked':''}><span>${labelOf(control)}</span></label>`;
    }
    case 'slider': {
      const value = getPath(control.key);
      const id = idFor(control.key);
      return `<div class="slider"><label for="${id}">${labelOf(control)}</label><output for="${id}">${typeof value === 'number' ? +value.toFixed(2) : value}${control.unit ?? ''}</output><input id="${id}" type="range" min="${control.min}" max="${control.max}" step="${control.step}" value="${value}" data-key="${control.key}" data-unit="${control.unit ?? ''}" ${control.live?`data-live="${control.live}"`:''}></div>`;
    }
    case 'select': {
      const id = idFor(control.key);
      return `<label class="field" for="${id}"><span>${labelOf(control)}</span><select id="${id}" data-key="${control.key}">${control.options.map(([value,label])=>`<option value="${value}" ${value===getPath(control.key)?'selected':''}>${trSafe(label)}</option>`).join('')}</select></label>`;
    }
    case 'group':
      return `<details ${control.open?'open':''}><summary>${trSafe(control.labelKey ?? control.label)}</summary>${control.items.map(controlHtml).join('')}</details>`;
    case 'layers':
      return `<div class="layers">${Object.entries(state.layers).map(([name,visible])=>`<label class="check" for="layer-${name}"><input type="checkbox" id="layer-${name}" data-kind="layer" data-name="${name}" ${visible?'checked':''}><span>${trSafe(name)}</span></label>`).join('')}</div>`;
    case 'inkLayers':
      return `<div class="layers">${Object.entries(state.inkLayers).map(([name,enabled])=>`<label class="check" for="ink-${name}"><input type="checkbox" id="ink-${name}" data-kind="ink" data-name="${name}" ${enabled?'checked':''}><span>${trSafe(name)}</span></label>`).join('')}</div>`;
    case 'clouds':
      return state.clouds.map((visible,i)=>`<div class="cloud-row"><label class="check" for="ctl-cloud-${i}"><input id="ctl-cloud-${i}" data-kind="cloud" data-index="${i}" type="checkbox" ${visible?'checked':''}>${tr('cloud')} ${i+1}</label><input type="range" min="0" max="1.5" step="0.05" value="${state.cloudStrengths[i]}" data-kind="cloud-strength" data-index="${i}" aria-label="${tr('cloud')} ${i+1} ${tr('strength')}"></div>`).join('');
    case 'action':
      return `<button id="ctl-action-${control.id}" type="button" data-kind="action" data-action="${control.id}">${trSafe(control.labelKey ?? control.label)}</button>`;
    default: return '';
  }
};
function getPath(key) {
  const [head, rest] = key.split('.');
  return rest === undefined ? state[head] : state[head][rest];
}
function setPath(key, value) {
  const [head, rest] = key.split('.');
  if (rest === undefined) state[head] = value;
  else state[head][rest] = value;
}
function renderUI() {
  renderShell();
  if (!state) return;
  const def = versionById(ver);
  $('panel').setAttribute('aria-label',tr('controls'));
  $('panel-body').innerHTML = `<label class="field" for="ctl-version"><span>${tr('version')}</span><select id="ctl-version">${VERSIONS.map(v=>`<option value="${v.id}" ${v.id===ver?'selected':''}>${tr(v.titleKey)}</option>`).join('')}</select></label>
    ${def.controls(state).map(controlHtml).join('')}`;
  wireUI();
  $('play').disabled = failed;
  setPlayingLabel();
}
function renderShell() {
  document.documentElement.lang = {en:'en',zh:'zh-CN',ja:'ja'}[lang];
  document.title = tr('title');
  document.querySelector('meta[name=description]').content = tr('subtitle');
  $('panel-title').textContent = tr('title');
  $('share').setAttribute('aria-label',tr('share'));
  $('share').title = tr('share');
  $('language').setAttribute('aria-label',tr('language'));
  $('language').title = tr('language');
  for (const item of $('language-menu').children) item.setAttribute('aria-checked',String(item.dataset.lang===lang));
  $('reset').textContent = tr('reload');
  $('live-demo').textContent = tr('radio');
  $('credits-link').textContent = tr('credits');
  applyPanel();
  $('loading').textContent = tr('loading');
  $('loading').hidden = !loading;
  $('fallback').alt = tr('artwork');
  document.querySelector('canvas').setAttribute('aria-label',tr('artwork'));
  $('failure-text').textContent = tr('fallback');
  $('retry').textContent = tr('retry');
  $('share-link-label').textContent = tr('shareError');
}
function pausedLabel() { return !state || !state.playing || !motionEnabled() ? 'play' : 'pause'; }
function setPlayingLabel() {
  const key = pausedLabel();
  $('play').textContent = tr(key);
  $('play').setAttribute('aria-label',tr(key));
}
function applyStateToInstance() {
  if (!instance) return;
  instance.applyState(state);
  if (ver === 'v5') instance.setReveal(state.reveal);
  instance.resize(Math.max(renderer.domElement.clientWidth,1) / Math.max(renderer.domElement.clientHeight,1));
  if (typeof state.time === 'number') seconds = state.time;
  dirty = true;
}
function changed() {
  applyStateToInstance();
  updateURL();
  say('');
  setPlayingLabel();
}
function wireUI() {
  $('play').onclick = () => {
    if (!motionEnabled()) { state.motion = true; state.playing = true; userMotionChoice = true; }
    else state.playing = !state.playing;
    changed(); renderUI();
  };
}
function onPanelInput(event) {
  const target = event.target;
  if (target.id === 'ctl-version') { setVersion(target.value); return; }
  const kind = target.dataset.kind;
  if (!kind && !target.dataset.key) return;
  if (kind === 'layer') { state.layers[target.dataset.name] = target.checked; changed(); return; }
  if (kind === 'ink') { state.inkLayers[target.dataset.name] = target.checked; changed(); return; }
  if (kind === 'cloud') { state.clouds[Number(target.dataset.index)] = target.checked; changed(); return; }
  if (kind === 'cloud-strength') { state.cloudStrengths[Number(target.dataset.index)] = target.valueAsNumber; changed(); updateOutput(target); return; }
  if (kind === 'action') {
    if (target.dataset.action === 'replay') replay();
    return;
  }
  if (!target.dataset.key) return;
  const key = target.dataset.key;
  if (key === 'motion') userMotionChoice = true;
  const value = target.type === 'checkbox' ? target.checked
    : target.tagName === 'SELECT' ? target.value : target.valueAsNumber;
  if (target.dataset.live === 'time') {
    seconds = value;
    state.playing = false;
    setPath(key, value);
    applyStateToInstance(); updateURL(); setPlayingLabel(); updateOutput(target);
    return;
  }
  if (target.dataset.live === 'reveal') {
    entranceActive = false;
    state.playing = false;
    setPath(key, value);
    changed(); updateOutput(target);
    return;
  }
  setPath(key, value);
  changed(); updateOutput(target);
  if (key === 'motion') { setPlayingLabel(); renderUI(); }
}
function updateOutput(input) {
  const output = $('panel').querySelector(`output[for="${input.id}"]`);
  if (output) output.value = (Math.round(input.valueAsNumber * 100) / 100) + (input.dataset.unit ?? '');
}
function replay() {
  seconds = 0;
  state.time = 0;
  if (ver === 'v5') { state.reveal = 0; entranceActive = false; } // replay restarts the loop, not the entrance
  dirty = true; updateURL();
}
function startEntrance() {
  if (ver !== 'v5' || !instance) return;
  state.reveal = 0;
  entranceActive = true;
  activationClock = 0;
  dirty = true; updateURL();
}

// ---- Host loop ------------------------------------------------------------
let loading = true;
function paint() {
  if (!instance || failed) return;
  renderer.render(instance.scene, instance.camera);
}
function resize() {
  if (!instance || failed) return;
  const canvas = renderer.domElement;
  renderer.setPixelRatio(Math.min(devicePixelRatio,2));
  renderer.setSize(canvas.clientWidth,canvas.clientHeight,false);
  const aspect = Math.max(canvas.clientWidth,1) / Math.max(canvas.clientHeight,1);
  instance.resize(aspect);
  dirty = true;
}
async function setVersion(next, bootState) {
  const def = versionById(next);
  if (!def) return;
  const previousId = ver;
  if (instance) {
    try { instance.dispose(); } catch { /* keep switching */ }
    instance = null;
  }
  ver = def.id;
  if (bootState) {
    state = bootState;
    versionStates.set(ver, state);
  } else if (!versionStates.has(ver)) {
    state = def.defaultState();
    versionStates.set(ver, state);
  } else {
    state = versionStates.get(ver);
  }
  $('loading').hidden = false;
  try {
    const textures = await loadPlates(def.assets);
    instance = await def.create({
      textures,
      plateWindows,
      skyGroupCount: skyGroups.length,
      motionData: integratedMotion,
      aspect: Math.max(renderer.domElement.clientWidth,1) / Math.max(renderer.domElement.clientHeight,1),
      reduced: reduced.matches
    });
    applyStateToInstance();
    // Activation entrance: V5 greets on every mount (fresh load, reload,
    // version switch) unless the link pins a reveal; V1–V4 play their own
    // historical reveal only when switched to, never on a cold boot (their
    // historical behaviour had no load animation) and never under reduced
    // motion.
    const pinnedReveal = bootState ? bootPinnedReveal : false;
    if (def.id === 'v5') {
      entranceActive = !pinnedReveal;
      if (entranceActive) state.reveal = 0;
    } else {
      entranceActive = mounted && previousId !== def.id && !reduced.matches
        && typeof instance.setReveal === 'function';
    }
    mounted = true;
    if (entranceActive) {
      activationClock = 0;
      instance.setReveal?.(0);
    }
    loading = false;
    $('loading').hidden = true;
    document.querySelector('canvas').dataset.ready = 'true';
    $('fallback').hidden = true;
  } catch (error) {
    console.warn('Living Ukiyo-e: version failed to load', error);
    showFailure();
    return;
  }
  renderUI();
  resize();
}
let bootPinnedReveal = false;
// Minimal headless test handle (no UI): used by scripts/e2e.mjs for framing
// audits and entrance choreography assertions.
window.__waveLab = {
  get version() { return ver; },
  diagnostics() { return instance?.diagnostics ? instance.diagnostics() : null; },
  entrance() { return { active: entranceActive, reveal: state?.reveal ?? null }; }
};
function frame(now) {
  const dt = Math.min((now - previous) / 1000,.25);
  previous = now;
  const active = activeNow();
  const target = active ? 1 : 0;
  const tau = target > envelope ? 1.35 : 2.16;
  envelope += (target - envelope) * (1 - Math.exp(-dt / tau));
  if (Math.abs(target - envelope) < 0.001) envelope = target;
  const loopPin = state && state.loopSeek !== undefined && state.loopSeek >= 0 ? state.loopSeek : seconds % LOOP_SECONDS;
  if (active) {
    seconds += ver === 'v5' ? dt * envelope : dt;
    if (state) state.time = seconds % LOOP_SECONDS;
    const timeline = document.getElementById('timeline');
    if (timeline) {
      timeline.value = String(Math.round((seconds % LOOP_SECONDS) * 100) / 100);
      updateOutput(timeline);
    }
  }
  if (entranceActive && instance) {
    const duration = instance.entranceDuration || 1;
    activationClock = Math.min(duration, activationClock + dt);
    const progress = duration ? activationClock / duration : 1;
    if (ver === 'v5') state.reveal = progress;
    instance.setReveal?.(progress);
    dirty = true;
    if (progress >= 1) {
      entranceActive = false;
      if (ver === 'v5') { state.reveal = 1; updateURL(); }
    }
  }
  if (instance && !failed) {
    instance.update(dt, {
      dt, seconds, time: loopPin, active, playing: state.playing,
      motionOn: motionEnabled(),
      motion: state.loopSeek >= 0 ? 1 : envelope,
      loopPin, reduced: reduced.matches
    });
    if (active || dirty || entranceActive) { paint(); dirty = false; }
  }
  frameId = requestAnimationFrame(frame);
}

// ---- Share / failure ------------------------------------------------------
// The share button opens a small menu of the usual social intents. Every link
// is a plain URL (no SDK or backend), and each one carries the versioned
// fragment, so whoever opens it sees the same scene.
function shareLink() {
  const url = new URL(location.href);
  url.hash = encodeHash();
  url.search = '';
  return url.href;
}
function socialShareHref(network) {
  const link = encodeURIComponent(shareLink());
  const title = encodeURIComponent(tr('title'));
  const text = encodeURIComponent(tr('shareText'));
  switch (network) {
    case 'x': return `https://twitter.com/intent/tweet?text=${text}&url=${link}`;
    case 'weibo': return `https://service.weibo.com/share/share.php?url=${link}&title=${text}`;
    case 'facebook': return `https://www.facebook.com/sharer/sharer.php?u=${link}`;
    case 'telegram': return `https://t.me/share/url?url=${link}&text=${text}`;
    case 'email': return `mailto:?subject=${title}&body=${text}%0A%0A${link}`;
    default: return link;
  }
}
const canSystemShare = () => typeof navigator.share === 'function';
function renderShareMenu() {
  const networks = [
    ['x', 'X'], ['facebook', 'Facebook'], ['telegram', 'Telegram'],
    ['weibo', tr('weibo')], ['email', tr('email')]
  ];
  $('share-menu').innerHTML = networks.map(([network, label]) =>
    `<a role="menuitem" data-share="${network}" href="${socialShareHref(network)}" target="_blank" rel="noopener noreferrer">${label}</a>`
  ).join('')
    + `<button type="button" role="menuitem" data-share="copy">${tr('copy')}</button>`
    + (canSystemShare() ? `<button type="button" role="menuitem" data-share="system">${tr('systemShare')}</button>` : '');
}
async function copyShareLink() {
  const link = shareLink();
  $('manual-copy').hidden = true;
  try {
    await navigator.clipboard.writeText(link);
    say('shared');
  } catch {
    say(''); $('manual-copy').hidden = false; $('share-link').value = link; $('share-link').focus(); $('share-link').select();
  }
}
async function systemShare() {
  try { await navigator.share({ title: tr('title'), url: shareLink() }); say('shareDone'); }
  catch (error) { if (error.name !== 'AbortError') await copyShareLink(); }
}
function showFailure() {
  failed = true; loading = false; cancelAnimationFrame(frameId);
  document.querySelector('canvas').hidden = true;
  $('fallback').hidden = false; $('loading').hidden = true; $('failure').hidden = false;
  $('play').disabled = true;
}
$('retry').onclick = () => location.reload();

// ---- Panel visibility -----------------------------------------------------
// A single button floats on the seam. Closed, the whole panel goes away and the
// button stays alone at the right edge; clicking it again brings the panel back.
// The choice is remembered across visits.
const PANEL_STORE = 'living-ukiyoe.panel';
let panelCollapsed = false;
try { panelCollapsed = JSON.parse(localStorage.getItem(PANEL_STORE) || 'null')?.c === true; } catch { /* storage can be unavailable */ }
function applyPanel() {
  document.body.classList.toggle('panel-closed', panelCollapsed);
  const label = tr(panelCollapsed ? 'showPanel' : 'hidePanel');
  $('panel-toggle').setAttribute('aria-expanded', String(!panelCollapsed));
  $('panel-toggle').setAttribute('aria-label', label);
  $('panel-toggle').title = label;
}
function setPanelCollapsed(next) {
  panelCollapsed = next;
  applyPanel();
  try { localStorage.setItem(PANEL_STORE, JSON.stringify({ c: panelCollapsed })); } catch { /* private mode */ }
}
$('panel-toggle').onclick = () => setPanelCollapsed(!panelCollapsed);
applyPanel();

// ---- Panel chrome ---------------------------------------------------------
// One popover at a time, anchored under its icon.
const MENUS = { share: { button: 'share', panel: 'share-menu' }, language: { button: 'language', panel: 'language-menu' } };
let openMenu = null;
function closeMenus() {
  if (!openMenu) return;
  const menu = MENUS[openMenu];
  $(menu.panel).hidden = true;
  $(menu.button).setAttribute('aria-expanded', 'false');
  openMenu = null;
}
function toggleMenu(name) {
  if (openMenu === name) { closeMenus(); return; }
  closeMenus();
  if (name === 'share') renderShareMenu();
  openMenu = name;
  $(MENUS[name].panel).hidden = false;
  $(MENUS[name].button).setAttribute('aria-expanded', 'true');
}
$('share').onclick = () => toggleMenu('share');
$('language').onclick = () => toggleMenu('language');
$('share-menu').addEventListener('click', event => {
  const item = event.target.closest('[data-share]');
  if (!item) return;
  const network = item.dataset.share;
  if (network === 'copy' || network === 'system') {
    event.preventDefault();
    closeMenus();
    if (network === 'copy') copyShareLink(); else systemShare();
    return;
  }
  closeMenus(); // the anchor itself opens the intent in a new tab
});
$('language-menu').addEventListener('click', event => {
  const item = event.target.closest('[data-lang]');
  if (!item) return;
  lang = item.dataset.lang;
  try { localStorage.setItem('living-ukiyoe.language', lang); } catch { /* private mode */ }
  closeMenus();
  say(''); renderUI();
});
document.addEventListener('pointerdown', event => {
  if (!openMenu) return;
  if ($('share-menu').contains(event.target) || $('share').contains(event.target)) return;
  if ($('language-menu').contains(event.target) || $('language').contains(event.target)) return;
  closeMenus();
});
document.addEventListener('keydown', event => {
  if (event.key !== 'Escape' || !openMenu) return;
  const button = MENUS[openMenu].button;
  closeMenus();
  $(button).focus();
});
$('reset').onclick = () => {
  const def = versionById(ver);
  if (!def || !state) return;
  state = def.defaultState();
  userMotionChoice = false;
  if (ver === DEFAULT_VERSION) startEntrance(); // a fresh V5 greets with the entrance
  seconds = 0;
  changed(); renderUI();
};

// ---- Boot -----------------------------------------------------------------
const panel = $('panel');
panel.addEventListener('input', onPanelInput);
panel.addEventListener('change', onPanelInput);
renderShell(); // language shell before the first version mounts
const initial = decodeHash(location.hash);
if (!initial.valid) say('invalid');
async function mount() {
  const canvas = document.querySelector('canvas');
  renderer = new THREE.WebGLRenderer({canvas,alpha:false,antialias:false});
  renderer.setClearColor(0xb6c5c3);
  canvas.addEventListener('webglcontextlost',event=>{event.preventDefault();showFailure();});
  bootPinnedReveal = initial.pinned.has('reveal');
  await setVersion(initial.ver, initial.state);
  const observer = new ResizeObserver(resize); observer.observe(canvas);
  previous = performance.now();
  frameId = requestAnimationFrame(frame);
}
addEventListener('hashchange', () => {
  const next = decodeHash(location.hash);
  if (!next.valid) { say('invalid'); return; }
  say(next.valid ? '' : 'invalid');
  setVersion(next.ver, next.state);
});
reduced.addEventListener('change', () => { userMotionChoice = false; dirty = true; renderUI(); });
addEventListener('orientationchange',resize);
addEventListener('pagehide',event=>{
  if(event.persisted)return;
  if (instance) { try { instance.dispose(); } catch { /* page is going away */ } }
  if (renderer) renderer.dispose();
});
mount().catch(error=>{console.warn('Living Ukiyo-e: renderer unavailable',error);showFailure();});
