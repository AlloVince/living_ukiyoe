import {
  BufferAttribute, BufferGeometry, DynamicDrawUsage, Mesh, ShaderMaterial
} from "three";

export const defaultSprayDistance = 50;
export const defaultSprayLimit = 100;
export const maxSprayDistance = 120;
export const firstSprayRound = 1.75;
const bursts = [0.45, 9.85, 19.25];
const rounds = [
  { start: 0, duration: 2.75 },
  { start: 2.05, duration: 3.05 },
  { start: 4.3, duration: 2.65 },
  // Higher limits weave extra rounds between the three default rounds.
  { start: 1, duration: 2.75 },
  { start: 3.15, duration: 2.85 },
  { start: 5.15, duration: 2.35 }
];
const flecksPerRound = 25;
const sprayOpacity = .8;
const corners = [[0, 0], [0, 1], [1, 0], [1, 1]];

export function createSprayLayer({ texture, data, aperture, uniforms, unit, origin }) {
  const { atlasSize: [atlasWidth, atlasHeight], flecks, regions } = data;
  const geometry = new BufferGeometry();
  const trajectories = flecks.map(({ region }, index) => {
    const { direction: [directionX, directionY], delay } = regions[region];
    const round = rounds[Math.floor(index / flecksPerRound)];
    return {
      directionX, directionY,
      start: round.start + delay * .34 + (index % 7) * .035,
      duration: round.duration + (index % 5) * .11
    };
  });
  const positions = new Float32Array(flecks.length * 12);
  const coverage = new Float32Array(flecks.length * 4);
  const uvs = new Float32Array(flecks.length * 8);
  const indices = [];
  for (const [index, { tile: [x, y, width, height] }] of flecks.entries()) {
    for (const [corner, [u, v]] of corners.entries()) {
      // A transparent texel around the isolated source shape keeps its
      // printed antialiasing when the sprite is projected onto the scene.
      uvs.set([(x - 1 + u * (width + 2)) / atlasWidth,
        1 - (y - 1 + v * (height + 2)) / atlasHeight], index * 8 + corner * 2);
    }
    const start = index * 4;
    indices.push(start, start + 1, start + 2, start + 2, start + 1, start + 3);
  }
  geometry.setAttribute("position", new BufferAttribute(positions, 3).setUsage(DynamicDrawUsage));
  geometry.setAttribute("coverage", new BufferAttribute(coverage, 1).setUsage(DynamicDrawUsage));
  geometry.setAttribute("uv", new BufferAttribute(uvs, 2));
  geometry.setIndex(indices);

  const material = new ShaderMaterial({
    uniforms: { ...uniforms, plate: { value: texture } },
    vertexShader: /* glsl */ `
      attribute float coverage;
      varying vec2 artPoint;
      varying vec2 texCoord;
      varying float fleckCoverage;
      void main() {
        artPoint = position.xy * vec2(${unit}.0, -${unit}.0) + vec2(${origin[0]}.0, ${origin[1]}.0);
        texCoord = uv;
        fleckCoverage = coverage;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      ${aperture}
      uniform sampler2D plate;
      varying vec2 texCoord;
      varying float fleckCoverage;
      void main() {
        clipReveal();
        if (outsidePrint() || fleckCoverage <= 0.0) discard;
        vec4 ink = texture2D(plate, texCoord);
        if (ink.a < 0.002) discard;
        gl_FragColor = vec4(ink.rgb / ink.a, ink.a * fleckCoverage);
      }
    `,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    toneMapped: false
  });
  const mesh = new Mesh(geometry, material);
  mesh.name = "spray-motion";
  mesh.frustumCulled = false;
  mesh.renderOrder = 7.8;
  mesh.visible = false;

  function update(seconds, distance, limit) {
    const burst = bursts.findLast((start) => start <= seconds);
    const elapsed = seconds - burst;
    let active = 0;
    mesh.visible = false;
    if (distance === 0 || !Number.isFinite(elapsed)) return active;
    for (let index = 0; index < limit; index++) {
      const { anchor, tile: [, , width, height] } = flecks[index];
      const { start, duration, directionX, directionY } = trajectories[index];
      const phase = (elapsed - start) / duration;
      const fade = Math.min(1, phase * 4, (1 - phase) * 7);
      coverage.fill(Math.max(0, fade) * sprayOpacity, index * 4, index * 4 + 4);
      if (fade <= 0) continue;
      active++;
      const reach = distance * (.68 + (index % 11) * .032);
      const lift = Math.sin(Math.PI * phase);
      const drift = lift * Math.sin(2 * Math.PI * phase) * .17;
      const dx = reach * (directionX * lift - directionY * drift);
      const dy = reach * (directionY * lift + directionX * drift);
      const scale = .72 + .35 * (1 - (1 - phase) ** 2);
      const centerX = anchor[0] + width / 4 + dx;
      const centerY = anchor[1] + height / 4 + dy;
      for (const [corner, [u, v]] of corners.entries()) {
        const offset = index * 12 + corner * 3;
        const x = centerX + (u - .5) * (width / 2 + 1) * scale;
        const y = centerY + (v - .5) * (height / 2 + 1) * scale;
        positions[offset] = (x - origin[0]) / unit;
        positions[offset + 1] = (origin[1] - y) / unit;
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

export function sprayOverlayShader(regionCount) {
  return /* glsl */ `
    uniform vec4 regionBoxes[${regionCount}];
    uniform bool sprayActive;

    vec4 sprayOverlay(vec2 p) {
      for (int i = 0; i < ${regionCount}; i++) {
        vec4 box = regionBoxes[i];
        vec2 delta = max(box.xy - p, p - box.zw);
        if (abs(max(delta.x, delta.y)) < 1.6) {
          return sprayActive ? vec4(.65, .18, .075, .98) : vec4(.25, .39, .36, .8);
        }
      }
      return vec4(0.0);
    }
  `;
}
