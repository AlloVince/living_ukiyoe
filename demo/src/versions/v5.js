// V5 — the final artwork. Default layer closure of the frozen Demo plus the
// Radio production revisions: complete-print framing (Radio's cover stays
// available as a composition), warm paper field, playback-gated 28 s loop and
// the part-by-part entrance with the paper opening. The print's own flecks
// ("original flecks") are carried over from the Demo and start switched off.
// Implementation lives in ./v5/ (verbatim port of the Radio theme).
import { createV5Scene } from './v5/scene.js';
import { LOOP_SECONDS } from './v5/constants.js';
import { makeValidate, encodeDelta } from './schema.js';

export const V5_LAYERS = ['source-sky', 'fuji', 'inscription', 'hero', 'hero-flow', 'upper-wave', 'lower-left',
  'lower-center', 'lower-right', 'boat-left', 'boat-near', 'boat-far', 'spray-source', 'spray-motion'];
const LAYERS_OFF_BY_DEFAULT = new Set(['spray-source']);
export const V5_INK_LAYERS = ['hero', 'upper-wave', 'lower-left', 'lower-center', 'lower-right'];
export const V5_PHASES = ['lower-left', 'lower-center', 'lower-right'];
export const CLOUD_DEFAULTS = [0.3, 1.5, 1.1, 0.7, 0.1, 0.1];

/** Entrance duration matches Radio's Stage: 1.5 s, 0.45 s under reduced motion. */
export const ENTRANCE_SECONDS = 1.5;
export const ENTRANCE_SECONDS_REDUCED = 0.45;

const layerState = () => Object.fromEntries(V5_LAYERS.map((name) => [name, !LAYERS_OFF_BY_DEFAULT.has(name)]));
const inkLayerState = () => Object.fromEntries(V5_INK_LAYERS.map((name) => [name, true]));
const phaseState = () => Object.fromEntries(V5_PHASES.map((name) => [name, 0]));

const defaults = () => ({
  motion: true, playing: true, time: 0,
  reveal: 0, // 0 -> the entrance runs on load; shared links may pin 0..1
  layers: layerState(),
  ink: 'alternate', inkStrength: 1, inkContour: true,
  inkLayers: inkLayerState(),
  cloudMotion: true, cloudStrength: 1,
  clouds: [true, true, true, true, true, true],
  cloudStrengths: [...CLOUD_DEFAULTS],
  sprayDistance: 50, sprayCount: 100,
  speed: 3, push: 1, lift: 0.3,
  phases: phaseState(),
  composition: 'full',
  loopSeek: -1 // headless A/B only: pin one second of the 28 s loop
});

const validate = makeValidate({
  defaults,
  fields: {
    motion: { type: 'bool' }, playing: { type: 'bool' },
    time: { type: 'number', min: 0, max: 28, step: 0.01 },
    reveal: { type: 'number', min: 0, max: 1, step: 0.01 },
    ink: { type: 'enum', values: ['alternate', 'light', 'dark'] },
    inkStrength: { type: 'number', min: 0, max: 1.5, step: 0.05 },
    inkContour: { type: 'bool' },
    inkLayers: { type: 'flags' },
    cloudMotion: { type: 'bool' },
    cloudStrength: { type: 'number', min: 0, max: 1.5, step: 0.05 },
    clouds: { type: 'array', bool: true },
    cloudStrengths: { type: 'array', min: 0, max: 1.5, step: 0.05 },
    sprayDistance: { type: 'number', min: 0, max: 120, step: 1 },
    sprayCount: { type: 'number', min: 1, max: 150, step: 1 },
    speed: { type: 'number', min: 1, max: 4, step: 1 },
    push: { type: 'number', min: 0, max: 2, step: 0.05 },
    lift: { type: 'number', min: 0, max: 2, step: 0.05 },
    phases: { type: 'numbers', min: -180, max: 180, step: 5 },
    composition: { type: 'enum', values: ['cover', 'full', 'safe'] },
    loopSeek: { type: 'number', min: -1, max: 28, step: 0.01 }
  }
});

export const definition = {
  id: 'v5',
  titleKey: 'versionV5',
  loopSeconds: LOOP_SECONDS,
  assets: [
    'source-sky', 'source-sky-index', 'fuji', 'inscription', 'hero', 'upper-wave',
    'lower-left', 'lower-center', 'lower-right',
    'boat-left', 'boat-near', 'boat-far',
    'join-hero-left', 'join-hero-center', 'join-upper-center', 'join-upper-right',
    'join-center-left', 'join-center-right', 'join-left-right',
    'hero-boat-foam', 'hero-ribbons', 'hero-ribbons-dark', 'spray-motion-atlas',
    'sky-spray', 'hero-marks', 'upper-marks', 'lower-center-marks', 'lower-left-marks'
  ],
  needsMotionData: true,
  defaultState: defaults,
  validate,
  encode(state) {
    // A completed entrance (reveal 1) is the steady state, not a user edit:
    // links stay clean and the greeting entrance still plays on open.
    const normalized = state.reveal >= 1 ? { ...state, reveal: defaults().reveal } : state;
    return encodeDelta(normalized, defaults());
  },
  controls: () => [
    { kind: 'select', key: 'composition', labelKey: 'composition',
      options: [['full', 'full'], ['cover', 'cover'], ['safe', 'safe']] },
    { kind: 'group', labelKey: 'layers', open: true, items: [
      { kind: 'layers' }
    ] },
    { kind: 'group', labelKey: 'waves', open: false, items: [
      { kind: 'slider', key: 'speed', labelKey: 'speed', min: 1, max: 4, step: 1, unit: '×' },
      { kind: 'slider', key: 'push', labelKey: 'push', min: 0, max: 2, step: 0.05, unit: '×' },
      { kind: 'slider', key: 'lift', labelKey: 'lift', min: 0, max: 2, step: 0.05, unit: '×' },
      { kind: 'group', labelKey: 'phases', open: false, items: V5_PHASES.map((name) => ({
        kind: 'slider', key: `phases.${name}`, labelKey: name, min: -180, max: 180, step: 5, unit: '°'
      })) }
    ] },
    { kind: 'group', labelKey: 'inkControls', open: false, items: [
      { kind: 'select', key: 'ink', labelKey: 'ink',
        options: [['alternate', 'alternate'], ['light', 'light'], ['dark', 'dark']] },
      { kind: 'slider', key: 'inkStrength', labelKey: 'strength', min: 0, max: 1.5, step: 0.05 },
      { kind: 'check', key: 'inkContour', labelKey: 'contour' },
      { kind: 'group', labelKey: 'inkLayers', open: false, items: [{ kind: 'inkLayers' }] }
    ] },
    { kind: 'group', labelKey: 'clouds', open: false, items: [
      { kind: 'check', key: 'cloudMotion', labelKey: 'cloudMotion' },
      { kind: 'slider', key: 'cloudStrength', labelKey: 'strength', min: 0, max: 1.5, step: 0.05 },
      { kind: 'clouds' }
    ] },
    { kind: 'group', labelKey: 'spray', open: false, items: [
      { kind: 'slider', key: 'sprayDistance', labelKey: 'distance', min: 0, max: 120, step: 1 },
      { kind: 'slider', key: 'sprayCount', labelKey: 'count', min: 1, max: 150, step: 1 }
    ] },
    { kind: 'group', labelKey: 'timeline', open: false, items: [
      { kind: 'slider', key: 'time', labelKey: 'timeline', min: 0, max: 28, step: 0.01, unit: ' s', live: 'time' },
      { kind: 'slider', key: 'reveal', labelKey: 'reveal', min: 0, max: 1, step: 0.01, live: 'reveal' },
      { kind: 'action', id: 'replay', labelKey: 'replay' }
    ] }
  ],

  async create({ textures, motionData, aspect, reduced }) {
    const scene = createV5Scene(textures, motionData, { reduced, aspect });
    return {
      ...scene,
      entranceDuration: reduced ? ENTRANCE_SECONDS_REDUCED : ENTRANCE_SECONDS,
      // Headless A/B: the live camera window in print units (framing audit).
      diagnostics() {
        const c = scene.camera;
        return {
          frameX: Math.round(c.left * 450 + 700),
          frameY: Math.round(480 - c.top * 450),
          frameWidth: Math.round((c.right - c.left) * 450),
          frameHeight: Math.round((c.top - c.bottom) * 450),
          partsVisible: scene.visibleParts
        };
      },
      applyState(state) {
        scene.setFramingMode({ cover: 0, full: 1, safe: 2 }[state.composition] ?? 0);
        for (const [name, visible] of Object.entries(state.layers)) scene.setLayer(name, visible);
        scene.setRibbonInk(state.ink);
        scene.setInkStrength(state.inkStrength, state.inkContour);
        for (const [name, enabled] of Object.entries(state.inkLayers)) scene.setInkLayer(name, enabled);
        scene.setCloudMotion(state.cloudMotion, state.cloudStrength);
        for (let i = 0; i < 6; i += 1) {
          scene.setSkyGroup(i, state.clouds[i]);
          scene.setSkyStrength(i, state.cloudStrengths[i]);
        }
        scene.setSprayControls(state.sprayDistance, state.sprayCount);
        scene.setSwellControls(state);
        scene.setLoop(state.time);
        scene.setReveal(state.reveal);
      }
    };
  }
};
