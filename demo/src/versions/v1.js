// V1 — faithful restoration of commit 1ee33a5 ("feat(radio): ship a static-first
// immersive Japanese radio", 2026-11-07): the original Radio Ukiyo-e theme.
// Source of record (read-only, same commit):
//   packages/radio/src/visual/ukiyoe.ts   — wave meshes, spray points, shaders
//   packages/radio/src/visual/shaders.ts  — NOISE block + backdrop shaders
//   packages/radio/src/visual/stage.ts    — cameras, shared uniform block, eco sizing
//   packages/radio/src/audio/spectrum.ts  — deterministic fallback DataTexture
// Fully procedural: zero textures from the host (textures arg is ignored), the
// only texture is the 256x64 spectrum history DataTexture recreated here and
// driven by the historical generator branch (uReactive stays 0 — the wave reads
// as calm ambient drift, exactly as V1 behaved without an analysable stream).
//
// Adaptations forced by the Wave Lab host contract (single scene + single
// camera, one render call), none of which change the image:
//  - stage.ts rendered two passes (orthographic backdrop, then the theme scene
//    with a perspective camera and a clearDepth between). Here the backdrop
//    plane lives in the same scene: its vertex shader writes clip space
//    directly, so it is camera-independent, and the historical draw order is
//    kept via renderOrder (backdrop 0 < back wave 1 < front wave 3 < spray 5).
//    All theme materials already have depthWrite:false, so depth never orders
//    anything in V1.
//  - uTime was the unbounded wall clock; the host's unbounded ctx.seconds is
//    the same semantics (it merely stops while paused, per the lab's playback
//    model, instead of V1's low-fps standby drift).
//  - uPixelRatio follows the host renderer's actual device-pixel ratio
//    (min(devicePixelRatio, 2)) so gl_PointSize scales as in V1; V1's own
//    1.6/1.15 DPR caps belonged to its renderer, which the host owns here.
import {
  BufferGeometry,
  ClampToEdgeWrapping,
  DataTexture,
  DoubleSide,
  Float32BufferAttribute,
  LinearFilter,
  Mesh,
  NormalBlending,
  PerspectiveCamera,
  PlaneGeometry,
  Points,
  RedFormat,
  Scene,
  ShaderMaterial,
  UnsignedByteType,
} from 'three';

// ---- Deterministic spectrum fallback (spectrum.ts @ 1ee33a5, non-analysing branch) ----
const BANDS = 256;
const HISTORY = 64;
const lerp = (a, b, k) => a + (b - a) * k;
/** Repeatable, smooth pseudo-noise. Deterministic for a given time and seed. */
const wobble = (time, seed) =>
  0.5 + 0.5 * (
    0.55 * Math.sin(time * 0.37 + seed * 1.7)
    + 0.3 * Math.sin(time * 0.91 + seed * 4.1)
    + 0.15 * Math.sin(time * 1.93 + seed * 9.3)
  );

// ---- shaders.ts @ 1ee33a5: NOISE (verbatim) ----
export const NOISE = /* glsl */ `
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
    mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.y),
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

// ---- shaders.ts @ 1ee33a5: BACKDROP (verbatim; the ukiyoePaper side of it is
// part of the V1 picture — indigo bokashi sky, Mt Fuji, woodblock contour
// bands, paper grain). uThemeMix is pinned to 1 (settled ukiyoe) and
// uRevealSeam to 0 (no theme transition in the lab). ----
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
uniform float uBass;
uniform float uReactive;
uniform float uReduced;
uniform sampler2D uSpectrum;
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
  col += vec3(0.55, 0.40, 0.42) * exp(-r * 5.5) * 0.42;
  col = mix(col, vec3(0.98, 0.91, 0.86), smoothstep(0.105, 0.092, r) * 0.92);
  // Distant hills, layered ink silhouettes.
  float hill1 = 0.22 + 0.045 * sin(uv.x * 5.2 + 0.6) + 0.025 * fbm(vec2(uv.x * 3.0, 1.7));
  float hill2 = 0.15 + 0.035 * sin(uv.x * 8.5 - 1.2);
  col = mix(col, vec3(0.16, 0.11, 0.19), smoothstep(hill1 + 0.004, hill1 - 0.004, uv.y) * 0.82);
  col = mix(col, vec3(0.10, 0.075, 0.14), smoothstep(hill2 + 0.004, hill2 - 0.004, uv.y) * 0.9);
  // Drifting mist bands + a very fine paper grain.
  float mist = fbm(vec2(uv.x * 2.4 + uTime * 0.014, uv.y * 7.0));
  col += vec3(0.12, 0.07, 0.09) * smoothstep(0.55, 0.9, mist) * (1.0 - smoothstep(0.28, 0.55, uv.y));
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

  // A restrained common vignette; audio energy only breathes the corners.
  vec2 q = (uv - 0.5) * vec2(uAspect, 1.0);
  float vignette = smoothstep(1.15, 0.28, length(q));
  col *= mix(0.78, 1.0, vignette);
  // The newest spectrum row adds a very restrained horizon glow; the older
  // row lags behind it, so the light has a sense of time rather than a blink.
  float nowRow = texture2D(uSpectrum, vec2(uv.x, 0.02)).r;
  float pastRow = texture2D(uSpectrum, vec2(uv.x, 0.42)).r;
  col += vec3(0.035, 0.022, 0.03) * uBass * uReactive * vignette;
  col += vec3(0.05, 0.035, 0.04) * uReactive * mix(pastRow, nowRow, 0.6) * (1.0 - smoothstep(0.2, 0.8, uv.y));
  col *= 1.0 - 0.05 * uReduced;
  gl_FragColor = vec4(col, 1.0);
}
`;

// ---- ukiyoe.ts @ 1ee33a5: WAVE_FIELD (verbatim) ----
const WAVE_FIELD = /* glsl */ `
float crestCentre(float t, float layer) {
  float scale = min(1.0, max(0.35, uAspect / 1.35));
  return (1.4 + 2.4 * sin(t * 0.075 + layer * 1.3)) * scale;
}
float waveField(float x, float t, float layer, float bass, float gust, float reactive) {
  float scale = min(1.0, max(0.35, uAspect / 1.35));
  float d = (x - crestCentre(t, layer)) / (3.6 * scale);
  float bell = exp(-d * d * 1.8);
  float base = -1.35 + 0.28 * sin(x * 0.5 - t * 0.55) + 0.16 * sin(x * 1.1 + t * 0.36);
  float crest = bell * (3.6 + 1.6 * bass * reactive + 1.7 * gust) * mix(0.48, 1.0, layer);
  float claws = bell * pow(max(0.0, sin(x * 2.1 + t * 0.8)), 3.0) * 0.42;
  return base + crest + claws;
}
`;

// ---- ukiyoe.ts @ 1ee33a5: WAVE_VERTEX / WAVE_FRAGMENT (verbatim) ----
const WAVE_VERTEX = /* glsl */ `
precision highp float;
uniform float uTime;
uniform float uReveal;
uniform float uReduced;
uniform float uGust;
uniform float uBass;
uniform float uLevel;
uniform float uTreble;
uniform float uReactive;
uniform float uLayer;
uniform float uRevealSeam;
uniform float uAspect;
uniform sampler2D uSpectrum;
varying vec2 vUv;
varying float vTop;
varying float vCurl;
varying float vDepth;
${NOISE}
${WAVE_FIELD}
void main() {
  float motion = 1.0 - 0.7 * uReduced;
  float t = uTime * motion;
  float x = position.x;
  float v = uv.y;
  // The newest spectrum row gently lifts the breaking lip; a delayed row adds
  // an after-swell so the print has motion in time, not just in space.
  float nowRow = texture2D(uSpectrum, vec2(uv.x, 0.02)).r;
  float pastRow = texture2D(uSpectrum, vec2(uv.x, 0.38)).r;
  float spectral = mix(pastRow, nowRow, 0.6);
  float top = waveField(x, t, uLayer, uBass, uGust, uReactive)
            + spectral * uReactive * 0.35
            + (1.0 - uLayer) * 1.35;
  float scale = min(1.0, max(0.35, uAspect / 1.35));
  float d = (x - crestCentre(t, uLayer)) / (3.6 * scale);
  float bell = exp(-d * d * 1.8);
  float curl = pow(v, 5.0) * bell;
  float y = mix(-9.0, top, v);
  float z = curl * (2.8 + 1.2 * uBass * uReactive)
          + 0.18 * sin(x * 0.8 + t * 0.5) * v
          + uReactive * uTreble * 0.12 * sin(x * 2.0 + t * 2.0) * v;
  vec3 p = vec3(x + curl * 1.9 * (1.0 - v * 0.6), y, z);
  // Theme change: the whole print folds down and slides away, not an opacity fade.
  p.y -= (1.0 - uReveal) * (6.0 + 2.0 * uRevealSeam);
  p.z += (1.0 - uReveal) * 2.0;
  p.x += (1.0 - uReveal) * 3.0 * sign(uLayer - 0.5);
  vUv = uv;
  vTop = top;
  vCurl = curl;
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
uniform float uReactive;
uniform float uTreble;
uniform float uReduced;
uniform sampler2D uSpectrum;
varying vec2 vUv;
varying float vTop;
varying float vCurl;
varying float vDepth;
${NOISE}
void main() {
  float depth = vDepth;
  vec3 paper = vec3(0.93, 0.88, 0.76);
  vec3 deep = mix(vec3(0.035, 0.09, 0.17), vec3(0.055, 0.15, 0.27), uLayer);
  vec3 mid = vec3(0.13, 0.33, 0.50);
  vec3 pale = vec3(0.44, 0.64, 0.72);

  // Posterised woodblock bands instead of a smooth photographic gradient.
  vec3 col = mix(deep, mid, smoothstep(0.05, 0.72, depth));
  col = mix(col, pale, smoothstep(0.72, 0.97, depth) * 0.72);
  float band = floor(depth * 5.0) / 5.0;
  col = mix(col, mix(deep, mid, band), 0.30);

  // Ink contour lines follow the flow of the water and curl with the crest.
  float flow = depth * 11.0 + fbm(vec2(vUv.x * 9.0 + uTime * 0.08, depth * 3.0)) * 2.2 + vCurl * 2.0;
  float line = 1.0 - smoothstep(0.0, 0.09, abs(fract(flow) - 0.5));
  col = mix(col, vec3(0.025, 0.06, 0.11), line * 0.44);

  // Hand-cut hatching in the troughs.
  float hatch = sin((vUv.x * uAspect * 1.6 + depth) * 420.0 + fbm(vUv * 10.0) * 3.0);
  col *= 1.0 - 0.14 * smoothstep(0.40, 0.99, hatch) * (1.0 - smoothstep(0.30, 0.85, depth));

  // White foam along the breaking edge, with fingers reaching above the crest.
  float foamNoise = fbm(vec2(vUv.x * 26.0 + uTime * 0.35, depth * 10.0));
  float foam = smoothstep(0.925, 0.999, depth + foamNoise * 0.055 + vCurl * 0.045);
  col = mix(col, paper, foam);
  float finger = pow(max(0.0, sin(vUv.x * 54.0 + uTime * 0.65 + fbm(vec2(vUv.x * 12.0, 1.0)) * 4.0)), 7.0);
  float claw = finger * smoothstep(0.70, 0.95, depth) * smoothstep(0.2, 1.6, vTop);
  col = mix(col, paper, claw * 0.88);

  // The dark printed outline just under the foam is the memorable ink edge.
  float ink = exp(-pow((depth - 0.905) / 0.009, 2.0)) * 0.78;
  col = mix(col, vec3(0.02, 0.05, 0.09), ink);
  float speck = step(0.94, hash21(floor(vUv * vec2(900.0, 620.0))));
  col = mix(col, vec3(1.0), speck * foam * 0.55);

  float fine = texture2D(uSpectrum, vec2(vUv.x, 0.02)).r;
  col += vec3(0.05) * fine * uReactive * uTreble * foam * 0.5;
  float grain = hash21(floor(vUv * vec2(1100.0, 760.0)));
  col -= (grain - 0.5) * 0.045;
  col = mix(col * 0.80, col, uLayer);

  // A woodblock print must not end in a rectangular mesh edge. Feather the
  // left/right borders into the paper so the displaced surface never shows a
  // hard cut, even when the curled crest pulls geometry back into frame.
  float edge = smoothstep(0.0, 0.075, vUv.x) * (1.0 - smoothstep(0.925, 1.0, vUv.x));
  float alpha = uReveal * mix(0.76, 1.0, uLayer) * (1.0 - 0.12 * uReduced) * edge;
  if (alpha < 0.01) discard;
  gl_FragColor = vec4(col, alpha);
}
`;

// ---- ukiyoe.ts @ 1ee33a5: SPRAY_VERTEX / SPRAY_FRAGMENT (verbatim) ----
const SPRAY_VERTEX = /* glsl */ `
precision highp float;
attribute float aSeed;
attribute float aPhase;
attribute float aSize;
uniform float uTime;
uniform float uReveal;
uniform float uPixelRatio;
uniform float uReduced;
uniform float uGust;
uniform float uBass;
uniform float uReactive;
uniform float uLayer;
uniform float uTreble;
uniform float uAspect;
uniform sampler2D uSpectrum;
varying float vAlpha;
${WAVE_FIELD}
void main() {
  float motion = 1.0 - 0.65 * uReduced;
  float t = uTime * motion;
  float life = fract(uTime * (0.28 + aSeed * 0.22) * motion + aPhase);
  float centre = crestCentre(t, uLayer);
  float scale = min(1.0, max(0.35, uAspect / 1.35));
  float x = centre + (aSeed - 0.5) * 6.5 * scale;
  float top = waveField(x, t, uLayer, uBass, uGust, uReactive) + (1.0 - uLayer) * 1.35;
  float sprayEnergy = texture2D(uSpectrum, vec2(aSeed, 0.02)).r;
  float burst = 1.0 + 0.8 * uGust + 0.6 * uBass * uReactive + 0.5 * sprayEnergy * uReactive;
  vec3 p = vec3(
    x + life * (aSeed - 0.5) * 2.4 + 1.1,
    top - 0.25 + life * (2.6 + 1.8 * aSeed) * burst - life * life * 3.4,
    1.2 + life * 1.2
  );
  p.y -= (1.0 - uReveal) * 6.0;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = aSize * (9.0 / max(2.0, -mv.z)) * uPixelRatio * (0.7 + 0.55 * burst);
  vAlpha = uReveal * sin(life * 3.14159) * (0.45 + 0.55 * aSeed);
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

export const definition = {
  id: 'v1',
  titleKey: 'versionV1',
  // V1 ran on the unbounded wall clock — it had no loop timeline of its own.
  loopSeconds: 0,
  assets: [],
  needsMotionData: false,
  defaultState: () => ({ playing: true, motion: true }),
  validate: (raw) => ({
    playing: raw?.playing === false ? false : true,
    motion: raw?.motion === false ? false : true
  }),
  encode: (state) => ({
    ...(state?.playing === false ? { playing: false } : {}),
    ...(state?.motion === false ? { motion: false } : {})
  }),
  controls: () => [
    { kind: 'action', id: 'replay', label: 'Replay' }
  ],

  async create({ aspect, reduced }) {
    // Historical eco sizing (stage.ts: software GL / weak CPU / reduced motion
    // → segments 76 + spray 260, else 168 + 820). The lab exposes only the
    // reduced-motion flag, so reduced triggers the historical eco branch here.
    const eco = reduced === true;
    const segments = eco ? 76 : 168;
    const sprayCount = eco ? 260 : 820;

    const scene = new Scene();
    // stage.ts camera, verbatim parameters.
    const camera = new PerspectiveCamera(52, aspect, 0.1, 120);
    camera.position.set(0, 1.05, 10);
    camera.lookAt(0, 0.2, 0);

    // 256x64 spectrum history texture, rebuilt from spectrum.ts @ 1ee33a5
    // (constructor + the non-analysing generator branch). uReactive never
    // leaves 0, which is V1's true no-analyser behaviour.
    const spectrumData = new Uint8Array(new ArrayBuffer(BANDS * HISTORY));
    const spectrumTexture = new DataTexture(spectrumData, BANDS, HISTORY, RedFormat, UnsignedByteType);
    spectrumTexture.minFilter = LinearFilter;
    spectrumTexture.magFilter = LinearFilter;
    spectrumTexture.wrapS = ClampToEdgeWrapping;
    spectrumTexture.wrapT = ClampToEdgeWrapping;
    spectrumTexture.generateMipmaps = false;
    spectrumTexture.unpackAlignment = 1;
    spectrumTexture.needsUpdate = true;

    // Shared uniform block (types.ts + stage.ts). The same IUniform objects are
    // shared by reference across all materials, exactly as in V1 (uReveal in
    // particular must be one object behind all three materials).
    const shared = {
      uSpectrum: { value: spectrumTexture },
      uReactive: { value: 0 },
      uLevel: { value: 0 },
      uBass: { value: 0 },
      uTreble: { value: 0 },
      uAmbient: { value: 0 },
      uGust: { value: 0 },
      uTime: { value: 0 },
      // Settled ukiyoe: the sakura→ukiyoe transition of stage.ts never runs here.
      uThemeMix: { value: 1 },
      uRevealSeam: { value: 0 },
      uAspect: { value: aspect },
      uPixelRatio: { value: Math.min(window.devicePixelRatio || 1, 2) },
      uReduced: { value: eco ? 1 : 0 },
      uEco: { value: eco ? 1 : 0 },
    };
    // One shared reveal uniform; 1 = the print is fully on screen (stage.ts
    // parks it there once the theme mix settles).
    const reveal = { value: 1 };

    // Backdrop (stage.ts fullscreen pass; shaders.ts BACKDROP_*). Kept in the
    // same scene — see the header note about the two-pass adaptation.
    const backdropGeometry = new PlaneGeometry(2, 2);
    const backdropMaterial = new ShaderMaterial({
      uniforms: { ...shared },
      vertexShader: BACKDROP_VERTEX,
      fragmentShader: BACKDROP_FRAGMENT,
      depthTest: false,
      depthWrite: false,
    });
    const backdrop = new Mesh(backdropGeometry, backdropMaterial);
    backdrop.frustumCulled = false;
    backdrop.renderOrder = 0;
    scene.add(backdrop);

    const makeWave = (layer) => {
      const geometry = new PlaneGeometry(26, 12, segments, Math.round(segments * 0.75));
      const layerUniform = { value: layer };
      const material = new ShaderMaterial({
        uniforms: { ...shared, uReveal: reveal, uLayer: layerUniform },
        vertexShader: WAVE_VERTEX,
        fragmentShader: WAVE_FRAGMENT,
        transparent: true,
        depthWrite: false,
        side: DoubleSide,
        blending: NormalBlending,
      });
      const mesh = new Mesh(geometry, material);
      mesh.position.set(0, 0, layer === 1 ? -1.5 : -6.5);
      mesh.renderOrder = layer === 1 ? 3 : 1;
      mesh.frustumCulled = false;
      scene.add(mesh);
      return { geometry, material };
    };
    const back = makeWave(0);
    const front = makeWave(1);

    // Spray points with the historical deterministic PRNG.
    const sprayGeometry = new BufferGeometry();
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
    sprayGeometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
    sprayGeometry.setAttribute('aSeed', new Float32BufferAttribute(seeds, 1));
    sprayGeometry.setAttribute('aPhase', new Float32BufferAttribute(phases, 1));
    sprayGeometry.setAttribute('aSize', new Float32BufferAttribute(sizes, 1));
    sprayGeometry.boundingSphere = null;
    const sprayLayer = { value: 1 };
    const sprayMaterial = new ShaderMaterial({
      uniforms: { ...shared, uReveal: reveal, uLayer: sprayLayer },
      vertexShader: SPRAY_VERTEX,
      fragmentShader: SPRAY_FRAGMENT,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: NormalBlending,
    });
    const spray = new Points(sprayGeometry, sprayMaterial);
    spray.frustumCulled = false;
    spray.position.set(0, 0, -1.5);
    spray.renderOrder = 5;
    scene.add(spray);

    // spectrum.ts @ 1ee33a5 update(), non-analysing branch only: the texture
    // is never fed audio, uReactive decays to 0 and stays there; uGust and
    // uAmbient keep their audio-independent ambient motion.
    const updateSpectrum = (time, playing) => {
      const base = playing ? 0.075 : 0.045;
      for (let band = 0; band < BANDS; band += 1) {
        const swell = 0.5 + 0.5 * Math.sin(time * 0.55 + band * 0.045);
        const drift = wobble(time + band * 0.013, band * 0.017);
        const value = base * (0.55 + 0.45 * swell) * (0.7 + 0.3 * drift);
        spectrumData[band] = Math.round(lerp(spectrumData[band], 255 * value, 0.08));
      }
      // Scroll the newest row into the history texture (row 0 = now, row 63 = oldest).
      spectrumData.copyWithin(BANDS, 0, BANDS * (HISTORY - 1));
      spectrumTexture.needsUpdate = true;

      const u = shared;
      u.uReactive.value = lerp(u.uReactive.value, 0, 0.035);
      u.uLevel.value = lerp(u.uLevel.value, 0, 0.08);
      u.uBass.value = lerp(u.uBass.value, 0, 0.09);
      u.uTreble.value = lerp(u.uTreble.value, 0, 0.09);
      const breathing = 0.5 + 0.5 * Math.sin(time * 0.24) * Math.sin(time * 0.11 + 1.3);
      u.uAmbient.value = wobble(time, 1.7) * 0.6 + breathing * 0.4;
      const gustPhase = (time * 0.045) % 1;
      const gustEnvelope = Math.exp(-Math.pow((gustPhase - 0.62) / 0.12, 2));
      u.uGust.value = gustEnvelope * (0.55 + 0.45 * wobble(time, 5.1));
    };

    return {
      scene,
      camera,
      // Activation entrance: the theme-change reveal the first Radio drove
      // through setReveal; the meshes rise in and the spray fades with it.
      entranceDuration: 0.9,
      setReveal(value) {
        reveal.value = value;
      },
      resize(nextAspect) {
        camera.aspect = nextAspect;
        camera.updateProjectionMatrix();
        shared.uAspect.value = nextAspect;
        shared.uPixelRatio.value = Math.min(window.devicePixelRatio || 1, 2);
      },
      update(_dt, ctx) {
        // V1's uTime was the unbounded wall clock; ctx.seconds is the same
        // semantics (bounded only by the host's pause behaviour).
        const time = ctx.seconds;
        shared.uTime.value = time;
        updateSpectrum(time, ctx.playing === true);
      },
      // V1 had no user-adjustable per-version parameters; playback is host-owned.
      applyState() {},
      dispose() {
        spectrumTexture.dispose();
        backdropGeometry.dispose();
        backdropMaterial.dispose();
        back.geometry.dispose();
        back.material.dispose();
        front.geometry.dispose();
        front.material.dispose();
        sprayGeometry.dispose();
        sprayMaterial.dispose();
        scene.clear();
      }
    };
  }
};
