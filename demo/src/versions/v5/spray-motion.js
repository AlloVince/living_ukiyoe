// Dynamic spray. Verbatim JS port of the Radio theme's `spray-motion.ts`
// (itself copied verbatim from the frozen Demo), including the 50 / 100
// defaults, four 25-fleck rounds, three bursts, trajectory, scale ramp and
// 80% peak opacity. The debug guide overlay is not part of the production
// picture and is not ported.
import {
  BufferAttribute,
  BufferGeometry,
  DynamicDrawUsage,
  Mesh,
  ShaderMaterial
} from 'three';
import { APERTURE } from './aperture.js';
import { UNIT, ORIGIN_X, ORIGIN_Y } from './constants.js';

const BURSTS = [0.45, 9.85, 19.25];
const ROUNDS = [
  { start: 0, duration: 2.75 },
  { start: 2.05, duration: 3.05 },
  { start: 4.3, duration: 2.65 },
  { start: 1, duration: 2.75 },
  { start: 3.15, duration: 2.85 },
  { start: 5.15, duration: 2.35 }
];
const FLECKS_PER_ROUND = 25;
const SPRAY_OPACITY = 0.8;
const CORNERS = [[0, 0], [0, 1], [1, 0], [1, 1]];

export function createSprayLayer(options) {
  const { texture, data, uniforms } = options;
  const { atlasSize: [atlasWidth, atlasHeight], flecks, regions } = data;
  const geometry = new BufferGeometry();
  const trajectories = flecks.map(({ region }, index) => {
    const { direction: [directionX, directionY], delay } = regions[region];
    const round = ROUNDS[Math.floor(index / FLECKS_PER_ROUND)];
    return {
      directionX, directionY,
      start: round.start + delay * 0.34 + (index % 7) * 0.035,
      duration: round.duration + (index % 5) * 0.11
    };
  });
  const positions = new Float32Array(flecks.length * 12);
  const coverage = new Float32Array(flecks.length * 4);
  const uvs = new Float32Array(flecks.length * 8);
  const indices = [];
  for (const [index, { tile: [x, y, width, height] }] of flecks.entries()) {
    for (const [corner, [u, v]] of CORNERS.entries()) {
      uvs.set([(x - 1 + u * (width + 2)) / atlasWidth,
        1 - (y - 1 + v * (height + 2)) / atlasHeight], index * 8 + corner * 2);
    }
    const start = index * 4;
    indices.push(start, start + 1, start + 2, start + 2, start + 1, start + 3);
  }
  geometry.setAttribute('position', new BufferAttribute(positions, 3).setUsage(DynamicDrawUsage));
  geometry.setAttribute('coverage', new BufferAttribute(coverage, 1).setUsage(DynamicDrawUsage));
  geometry.setAttribute('uv', new BufferAttribute(uvs, 2));
  geometry.setIndex(indices);

  const material = new ShaderMaterial({
    uniforms: { ...uniforms, plate: { value: texture } },
    vertexShader: /* glsl */ `
      attribute float coverage;
      varying vec2 artPoint;
      varying vec2 texCoord;
      varying float fleckCoverage;
      void main() {
        artPoint = position.xy * vec2(${UNIT}.0, -${UNIT}.0) + vec2(${ORIGIN_X}.0, ${ORIGIN_Y}.0);
        texCoord = uv;
        fleckCoverage = coverage;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      ${APERTURE}
      uniform sampler2D plate;
      uniform float opacity;
      varying vec2 texCoord;
      varying float fleckCoverage;
      void main() {
        if (outsidePrint() || fleckCoverage <= 0.0) discard;
        vec4 ink = texture2D(plate, texCoord);
        if (ink.a < 0.002) discard;
        gl_FragColor = vec4(ink.rgb / ink.a, ink.a * fleckCoverage * opacity);
      }
    `,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    toneMapped: false
  });
  const mesh = new Mesh(geometry, material);
  mesh.name = 'spray-motion';
  mesh.frustumCulled = false;
  mesh.renderOrder = 7.8;
  mesh.visible = false;

  function update(seconds, distance, limit) {
    let burst = -1;
    for (const start of BURSTS) if (start <= seconds) burst = start;
    const elapsed = burst < 0 ? Number.NaN : seconds - burst;
    let active = 0;
    mesh.visible = false;
    if (distance === 0 || !Number.isFinite(elapsed)) return active;
    for (let index = 0; index < limit; index += 1) {
      const { anchor, tile: [, , width, height] } = flecks[index];
      const { start, duration, directionX, directionY } = trajectories[index];
      const phase = (elapsed - start) / duration;
      const fade = Math.min(1, phase * 4, (1 - phase) * 7);
      coverage.fill(Math.max(0, fade) * SPRAY_OPACITY, index * 4, index * 4 + 4);
      if (fade <= 0) continue;
      active += 1;
      const reach = distance * (0.68 + (index % 11) * 0.032);
      const lift = Math.sin(Math.PI * phase);
      const drift = lift * Math.sin(2 * Math.PI * phase) * 0.17;
      const dx = reach * (directionX * lift - directionY * drift);
      const dy = reach * (directionY * lift + directionX * drift);
      const scale = 0.72 + 0.35 * (1 - (1 - phase) ** 2);
      const centerX = anchor[0] + width / 4 + dx;
      const centerY = anchor[1] + height / 4 + dy;
      for (const [corner, [u, v]] of CORNERS.entries()) {
        const offset = index * 12 + corner * 3;
        const x = centerX + (u - 0.5) * (width / 2 + 1) * scale;
        const y = centerY + (v - 0.5) * (height / 2 + 1) * scale;
        positions[offset] = (x - ORIGIN_X) / UNIT;
        positions[offset + 1] = (ORIGIN_Y - y) / UNIT;
      }
    }
    geometry.setDrawRange(0, limit * 6);
    geometry.attributes.position.needsUpdate = true;
    geometry.attributes.coverage.needsUpdate = true;
    mesh.visible = active > 0;
    return active;
  }

  return { mesh, update };
}
