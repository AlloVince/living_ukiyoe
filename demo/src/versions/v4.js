// V4 — the frozen Wave Lab exactly as it stood when Radio migrated it
// ("frozen Ukiyo-e wave lab into an autonomous theme", d1f38f6): the original
// print plates plus the experimental layers (sea wash, paper/sea background,
// far/mid/near calm waves, original flecks and marks, inscription, spray
// guide) kept as independent, individually toggleable objects. The scene is
// the existing `wave-scene.js`, untouched; its protected baseline remains
// valid. Legacy share links (no version marker) restore here.
import * as THREE from 'three';
import { createWaveScene, applyFrame, LOOP_SECONDS } from '../wave-scene.js';
import { DEFAULT, freshConfig, validate } from '../config.js';

export const definition = {
  id: 'v4',
  titleKey: 'versionV4',
  loopSeconds: LOOP_SECONDS,
  assets: 'all',
  needsMotionData: true,
  // V4's story: parts of the original print were replaced by the lab's own
  // creations. The default opens with the lab's paper/sea ground and its
  // far/mid/near wavelets; the original sky, Fuji, upper wave, boats, moving
  // spray and inscription stay independent toggles. validate() still restores
  // the frozen defaults for legacy links.
  defaultState() {
    const state = freshConfig();
    // The V4 default shown in the panel: the lab's paper/sea ground and
    // far/mid/near wavelets replace the print's sea band, the original sky,
    // Fuji, upper wave, boats, moving spray, and inscription stay hidden.
    Object.assign(state.layers, {
      sky: true, sea: true, 'source-sky': false, fuji: false,
      far: true, mid: true, near: true, hero: true, 'hero-flow': true,
      'upper-wave': false, 'lower-left': true, 'lower-center': true,
      'lower-right': true, 'spray-source': true, 'spray-motion': false,
      'boat-left': false, 'boat-near': false, 'boat-far': false,
      inscription: false,
    });
    state.clouds = [true, true, true, true, true, false];
    return state;
  },
  validate,
  encode(state) {
    // Legacy flat fragment protocol, unchanged from the frozen app.
    const delta = validate(state);
    const flat = {};
    for (const [key, value] of Object.entries(delta)) {
      if (JSON.stringify(value) !== JSON.stringify(DEFAULT[key])) flat[key] = value;
    }
    return flat;
  },
  controls: () => [
    { kind: 'select', key: 'composition', labelKey: 'composition',
      options: [['full', 'full'], ['safe', 'safe']] },
    { kind: 'group', labelKey: 'layers', open: true, items: [{ kind: 'layers' }] },
    { kind: 'group', labelKey: 'waves', open: false, items: [
      { kind: 'slider', key: 'speed', labelKey: 'speed', min: 1, max: 4, step: 1, unit: '×' },
      { kind: 'slider', key: 'push', labelKey: 'push', min: 0, max: 2, step: 0.05, unit: '×' },
      { kind: 'slider', key: 'lift', labelKey: 'lift', min: 0, max: 2, step: 0.05, unit: '×' },
      { kind: 'group', labelKey: 'phases', open: false, items:
        ['lower-left', 'lower-center', 'lower-right'].map((name) => ({
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
      { kind: 'slider', key: 'reveal', labelKey: 'reveal', min: 0, max: 1, step: 0.01 },
      { kind: 'action', id: 'replay', labelKey: 'replay' }
    ] }
  ],

  async create({ textures, plateWindows, skyGroupCount, motionData, aspect, reduced }) {
    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 10);
    camera.position.z = 5;
    const wave = createWaveScene(textures, plateWindows, skyGroupCount, motionData);
    scene.add(wave.group);
    wave.resize(Math.round(925 * aspect), 925);
    applyFrame(camera, wave.frame);
    return {
      scene,
      camera,
      loopSeconds: LOOP_SECONDS,
      // V4's historical reveal is the diagonal clipReveal wipe; the host
      // drives it 0→1 when switching to this version.
      entranceDuration: 1.1,
      setReveal(value) {
        wave.setReveal(value);
      },
      resize(aspect) {
        wave.resize(Math.round(925 * aspect), 925);
        applyFrame(camera, wave.frame);
      },
      update(dt, ctx) {
        // Historical semantics: the motion multiplier follows the Animate
        // switch only; the play button stops the clock. A paused frame still
        // shows the displaced geometry at its pinned loop second (this is
        // exactly what the protected baseline keyframes captured).
        wave.setMotion(ctx.motionOn);
        wave.update(ctx.time, dt);
      },
      applyState(state) {
        wave.setComposition(state.composition);
        wave.setReveal(state.reveal);
        for (const [name, visible] of Object.entries(state.layers)) wave.setLayer(name, visible);
        wave.setRibbonInk(state.ink);
        wave.setInkStrength(state.inkStrength, state.inkContour);
        for (const name of Object.keys(state.inkLayers)) wave.setInkLayer(name, state.inkLayers[name]);
        wave.setCloudMotion(state.cloudMotion, state.cloudStrength);
        for (let i = 0; i < 6; i += 1) {
          wave.setSkyGroup(i, state.clouds[i]);
          wave.setSkyStrength(i, state.cloudStrengths[i]);
        }
        wave.setSprayControls(state.sprayDistance, state.sprayCount, false);
        wave.setSwellControls(state);
      },
      get loop() {
        return 0;
      },
      setLoop(seconds) {
        // The clock is owned by the host (ctx.time).
      },
      dispose() {
        wave.dispose();
        scene.clear();
      }
    };
  }
};
