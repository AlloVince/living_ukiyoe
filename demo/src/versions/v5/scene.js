// Ukiyo-e V5 scene factory. Verbatim JS port of the Radio theme's
// `themes/ukiyoe/scene.ts`, adapted only where the host differs:
//  - textures arrive pre-decoded from the Wave Lab asset loader (no Vite ?url);
//  - the play/pause envelope is supplied by the host (same tau 1.35 / 2.16);
//  - the paper-opening entrance cover replaces the two-picture compositor:
//    the assembly shader's opening math (centre-out fbm wrinkle + warm edge
//    highlight) is kept, the outgoing-picture side is dropped.
// No experimental layer (sea wash, far/mid/near, debug guide) exists here. The
// print's own cuts are kept instead: the cartouche plate and — matching the
// frozen Demo's "original flecks" layer — its spray and mark plates, which stay
// off until the layer is switched on.
import {
  Group,
  Mesh,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  Vector2,
  Vector3,
  Vector4
} from 'three';
import { createCloudMotion } from './cloud-motion.js';
import { createSprayLayer } from './spray-motion.js';
import { INK_FIELDS } from './ink-motion.js';
import { PAPER_FRAGMENT, PIGMENT_FRAGMENT, PLANE_VERTEX, SOURCE_SKY_FRAGMENT } from './shaders.js';
import { NOISE } from './noise.js';
import {
  BOATS,
  JOINS,
  LOOP_SECONDS,
  MASTER_HEIGHT,
  MASTER_WIDTH,
  ORIGIN_X,
  ORIGIN_Y,
  PLATE_WINDOWS,
  SKY_GROUP_COUNT,
  SWELLS,
  TAU,
  UNIT,
  DEFAULT_SPRAY_DISTANCE,
  DEFAULT_SPRAY_LIMIT
} from './constants.js';
import { frameFor, lerpFrame } from './framing.js';

// The original Radio reveal, rebuilt for the real print plates: every part of
// the woodblock arrives separately, from its own direction and at its own
// moment. Verbatim from scene.ts.
const ENTRANCE = {
  'source-sky': { delay: 0.16, span: 0.30, dx: 0.0, dy: 2.3 },
  inscription: { delay: 0.20, span: 0.26, dx: -1.2, dy: 0.6 },
  fuji: { delay: 0.24, span: 0.28, dx: 0.8, dy: -1.9 },
  hero: { delay: 0.30, span: 0.34, dx: -3.8, dy: -0.9 },
  'join-hero-left': { delay: 0.30, span: 0.34, dx: -3.8, dy: -0.9 },
  'join-hero-center': { delay: 0.30, span: 0.34, dx: -3.8, dy: -0.9 },
  'hero-boat-foam': { delay: 0.30, span: 0.34, dx: -3.8, dy: -0.9 },
  'upper-wave': { delay: 0.40, span: 0.30, dx: 3.4, dy: 0.6 },
  'join-upper-center': { delay: 0.40, span: 0.30, dx: 3.4, dy: 0.6 },
  'join-upper-right': { delay: 0.40, span: 0.30, dx: 3.4, dy: 0.6 },
  'lower-left': { delay: 0.46, span: 0.28, dx: -3.1, dy: -1.6 },
  'join-center-left': { delay: 0.46, span: 0.28, dx: -3.1, dy: -1.6 },
  'join-left-right': { delay: 0.46, span: 0.28, dx: -3.1, dy: -1.6 },
  'lower-center': { delay: 0.50, span: 0.28, dx: 0.0, dy: -2.5 },
  'lower-right': { delay: 0.54, span: 0.28, dx: 3.1, dy: -1.6 },
  'join-center-right': { delay: 0.54, span: 0.28, dx: 3.1, dy: -1.6 },
  'boat-left': { delay: 0.58, span: 0.26, dx: -2.6, dy: -1.8 },
  'boat-far': { delay: 0.60, span: 0.26, dx: 2.2, dy: -1.6 },
  'boat-near': { delay: 0.63, span: 0.26, dx: 0.4, dy: -2.3 },
  'spray-motion': { delay: 0.70, span: 0.30, dx: 0.0, dy: 1.8 }
};

const smooth01 = (value) => {
  const x = Math.min(1, Math.max(0, value));
  return x * x * (3 - 2 * x);
};

function applyFrame(camera, frame) {
  camera.left = (frame.x - ORIGIN_X) / UNIT;
  camera.right = (frame.x + frame.width - ORIGIN_X) / UNIT;
  camera.top = (ORIGIN_Y - frame.y) / UNIT;
  camera.bottom = (ORIGIN_Y - frame.y - frame.height) / UNIT;
  camera.updateProjectionMatrix();
}

// Screen-space cover: the paper opening from Radio's assembly effect, without
// the outgoing picture. Reused numbers: sweep 0.05..0.46, aspect*0.72 radius
// field, fbm wrinkle * 0.30, soft edge 0.13, warm highlight vec3(.16,.14,.11).
const COVER_FRAGMENT = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform float uProgress;
uniform float uAspect;
uniform float uTime;
uniform float uReduced;
${NOISE}

void main() {
  float sweep = smoothstep(0.05, 0.46, uProgress);
  vec2 q = (vUv - 0.5) * vec2(uAspect * 0.72, 1.0);
  float radius = length(q);
  float wrinkle = (fbm(vec2(vUv.x * 7.0, vUv.y * 5.0) + vec2(0.0, uTime * 0.04)) - 0.5) * 0.30;
  float opening = sweep * 1.35 + wrinkle - 0.08;
  float reveal = smoothstep(radius - 0.13, radius + 0.13, opening);
  if (reveal >= 1.0) discard;
  vec3 closed = vec3(0.838, 0.745, 0.606);
  float grain = (hash21(floor(vUv * 900.0)) - 0.5) * 0.02;
  vec3 col = closed + grain;
  float edge = (1.0 - abs(reveal - 0.5) * 2.0) * sin(3.14159265 * min(uProgress, 1.0));
  col += vec3(0.16, 0.14, 0.11) * edge * 0.5 * (1.0 - uReduced * 0.5);
  gl_FragColor = vec4(col, 1.0 - reveal);
}
`;

const COVER_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export function createV5Scene(textures, motionData, options) {
  const { reduced } = options;
  let framingMode = options.framingMode ?? 0;
  const scene = new Scene();
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0.01, 10);
  camera.position.z = 5;

  const art = new Group();
  art.name = 'Ukiyo-e print';
  scene.add(art);

  const phase = { value: 0 };
  const motion = { value: reduced ? 0 : 1 };
  const uPaperLift = { value: 0 };
  const inkStrength = { value: 1 };
  const inkMode = { value: 0 };
  const inkContour = { value: 1 };
  const inkLayers = {};
  let showInk = true;
  let moveCloud = true;
  let cloudStrength = 1;
  let moveSpray = true;
  let sprayDistance = DEFAULT_SPRAY_DISTANCE;

  const swellUniforms = {};
  for (const [name, swell] of Object.entries(SWELLS)) {
    swellUniforms[name] = {
      swellFocus: { value: new Vector2(swell.focus[0], swell.focus[1]) },
      swellHeading: { value: new Vector2(swell.heading[0], swell.heading[1]) },
      swellReach: { value: new Vector2(swell.reach[0], swell.reach[1]) },
      swellRhythm: { value: new Vector3(swell.stride, swell.rate, swell.offset) }
    };
  }

  const meshes = [];
  const parts = [];

  function registerPart(mesh) {
    const entrance = ENTRANCE[mesh.name];
    if (!entrance) return;
    const material = mesh.material;
    parts.push({
      mesh,
      entrance,
      baseX: mesh.position.x,
      baseY: mesh.position.y,
      baseOpacity: material.uniforms.opacity?.value ?? 1
    });
  }

  function plane(config) {
    const {
      name, order, fragment = PIGMENT_FRAGMENT, texture,
      width = MASTER_WIDTH, height = MASTER_HEIGHT,
      x = ORIGIN_X, y = MASTER_HEIGHT / 2,
      opacity = 1, depth = 1, amplitude = 0,
      swell, hull, cloud, groupIndex, groupVisible, spray = false
    } = config;
    const uniforms = {
      phase, motion, uPaperLift,
      depth: { value: depth },
      amplitude: { value: amplitude },
      plate: { value: texture ?? null },
      opacity: { value: opacity },
      plateSize: { value: new Vector2(width, height) },
      plateCenter: { value: new Vector2(x, y) },
      ...(swell ? swellUniforms[swell] : {})
    };
    if (groupIndex) {
      uniforms.groupIndex = { value: groupIndex };
      uniforms.groupVisible = { value: groupVisible };
    }
    const ink = INK_FIELDS[name];
    if (ink) {
      const inkEnabledField = { value: 1 };
      inkLayers[name] = { inkEnabled: inkEnabledField, enabled: true };
      Object.assign(uniforms, {
        inkMode, inkStrength, inkContour, inkEnabled: inkEnabledField,
        inkCenter: { value: new Vector2(ink.center[0], ink.center[1]) },
        inkPath: { value: new Vector4(...ink.path) },
        inkRhythm: { value: new Vector4(...ink.rhythm) },
        inkEdge: { value: ink.edge },
        lightTrack: { value: textures['hero-ribbons'] },
        darkTrack: { value: textures['hero-ribbons-dark'] }
      });
    }
    if (hull) uniforms.hullContact = { value: new Vector2(hull[0], hull[1]) };
    const crop = PLATE_WINDOWS[name];
    if (crop) {
      const [x0, y0, x1, y1] = crop;
      uniforms.plateWindow = { value: new Vector4(
        x0 / (MASTER_WIDTH * 2), 1 - y1 / (MASTER_HEIGHT * 2),
        (x1 - x0) / (MASTER_WIDTH * 2), (y1 - y0) / (MASTER_HEIGHT * 2)
      ) };
    }
    const defines = {
      ...(spray ? { SOURCE_SPRAY: 1 } : {}),
      ...(swell ? { WAVE_SWELL: 1 } : {}),
      ...(hull ? { WAVE_HULL: 1 } : {}),
      ...(crop ? { CROPPED_PLATE: 1 } : {}),
      ...(cloud ? { CLOUD_MESH: 1 } : {}),
      ...(ink ? { WATER_INK: 1 } : {}),
      ...(name === 'hero' ? { HERO_TRACKS: 1 } : {})
    };
    const segments = amplitude || (swell && !hull) ? 48 : 1;
    const geometry = cloud ?? new PlaneGeometry(width / UNIT, height / UNIT, segments, segments);
    const material = new ShaderMaterial({
      uniforms,
      vertexShader: PLANE_VERTEX,
      fragmentShader: fragment,
      defines,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false
    });
    const mesh = new Mesh(geometry, material);
    mesh.name = name;
    mesh.frustumCulled = false;
    mesh.renderOrder = order;
    mesh.position.set((x - ORIGIN_X) / UNIT, (ORIGIN_Y - y) / UNIT, 0);
    meshes.push(mesh);
    registerPart(mesh);
    return mesh;
  }

  // 0. Paper field covers every viewport.
  const paper = plane({ name: 'paper', order: 0, fragment: PAPER_FRAGMENT, width: 12000, height: 10000 });
  scene.add(paper);

  // 1. Original sky, six registered cloud regions and one shared cloud mesh.
  const skyVisibility = new Float32Array(SKY_GROUP_COUNT).fill(1);
  const cloud = createCloudMotion(motionData.skyColumns);
  const sourceSky = plane({
    name: 'source-sky', order: 1, fragment: SOURCE_SKY_FRAGMENT,
    texture: textures['source-sky'], cloud: cloud.geometry,
    groupIndex: textures['source-sky-index'], groupVisible: skyVisibility
  });
  art.add(sourceSky);

  // 1b. The print's own cartouche, signature and seal. Owner decision
  // (2026-11-10): this layer belongs in the final artwork even though the
  // Radio migration had left it out; it arrives between sky and Fuji.
  const inscription = plane({ name: 'inscription', order: 1.2, texture: textures.inscription });
  art.add(inscription);

  // 2. Print layers, in the frozen Demo's render order.
  const fuji = plane({ name: 'fuji', order: 4.2, texture: textures.fuji });
  const hero = plane({ name: 'hero', order: 5, texture: textures.hero });
  const upper = plane({ name: 'upper-wave', order: 4.6, texture: textures['upper-wave'], swell: 'upper-wave' });
  const lowerCenter = plane({ name: 'lower-center', order: 6, texture: textures['lower-center'], swell: 'lower-center' });
  const lowerLeft = plane({ name: 'lower-left', order: 6.2, texture: textures['lower-left'], swell: 'lower-left' });
  const lowerRight = plane({ name: 'lower-right', order: 6.4, texture: textures['lower-right'], swell: 'lower-right' });
  art.add(fuji, hero, upper, lowerCenter, lowerLeft, lowerRight);

  for (const boat of BOATS) {
    const boatMesh = plane({
      name: boat.name, order: boat.order, texture: textures[boat.name],
      swell: boat.carrier, hull: boat.hull
    });
    art.add(boatMesh);
  }
  const plateLayers = {
    'source-sky': sourceSky, fuji, inscription, hero,
    'upper-wave': upper, 'lower-center': lowerCenter,
    'lower-left': lowerLeft, 'lower-right': lowerRight
  };
  for (const boat of BOATS) plateLayers[boat.name] = art.children.find(m => m.name === boat.name);

  // 3. Seam repaint between neighbouring wave plates.
  const joinPairs = [];
  for (const join of JOINS) {
    const mesh = plane({ name: join.name, order: join.order, texture: textures[join.name], swell: join.swell });
    art.add(mesh);
    joinPairs.push({ mesh, rear: join.rear, front: join.front });
  }
  const bowFoam = plane({ name: 'hero-boat-foam', order: 6.17, texture: textures['hero-boat-foam'] });
  art.add(bowFoam);
  joinPairs.push({ mesh: bowFoam, rear: 'hero', front: 'boat-left' });

  function updateJoinVisibility() {
    for (const { mesh, rear, front } of joinPairs) {
      mesh.visible = plateLayers[rear].visible && plateLayers[front].visible;
    }
  }
  updateJoinVisibility();

  function updateInkLayers() {
    for (const { inkEnabled, enabled } of Object.values(inkLayers)) {
      inkEnabled.value = Number(showInk && enabled);
    }
  }

  // 3b. The print's own flecks and spray — the frozen Demo's "original flecks"
  // layer. It rides the same swell as its carrier plate and stays off by
  // default, because the final picture has always opened without it.
  let showSourceSpray = false;
  const skySpray = plane({ name: 'sky-spray', order: 1.1, texture: textures['sky-spray'], spray: true });
  art.add(skySpray);
  const markParts = [
    ['hero', 'hero-marks', 5.15],
    ['upper-wave', 'upper-marks', 4.65],
    ['lower-center', 'lower-center-marks', 6.05],
    ['lower-left', 'lower-left-marks', 6.25]
  ].filter(([, name]) => textures[name]).map(([carrier, name, order]) => {
    const mesh = plane({
      name, order, texture: textures[name], spray: true,
      swell: carrier === 'hero' ? undefined : carrier
    });
    art.add(mesh);
    return { mesh, carrier };
  });
  function updateSourceSpray() {
    skySpray.visible = showSourceSpray;
    for (const { mesh, carrier } of markParts) {
      mesh.visible = showSourceSpray && plateLayers[carrier].visible;
    }
  }
  updateSourceSpray();

  // 4. Dynamic spray: its own geometry, atlas and 28s round schedule.
  const spray = createSprayLayer({
    texture: textures['spray-motion-atlas'],
    data: motionData.spray,
    uniforms: { opacity: { value: 1 } }
  });
  art.add(spray.mesh);
  meshes.push(spray.mesh);
  registerPart(spray.mesh);
  let sprayLimit = Math.min(DEFAULT_SPRAY_LIMIT, motionData.spray.flecks.length);

  // 5. Entrance cover (paper opening), a screen-space quad above everything.
  const coverUniforms = {
    uProgress: { value: 1 },
    uAspect: { value: 1 },
    uTime: { value: 0 },
    uReduced: { value: reduced ? 1 : 0 }
  };
  const coverMaterial = new ShaderMaterial({
    uniforms: coverUniforms,
    vertexShader: COVER_VERTEX,
    fragmentShader: COVER_FRAGMENT,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    toneMapped: false
  });
  const cover = new Mesh(new PlaneGeometry(2, 2), coverMaterial);
  cover.name = 'entrance-cover';
  cover.frustumCulled = false;
  cover.renderOrder = 999;
  cover.visible = false;
  scene.add(cover);
  meshes.push(cover);

  let frame = frameFor(options.aspect ?? 16 / 9, framingMode);
  let targetAspect = options.aspect ?? 16 / 9;
  applyFrame(camera, frame);
  let loop = 0;
  let revealValue = 1;
  let visibleParts = 0;

  function applyEntrance(reveal) {
    const travel = reduced ? 0.3 : 1;
    let visible = 0;
    for (const part of parts) {
      const { delay, span, dx, dy } = part.entrance;
      const t = smooth01((reveal - delay) / span);
      const away = 1 - t;
      if (t > 0.001) visible += 1;
      part.mesh.position.x = part.baseX + dx * away * travel;
      part.mesh.position.y = part.baseY + dy * away * travel;
      const material = part.mesh.material;
      if (material.uniforms.opacity) material.uniforms.opacity.value = part.baseOpacity * t;
    }
    visibleParts = visible;
    // Cover visibility and geometry follow the camera window.
    const coverActive = reveal < 1;
    cover.visible = coverActive;
    if (coverActive) {
      coverUniforms.uProgress.value = reveal;
      cover.scale.set((camera.right - camera.left) / 2, (camera.top - camera.bottom) / 2, 1);
      cover.position.set((camera.right + camera.left) / 2, (camera.top + camera.bottom) / 2, 0);
      coverUniforms.uAspect.value = (camera.right - camera.left) / Math.max(camera.top - camera.bottom, 0.0001);
      coverUniforms.uTime.value = reduced ? 0 : loop;
    }
  }
  applyEntrance(revealValue);

  return {
    id: 'v5',
    scene,
    camera,
    setReveal(value) {
      revealValue = Math.min(1, Math.max(0, value));
      applyEntrance(revealValue);
    },
    get reveal() {
      return revealValue;
    },
    get visibleParts() {
      return visibleParts;
    },
    setFramingMode(mode) {
      framingMode = mode;
    },
    resize(aspect) {
      targetAspect = aspect;
      // Recompute immediately so a static page is framed correctly on the
      // very first paint; animation-time changes ease through update().
      frame = lerpFrame(frame, frameFor(targetAspect, framingMode), 1);
      applyFrame(camera, frame);
    },
    update(dt, ctx) {
      // ctx: { motion (0..1 playMotion envelope), reduced }
      // Framing: eased in time like Radio, so crossing an aspect segment or
      // rotating a device never jumps the print.
      frame = lerpFrame(frame, frameFor(targetAspect, framingMode), 1 - Math.exp(-dt / 0.1));
      applyFrame(camera, frame);
      applyEntrance(revealValue);
      // Radio freezes everything under reduced-motion. The Lab keeps that
      // as the default but honours the explicit Animate opt-in, which Radio
      // has no UI for; without opt-in (motionOn false) it stays frozen.
      const runAmount = ctx.motionOn ? ctx.motion : 0;
      motion.value = runAmount;
      // The host owns the 28 s clock (loopPin); the scene only advances it
      // when the host lets it (standalone use).
      if (ctx.loopPin !== undefined) loop = ctx.loopPin;
      else if (runAmount > 0) loop = (loop + dt * runAmount) % LOOP_SECONDS;
      phase.value = loop / LOOP_SECONDS * TAU;
      uPaperLift.value = 0; // No audio stream exists in the Wave Lab.
      const animateCloud = moveCloud && runAmount > 0
        && skyVisibility.some((visible, index) => visible && cloud.strength[index] > 0);
      cloud.update(phase.value, animateCloud ? runAmount * cloudStrength : 0, skyVisibility);
      spray.update(loop, moveSpray && runAmount > 0 ? sprayDistance : 0, sprayLimit);
    },
    setLayer(name, visible) {
      if (name === 'hero-flow') {
        showInk = visible;
        updateInkLayers();
        return;
      }
      if (name === 'spray-source') {
        showSourceSpray = visible;
        updateSourceSpray();
        return;
      }
      if (name === 'spray-motion') {
        moveSpray = visible;
        return;
      }
      const mesh = plateLayers[name];
      if (mesh) {
        mesh.visible = visible;
        updateJoinVisibility();
        updateSourceSpray();
      }
    },
    setRibbonInk(ink) {
      inkMode.value = { light: 1, dark: 2 }[ink] ?? 0;
    },
    setInkStrength(strength, contour) {
      inkStrength.value = strength;
      inkContour.value = Number(contour);
    },
    setInkLayer(name, enabled) {
      const field = inkLayers[name];
      if (field) {
        field.enabled = enabled;
        updateInkLayers();
      }
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
    setSprayControls(distance, limit) {
      sprayDistance = distance;
      sprayLimit = Math.min(limit, motionData.spray.flecks.length);
    },
    setSwellControls({ speed, push, lift, phases }) {
      for (const name of ['lower-left', 'lower-center', 'lower-right']) {
        const { reach, rate, offset } = SWELLS[name];
        const { swellReach, swellRhythm } = swellUniforms[name];
        swellReach.value.set(reach[0] * push, reach[1] * lift);
        swellRhythm.value.y = rate * speed;
        swellRhythm.value.z = offset + (phases[name] ?? 0) * Math.PI / 180;
      }
    },
    get loop() {
      return loop;
    },
    setLoop(seconds) {
      loop = ((seconds % LOOP_SECONDS) + LOOP_SECONDS) % LOOP_SECONDS;
      phase.value = loop / LOOP_SECONDS * TAU;
    },
    dispose() {
      for (const mesh of meshes) {
        mesh.geometry.dispose();
        mesh.material.dispose();
      }
      for (const texture of Object.values(textures)) texture.dispose();
      scene.clear();
    }
  };
}
