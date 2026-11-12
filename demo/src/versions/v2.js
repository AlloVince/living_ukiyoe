// V2 — faithful restoration of commit 7ad5464 ("rebuild theme motion language
// around a macro director"): the Radio Ukiyo-e theme of that commit, ported
// verbatim. Travelling large waves with layered small-scale noise; each crest
// goes through build -> peak -> break -> settle with a curling hook, and foam /
// spray / highlights read the SAME crest, slope and break phase. The macro
// director (slow/mid/fast time scales) runs its deterministic generator path
// because the lab has no analysable audio — exactly the historic uReactive = 0
// behaviour. The ukiyoe paper backdrop of the same commit is kept verbatim;
// uThemeMix is pinned to 1 so only its ukiyoe branch shows. Nothing is merged
// from other versions and nothing is beautified.
//
// Sources (read-only): packages/radio/src/visual/{ukiyoe,director,params,shaders,stage}.ts @ 7ad5464
// Deliberate deviations (integration only, algorithm untouched):
//   - state fields are flat and keep the exact params.ts key names;
//   - `reset()` on the director restores constructor values so the host's
//     Replay action (which rewinds `seconds` to 0) truly restarts the macro
//     timeline;
//   - the director only steps while the host reports ctx.active, matching the
//     lab's playback-gated repaint model (Radio's own frame gating lived in
//     stage.ts, which is not ported).
import * as THREE from 'three';
import { makeValidate, encodeDelta } from './schema.js';

// ---- GLSL: NOISE — verbatim from 7ad5464 shaders.ts ------------------------
const NOISE = /* glsl */ `
float hash11(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}
float hash21(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float noise2(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x),
    mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x),
    f.y
  );
}
float fbm(vec2 p) {
  float value = 0.0;
  float amplitude = 0.5;
  for (int i = 0; i < 5; i++) {
    value += amplitude * noise2(p);
    p *= 2.02;
    amplitude *= 0.5;
  }
  return value;
}
`;

// ---- GLSL: WAVE_FIELD — verbatim from 7ad5464 ukiyoe.ts --------------------
const WAVE_FIELD = /* glsl */ `
uniform float uTime;
uniform float uSwell;
uniform float uCrestPhase;
uniform float uBreak;
uniform float uDrift;
uniform float uAspect;
uniform float uWaveAmplitude;
uniform float uCrestHeight;
uniform float uWaveNumber;
uniform float uSmallWaveGain;
uniform float uBreakGain;
uniform float uHookReach;
uniform float uFoamThreshold;
uniform float uFoamWidth;
const float TAU = 6.2831853;

float waveScale() { return min(1.0, max(0.35, uAspect / 1.35)); }
/** Phase travels with the wave: a fixed phase moves towards +x over time. */
float travelPhase(float x) { return x * uWaveNumber / waveScale() - uCrestPhase; }
/** 0..1 lifetime of the crest passing through this x. */
float crestLife(float x) {
  return fract((uCrestPhase - x * uWaveNumber / waveScale()) / TAU + 0.5);
}
/** build -> peak -> break -> settle, never a hard switch. */
float breakEnvelope(float x) {
  float p = crestLife(x);
  return smoothstep(0.08, 0.44, p) * (1.0 - smoothstep(0.58, 0.92, p));
}
/** xyz = height, crest, breaking; w = analytic slope of the same surface. */
vec4 waveState(float x, float layer) {
  float phase = travelPhase(x);
  // Large waves: two travelling components with different k and speed. The
  // dominant one is kept low so the sharpened crest reads as ONE wave wall.
  float big = sin(phase) * 0.72 + sin(phase * 0.53 + 1.9) * 0.26;
  // Tall, asymmetric crest: a long back slope and a steep, curling front.
  float crest = pow(max(0.0, 0.5 + 0.5 * sin(phase + 0.35)), 6.0);
  // Small waves: different frequency AND speed, layered on the big surface.
  float small = 0.0;
  small += (noise2(vec2(x * 0.62 + uTime * 0.16, uTime * 0.21)) - 0.5) * 0.42;
  small += (noise2(vec2(x * 1.45 - uTime * 0.29, uTime * 0.37 + 5.0)) - 0.5) * 0.20;
  small += sin(x * 2.6 - uTime * 1.1 + uDrift * 3.0) * 0.055;
  // Breaking only happens near a crest and only during its break phase.
  float breaking = crest * breakEnvelope(x) * (0.30 + 0.70 * uBreak) * uBreakGain;
  float amplitude = (0.90 + 1.20 * uSwell) * mix(0.52, 1.0, layer) * uWaveAmplitude;
  float base = -1.55 + 0.14 * sin(x * 0.21 - uCrestPhase * 0.4);
  float top = base + (big * 0.82 + crest * uCrestHeight
            + small * 0.75 * uSmallWaveGain + breaking * 0.85) * amplitude;
  float slope = (0.72 * cos(phase) * 0.42
               + 0.26 * cos(phase * 0.53 + 1.9) * 0.42 * 0.53
               + crest * 1.2) * amplitude;
  return vec4(top, crest, breaking, slope);
}
`;

// ---- GLSL: wave materials — verbatim from 7ad5464 ukiyoe.ts ----------------
const WAVE_VERTEX = /* glsl */ `
precision highp float;
uniform float uReveal;
uniform float uReduced;
uniform float uLayer;
uniform float uRevealSeam;
varying vec2 vUv;
varying float vTop;
varying float vCrest;
varying float vBreak;
varying float vSlope;
varying float vDepth;
${NOISE}
${WAVE_FIELD}
void main() {
  float motion = 1.0 - 0.55 * uReduced;
  float x = position.x;
  float v = uv.y;
  vec4 state = waveState(x, uLayer);
  float top = state.x + (1.0 - uLayer) * 1.35;
  float crest = state.y;
  float breaking = state.z;
  float slope = state.w;
  // The lip curls forward and DOWN at a crest: a hook, not a round hill.
  float hook = pow(v, 6.0) * crest * (0.42 + 0.58 * uBreak);
  float y = mix(-9.0, top, v) - hook * hook * 3.0 * uHookReach;
  float z = hook * (2.6 + 1.0 * uSwell) * motion
          + 0.18 * sin(x * 0.8 + uTime * 0.5) * v;
  vec3 p = vec3(x + hook * 4.2 * waveScale() * motion * uHookReach, y, z);
  // Theme change: the whole print folds down and slides away.
  p.y -= (1.0 - uReveal) * (6.0 + 2.0 * uRevealSeam);
  p.z += (1.0 - uReveal) * 2.0;
  p.x += (1.0 - uReveal) * 3.0 * sign(uLayer - 0.5);
  vUv = uv;
  vTop = top;
  vCrest = crest;
  vBreak = breaking;
  vSlope = slope;
  vDepth = v;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`;

const WAVE_FRAGMENT = /* glsl */ `
precision highp float;
uniform float uTime;
uniform float uReveal;
uniform float uAspect;
uniform float uLayer;
uniform float uReduced;
uniform float uPulse;
uniform float uFoamThreshold;
uniform float uFoamWidth;
varying vec2 vUv;
varying float vTop;
varying float vCrest;
varying float vBreak;
varying float vSlope;
varying float vDepth;
${NOISE}
void main() {
  float depth = vDepth;
  vec3 paper = vec3(0.93, 0.88, 0.76);
  vec3 deep = mix(vec3(0.025, 0.07, 0.14), vec3(0.035, 0.12, 0.23), uLayer);
  vec3 mid = vec3(0.13, 0.33, 0.50);
  vec3 pale = vec3(0.44, 0.64, 0.72);

  // Posterised woodblock bands instead of a smooth photographic gradient.
  vec3 col = mix(deep, mid, smoothstep(0.05, 0.72, depth));
  col = mix(col, pale, smoothstep(0.72, 0.97, depth) * 0.50);
  float band = floor(depth * 5.0) / 5.0;
  col = mix(col, mix(deep, mid, band), 0.30);

  // Shading follows the SAME deformed surface: one physical sheet of water.
  float facing = clamp(0.5 + 0.42 * vSlope, 0.0, 1.0);
  col *= mix(0.82, 1.14, facing);

  // Ink contour lines follow the flow of the water and curl with the crest.
  float flow = depth * 11.0 + fbm(vec2(vUv.x * 9.0 + uTime * 0.08, depth * 3.0)) * 2.2
             + vCrest * 1.6 + vSlope * 0.7;
  float line = 1.0 - smoothstep(0.0, 0.09, abs(fract(flow) - 0.5));
  col = mix(col, vec3(0.025, 0.06, 0.11), line * 0.55);

  float hatch = sin((vUv.x * uAspect * 1.6 + depth) * 420.0 + fbm(vUv * 10.0) * 3.0);
  col *= 1.0 - 0.14 * smoothstep(0.40, 0.99, hatch) * (1.0 - smoothstep(0.30, 0.85, depth));

  // Foam is caused by the crest: position, local slope and break phase agree.
  float foamNoise = fbm(vec2(vUv.x * 26.0 + uTime * 0.35, depth * 10.0));
  float crestBand = smoothstep(uFoamThreshold, uFoamThreshold + uFoamWidth,
    depth + foamNoise * 0.025 + vCrest * 0.035);
  float slopeFoam = smoothstep(0.10, 0.55, abs(vSlope));
  float foam = crestBand * (0.55 + 0.45 * vBreak) * (0.75 + 0.25 * slopeFoam);
  col = mix(col, paper, clamp(foam, 0.0, 1.0));
  float finger = pow(max(0.0, sin(vUv.x * 54.0 + uTime * 0.65 + fbm(vec2(vUv.x * 12.0, 1.0)) * 4.0)), 7.0);
  float claw = finger * smoothstep(0.56, 0.92, depth) * smoothstep(0.2, 1.6, vTop)
             * (0.35 + 0.65 * vCrest) * (0.35 + 0.65 * vBreak);
  col = mix(col, paper, claw * 0.95);

  float ink = exp(-pow((depth - 0.86) / 0.012, 2.0)) * 0.72;
  col = mix(col, vec3(0.02, 0.05, 0.09), ink);
  float speck = step(0.94, hash21(floor(vUv * vec2(900.0, 620.0))));
  col = mix(col, vec3(1.0), speck * foam * 0.55);
  col += vec3(0.04) * uPulse * foam;
  float grain = hash21(floor(vUv * vec2(1100.0, 760.0)));
  col -= (grain - 0.5) * 0.045;
  col = mix(col * 0.80, col, uLayer);

  // Feather the mesh borders into the paper so no rectangular edge shows.
  float edge = smoothstep(0.0, 0.075, vUv.x) * (1.0 - smoothstep(0.925, 1.0, vUv.x));
  float alpha = uReveal * mix(0.76, 1.0, uLayer) * (1.0 - 0.12 * uReduced) * edge;
  if (alpha < 0.01) discard;
  gl_FragColor = vec4(col, alpha);
}
`;

const SPRAY_VERTEX = /* glsl */ `
precision highp float;
attribute float aSeed;
attribute float aPhase;
attribute float aSize;
uniform float uReveal;
uniform float uPixelRatio;
uniform float uReduced;
uniform float uLayer;
varying float vAlpha;
${NOISE}
${WAVE_FIELD}
void main() {
  float motion = 1.0 - 0.5 * uReduced;
  float life = fract(uTime * (0.30 + aSeed * 0.16) * motion + aPhase);
  float x = (aSeed - 0.5) * 26.0;
  vec4 state = waveState(x, uLayer);
  float emit = state.y * (0.42 + 0.58 * clamp(state.z * 2.2, 0.0, 1.0));
  float top = state.x + (1.0 - uLayer) * 1.35;
  vec3 p = vec3(
    x + life * (aSeed - 0.5) * 1.9 + 0.9,
    top - 0.25 + life * (2.2 + 1.9 * aSeed) * (0.55 + 0.85 * uSwell) - life * life * 3.2,
    1.2 + life * 1.2
  );
  p.y -= (1.0 - uReveal) * 6.0;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = aSize * (9.0 / max(2.0, -mv.z)) * uPixelRatio * (0.75 + 0.8 * uSwell);
  // Spray exists only where a crest is actually breaking.
  vAlpha = uReveal * emit * sin(life * 3.14159) * (0.4 + 0.6 * aSeed);
}
`;

const SPRAY_FRAGMENT = /* glsl */ `
precision highp float;
varying float vAlpha;
void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float shape = smoothstep(1.0, 0.15, length(p));
  if (shape < 0.02) discard;
  gl_FragColor = vec4(vec3(0.97, 0.96, 0.92), shape * vAlpha * 0.9);
}
`;

// ---- GLSL: backdrop — verbatim from 7ad5464 shaders.ts. uThemeMix is pinned
// to 1 in this port, which selects the pure ukiyoe paper branch everywhere
// (the travelling seam never crosses the frame). -----------------------------
const BACKDROP_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const BACKDROP_FRAGMENT = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform float uTime;
uniform float uThemeMix;
uniform float uAspect;
uniform float uRevealSeam;
uniform float uGust;
uniform float uLuminance;
uniform float uWindAngle;
uniform float uDrift;
uniform float uPulse;
uniform float uReduced;
${NOISE}

vec3 sakuraSky(vec2 uv) {
  vec3 top = vec3(0.085, 0.078, 0.165);
  vec3 mid = vec3(0.29, 0.15, 0.26);
  vec3 low = vec3(0.72, 0.38, 0.42);
  float y = uv.y;
  vec3 col = mix(low, mid, smoothstep(0.08, 0.62, y));
  col = mix(col, top, smoothstep(0.55, 1.0, y));
  // Pale moon with a soft halo, high on the right — a quiet Japanese composition.
  vec2 moon = vec2(0.76, 0.74);
  vec2 d = (uv - moon) * vec2(uAspect, 1.0);
  float r = length(d);
  // The moon and hills stay still; only their halo and the mist breathe.
  col += vec3(0.55, 0.40, 0.42) * exp(-r * 5.5) * 0.42 * (0.82 + 0.30 * uLuminance);
  col = mix(col, vec3(0.98, 0.91, 0.86), smoothstep(0.105, 0.092, r) * 0.92);
  // Distant hills, layered ink silhouettes.
  float hill1 = 0.22 + 0.045 * sin(uv.x * 5.2 + 0.6) + 0.025 * fbm(vec2(uv.x * 3.0, 1.7));
  float hill2 = 0.15 + 0.035 * sin(uv.x * 8.5 - 1.2);
  col = mix(col, vec3(0.16, 0.11, 0.19), smoothstep(hill1 + 0.004, hill1 - 0.004, uv.y) * 0.82);
  col = mix(col, vec3(0.10, 0.075, 0.14), smoothstep(hill2 + 0.004, hill2 - 0.004, uv.y) * 0.9);
  // Drifting mist bands + a very fine paper grain. The wind direction slowly
  // steers the fog; nothing here jumps frame to frame.
  float mist = fbm(vec2(uv.x * 2.4 + uTime * 0.014 + uWindAngle * 0.35 + uDrift * 0.6, uv.y * 7.0));
  col += vec3(0.12, 0.07, 0.09) * smoothstep(0.55, 0.9, mist)
       * (0.82 + 0.32 * uLuminance) * (1.0 - smoothstep(0.28, 0.55, uv.y));
  return col;
}

vec3 ukiyoePaper(vec2 uv) {
  vec3 paper = vec3(0.90, 0.855, 0.735);
  vec3 blue = vec3(0.085, 0.20, 0.34);
  // Sky: graduated indigo bokashi at the top, warm paper at the horizon.
  vec3 col = mix(paper, blue, smoothstep(0.18, 0.86, uv.y) * 0.82);
  col *= 0.94 + 0.10 * fbm(uv * 8.0);
  // Mt Fuji, with a snow cap and a dark ink foothill.
  // Fuji sits left of the great wave so its snow cap stays above the crest.
  float fx = (uv.x - 0.24) * uAspect;
  float mountain = 0.34 + 0.26 * exp(-abs(fx) * 4.2) - 0.05 * abs(fx);
  float snow = mountain - 0.06;
  float inMountain = smoothstep(mountain + 0.003, mountain - 0.003, uv.y);
  col = mix(col, vec3(0.30, 0.36, 0.44), inMountain * 0.9);
  col = mix(col, paper, smoothstep(snow + 0.002, snow - 0.002, uv.y) * inMountain * 0.92);
  // Woodblock contour lines across the sky.
  float bands = sin(uv.y * 145.0 + fbm(vec2(uv.x * 3.0, uv.y * 2.0)) * 3.0);
  col -= vec3(0.035, 0.03, 0.025) * smoothstep(0.72, 0.98, bands) * smoothstep(0.35, 0.9, uv.y);
  // Paper grain and faint ink speckles.
  float grain = hash21(floor(uv * vec2(920.0, 640.0)));
  col -= (grain - 0.5) * 0.045;
  return col;
}

void main() {
  vec2 uv = vUv;
  vec3 sakura = sakuraSky(uv);
  vec3 ukiyoe = ukiyoePaper(uv);

  // A seam travels across the frame. Noise wrinkles its edge like a page being
  // turned; the shaders' geometry and particles move at the same time.
  float wrinkle = (fbm(vec2(uv.y * 5.0, uTime * 0.12 + 3.0)) - 0.5) * 0.16;
  float seam = uThemeMix * 1.5 - 0.25 + wrinkle;
  float reveal = 1.0 - smoothstep(seam - 0.11, seam + 0.11, uv.x);
  vec3 col = mix(sakura, ukiyoe, reveal);

  // Bright fold travelling with the seam, plus a soft shadow behind it.
  float fold = exp(-pow((uv.x - seam) / 0.035, 2.0));
  float shadow = exp(-pow((uv.x - seam - 0.045) / 0.075, 2.0));
  col += vec3(0.35, 0.30, 0.26) * fold * uRevealSeam * (0.6 + 0.4 * uGust);
  col -= vec3(0.10, 0.08, 0.09) * shadow * uRevealSeam;

  // A restrained common vignette; only a macro signal breathes the corners.
  vec2 q = (uv - 0.5) * vec2(uAspect, 1.0);
  float vignette = smoothstep(1.15, 0.28, length(q));
  col *= mix(0.78, 1.0, vignette);
  col += vec3(0.022, 0.016, 0.020) * (uLuminance - 0.5) * vignette;
  col += vec3(0.03) * uPulse * (1.0 - smoothstep(0.2, 0.8, uv.y));
  col *= 1.0 - 0.05 * uReduced;
  gl_FragColor = vec4(col, 1.0);
}
`;

// ---- MotionDirector — verbatim port of 7ad5464 director.ts (plus reset()) --
const clamp01 = (value) => Math.min(1, Math.max(0, value));
const lerp = (a, b, k) => a + (b - a) * k;
const smootherstep = (t) => {
  const k = clamp01(t);
  return k * k * k * (k * (k * 6 - 15) + 10);
};
/** Exponential moving average with a time constant in seconds (frame-rate free). */
const ema = (current, target, tau, dt) =>
  current + (target - current) * (1 - Math.exp(-dt / Math.max(0.01, tau)));

/** Deterministic integer hash -> [0,1). */
const hash = (index, seed) => {
  let h = (seed ^ Math.imul(index | 0, 0x27d4eb2d)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
};
/** Smooth, reproducible 1-D value noise over continuous time. */
const valueNoise = (x, seed) => {
  const i = Math.floor(x);
  const a = hash(i, seed);
  return lerp(a, hash(i + 1, seed), smootherstep(x - i));
};
/** A slow sine blended with seeded drift; frequency is cycles per second. */
class Drift {
  constructor(seed, frequency, noiseAmount = 0.55, phase = 0) {
    this.seed = seed;
    this.frequency = frequency;
    this.noiseAmount = noiseAmount;
    this.phase = phase;
    this.initialPhase = phase;
  }
  step(dt) {
    this.phase += this.frequency * dt;
    const sine = 0.5 + 0.5 * Math.sin(this.phase * Math.PI * 2);
    return clamp01(lerp(sine, valueNoise(this.phase, this.seed), this.noiseAmount));
  }
  reset() { this.phase = this.initialPhase; }
}

/** lull -> breeze -> gust -> hold -> settle. Every segment is C1-continuous. */
const gustEnvelope = (p) => {
  const segment = (a, b) => smootherstep((p - a) / (b - a));
  if (p < 0.36) return 0.06;
  if (p < 0.58) return lerp(0.06, 0.42, segment(0.36, 0.58));
  if (p < 0.66) return lerp(0.42, 1, segment(0.58, 0.66));
  if (p < 0.74) return 1;
  return lerp(1, 0.06, segment(0.74, 1));
};

const SEED = 0x1a2b3c4d;
const DEFAULT_DIRECTOR_TUNING = { cycleSeconds: 32, windGain: 1, swellGain: 1, driftScale: 1, phaseSpeed: 1 };

class MotionDirector {
  constructor(tuning = DEFAULT_DIRECTOR_TUNING) {
    this.tuning = tuning;
    this.uniforms = {
      uWind: { value: 0.12 },
      uWindAngle: { value: -0.32 },
      uGust: { value: 0.06 },
      uSwell: { value: 0.4 },
      uCrestPhase: { value: 0 },
      uBreak: { value: 0.35 },
      uDrift: { value: 0.5 },
      uDensity: { value: 0.38 },
      uLuminance: { value: 0.5 },
      uPulse: { value: 0 },
    };
    this.driftBank = {
      drift: new Drift(SEED ^ 1, 1 / 74, 0.6, 0.12),
      windBias: new Drift(SEED ^ 2, 1 / 47, 0.6, 0.4),
      swellBias: new Drift(SEED ^ 3, 1 / 39, 0.6, 0.7),
      densityBias: new Drift(SEED ^ 4, 1 / 83, 0.65, 0.25),
      lightBias: new Drift(SEED ^ 5, 1 / 55, 0.6, 0.55),
      angleBias: new Drift(SEED ^ 6, 1 / 31, 0.7, 0.2),
      /** No-audio generator: a 1-8s energy envelope so the mid scale stays alive. */
      generator: new Drift(SEED ^ 7, 1 / 6.5, 0.45, 0.35),
    };
    this.cycle = 0.08;
    this.windAngle = -0.32;
    this.pulse = 0;
    this.audioLevel = 0;
    this.reduced = false;
  }

  setReduced(reduced) { this.reduced = reduced; }

  /**
   * Lab addition (not in 7ad5464): restore every signal to its constructor
   * value so the host's Replay action restarts the macro timeline. The update
   * algorithm itself is untouched.
   */
  reset() {
    const u = this.uniforms;
    u.uWind.value = 0.12;
    u.uWindAngle.value = -0.32;
    u.uGust.value = 0.06;
    u.uSwell.value = 0.4;
    u.uCrestPhase.value = 0;
    u.uBreak.value = 0.35;
    u.uDrift.value = 0.5;
    u.uDensity.value = 0.38;
    u.uLuminance.value = 0.5;
    u.uPulse.value = 0;
    for (const drift of Object.values(this.driftBank)) drift.reset();
    this.cycle = 0.08;
    this.windAngle = -0.32;
    this.pulse = 0;
    this.audioLevel = 0;
  }

  /**
   * Advance by `dt` seconds. `time` is only used for the deterministic initial
   * phase; all evolution is integrated so a frame drop or tab resume cannot
   * make any signal jump.
   */
  update(_time, dtRaw, input) {
    const dt = Math.min(0.2, Math.max(0, dtRaw));
    if (dt === 0) return;
    const u = this.uniforms;
    const bank = this.driftBank;

    // --- slow 20-90s drift -------------------------------------------------
    const drift = bank.drift.step(dt);
    const windBias = bank.windBias.step(dt);
    const swellBias = bank.swellBias.step(dt);
    const densityBias = bank.densityBias.step(dt);
    const lightBias = bank.lightBias.step(dt);
    const angleBias = bank.angleBias.step(dt);
    const generator = bank.generator.step(dt);

    // --- mid 1-8s: gust cycle + energy --------------------------------------
    const cycleLength = this.tuning.cycleSeconds + 10 * drift * this.tuning.driftScale;
    this.cycle = (this.cycle + dt / cycleLength) % 1;
    const gust = gustEnvelope(this.cycle);
    const audio = clamp01(input.reactive);
    this.audioLevel = audio;
    const ambientEnergy = 0.18 + 0.42 * generator;
    const energy = clamp01(lerp(ambientEnergy, input.energy, audio));

    // A transient is tiny, short-lived and never moves geometry directly.
    const generatorTransient = Math.max(0, generator - 0.72) > 0 ? 0.035 : 0;
    const transient = clamp01(lerp(generatorTransient, input.onset, audio));
    this.pulse = Math.max(this.pulse * Math.exp(-dt / 0.22), Math.min(0.12, transient * 0.12));

    // The whole field shares one direction; it turns slowly and a little
    // further during a gust, never snapping to a new angle.
    const angleTarget = -0.58 + 0.62 * angleBias + (gust - 0.5) * 0.36;
    this.windAngle = ema(this.windAngle, angleTarget, 2.4, dt);

    const motionScale = this.reduced ? 0.45 : 1;
    const windTarget = clamp01(
      (0.06 + 0.62 * gust + 0.22 * windBias + 0.14 * energy + 0.10 * drift) * motionScale * this.tuning.windGain,
    );
    const swellTarget = clamp01((0.22 + 0.34 * swellBias + 0.26 * energy + 0.16 * gust) * this.tuning.swellGain);
    const densityTarget = clamp01(0.28 + 0.52 * gust + 0.14 * densityBias + 0.10 * energy);
    const breakTarget = clamp01(0.24 + 0.44 * gust + 0.20 * energy + 0.10 * drift);
    const lightTarget = clamp01(0.20 + 0.52 * lightBias + 0.18 * energy + 0.10 * input.centroid);

    u.uWind.value = ema(u.uWind.value, windTarget, 0.7, dt);
    u.uWindAngle.value = this.windAngle;
    u.uGust.value = ema(u.uGust.value, gust, 0.8, dt);
    u.uSwell.value = ema(u.uSwell.value, swellTarget, 0.9, dt);
    u.uBreak.value = ema(u.uBreak.value, breakTarget, 1.1, dt);
    u.uDensity.value = ema(u.uDensity.value, densityTarget, 1.3, dt);
    u.uLuminance.value = ema(u.uLuminance.value, lightTarget, 2.2, dt);
    u.uDrift.value = ema(u.uDrift.value, drift * this.tuning.driftScale, 2.5, dt);
    u.uPulse.value = this.pulse;
    // Integrated phase: wave speed changes smoothly, the crest never teleports.
    u.uCrestPhase.value += dt * (1.05 + 1.15 * u.uSwell.value)
      * (this.reduced ? 0.55 : 1) * this.tuning.phaseSpeed;
  }
}

// ---- Theme construction — verbatim port of 7ad5464 ukiyoe.ts createUkiyoe --
function createUkiyoe(shared, segments, sprayCount) {
  const group = new THREE.Group();
  const reveal = { value: 0 };

  const makeWave = (layer) => {
    const geometry = new THREE.PlaneGeometry(26, 12, segments, Math.round(segments * 0.75));
    const layerUniform = { value: layer };
    const material = new THREE.ShaderMaterial({
      uniforms: { ...shared, uReveal: reveal, uLayer: layerUniform },
      vertexShader: WAVE_VERTEX,
      fragmentShader: WAVE_FRAGMENT,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.NormalBlending,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(0, 0, layer === 1 ? -1.5 : -6.5);
    mesh.renderOrder = layer === 1 ? 3 : 1;
    mesh.frustumCulled = false;
    group.add(mesh);
    return { geometry, material };
  };
  const back = makeWave(0);
  const front = makeWave(1);

  const sprayGeometry = new THREE.BufferGeometry();
  const seeds = new Float32Array(sprayCount);
  const phases = new Float32Array(sprayCount);
  const sizes = new Float32Array(sprayCount);
  const positions = new Float32Array(sprayCount * 3);
  for (let i = 0; i < sprayCount; i += 1) {
    const rand = (seed) => {
      const value = Math.sin(seed * 91.7 + 47.3) * 43758.5453;
      return value - Math.floor(value);
    };
    seeds[i] = rand(i * 5 + 1);
    phases[i] = rand(i * 5 + 2);
    sizes[i] = 4 + rand(i * 5 + 3) * 12;
  }
  sprayGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  sprayGeometry.setAttribute('aSeed', new THREE.Float32BufferAttribute(seeds, 1));
  sprayGeometry.setAttribute('aPhase', new THREE.Float32BufferAttribute(phases, 1));
  sprayGeometry.setAttribute('aSize', new THREE.Float32BufferAttribute(sizes, 1));
  sprayGeometry.boundingSphere = null;
  const sprayLayer = { value: 1 };
  const sprayMaterial = new THREE.ShaderMaterial({
    uniforms: { ...shared, uReveal: reveal, uLayer: sprayLayer },
    vertexShader: SPRAY_VERTEX,
    fragmentShader: SPRAY_FRAGMENT,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.NormalBlending,
  });
  const spray = new THREE.Points(sprayGeometry, sprayMaterial);
  spray.frustumCulled = false;
  spray.position.set(0, 0, -1.5);
  spray.renderOrder = 5;
  group.add(spray);

  return {
    group,
    setReveal: (value) => { reveal.value = value; },
    update: () => {},
    dispose: () => {
      back.geometry.dispose(); back.material.dispose();
      front.geometry.dispose(); front.material.dispose();
      sprayGeometry.dispose(); sprayMaterial.dispose();
      group.clear();
    },
  };
}

// ---- Version state: the 13 tuning knobs of 7ad5464 params.ts. Field names
// match params.ts exactly so share links stay readable; `playing`/`motion`
// belong to the host's playback contract (header button), not to the sliders.
const defaults = () => ({
  playing: true, motion: true,
  waveAmplitude: 1, crestHeight: 2.45, waveNumber: 0.42, smallWaveGain: 1,
  breakGain: 1, hookReach: 1, foamThreshold: 0.935, foamWidth: 0.06,
  cycleSeconds: 32, windGain: 1, swellGain: 1, driftScale: 1, phaseSpeed: 1
});

const validate = makeValidate({
  defaults,
  fields: {
    playing: { type: 'bool' }, motion: { type: 'bool' },
    // Ranges are the clamped MOTION_KEYS ranges of 7ad5464 params.ts.
    waveAmplitude: { type: 'number', min: 0.3, max: 2.2, step: 0.05 },
    crestHeight: { type: 'number', min: 0.4, max: 4, step: 0.05 },
    waveNumber: { type: 'number', min: 0.2, max: 0.9, step: 0.01 },
    smallWaveGain: { type: 'number', min: 0, max: 2.5, step: 0.05 },
    breakGain: { type: 'number', min: 0.2, max: 2, step: 0.05 },
    hookReach: { type: 'number', min: 0, max: 2, step: 0.05 },
    foamThreshold: { type: 'number', min: 0.75, max: 0.99, step: 0.005 },
    foamWidth: { type: 'number', min: 0.02, max: 0.2, step: 0.005 },
    cycleSeconds: { type: 'number', min: 12, max: 120, step: 1 },
    windGain: { type: 'number', min: 0.3, max: 2, step: 0.05 },
    swellGain: { type: 'number', min: 0.3, max: 2, step: 0.05 },
    driftScale: { type: 'number', min: 0.2, max: 2, step: 0.05 },
    phaseSpeed: { type: 'number', min: 0.3, max: 2.5, step: 0.05 }
  }
});

// The historic no-audio input: uReactive stays 0, so the director's energy,
// transients and brightness all come from the deterministic generator drift.
const NO_AUDIO_INPUT = { reactive: 0, energy: 0, onset: 0, centroid: 0 };

export const definition = {
  id: 'v2',
  titleKey: 'versionV2',
  // The director integrates continuously; there is no natural loop to pin.
  loopSeconds: 0,
  assets: [],
  needsMotionData: false,
  defaultState: defaults,
  validate,
  encode(state) { return encodeDelta(state, defaults()); },
  controls: () => [
    { kind: 'group', label: 'Ukiyoe waves', open: true, items: [
      { kind: 'slider', key: 'waveAmplitude', label: 'Wave amplitude', min: 0.3, max: 2.2, step: 0.05 },
      { kind: 'slider', key: 'crestHeight', label: 'Crest height', min: 0.4, max: 4, step: 0.05 },
      { kind: 'slider', key: 'waveNumber', label: 'Wave number', min: 0.2, max: 0.9, step: 0.01 },
      { kind: 'slider', key: 'smallWaveGain', label: 'Small wave gain', min: 0, max: 2.5, step: 0.05 },
      { kind: 'slider', key: 'breakGain', label: 'Break gain', min: 0.2, max: 2, step: 0.05 },
      { kind: 'slider', key: 'hookReach', label: 'Hook reach', min: 0, max: 2, step: 0.05 },
      { kind: 'slider', key: 'foamThreshold', label: 'Foam threshold', min: 0.75, max: 0.99, step: 0.005 },
      { kind: 'slider', key: 'foamWidth', label: 'Foam width', min: 0.02, max: 0.2, step: 0.005 }
    ] },
    { kind: 'group', label: 'Macro director', open: false, items: [
      { kind: 'slider', key: 'cycleSeconds', label: 'Gust cycle', min: 12, max: 120, step: 1, unit: ' s' },
      { kind: 'slider', key: 'windGain', label: 'Wind gain', min: 0.3, max: 2, step: 0.05 },
      { kind: 'slider', key: 'swellGain', label: 'Swell gain', min: 0.3, max: 2, step: 0.05 },
      { kind: 'slider', key: 'driftScale', label: 'Drift scale', min: 0.2, max: 2, step: 0.05 },
      { kind: 'slider', key: 'phaseSpeed', label: 'Phase speed', min: 0.3, max: 2.5, step: 0.05 }
    ] },
    { kind: 'action', id: 'replay', label: 'Replay' }
  ],

  async create({ aspect, reduced }) {
    const scene = new THREE.Scene();
    // Radio's Stage camera (stage.ts): perspective 52deg at (0, 1.05, 10).
    const camera = new THREE.PerspectiveCamera(52, aspect, 0.1, 120);
    camera.position.set(0, 1.05, 10);
    camera.lookAt(0, 0.2, 0);

    const tuning = { ...DEFAULT_DIRECTOR_TUNING }; // applyState() overwrites live
    const director = new MotionDirector(tuning);
    // The demo host caps the device pixel ratio at 2 (app/main.js resize()).
    const dpr = Math.min(typeof devicePixelRatio === 'number' ? devicePixelRatio : 1, 2);
    const shared = {
      ...director.uniforms,
      uTime: { value: 0 },
      // uThemeMix pinned to 1: the pure ukiyoe paper branch of the backdrop.
      uThemeMix: { value: 1 },
      uRevealSeam: { value: 0 },
      uReveal: { value: 1 }, // steady state; the theme-change fold never runs here
      uAspect: { value: aspect },
      uPixelRatio: { value: dpr },
      uReduced: { value: reduced ? 1 : 0 },
      // The 8 ukiyoe motion uniforms (createMotionUniforms @ params.ts);
      // applyState() keeps them in sync with the state.
      uWaveAmplitude: { value: 1 },
      uCrestHeight: { value: 2.45 },
      uWaveNumber: { value: 0.42 },
      uSmallWaveGain: { value: 1 },
      uBreakGain: { value: 1 },
      uHookReach: { value: 1 },
      uFoamThreshold: { value: 0.935 },
      uFoamWidth: { value: 0.06 },
    };

    // Fullscreen procedural paper (same commit's backdrop shader), drawn first
    // without depth so the waves composite over it exactly as in Radio.
    const backdropGeometry = new THREE.PlaneGeometry(2, 2);
    const backdropMaterial = new THREE.ShaderMaterial({
      uniforms: { ...shared },
      vertexShader: BACKDROP_VERTEX,
      fragmentShader: BACKDROP_FRAGMENT,
      depthTest: false,
      depthWrite: false,
    });
    const backdrop = new THREE.Mesh(backdropGeometry, backdropMaterial);
    backdrop.frustumCulled = false;
    scene.add(backdrop);

    // Non-eco segment/spray counts of stage.ts (168 / 820).
    const ukiyoe = createUkiyoe(shared, 168, 820);
    ukiyoe.setReveal(1);
    scene.add(ukiyoe.group);

    let lastSeconds = -1;
    return {
      scene,
      camera,
      // Activation entrance via the historical theme-change reveal.
      entranceDuration: 0.9,
      setReveal: (value) => ukiyoe.setReveal(value),
      resize(aspect) {
        camera.aspect = aspect;
        camera.updateProjectionMatrix();
        shared.uAspect.value = aspect;
      },
      update(dt, ctx) {
        shared.uTime.value = ctx.seconds;
        shared.uReduced.value = ctx.reduced ? 1 : 0;
        director.setReduced(!!ctx.reduced);
        // The host rewinds `seconds` for Replay/Reset: restart the macro timeline.
        if (lastSeconds >= 0 && ctx.seconds + 1e-6 < lastSeconds) director.reset();
        lastSeconds = ctx.seconds;
        // Playback-gated like every lab version: the director only advances
        // while the host reports active motion.
        if (ctx.active) director.update(ctx.seconds, dt, NO_AUDIO_INPUT);
      },
      applyState(state) {
        tuning.cycleSeconds = state.cycleSeconds;
        tuning.windGain = state.windGain;
        tuning.swellGain = state.swellGain;
        tuning.driftScale = state.driftScale;
        tuning.phaseSpeed = state.phaseSpeed;
        shared.uWaveAmplitude.value = state.waveAmplitude;
        shared.uCrestHeight.value = state.crestHeight;
        shared.uWaveNumber.value = state.waveNumber;
        shared.uSmallWaveGain.value = state.smallWaveGain;
        shared.uBreakGain.value = state.breakGain;
        shared.uHookReach.value = state.hookReach;
        shared.uFoamThreshold.value = state.foamThreshold;
        shared.uFoamWidth.value = state.foamWidth;
      },
      dispose() {
        ukiyoe.dispose();
        backdropGeometry.dispose();
        backdropMaterial.dispose();
        scene.clear();
      }
    };
  }
};
