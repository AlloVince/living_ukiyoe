// The Ukiyo-e V5 private shaders. Verbatim JS port of the Radio theme's
// `shaders.ts` (itself copied from the frozen Demo's `wave-scene.js`; debug
// reveal / sea / inscription / static-spray branches removed because those
// layers are off in the final default picture).
import { APERTURE } from './aperture.js';
import { INK_SHADER } from './ink-motion.js';
import { MASTER_HEIGHT, MASTER_WIDTH, SKY_GROUP_COUNT } from './constants.js';

export const PLANE_VERTEX = /* glsl */ `
  uniform float phase;
  uniform float motion;
  uniform float depth;
  uniform float amplitude;
  uniform vec2 plateSize;
  uniform vec2 plateCenter;
  varying vec2 artPoint;
  varying vec2 texCoord;

  #ifdef WAVE_SWELL
  uniform vec2 swellFocus;
  uniform vec2 swellHeading;
  uniform vec2 swellReach;
  uniform vec3 swellRhythm;
  uniform vec2 hullContact;

  vec2 waveDisplacement(vec2 art) {
    vec2 local = art - swellFocus;
    float angle = phase * swellRhythm.y + swellRhythm.z
      - dot(local, swellHeading) / swellRhythm.x;
    vec2 spread = local / vec2(365.0, 200.0);
    float crest = mix(0.46, 1.0, exp(-dot(spread, spread)));
    float stroke = sin(angle) + 0.18 * sin(2.0 * angle - 0.6);
    vec2 travel = vec2(
      swellReach.x * swellHeading.x * stroke,
      swellReach.y * (0.55 * swellHeading.y * stroke - 0.72 * cos(angle))
    );
    float side = smoothstep(18.0, 76.0, art.x) * (1.0 - smoothstep(1324.0, 1382.0, art.x));
    travel.y *= 1.0 - smoothstep(895.0, 943.0, art.y);
    return motion * crest * side * travel;
  }
  #endif

  void main() {
    texCoord = uv;
    vec3 point = position;
    vec2 displacement;
    artPoint = plateCenter + vec2(
      (uv.x - 0.5) * plateSize.x,
      (0.5 - uv.y) * plateSize.y
    );
    #ifdef CLOUD_MESH
      displacement = vec2(position.x, -position.y) * 450.0 + plateCenter - artPoint;
    #elif defined(WAVE_SWELL)
      #ifdef WAVE_HULL
      displacement = waveDisplacement(hullContact);
      float rise = waveDisplacement(hullContact + vec2(72.0, 0.0)).y
        - waveDisplacement(hullContact - vec2(72.0, 0.0)).y;
      float angle = clamp(rise * (0.45 / 144.0), -0.014, 0.014);
      float c = cos(angle), s = sin(angle);
      vec2 arm = artPoint - hullContact;
      displacement += mat2(c, s, -s, c) * arm - arm;
      #else
      displacement = waveDisplacement(artPoint);
      #endif
    point.xy += vec2(displacement.x, -displacement.y) / 450.0;
    #else
    float x = position.x * 450.0;
    float y = position.y * 450.0;
    float swell = phase * depth + x / 120.0 + y / 50.0;
    point.y += motion * amplitude * (sin(swell) + 0.32 * sin(phase + x / 64.0)) / 450.0;
    point.x += motion * amplitude * 1.15 * sin(swell + 1.1) / 450.0;
    displacement = vec2(point.x - position.x, position.y - point.y) * 450.0;
    #endif
    artPoint += displacement;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(point, 1.0);
  }
`;

export const PIGMENT_FRAGMENT = /* glsl */ `
  ${APERTURE}
  uniform sampler2D plate;
  uniform float opacity;
  #ifdef CROPPED_PLATE
  uniform vec4 plateWindow;
  #endif
  varying vec2 texCoord;
  #ifdef WATER_INK
  ${INK_SHADER}
  #endif

  void main() {
    #if defined(WATER_INK) || defined(SOURCE_SPRAY)
    vec2 dx = dFdx(texCoord), dy = dFdy(texCoord);
    #endif
    if (outsidePrint()) discard;
    vec2 samplePoint = texCoord;
    #ifdef CROPPED_PLATE
    samplePoint = (samplePoint - plateWindow.xy) / plateWindow.zw;
    #ifdef SOURCE_SPRAY
    dx /= plateWindow.zw;
    dy /= plateWindow.zw;
    #endif
    if (any(lessThan(samplePoint, vec2(0.0))) || any(greaterThan(samplePoint, vec2(1.0)))) discard;
    #endif
    #ifdef SOURCE_SPRAY
    vec4 pigment = textureGrad(plate, samplePoint, dx, dy);
    #else
    vec4 pigment = texture2D(plate, samplePoint);
    #endif
    if (pigment.a < 0.002) discard;
    #ifdef WATER_INK
    vec3 color = moveInk(pigment, texCoord, dx, dy);
    #else
    vec3 color = pigment.rgb / pigment.a;
    #endif
    gl_FragColor = vec4(color, pigment.a * opacity);
  }
`;

export const SOURCE_SKY_FRAGMENT = /* glsl */ `
  ${APERTURE}
  uniform sampler2D plate;
  uniform sampler2D groupIndex;
  uniform float groupVisible[${SKY_GROUP_COUNT}];
  uniform float opacity;
  varying vec2 texCoord;

  void main() {
    if (outsidePrint()) discard;
    vec4 pigment = texture2D(plate, texCoord);
    if (pigment.a < 0.002) discard;
    int index = int(texture2D(groupIndex, texCoord).r * 255.0 + 0.5);
    if (groupVisible[index] < 0.5) discard;
    gl_FragColor = vec4(pigment.rgb / pigment.a, pigment.a * opacity);
  }
`;

// The theme's own paper field: a warm aged buff sampled from the source plate
// at roughly RGB 231/207/171. Covers the entire viewport; no black bars.
// `uPaperLift` is the only audio-driven value in Radio; the Wave Lab keeps
// the uniform at 0 (no audio stream exists here).
export const PAPER_FRAGMENT = /* glsl */ `
  ${APERTURE}
  uniform float uPaperLift;

  float hash(vec2 p) {
    p = fract(p * vec2(0.1031, 0.0973));
    p += dot(p, p.yx + 33.33);
    return fract((p.x + p.y) * p.x);
  }

  float mottling(vec2 p) {
    vec2 cell = floor(p);
    vec2 f = smoothstep(vec2(0.0), vec2(1.0), fract(p));
    return mix(mix(hash(cell), hash(cell + vec2(1, 0)), f.x),
               mix(hash(cell + vec2(0, 1)), hash(cell + vec2(1, 1)), f.x), f.y);
  }

  void main() {
    vec2 p = artPoint;
    float falloff = clamp((p.y - 80.0) / 820.0, 0.0, 1.0);
    vec3 paper = mix(vec3(0.925, 0.838, 0.706), vec3(0.886, 0.792, 0.650), falloff);
    float outside = max(max(-p.x, p.x - ${MASTER_WIDTH}.0),
                        max(-p.y, p.y - ${MASTER_HEIGHT}.0));
    if (outside > 0.0) {
      paper = mix(vec3(0.838, 0.745, 0.606), paper, smoothstep(0.0, 150.0, outside));
    }
    float paperGrain = 0.017 * (hash(floor(p * 1.42)) - 0.5)
      + 0.019 * (mottling(p / 6.8) - 0.5);
    gl_FragColor = vec4(paper + paperGrain + uPaperLift, 1.0);
  }
`;
