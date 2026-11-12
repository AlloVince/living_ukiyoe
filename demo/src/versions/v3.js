// V3 — faithful restoration of commit a2973be ("hand-drawn 2D great wave,
// playback-driven sakura motion and Motion Lab").
//
// Ported verbatim from that commit's packages/radio/src/visual/:
//   - wave-art.ts  → drawWaveArt(): the 1600×1000 Canvas-2D painting
//     (palette, Catmull-Rom three-ribbon layout, posterised colour blocks,
//     flat-brush engraving, rounded attached foam) — untouched;
//   - ukiyoe.ts    → FLAT_VERTEX / SEA_FRAGMENT (five flat 2D sea bands,
//     painter's order, renderOrder 1) and ART_FRAGMENT (the CanvasTexture
//     main wave, renderOrder 3), plus the CanvasTexture setup — untouched;
//   - shaders.ts   → ukiyoePaper() (paper field, Mt Fuji, woodblock contours,
//     grain) and the shared vignette, i.e. the ukiyo-e half of the backdrop at
//     uThemeMix=1 / uRevealSeam=0 / audio uniforms at rest (this lab has no
//     audio spectrum) — untouched except for those constant substitutions;
//   - params.ts    → the Motion Lab's readable ukiyoe knobs
//     (seaAmplitude / seaSpeed / foamAttach / lineDetail) become state fields
//     + sliders with the original defaults and clamps.
//
// The main wave is STATIC by design: a2973be kept it at the Owner's
// art-confirmation gate. The four reserved keyframe-stage params
// (waveMotion / waveSpeed / detailMotion / lineBoil) stay pending — they are
// not wired to anything and no motion is faked. uPlayMotion is the host's
// playback envelope (ctx.motion); uAirTime keeps the historical integration
// (airRate = 0.55 + 0.45·playMotion, ×0.6 under reduced motion) but only
// advances while motion > 0, per the Wave Lab contract. In the restored
// ukiyo-e scene nothing samples uAirTime (in a2973be only the sakura half of
// the backdrop did), exactly as in history.
//
// No particles, no Points, no 3D mesh, no normals, no highlights.
import * as THREE from 'three';
import { makeValidate, encodeDelta } from './schema.js';

/* --------------------------------------------------------------- state ---- */

const defaults = () => ({
  motion: true,
  playing: true,
  // Motion Lab readable knobs, defaults and clamps from a2973be params.ts.
  seaAmplitude: 1, // 0.2..2.2 — flat swell band height
  seaSpeed: 1,     // 0..2.5   — calm sea horizontal travel
  foamAttach: 1,   // 0.2..2   — rounded attached crest foam (repaints the art)
  lineDetail: 1    // 0.2..2   — engraved flow lines inside the wave (repaints)
});

const validate = makeValidate({
  defaults,
  fields: {
    motion: { type: 'bool' },
    playing: { type: 'bool' },
    seaAmplitude: { type: 'number', min: 0.2, max: 2.2, step: 0.05 },
    seaSpeed: { type: 'number', min: 0, max: 2.5, step: 0.05 },
    foamAttach: { type: 'number', min: 0.2, max: 2, step: 0.05 },
    lineDetail: { type: 'number', min: 0.2, max: 2, step: 0.05 }
  }
});

/* ------------------------------------------- wave-art.ts (verbatim port) --- */

const DESIGN_W = 1600;
const DESIGN_H = 1000;
const TAU = Math.PI * 2;

const PAL = {
  ink: '#0b1e33',
  deep: '#0c2740',
  deep2: '#123657',
  pruss: '#174574',
  mid: '#2b6592',
  pale: '#74a6c4',
  paleHi: '#b6d1de',
  foam: '#f3e9d1',
  foamShade: '#cfbc98',
};

/** Deterministic, coherent, low-frequency wobble. Shared phase => painterly,
 *  never per-stroke random jitter or high-frequency noise. */
const wob = (u, seed) =>
  Math.sin(u * 6.1 + seed * 1.7) * 0.5 +
  Math.sin(u * 2.3 + seed * 3.1) * 0.32 +
  Math.sin(u * 13.7 + seed * 0.9) * 0.18;

const rand01 = (k) => 0.5 + 0.5 * wob(k * 1.73, 3.31);

const catmull = (p0, p1, p2, p3, t) => {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2
    + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
};

/** Sample a Catmull-Rom spine + its half-widths into a dense control net. */
function buildSamples(spine, widths, n) {
  const count = spine.length;
  const points = [];
  const half = [];
  for (let i = 0; i < n; i += 1) {
    const u = (i / (n - 1)) * (count - 1);
    const seg = Math.min(count - 2, Math.floor(u));
    const t = u - seg;
    const a = spine[Math.max(0, seg - 1)];
    const b = spine[seg];
    const c = spine[seg + 1];
    const d = spine[Math.min(count - 1, seg + 2)];
    points.push({
      x: catmull(a.x, b.x, c.x, d.x, t),
      y: catmull(a.y, b.y, c.y, d.y, t),
    });
    half.push(catmull(
      widths[Math.max(0, seg - 1)], widths[seg], widths[seg + 1],
      widths[Math.min(count - 1, seg + 2)], t,
    ));
  }
  return points.map((p, i) => {
    const a = points[Math.max(0, i - 1)];
    const b = points[Math.min(n - 1, i + 1)];
    const length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const tx = (b.x - a.x) / length;
    const ty = (b.y - a.y) / length;
    return { x: p.x, y: p.y, nx: -ty, ny: tx, hw: Math.max(1, half[i]) };
  });
}

/** A point on the ribbon: t=0 is the outer/back edge, t=1 the inner/cavity. */
function at(samples, i, t, extra = 0) {
  const p = samples[i];
  const off = (t - 0.5) * 2 * p.hw + extra;
  return { x: p.x + p.nx * off, y: p.y + p.ny * off };
}

function silhouette(ctx, samples, hand = false) {
  const n = samples.length;
  ctx.beginPath();
  for (let i = 0; i < n; i += 1) {
    const w = hand ? wob(i * 0.021, 1.3) * 2.6 : 0;
    const p = at(samples, i, 0, w);
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  }
  for (let i = n - 1; i >= 0; i -= 1) {
    const w = hand ? wob(i * 0.019, 4.1) * 2.2 : 0;
    const p = at(samples, i, 1, w);
    ctx.lineTo(p.x, p.y);
  }
  ctx.closePath();
}

/** A few broad, unequal posterised blocks — the opposite of equidistant arcs. */
const RAMP = [
  [0.00, PAL.deep],
  [0.115, PAL.deep2],
  [0.235, PAL.pruss],
  [0.275, PAL.mid],
  [0.305, PAL.pruss],
  [0.470, PAL.deep2],
  [0.590, PAL.pruss],
  [0.640, PAL.pale],
  [0.675, PAL.pruss],
  [0.800, PAL.deep],
  [0.925, PAL.deep2],
  [1.000, PAL.ink],
];

function paintBlocks(ctx, samples) {
  const n = samples.length;
  for (let band = 0; band < RAMP.length - 1; band += 1) {
    const a = RAMP[band][0];
    const b = RAMP[band + 1][0];
    ctx.fillStyle = RAMP[band][1];
    ctx.beginPath();
    for (let i = 0; i < n; i += 1) {
      const drift = wob(i * 0.026, band * 0.73) * 0.016;
      const p = at(samples, i, a + drift);
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    }
    for (let i = n - 1; i >= 0; i -= 1) {
      const drift = wob(i * 0.026, band * 0.73) * 0.016;
      const p = at(samples, i, b + drift);
      ctx.lineTo(p.x, p.y);
    }
    ctx.closePath();
    ctx.fill();
  }
  // A broad shadow wedge under the curling lip gives the cavity depth.
  ctx.fillStyle = 'rgba(6, 20, 36, 0.42)';
  ctx.beginPath();
  const from = Math.floor(n * 0.42);
  for (let i = from; i < n; i += 1) {
    const p = at(samples, i, 0.78);
    if (i === from) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  }
  for (let i = n - 1; i >= from; i -= 1) {
    const p = at(samples, i, 1);
    ctx.lineTo(p.x, p.y);
  }
  ctx.closePath();
  ctx.fill();
}

/**
 * Flat-brush engraving. A stroke is a chain of short tapered quads with a
 * coherent width change and deliberate gaps. It covers only PART of the wave
 * (from..to) and drifts slightly across the flow, so the result is hand-drawn
 * line work rather than a set of equidistant full-length vector arcs.
 */
function paintBrushLine(
  ctx,
  samples,
  t,
  seed,
  width,
  opacity,
  from,
  to,
  step = 7,
  drift = 0.012,
) {
  const n = samples.length;
  const lo = Math.max(0, Math.floor(from * n));
  const hi = Math.min(n - 1, Math.ceil(to * n));
  ctx.globalAlpha = opacity;
  for (let i = lo; i < hi - step; i += step) {
    const gate = wob(i * 0.037, seed * 2.9);
    if (gate < -0.52) continue; // a deliberate break in the stroke
    const drip = (s) => t + drift * Math.sin(s * 0.011 + seed)
      + wob(s * 0.02, seed) * 0.005;
    const a = at(samples, i, drip(i));
    const b = at(samples, Math.min(n - 1, i + step), drip(i + step));
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const px = -dy / len;
    const py = dx / len;
    const wa = width * (0.35 + 0.9 * (0.5 + 0.5 * wob(i * 0.05, seed * 1.3)));
    const wb = width * (0.35 + 0.9 * (0.5 + 0.5 * wob((i + step) * 0.05, seed * 1.3)));
    ctx.beginPath();
    ctx.moveTo(a.x + px * wa, a.y + py * wa);
    ctx.lineTo(b.x + px * wb, b.y + py * wb);
    ctx.lineTo(b.x - px * wb, b.y - py * wb);
    ctx.lineTo(a.x - px * wa, a.y - py * wa);
    ctx.closePath();
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function paintInterior(ctx, samples, detail) {
  // Pale flow lines: each has its own start/end, so no full-length stripes.
  const flows = Math.round(13 * detail);
  for (let k = 0; k < flows; k += 1) {
    const t = 0.055 + (k / Math.max(1, flows - 1)) * 0.86;
    const from = 0.015 + rand01(k * 3 + 1) * 0.48;
    const to = Math.min(1, from + 0.26 + rand01(k * 5 + 11) * 0.52);
    ctx.fillStyle = k % 4 === 0 ? PAL.paleHi : PAL.pale;
    paintBrushLine(ctx, samples, t, k * 1.7 + 0.4,
      k % 4 === 0 ? 2.6 : 1.5, (k % 4 === 0 ? 0.32 : 0.22) * Math.min(1.35, detail),
      from, to, k % 2 === 0 ? 8 : 6, 0.014);
  }
  // Dark cut lines / hatching, denser in the shadowed cavity (t > 0.6).
  const cuts = Math.round(16 * detail);
  for (let k = 0; k < cuts; k += 1) {
    const t = 0.60 + (k / Math.max(1, cuts - 1)) * 0.37;
    const from = 0.30 + rand01(k * 7 + 3) * 0.42;
    ctx.fillStyle = PAL.ink;
    paintBrushLine(ctx, samples, t, k * 2.3 + 11.1, 1.8,
      0.38 * Math.min(1.35, detail), from, Math.min(1, from + 0.18 + rand01(k * 9 + 5) * 0.34), 5, 0.008);
  }
  // Short thick flat-brush accents: the "small coloured waves" idea from the
  // making-of, kept inside the Cloveread palette and well inside the body.
  const accents = Math.round(20 * detail);
  for (let k = 0; k < accents; k += 1) {
    const t = 0.12 + rand01(k * 11 + 7) * 0.72;
    const from = rand01(k * 13 + 2) * 0.82;
    ctx.fillStyle = k % 3 === 0 ? PAL.paleHi : k % 3 === 1 ? PAL.mid : PAL.ink;
    paintBrushLine(ctx, samples, t, k * 3.7 + 31.0, 2.4 + 1.8 * rand01(k * 17),
      0.26 * Math.min(1.35, detail), from, Math.min(1, from + 0.07 + rand01(k * 19) * 0.16), 4, 0.02);
  }
}

/** Rounded, attached crest foam: a chain of soft lobes, never claws, never a
 *  uniform outline, never a dot chain, never anything leaving the wave body. */
function paintFoam(ctx, samples, foamAttach) {
  const n = samples.length;
  const start = Math.floor(n * 0.46);
  const span = n - 1 - start;
  if (span <= 2) return;
  // Each lobe must be wide enough (>= ~12 samples) to stay rounded on the
  // near-vertical lip, but separated enough that the crest reads as a chain of
  // attached foam clouds rather than one uniform cream outline.
  const lobes = Array.from({ length: 9 }, (_, k) => ({
    c: 0.05 + k * 0.108,
    w: 0.038 + 0.006 * (k % 3),
    h: (20 + 18 * rand01(k * 7 + 4)) * foamAttach,
  }));
  const thickness = (i) => {
    const u = (i - start) / span;
    let value = (1.4 + 2.6 * Math.sin(Math.PI * u)) * foamAttach;
    for (const l of lobes) {
      const d = (u - l.c) / l.w;
      value += l.h * Math.exp(-d * d);
    }
    const ends = Math.min(1, u * 11) * Math.min(1, (1 - u) * 7);
    return Math.max(1.2, value * ends);
  };

  const band = (outerScale, inner, fill) => {
    ctx.beginPath();
    for (let i = start; i < n; i += 1) {
      const p = at(samples, i, 0, -thickness(i) * outerScale);
      if (i === start) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    }
    for (let i = n - 1; i >= start; i -= 1) {
      const p = at(samples, i, 0, inner);
      ctx.lineTo(p.x, p.y);
    }
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
  };
  // Shade gives the lobes a little volume; the white sits just inside it.
  band(1.0, 6, PAL.foamShade);
  band(0.86, 3, PAL.foam);

  // A soft ink edge on the foam, using the same coherent wobble.
  ctx.beginPath();
  for (let i = start; i < n; i += 1) {
    const p = at(samples, i, 0, -thickness(i) + wob(i * 0.03, 7.7) * 1.6);
    if (i === start) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  }
  ctx.strokeStyle = 'rgba(11, 30, 51, 0.28)';
  ctx.lineWidth = 1.5;
  ctx.lineJoin = 'round';
  ctx.stroke();

  // The band itself tapers to a soft rounded end; no bead, no dot chain.
}

function drawRibbon(ctx, spine, widths, opts) {
  const n = Math.max(80, Math.round(spine.length * 15));
  const samples = buildSamples(spine, widths, n);
  ctx.save();
  silhouette(ctx, samples, true);
  ctx.clip();
  silhouette(ctx, samples, false);
  ctx.fillStyle = PAL.pruss;
  ctx.fill();
  paintBlocks(ctx, samples);
  paintInterior(ctx, samples, opts.lineDetail * opts.detail);
  ctx.restore();

  // An uneven ink contour follows the whole painting.
  silhouette(ctx, samples, true);
  ctx.strokeStyle = PAL.ink;
  ctx.globalAlpha = 0.6 * opts.outline;
  ctx.lineWidth = 2.6 * opts.outline;
  ctx.lineJoin = 'round';
  ctx.stroke();
  ctx.globalAlpha = 1;

  // A thin pale rim on the back slope, before the foam begins.
  ctx.beginPath();
  for (let i = 0; i < Math.floor(n * 0.46); i += 1) {
    const p = at(samples, i, 0, 4);
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  }
  ctx.strokeStyle = 'rgba(182, 209, 222, 0.40)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  paintFoam(ctx, samples, opts.foamAttach * opts.detail);
}

/* ------------------------------------------------------------------ layout */

/** Big open curl rising from the lower left. Widths taper hard from a broad
 *  triangular foot to a thin lip, so the mass reads as a wave, not a tube. */
const MAIN_SPINE = [
  { x: -90, y: 1040 }, { x: 40, y: 890 }, { x: 175, y: 730 },
  { x: 305, y: 565 }, { x: 430, y: 415 }, { x: 555, y: 290 },
  { x: 685, y: 215 }, { x: 810, y: 198 }, { x: 905, y: 250 },
  { x: 958, y: 335 }, { x: 962, y: 420 },
];
const MAIN_WIDTHS = [400, 360, 310, 262, 218, 178, 146, 118, 88, 52, 20];

/** A low mid-ground swell to the right; same brush language, own phase. */
const MID_SPINE = [
  { x: 1000, y: 950 }, { x: 1085, y: 855 }, { x: 1175, y: 790 },
  { x: 1270, y: 775 }, { x: 1350, y: 810 }, { x: 1390, y: 870 },
];
const MID_WIDTHS = [92, 78, 62, 46, 28, 12];

/** A small foreground swell in the trough. */
const LOW_SPINE = [
  { x: 240, y: 1030 }, { x: 335, y: 970 }, { x: 435, y: 940 },
  { x: 535, y: 945 }, { x: 615, y: 985 },
];
const LOW_WIDTHS = [70, 58, 46, 30, 12];

/** Rounded foam caps resting on the flat sea bands — printed, never emitted. */
function paintSeaFoamCaps(ctx, foamAttach) {
  const caps = [
    [1160, 700, 0.9], [1420, 860, 0.7], [1510, 640, 0.5], [900, 950, 0.6],
  ];
  for (const [x, y, size] of caps) {
    const s = size * Math.min(1.5, foamAttach);
    ctx.fillStyle = PAL.foamShade;
    ctx.beginPath();
    ctx.ellipse(x, y + 2, 22 * s, 6 * s, -0.05, 0, TAU);
    ctx.fill();
    ctx.fillStyle = PAL.foam;
    ctx.beginPath();
    ctx.ellipse(x, y, 20 * s, 5.5 * s, -0.05, 0, TAU);
    ctx.fill();
    for (let k = -2; k <= 2; k += 1) {
      ctx.beginPath();
      ctx.arc(x + k * 8.5 * s, y - 2 * s, (4 + 1.8 * (2 - Math.abs(k))) * s, Math.PI, TAU);
      ctx.fill();
    }
  }
}

export function drawWaveArt(ctx, opts) {
  const { width, height, foamAttach, lineDetail } = opts;
  ctx.clearRect(0, 0, width, height);
  const aspect = width / Math.max(1, height);
  // Landscape: show the whole print. Portrait: zoom into the crest + Fuji
  // window AND lift the print, otherwise the wave sits on the sea horizon and
  // the top half of a phone screen is empty sky.
  const portrait = aspect < 1.15;
  const scale = portrait
    ? Math.max(width / DESIGN_W * 1.9, height / 1450)
    : Math.min(width / DESIGN_W, height / DESIGN_H);
  const dx = (width - DESIGN_W * scale) / 2;
  const dy = height - DESIGN_H * scale - (portrait ? height * 0.06 : 0);
  ctx.setTransform(scale, 0, 0, scale, dx, dy);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  paintSeaFoamCaps(ctx, foamAttach);
  drawRibbon(ctx, MID_SPINE, MID_WIDTHS, { foamAttach, lineDetail, detail: 0.42, outline: 0.7 });
  drawRibbon(ctx, MAIN_SPINE, MAIN_WIDTHS, { foamAttach, lineDetail, detail: 1, outline: 1 });
  drawRibbon(ctx, LOW_SPINE, LOW_WIDTHS, { foamAttach, lineDetail, detail: 0.35, outline: 0.55 });

  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

/* ------------------------------------- ukiyoe.ts shaders (verbatim port) --- */

const FLAT_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const SEA_FRAGMENT = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform float uSeaTime;
uniform float uSeaAmplitude;
uniform float uReveal;
uniform float uReduced;
const float TAU = 6.2831853;

/** Sharper crests and wider troughs than a plain sine. */
float profile(float th) {
  float s = 0.5 + 0.5 * sin(th);
  return pow(s, 1.55) * 2.0 - 1.0;
}
float bandTop(float x, float yB, float amp, float k, float sp, float ph, float t) {
  return yB - amp * profile((x * k - t * sp + ph) * TAU);
}
vec3 bandColour(float depth) {
  vec3 mid   = vec3(0.17, 0.38, 0.55);
  vec3 pruss = vec3(0.105, 0.255, 0.44);
  vec3 deep  = vec3(0.055, 0.155, 0.28);
  return mix(mix(mid, pruss, smoothstep(0.0, 0.45, depth)),
             deep, smoothstep(0.45, 1.0, depth));
}
/** Painter's order: each nearer band overwrites the lower part of the frame. */
void applyBand(inout vec3 col, inout float coverage,
               float x, float y, float yB, float amp,
               float k, float sp, float ph, float t) {
  float top = bandTop(x, yB, amp, k, sp, ph, t);
  float body = smoothstep(top + 0.0015, top - 0.0015, y);
  if (body <= 0.0) return;
  float depth = clamp((top - y) / 0.60, 0.0, 1.0);
  col = bandColour(depth);
  // Four thin woodblock lines following the SAME curve as the band edge.
  for (int j = 1; j <= 4; j++) {
    float fj = float(j);
    float ly = top - fj * amp * 0.55;
    float line = 1.0 - smoothstep(0.0, 0.0020, abs(y - ly));
    col = mix(col, vec3(0.48, 0.66, 0.76), line * mix(0.30, 0.44, mod(fj, 2.0)));
  }
  // Ink contour on the band's own edge.
  col = mix(col, vec3(0.07, 0.16, 0.26),
            (1.0 - smoothstep(0.0, 0.0020, abs(y - top))) * 0.45);
  // A soft, rounded foam cap that travels WITH the phase. It is part of the
  // print, never a particle and never detached from the swell.
  float prof = profile((x * k - t * sp + ph) * TAU);
  float crest = smoothstep(0.80, 0.97, prof);
  float capH = 0.005 + 0.009 * crest;
  float cap = 1.0 - smoothstep(0.0, capH, abs(y - (top - 0.002)));
  col = mix(col, vec3(0.95, 0.91, 0.81), crest * cap * 0.88);
  coverage = max(coverage, body);
}
void main() {
  float x = vUv.x;
  float y = vUv.y;
  float t = uSeaTime;
  float a = uSeaAmplitude * (1.0 - 0.35 * uReduced);
  vec3 col = vec3(0.0);
  float coverage = 0.0;
  applyBand(col, coverage, x, y, 0.525, 0.012 * a, 7.0, 0.22, 0.1, t);
  applyBand(col, coverage, x, y, 0.485, 0.018 * a, 5.4, 0.30, 2.1, t);
  applyBand(col, coverage, x, y, 0.400, 0.026 * a, 4.2, 0.42, 4.2, t);
  applyBand(col, coverage, x, y, 0.300, 0.032 * a, 3.2, 0.55, 0.7, t);
  applyBand(col, coverage, x, y, 0.100, 0.042 * a, 2.4, 0.70, 3.3, t);
  float alpha = coverage * uReveal;
  if (alpha < 0.01) discard;
  gl_FragColor = vec4(col, alpha);
}
`;

const ART_FRAGMENT = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D uArt;
uniform float uReveal;
uniform float uRevealSeam;
void main() {
  // Theme change folds the whole print down; the painting never deforms.
  vec2 uv = vUv;
  uv.y += (1.0 - uReveal) * 0.30;
  if (uv.y > 1.0 || uv.y < 0.0 || uv.x < 0.0 || uv.x > 1.0) discard;
  vec4 art = texture2D(uArt, uv);
  float alpha = art.a * uReveal * (1.0 - 0.35 * uRevealSeam);
  if (alpha < 0.008) discard;
  gl_FragColor = vec4(art.rgb, alpha);
}
`;

/* ---------------------------- shaders.ts, ukiyoe backdrop (verbatim port) --- */

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

// The ukiyo-e half of a2973be's BACKDROP_FRAGMENT at rest: uThemeMix = 1
// (theme seam, fold and wrinkle reduce away), uRevealSeam = 0, and the audio
// uniforms at their neutral rest values (uLuminance 0.5, uPulse 0 — this lab
// has no spectrum). ukiyoePaper() and the shared vignette are unchanged.
const BACKDROP_FRAGMENT = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform float uAspect;
uniform float uReduced;
${NOISE}

vec3 ukiyoePaper(vec2 uv) {
  vec3 paper = vec3(0.90, 0.855, 0.735);
  vec3 blue = vec3(0.085, 0.20, 0.34);
  // Sky: graduated indigo bokashi at the top, warm paper at the horizon.
  vec3 col = mix(paper, blue, smoothstep(0.18, 0.86, uv.y) * 0.82);
  col *= 0.94 + 0.10 * fbm(uv * 8.0);
  // Mt Fuji, with a snow cap and a dark ink foothill. It sits in the window
  // framed by the curling hand-drawn wave and the calm sea horizon, so the
  // snow cap stays visible and is never covered by crest foam.
  float fx = (uv.x - 0.66) * uAspect;
  float mountain = 0.36 + 0.31 * exp(-abs(fx) * 5.0) - 0.05 * abs(fx);
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
  vec3 col = ukiyoePaper(uv);
  // A restrained common vignette (uLuminance at rest => no luminance lift).
  vec2 q = (uv - 0.5) * vec2(uAspect, 1.0);
  float vignette = smoothstep(1.15, 0.28, length(q));
  col *= mix(0.78, 1.0, vignette);
  col *= 1.0 - 0.05 * uReduced;
  gl_FragColor = vec4(col, 1.0);
}
`;

/* ---------------------------------------------------------------- create --- */

export const definition = {
  id: 'v3',
  titleKey: 'versionV3',
  loopSeconds: 0,
  assets: [],
  needsMotionData: false,
  defaultState: defaults,
  validate,
  encode(state) {
    return encodeDelta(state, defaults());
  },
  controls: () => [
    { kind: 'group', label: 'Ukiyo-e motion (Motion Lab)', open: true, items: [
      { kind: 'slider', key: 'seaAmplitude', label: 'Calm sea swell 海面起伏', min: 0.2, max: 2.2, step: 0.05 },
      { kind: 'slider', key: 'seaSpeed', label: 'Calm sea flow speed 海面速度', min: 0, max: 2.5, step: 0.05 },
      { kind: 'slider', key: 'foamAttach', label: 'Attached crest foam 泡沫附着细节', min: 0.2, max: 2, step: 0.05 },
      { kind: 'slider', key: 'lineDetail', label: 'Painted line detail 内部绘画细节', min: 0.2, max: 2, step: 0.05 }
    ] },
    { kind: 'action', id: 'replay', label: 'Replay 重播' }
  ],

  async create({ aspect, reduced }) {
    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 10);
    camera.position.z = 5;
    const group = new THREE.Group();
    scene.add(group);

    // One shared fullscreen quad, one mesh per layer (backdrop 0, sea 1,
    // art 3 — the historical painter's order). No per-layer toggles: a2973be
    // had none.
    const quad = new THREE.PlaneGeometry(2, 2);

    const backdropMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uAspect: { value: aspect },
        uReduced: { value: reduced ? 1 : 0 },
      },
      vertexShader: FLAT_VERTEX,
      fragmentShader: BACKDROP_FRAGMENT,
      transparent: false,
      depthWrite: false,
      depthTest: false,
    });
    const backdrop = new THREE.Mesh(quad, backdropMaterial);
    backdrop.frustumCulled = false;
    backdrop.renderOrder = 0;
    group.add(backdrop);

    // Shared theme-change reveal: the historical stage contract drove every
    // theme's uReveal through setReveal; the host uses it for the activation
    // entrance (0→1) and leaves it at 1 afterwards.
    const reveal = { value: 1 };
    const seaUniforms = {
      uSeaTime: { value: 0 },
      uSeaAmplitude: { value: defaults().seaAmplitude },
      uReveal: reveal, // shared; the host drives it 0→1 on activation
      uReduced: { value: reduced ? 1 : 0 },
    };
    const seaMaterial = new THREE.ShaderMaterial({
      uniforms: seaUniforms,
      vertexShader: FLAT_VERTEX,
      fragmentShader: SEA_FRAGMENT,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.NormalBlending,
    });
    const sea = new THREE.Mesh(quad, seaMaterial);
    sea.frustumCulled = false;
    sea.renderOrder = 1;
    group.add(sea);

    // The painting is rasterised once per art-parameter change, not every
    // frame. It stays a single static artwork until the Owner approves it.
    const canvas = document.createElement('canvas');
    canvas.width = 1600;
    canvas.height = 1000;
    const ctx2d = canvas.getContext('2d');
    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;

    const artUniforms = {
      uArt: { value: texture },
      uReveal: reveal,             // shared; driven 0→1 on activation
      uRevealSeam: { value: 0 },   // no seam in the lab
    };
    const artMaterial = new THREE.ShaderMaterial({
      uniforms: artUniforms,
      vertexShader: FLAT_VERTEX,
      fragmentShader: ART_FRAGMENT,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.NormalBlending,
    });
    const art = new THREE.Mesh(quad, artMaterial);
    art.frustumCulled = false;
    art.renderOrder = 3;
    group.add(art);

    // The canvas is kept at the historical design resolution 1600×1000; the
    // lab host only provides an aspect (not a pixel size), and the painting is
    // sampled by a fullscreen quad, so one raster serves every viewport.
    const paint = { seaAmplitude: defaults().seaAmplitude, seaSpeed: defaults().seaSpeed,
      foamAttach: defaults().foamAttach, lineDetail: defaults().lineDetail };
    let drawnAttach = null;
    let drawnDetail = null;
    const redraw = () => {
      drawWaveArt(ctx2d, {
        width: canvas.width,
        height: canvas.height,
        foamAttach: paint.foamAttach,
        lineDetail: paint.lineDetail,
      });
      texture.needsUpdate = true;
    };
    redraw();

    let airTime = 0;
    let seaTime = 0;

    return {
      scene,
      camera,
      entranceDuration: 0.9,
      setReveal(value) {
        reveal.value = value;
      },
      resize(nextAspect) {
        backdropMaterial.uniforms.uAspect.value = nextAspect;
      },
      update(dt, ctx) {
        // ctx: { dt, seconds, time, active, motion (0..1 envelope), playing,
        // loopPin, reduced }. uPlayMotion is the host's eased playback factor;
        // the integrated clocks only advance while motion > 0.
        const motion = Number.isFinite(ctx.motion) ? ctx.motion : 0;
        seaUniforms.uReduced.value = ctx.reduced ? 1 : 0;
        backdropMaterial.uniforms.uReduced.value = ctx.reduced ? 1 : 0;
        if (motion > 0) {
          // Historical stage.ts airRate, gated on motion per the lab contract.
          const airRate = (0.55 + 0.45 * motion) * (ctx.reduced ? 0.6 : 1);
          airTime += dt * airRate;
          seaTime += dt * paint.seaSpeed * airRate;
          seaUniforms.uSeaTime.value = seaTime;
        }
      },
      applyState(state) {
        paint.seaAmplitude = state.seaAmplitude;
        paint.seaSpeed = state.seaSpeed;
        paint.foamAttach = state.foamAttach;
        paint.lineDetail = state.lineDetail;
        seaUniforms.uSeaAmplitude.value = state.seaAmplitude;
        // Art-level knobs repaint the static wave; uniform-only knobs do not
        // (historical installMotionDebug onChange behaviour).
        if (state.foamAttach !== drawnAttach || state.lineDetail !== drawnDetail) {
          drawnAttach = state.foamAttach;
          drawnDetail = state.lineDetail;
          redraw();
        }
      },
      dispose() {
        texture.dispose();
        quad.dispose();
        backdropMaterial.dispose();
        seaMaterial.dispose();
        artMaterial.dispose();
        group.clear();
        scene.clear();
      }
    };
  }
};
