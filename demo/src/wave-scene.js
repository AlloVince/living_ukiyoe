import * as THREE from "three";
import { createCloudMotion } from "./cloud-motion.js";
import { inkFields, inkShader } from "./ink-motion.js";
import { createSprayLayer, defaultSprayDistance, defaultSprayLimit, sprayOverlayShader } from "./spray-motion.js";

export const LOOP_SECONDS = 28;

const MASTER_WIDTH = 1400;
const MASTER_HEIGHT = 957;
const UNIT = 450;
const ORIGIN_X = 700;
const ORIGIN_Y = 480;
const tau = 2 * Math.PI;

const planeVertex = /* glsl */ `
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
      // The contact follows the carrier. The hull rotates as one rigid
      // object, using a fraction of the local water slope for pitch.
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

// The same aperture is applied to every layer. Revealed pigments keep their
// opacity, including where translucent edges overlap the sea underneath.
const aperture = /* glsl */ `
  uniform float reveal;
  uniform vec2 frameX;
  uniform bool fullArt;
  varying vec2 artPoint;

  bool outsidePrint() {
    return fullArt && (artPoint.x < 18.0 || artPoint.x > 1382.0
      || artPoint.y < 18.0 || artPoint.y > 943.0);
  }

  void clipReveal() {
    if (reveal >= 1.0) return;
    if (reveal <= 0.0) discard;
    float edge = mix(frameX.x - 115.0, frameX.y + 115.0, reveal);
    float reach = artPoint.x + 0.10 * (artPoint.y - 480.0)
      + 20.0 * sin(artPoint.y / 150.0);
    float coverage = smoothstep(-15.0, 15.0, edge - reach);
    vec2 cell = mod(floor(gl_FragCoord.xy), 4.0);
    float screen = fract(dot(cell, vec2(0.7548777, 0.5698403)));
    if (coverage <= screen) discard;
  }
`;

const pigmentFragment = /* glsl */ `
  ${aperture}
  uniform sampler2D plate;
  uniform float opacity;
  #ifdef CROPPED_PLATE
  uniform vec4 plateWindow;
  #endif
  varying vec2 texCoord;
  #ifdef WATER_INK
  ${inkShader}
  #endif

  void main() {
    #if defined(WATER_INK) || defined(SOURCE_SPRAY)
    vec2 dx = dFdx(texCoord), dy = dFdy(texCoord);
    #endif
    clipReveal();
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

const sourceSkyFragment = (groupCount) => /* glsl */ `
  ${aperture}
  uniform sampler2D plate;
  uniform sampler2D groupIndex;
  uniform float groupVisible[${groupCount}];
  varying vec2 texCoord;

  void main() {
    clipReveal();
    if (outsidePrint()) discard;
    vec4 pigment = texture2D(plate, texCoord);
    if (pigment.a < 0.002) discard;
    int index = int(texture2D(groupIndex, texCoord).r * 255.0 + 0.5);
    if (groupVisible[index] < 0.5) discard;
    gl_FragColor = vec4(pigment.rgb / pigment.a, pigment.a);
  }
`;

const sprayOverlayFragment = (regionCount) => /* glsl */ `
  ${aperture}
  ${sprayOverlayShader(regionCount)}
  void main() {
    clipReveal();
    if (outsidePrint()) discard;
    gl_FragColor = sprayOverlay(artPoint);
    if (gl_FragColor.a == 0.0) discard;
  }
`;

const paperFragment = /* glsl */ `
  ${aperture}
  uniform bool showSky;
  uniform bool showSea;

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
    clipReveal();
    vec2 p = artPoint;
    float horizon = 541.0 + 5.0 * sin(p.x / 225.0);
    float water = smoothstep(horizon - 22.0, horizon + 116.0, p.y);
    vec3 paper = vec3(0.811, 0.845, 0.822);

    vec3 sea = mix(vec3(0.59, 0.695, 0.698), vec3(0.245, 0.412, 0.50),
      smoothstep(horizon, 980.0, p.y));
    float etched = mottling(vec2(p.x / 96.0, p.y / 6.5 + 1.4 * sin(p.x / 140.0)));
    sea += vec3(0.08, 0.083, 0.074) * (etched - 0.5);
    float paperGrain = 0.017 * (hash(floor(p * 1.42)) - 0.5)
      + 0.019 * (mottling(p / 6.8) - 0.5);

    if (outsidePrint()) {
      if (!showSky) discard;
      gl_FragColor = vec4(paper + paperGrain, 1.0);
    } else if (showSky && showSea) {
      gl_FragColor = vec4(mix(paper, sea, water) + paperGrain, 1.0);
    } else if (showSea) {
      gl_FragColor = vec4(sea + paperGrain, water);
    } else if (showSky) {
      gl_FragColor = vec4(paper + paperGrain, 1.0);
    } else {
      discard;
    }
  }
`;

function getFrame(width, height, full) {
  const aspect = Math.max(width, 1) / Math.max(height, 1);
  if (full) {
    const span = Math.max(1364, 925 * aspect);
    const viewHeight = span / aspect;
    return { x: 700 - span / 2, y: 480.5 - viewHeight / 2, width: span, height: viewHeight };
  }
  // Follow the opening of the curl in portrait, then ease out towards
  // the original left edge on wider windows. The trim never enters frame.
  const wide = smooth((aspect - 1.08) / 0.52);
  const portrait = Math.max(585, aspect * 850);
  const span = THREE.MathUtils.lerp(portrait, 1360, wide);
  const viewHeight = span / aspect;
  return {
    x: Math.max(20, THREE.MathUtils.lerp(544 - span / 2, 20, wide)),
    y: Math.min(71, 937 - viewHeight),
    width: span,
    height: viewHeight
  };
}

// Authored in print coordinates (positive y points down). Each front travels
// through its own contour, while the trim keeps the edges of the print seated.
const swells = {
  "lower-left": { focus: [474, 598], heading: [.91, -.42], stride: 188, rate: 1, offset: .2, reach: [7.5, 4.8] },
  "lower-center": { focus: [704, 766], heading: [.87, .49], stride: 155, rate: 1, offset: 2.25, reach: [9, 5.7] },
  "lower-right": { focus: [1140, 842], heading: [-.94, -.34], stride: 225, rate: 2, offset: 3.5, reach: [11.5, 5.4] },
  "upper-wave": { focus: [975, 694], heading: [.93, -.36], stride: 310, rate: 2, offset: .9, reach: [1.5, 1.3] }
};

function smooth(value) {
  const x = THREE.MathUtils.clamp(value, 0, 1);
  return x * x * (3 - 2 * x);
}

/** Textures are supplied by the host. Ownership transfers to the scene. */
export function createWaveScene(textures, plateWindows, skyGroupCount, { skyColumns, spray }) {
  const group = new THREE.Group();
  group.name = "Ukiyo-e Wave Lab";
  const phase = { value: 0 };
  const motion = { value: 1 };
  const reveal = { value: 1 };
  const frameX = { value: new THREE.Vector2(20, 1380) };
  const showSky = { value: true };
  const showSea = { value: true };
  const fullArt = { value: true };
  const meshes = [];
  const inkStrength = { value: 1 };
  const inkMode = { value: 0 };
  const inkContour = { value: 1 };
  const inkLayers = {};
  let showInk = true;
  let cloudStrength = 1;
  let moveCloud = true;
  let sprayDistance = defaultSprayDistance;
  let sprayLimit = Math.min(defaultSprayLimit, spray.flecks.length);
  let moveSpray = true;
  const swellUniforms = Object.fromEntries(Object.entries(swells).map(([name, swell]) => [name, {
    swellFocus: { value: new THREE.Vector2(...swell.focus) },
    swellHeading: { value: new THREE.Vector2(...swell.heading) },
    swellReach: { value: new THREE.Vector2(...swell.reach) },
    swellRhythm: { value: new THREE.Vector3(swell.stride, swell.rate, swell.offset) }
  }]));
  let frame = getFrame(1360, 850, fullArt.value);

  function plane(name, options) {
    const {
      order, fragment = pigmentFragment, texture, width = MASTER_WIDTH,
      height = MASTER_HEIGHT, x = ORIGIN_X, y = MASTER_HEIGHT / 2,
      opacity = 1, depth = 1, amplitude = 0, swell, hull, cloud, spray, calm
    } = options;
    const uniforms = {
      phase, motion, reveal, frameX, showSky, showSea, fullArt,
      depth: { value: depth }, amplitude: { value: amplitude },
      plate: { value: texture },
      opacity: { value: opacity },
      plateSize: { value: new THREE.Vector2(width, height) },
      plateCenter: { value: new THREE.Vector2(x, y) },
      ...swellUniforms[swell]
    };
    const ink = inkFields[name];
    if (ink) {
      const inkEnabled = { value: 1 };
      inkLayers[name] = { inkEnabled, enabled: true };
      Object.assign(uniforms, {
        inkMode, inkStrength, inkContour, inkEnabled,
        inkCenter: { value: new THREE.Vector2(...ink.center) },
        inkPath: { value: new THREE.Vector4(...ink.path) },
        inkRhythm: { value: new THREE.Vector4(...ink.rhythm) },
        inkEdge: { value: ink.edge },
        lightTrack: { value: textures["hero-ribbons"] },
        darkTrack: { value: textures["hero-ribbons-dark"] },
      });
    }
    if (hull) uniforms.hullContact = { value: new THREE.Vector2(...hull) };
    const crop = plateWindows[name];
    if (crop) {
      const [x0, y0, x1, y1] = crop;
      uniforms.plateWindow = { value: new THREE.Vector4(
        x0 / (MASTER_WIDTH * 2), 1 - y1 / (MASTER_HEIGHT * 2),
        (x1 - x0) / (MASTER_WIDTH * 2), (y1 - y0) / (MASTER_HEIGHT * 2)
      ) };
    }
    const segments = amplitude || (swell && !hull) ? 48 : 1;
    const geometry = cloud ?? new THREE.PlaneGeometry(width / UNIT, height / UNIT, segments, segments);
    const material = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: planeVertex,
      defines: {
        ...(swell && { WAVE_SWELL: 1 }),
        ...(hull && { WAVE_HULL: 1 }),
        ...(crop && { CROPPED_PLATE: 1 }),
        ...(cloud && { CLOUD_MESH: 1 }),
        ...(spray && { SOURCE_SPRAY: 1 }),
        ...(ink && { WATER_INK: 1 }),
        ...(calm && { CALM_WATER: 1 }),
        ...(name === "hero" && { HERO_TRACKS: 1 }),
      },
      fragmentShader: fragment,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    mesh.frustumCulled = false;
    mesh.renderOrder = order;
    mesh.position.set((x - ORIGIN_X) / UNIT, (ORIGIN_Y - y) / UNIT, 0);
    group.add(mesh);
    meshes.push(mesh);
    return mesh;
  }

  plane("paper and sea", { order: 0, fragment: paperFragment, width: 4900, height: 4500 });
  const skyIndex = textures["source-sky-index"];
  skyIndex.minFilter = THREE.NearestFilter;
  skyIndex.magFilter = THREE.NearestFilter;
  skyIndex.generateMipmaps = false;
  const cloud = createCloudMotion(skyColumns, { width: MASTER_WIDTH, height: MASTER_HEIGHT, unit: UNIT });
  const sourceSky = plane("source-sky", {
    order: 1, fragment: sourceSkyFragment(skyGroupCount), texture: textures["source-sky"], cloud: cloud.geometry
  });
  const skySpray = plane("sky-spray", { order: 1.1, texture: textures["sky-spray"], spray: true });
  const inscription = plane("inscription", { order: 1.2, texture: textures.inscription });
  inscription.visible = false;
  const skyVisibility = new Float32Array(skyGroupCount).fill(1);
  sourceSky.material.uniforms.groupIndex = { value: skyIndex };
  sourceSky.material.uniforms.groupVisible = { value: skyVisibility };
  const fuji = plane("fuji", { order: 4.2, texture: textures.fuji });
  const far = plane("far", { order: 2, texture: textures.far, opacity: 0.51, calm: true, depth: 2, amplitude: 1.25 });
  const mid = plane("mid", { order: 3, texture: textures.mid, opacity: 0.72, calm: true, depth: 2, amplitude: 2.15 });
  const near = plane("near", { order: 4, texture: textures.near, opacity: 0.89, calm: true, depth: 3, amplitude: 3.1 });
  const hero = plane("hero", { order: 5, texture: textures.hero });
  const upper = plane("upper-wave", { order: 4.6, texture: textures["upper-wave"], swell: "upper-wave" });
  const lower = Object.fromEntries(["lower-center", "lower-left", "lower-right"].map(
    (name, i) => [name, plane(name, { order: 6 + i * .2, texture: textures[name], swell: name })]
  ));

  const boats = Object.fromEntries([
    ["boat-left", "lower-left", [239, 687], 6.15],
    ["boat-near", "lower-center", [830, 899], 6.1],
    ["boat-far", "upper-wave", [930, 720], 4.55]
  ].map(([name, carrier, hull, order]) => {
    const mesh = plane(name, { order, texture: textures[name], swell: carrier, hull });
    mesh.visible = false;
    return [name, mesh];
  }));

  const layers = {
    fuji, far, mid, near, hero, ...lower, ...boats,
    "upper-wave": upper, "source-sky": sourceSky, inscription
  };
  let showMarks = true;
  const marks = [
    ["hero", "hero-marks"],
    ["upper-wave", "upper-marks"],
    ...Object.keys(lower).map((name) => [name, name + "-marks"])
  ].filter(([, name]) => textures[name]).map(([carrier, name]) => {
    const back = layers[carrier];
    const mesh = plane(name, {
      order: carrier === "hero" ? 5.15 : back.renderOrder + .05,
      texture: textures[name],
      spray: true, swell: carrier === "hero" ? undefined : carrier
    });
    return { mesh, back };
  });
  const joins = [
    ["hero", "lower-left", "hero-left"],
    ["hero", "lower-center", "hero-center"],
    ["upper-wave", "lower-center", "upper-center"],
    ["upper-wave", "lower-right", "upper-right"],
    ["lower-center", "lower-left", "center-left"],
    ["lower-center", "lower-right", "center-right"],
    ["lower-left", "lower-right", "left-right"]
  ].map(([rear, front, suffix], i) => {
    const name = "join-" + suffix;
    const back = layers[rear];
    const mesh = plane(name, {
      order: back.renderOrder + (rear === "hero" ? .02 : -.07) + i * .001,
      texture: textures[name],
      swell: rear === "hero" ? undefined : rear
    });
    return { mesh, back, front: layers[front] };
  });
  // The completed hull slides behind the original hero foam at the bow.
  const bowFoam = plane("hero-boat-foam", { order: 6.17, texture: textures["hero-boat-foam"] });
  bowFoam.visible = false;
  joins.push({ mesh: bowFoam, back: hero, front: boats["boat-left"] });

  const sprayLayer = createSprayLayer({
    texture: textures["spray-motion-atlas"], data: spray, aperture,
    uniforms: { reveal, frameX, fullArt }, unit: UNIT, origin: [ORIGIN_X, ORIGIN_Y]
  });
  group.add(sprayLayer.mesh);
  meshes.push(sprayLayer.mesh);
  const sprayOverlay = plane("spray guide", { order: 8, fragment: sprayOverlayFragment(spray.regions.length) });
  sprayOverlay.visible = false;
  Object.assign(sprayOverlay.material.uniforms, {
    regionBoxes: { value: spray.regions.map(({ bounds }) => new THREE.Vector4(...bounds)) },
    sprayActive: { value: false }
  });

  function updateInkLayers() {
    for (const { inkEnabled, enabled } of Object.values(inkLayers)) inkEnabled.value = Number(showInk && enabled);
  }

  return {
    group,
    get frame() { return frame; },
    setReveal(value) {
      reveal.value = THREE.MathUtils.clamp(value, 0, 1);
    },
    setMotion(enabled) {
      motion.value = Number(enabled);
    },
    setSkyGroup(index, visible) {
      skyVisibility[index] = Number(visible);
    },
    setSkyStrength(index, strength) {
      cloud.strength[index] = strength;
    },
    setCloudMotion(enabled, strength) {
      moveCloud = enabled;
      cloudStrength = strength;
    },
    setSprayControls(distance, limit, showGuide) {
      sprayDistance = distance;
      sprayLimit = limit;
      sprayOverlay.visible = showGuide;
    },
    setInkStrength(strength, contour) {
      inkStrength.value = strength;
      inkContour.value = Number(contour);
    },
    setInkLayer(name, enabled) {
      inkLayers[name].enabled = enabled;
      updateInkLayers();
    },
    setSwellControls({ speed, push, lift, phases }) {
      for (const name of Object.keys(lower)) {
        const { reach, rate, offset } = swells[name];
        const { swellReach, swellRhythm } = swellUniforms[name];
        swellReach.value.set(reach[0] * push, reach[1] * lift);
        swellRhythm.value.y = rate * speed;
        swellRhythm.value.z = offset + THREE.MathUtils.degToRad(phases[name]);
      }
    },
    setLayer(name, visible) {
      if (name === "sky") showSky.value = visible;
      else if (name === "sea") showSea.value = visible;
      else if (name === "hero-flow") {
        showInk = visible;
        updateInkLayers();
      } else if (name === "spray-motion") {
        moveSpray = visible;
      } else if (name === "spray-source") {
        showMarks = visible;
        skySpray.visible = visible;
      } else layers[name].visible = visible;
      for (const { mesh, back } of marks) mesh.visible = showMarks && back.visible;
      for (const { mesh, back, front } of joins) mesh.visible = back.visible && front.visible;
    },
    setRibbonInk(ink) {
      inkMode.value = { light: 1, dark: 2 }[ink] ?? 0;
    },
    setComposition(mode) {
      fullArt.value = mode === "full";
    },
    resize(width, height) {
      frame = getFrame(width, height, fullArt.value);
      frameX.value.set(frame.x, frame.x + frame.width);
    },
    update(time, _delta) {
      const loop = THREE.MathUtils.euclideanModulo(time, LOOP_SECONDS);
      phase.value = loop / LOOP_SECONDS * tau;
      const animateCloud = motion.value && moveCloud && sourceSky.visible
        && skyVisibility.some((visible, index) => visible && cloud.strength[index]);
      const cloudAmount = animateCloud ? cloudStrength : 0;
      cloud.update(phase.value, cloudAmount, skyVisibility);
      const active = sprayLayer.update(loop, motion.value && moveSpray ? sprayDistance : 0, sprayLimit);
      sprayOverlay.material.uniforms.sprayActive.value = active > 0;
      return active;
    },
    dispose() {
      for (const mesh of meshes) {
        mesh.geometry.dispose();
        mesh.material.dispose();
      }
      for (const texture of Object.values(textures)) texture.dispose();
      group.removeFromParent();
      group.clear();
    }
  };
}

export function applyFrame(camera, frame) {
  camera.left = (frame.x - ORIGIN_X) / UNIT;
  camera.right = (frame.x + frame.width - ORIGIN_X) / UNIT;
  camera.top = (ORIGIN_Y - frame.y) / UNIT;
  camera.bottom = (ORIGIN_Y - frame.y - frame.height) / UNIT;
  camera.updateProjectionMatrix();
}
