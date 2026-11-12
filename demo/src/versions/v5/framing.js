// Viewport framing for V5. Verbatim JS port of the Radio theme's
// `framing.ts`: a true `cover` over the PIGMENT area, not the whole sheet.
// The frozen Demo's full-art and safe-trim algorithms remain available as
// A/B modes (1 / 2), matching Radio's `ukiyoe.framing` headless modes.
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const clamp01 = (value) => clamp(value, 0, 1);
const smooth = (value) => {
  const x = clamp01(value);
  return x * x * (3 - 2 * x);
};
const lerp = (a, b, t) => a + (b - a) * t;

const CREST_TOP = 80;
const CREST_BOTTOM = 720;
const CREST_LEFT = 0;
const CREST_RIGHT = 850;

const PIGMENT_LEFT = 20;
const PIGMENT_RIGHT = 1380;
const PIGMENT_TOP = 20;
const PIGMENT_BOTTOM = 940;
const PIGMENT_WIDTH = PIGMENT_RIGHT - PIGMENT_LEFT;
const PIGMENT_HEIGHT = PIGMENT_BOTTOM - PIGMENT_TOP;

function getFrame(width, height, full) {
  const aspect = Math.max(width, 1) / Math.max(height, 1);
  if (full) {
    const span = Math.max(1364, 925 * aspect);
    const viewHeight = span / aspect;
    return { x: 700 - span / 2, y: 480.5 - viewHeight / 2, width: span, height: viewHeight };
  }
  const wide = smooth((aspect - 1.08) / 0.52);
  const portrait = Math.max(585, aspect * 850);
  const span = lerp(portrait, 1360, wide);
  const viewHeight = span / aspect;
  return {
    x: Math.max(20, lerp(544 - span / 2, 20, wide)),
    y: Math.min(71, 937 - viewHeight),
    width: span,
    height: viewHeight
  };
}

export function coverFrame(aspect) {
  const a = Math.max(0.1, aspect);
  const width = Math.min(PIGMENT_WIDTH, PIGMENT_HEIGHT * a);
  const height = width / a;

  const shortfall = Math.max(0, CREST_BOTTOM - CREST_TOP - height);
  const y = clamp(
    (CREST_TOP + CREST_BOTTOM - height) / 2 - shortfall * 0.5,
    PIGMENT_TOP,
    PIGMENT_BOTTOM - height
  );

  const centred = PIGMENT_LEFT + (PIGMENT_WIDTH - width) / 2;
  const crestAnchored = clamp(
    (CREST_LEFT + CREST_RIGHT - width) / 2,
    PIGMENT_LEFT,
    PIGMENT_RIGHT - width
  );
  const wide = smooth((a - 0.62) / (1.06 - 0.62));
  const x = lerp(crestAnchored, centred, wide);
  return { x, y, width, height };
}

/** Framing mode for A/B evidence: 0 = production cover, 1 = full art, 2 = safe trim. */
export function frameFor(aspect, mode) {
  if (mode === 1) return getFrame(aspect * 925, 925, true);
  if (mode === 2) return getFrame(aspect * 925, 925, false);
  return coverFrame(aspect);
}

export const lerpFrame = (from, to, t) => ({
  x: lerp(from.x, to.x, t),
  y: lerp(from.y, to.y, t),
  width: lerp(from.width, to.width, t),
  height: lerp(from.height, to.height, t)
});
