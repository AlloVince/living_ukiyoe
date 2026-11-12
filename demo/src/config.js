// Public fragment protocol v1. Values are validated before they reach the renderer.
export const layerDefaults = {
  sky:true, sea:false, 'source-sky':true, fuji:true, far:false, mid:false, near:false,
  hero:true, 'hero-flow':true, 'upper-wave':true, 'lower-left':true, 'lower-center':true,
  'lower-right':true, 'spray-source':false, 'spray-motion':true,
  'boat-left':true, 'boat-near':true, 'boat-far':true, inscription:false
};
export const inkLayerNames = ['hero','upper-wave','lower-left','lower-center','lower-right','far','mid','near'];
export const phaseNames = ['lower-left','lower-center','lower-right'];
export const cloudDefaults = [.3,1.5,1.1,.7,.1,.1];
export const DEFAULT = {
  composition:'full', motion:true, playing:true, time:0, reveal:1,
  layers:layerDefaults, ink:'alternate', inkStrength:1, inkContour:true,
  inkLayers:Object.fromEntries(inkLayerNames.map(x=>[x,true])),
  cloudMotion:true, cloudStrength:1, clouds:[true,true,true,true,true,true], cloudStrengths:cloudDefaults,
  sprayDistance:50, sprayCount:100, speed:1, push:1, lift:1,
  phases:Object.fromEntries(phaseNames.map(x=>[x,0]))
};
export const freshConfig = () => structuredClone(DEFAULT);
const isObject = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const bool = (x,d) => typeof x === 'boolean' ? x : d;
const number = (x,d,min,max,step) => typeof x === 'number' && Number.isFinite(x) && x >= min && x <= max && Math.abs((x-min)/step - Math.round((x-min)/step)) < 1e-6 ? x : d;
const enumeration = (x,d,values) => values.includes(x) ? x : d;
export function validate(input) {
  const d = freshConfig();
  if (!isObject(input)) return d;
  for (const k of ['motion','playing','inkContour','cloudMotion']) d[k] = bool(input[k],d[k]);
  d.composition = enumeration(input.composition,d.composition,['full','safe']);
  d.ink = enumeration(input.ink,d.ink,['alternate','light','dark']);
  for (const [k,min,max,step] of [
    ['time',0,28,.01],['reveal',0,1,.01],['inkStrength',0,1.5,.05],['cloudStrength',0,1.5,.05],
    ['sprayDistance',0,120,1],['sprayCount',1,150,1],['speed',1,4,1],['push',0,2,.05],['lift',0,2,.05]
  ]) d[k] = number(input[k],d[k],min,max,step);
  for (const k of ['layers','inkLayers']) {
    if (isObject(input[k])) for (const name of Object.keys(d[k])) d[k][name] = bool(input[k][name],d[k][name]);
  }
  if (isObject(input.phases)) for (const k of phaseNames) d.phases[k] = number(input.phases[k],0,-180,180,5);
  for (let i=0;i<6;i++) {
    d.clouds[i] = bool(input.clouds?.[i],true);
    d.cloudStrengths[i] = number(input.cloudStrengths?.[i],cloudDefaults[i],0,1.5,.05);
  }
  return d;
}
function diff(value, defaults) {
  if (isObject(value)) return Object.fromEntries(Object.keys(defaults).flatMap(k => {
    const v = diff(value[k],defaults[k]); return v === undefined ? [] : [[k,v]];
  }));
  return JSON.stringify(value) === JSON.stringify(defaults) ? undefined : value;
}
export function encode(config) {
  const delta = diff(validate(config), DEFAULT);
  for (const key of Object.keys(delta)) if (isObject(delta[key]) && !Object.keys(delta[key]).length) delete delta[key];
  if (!Object.keys(delta).length) return '';
  // URI-encoded JSON is readable, Unicode-safe and does not require compression libraries.
  return '#u=' + encodeURIComponent(JSON.stringify({v:1,...delta}));
}
export function decode(hash) {
  if (!hash) return {config:freshConfig(),valid:true};
  if (!hash.startsWith('#u=') || hash.length > 12000) return {config:freshConfig(),valid:false};
  try {
    const value = JSON.parse(decodeURIComponent(hash.slice(3)));
    if (!isObject(value) || value.v !== 1) throw Error('version');
    return {config:validate(value),valid:true};
  } catch { return {config:freshConfig(),valid:false}; }
}
export function selectLanguage(saved, languages=[]) {
  if (['en','zh','ja'].includes(saved)) return saved;
  for (const item of languages) { const lang = item.toLowerCase().split('-')[0]; if (['en','zh','ja'].includes(lang)) return lang; }
  return 'en';
}
