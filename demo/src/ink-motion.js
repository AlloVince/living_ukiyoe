// Each coordinate field follows the local cut of the wave. For the lower
// curl, the tangent changes sign across the trough; the calm motifs use
// short, almost horizontal tracks. Rates are integer cycles per print loop.
export const inkFields = {
  hero:         { center: [487, 400], path: [.45, -.90, .0038, 163], rhythm: [3, 2, .3, 1.0], edge: 4.4 },
  "upper-wave": { center: [1170, 665], path: [.87, -.48, -.0011, 196], rhythm: [2, 1, 1.4, .74], edge: 2.8 },
  "lower-left": { center: [261, 868], path: [.29, -.96, .0020, 152], rhythm: [3, 1, 2.8, .91], edge: 3.8 },
  "lower-center": { center: [920, 780], path: [.98, .17, -.0017, 225], rhythm: [2, 2, 4.1, 1.0], edge: 4.2 },
  "lower-right": { center: [1150, 885], path: [-.96, .28, -.0008, 174], rhythm: [4, 1, 5.2, .89], edge: 3.2 },
  far:  { center: [1050, 571], path: [.98, -.19, 0, 71], rhythm: [2, 1, .7, .57], edge: .8 },
  mid:  { center: [940, 618], path: [.99, -.13, .0002, 92], rhythm: [3, 2, 3.4, .62], edge: 1.2 },
  near: { center: [1125, 675], path: [-.99, .12, -.0002, 114], rhythm: [4, 3, 5.9, .72], edge: 1.7 },
};

export const inkShader = /* glsl */ `
  uniform float phase;
  uniform float motion;
  uniform float inkStrength;
  uniform float inkEnabled;
  uniform float inkMode;
  uniform float inkContour;
  uniform vec2 inkCenter;
  uniform vec4 inkPath;
  uniform vec4 inkRhythm;
  uniform float inkEdge;
  #ifdef HERO_TRACKS
  uniform sampler2D lightTrack;
  uniform sampler2D darkTrack;
  #endif

  float waterInk(vec4 sampleInk) {
    vec3 rgb = 255.0 * sampleInk.rgb / max(sampleInk.a, 0.002);
    #ifdef CALM_WATER
      float ceiling = 146.0;
      float blue = smoothstep(9.0, 15.0, rgb.b - rgb.g);
    #else
      float ceiling = 91.0;
      float blue = smoothstep(10.0, 17.0, rgb.b - rgb.g);
    #endif
    return blue * smoothstep(37.0, 46.0, rgb.g)
      * (1.0 - smoothstep(ceiling - 5.0, ceiling, rgb.g))
      * smoothstep(.94, 1.0, sampleInk.a);
  }

  vec3 moveInk(vec4 pigment, vec2 uv, vec2 dx, vec2 dy) {
    vec3 original = pigment.rgb / pigment.a;
    float strength = motion * inkEnabled * inkStrength;
    float support = waterInk(pigment);
    if (strength == 0.0 || support < 0.001) return original;

    vec2 p = vec2(uv.x, 1.0 - uv.y) * vec2(1400.0, 957.0) - inkCenter;
    vec2 tangent = normalize(inkPath.xy + vec2(0.0, p.x * inkPath.z));
    vec2 normal = vec2(-tangent.y, tangent.x);
    float along = (dot(p, inkPath.xy) + .5 * inkPath.z * p.x * p.x) * 6.283185 / inkPath.w;
    float across = dot(p, normal) / 86.0;
    float edgePhase = phase * inkRhythm.y - .51 * along + inkRhythm.z;
    float edge = sin(edgePhase + across) + .32 * sin(2.0 * edgePhase - .6 * across);
    vec2 bow = (normal * edge + .21 * tangent * cos(edgePhase)) * inkEdge * strength;
    vec2 warpedUV = uv - inkContour * vec2(bow.x / 1400.0, -bow.y / 957.0);

    // Borrow the original pigment across the light/dark boundary only
    // when both coordinates still belong to blue water. The silhouette,
    // the print lines against foam, and the alpha stay on the base plate.
    vec4 shifted = textureGrad(plate, warpedUV, dx, dy);
    float displaced = support * waterInk(shifted);
    vec3 ink = mix(original, shifted.rgb / max(shifted.a, 0.002), displaced);
    #ifdef CALM_WATER
      float light = smoothstep(89.0, 111.0, ink.g * 255.0);
    #else
      float light = smoothstep(59.0, 69.0, ink.g * 255.0);
    #endif
    if (inkMode == 1.0) ink = mix(original, ink, light);
    if (inkMode == 2.0) ink = mix(original, ink, 1.0 - light);

    float travel = phase * inkRhythm.x - along + inkRhythm.z;
    float swell = .5 + .5 * cos(travel + .65 * sin(across));
    float indigo = .5 + .5 * cos(travel - 1.6 + .5 * sin(across));
    #ifdef HERO_TRACKS
      vec3 lightArc = textureGrad(lightTrack, warpedUV, dx, dy).rgb;
      vec3 darkArc = textureGrad(darkTrack, warpedUV, dx, dy).rgb;
      float a = phase * inkRhythm.x + inkRhythm.z;
      vec2 wave = vec2(cos(a), sin(a));
      swell = mix(swell, .5 + .5 * dot(lightArc.rg * 2.0 - 1.0, wave), lightArc.b);
      indigo = mix(indigo, .5 + .5 * dot(darkArc.rg * 2.0 - 1.0, wave), darkArc.b);
    #endif

    // Crossfade two travelling impressions over the pigment already on
    // the plate. Neither stroke turns on or off as a whole.
    float turn = .5 + .5 * sin(phase * inkRhythm.y - .36 * along + inkRhythm.z);
    float paleWeight = inkMode == 2.0 ? 0.0 : (inkMode == 1.0 ? 1.0 : mix(.23, .95, turn));
    float darkWeight = inkMode == 1.0 ? 0.0 : (inkMode == 2.0 ? 1.0 : mix(.95, .23, turn));
    vec3 pale = vec3(13., 24., 29.) * (smoothstep(.22, .96, swell) - .42) * light * paleWeight;
    vec3 dark = vec3(9., 18., 24.) * (smoothstep(.17, .94, indigo) - .47) * (1.0 - light) * darkWeight;
    return ink + (pale + dark) * (support * strength * inkRhythm.w / 255.0);
  }
`;
