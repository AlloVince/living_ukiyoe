import { BufferAttribute, BufferGeometry, DynamicDrawUsage } from "three";

export const defaultCloudStrengths = [.3, 1.5, 1.1, .7, .1, .1];

// Lower seams in print order. The lower clouds share a broad rising mass
// with smaller rolls of their own. Signed wavelengths set travel direction.
const profiles = [
  { rise: 36, wave: 126, rate: 1, offset: .4, glide: 18 },
  { rise: 19, wave: -157, rate: 1, offset: 1.7, glide: -12 },
  { rise: 8, wave: -106, rate: 1, offset: 2.3, glide: -4 },
  { rise: 14, wave: 119, rate: 2, offset: 4.1, glide: 6 },
  { rise: 7, wave: 163, rate: 1, offset: 5.0, glide: 3 },
  { rise: 5, wave: -204, rate: 1, offset: 3.6, glide: -3 },
];
const rowsPerBand = [1, 10, 12, 4, 4, 4, 6, 3];
const fade = (x) => {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
};

export function createCloudMotion(columns, { width, height, unit }) {
  const positions = [];
  const uvs = [];
  const indices = [];
  const rowCount = 1 + rowsPerBand.reduce((sum, rows) => sum + rows, 0);
  const guides = columns.map(([x, ...edges]) => {
    // At the far right the horizon fades out before the last guide.
    // Keep the mesh ordered through that transparent part of the plate.
    edges[5] = Math.max(edges[5], edges[4] + 12);
    return {
      x,
      // The source matte starts at y=18. Seat that paper edge in a
      // fixed strip so the sky cannot move the border in either crop.
      edges: [0, 26, ...edges, height],
      trim: fade((x - 18) / 110) * fade((width - 18 - x) / 110),
      roll: Math.exp(-(((x - 925) / 490) ** 2)),
    };
  });
  const rows = rowsPerBand.flatMap((count, band) => Array.from({ length: count }, (_, step) => {
    const fraction = step / count;
    return { band, fraction, interior: 4 * fraction * (1 - fraction) };
  }));
  rows.push({ band: rowsPerBand.length - 1, fraction: 1, interior: 0 });

  for (const [column, { x, edges }] of guides.entries()) {
    for (const [row, { band, fraction }] of rows.entries()) {
      const y = edges[band] + (edges[band + 1] - edges[band]) * fraction;
      positions.push((x - width / 2) / unit, (height / 2 - y) / unit, 0);
      uvs.push(x / width, 1 - y / height);
      if (column === 0 || row === 0) continue;
      const i = column * rowCount + row;
      indices.push(i - rowCount - 1, i - rowCount, i - 1, i - 1, i - rowCount, i);
    }
  }
  const geometry = new BufferGeometry();
  const points = new BufferAttribute(new Float32Array(positions), 3).setUsage(DynamicDrawUsage);
  geometry.setAttribute("position", points);
  geometry.setAttribute("uv", new BufferAttribute(new Float32Array(uvs), 2));
  geometry.setIndex(indices);

  const offsets = new Float32Array(rowsPerBand.length + 1);
  const strength = Float32Array.from(defaultCloudStrengths);
  let deformed = false;
  function update(phase, amount, visible) {
    // A static frame uses the exact registered positions.
    if (amount === 0) {
      if (deformed) {
        points.array.set(positions);
        points.needsUpdate = true;
        deformed = false;
      }
      return;
    }
    deformed = true;
    const seams = profiles.map((_, i) => {
      if (i === 5 || visible[i + 1] === 0) return strength[i];
      return visible[i] === 0 ? strength[i + 1] : Math.min(strength[i], strength[i + 1]);
    });
    const glides = profiles.map(({ rate, offset, glide }, i) =>
      Math.sin(phase * rate + offset + 1.2) * glide * strength[i] * amount);

    for (let column = 0; column < guides.length; column++) {
      const { x, edges, trim, roll } = guides[column];
      const tide = (Math.sin(phase - x / 205 + 1.25) + .29 * Math.sin(phase * 2 + x / 133))
        * 15 * roll * trim * amount;
      for (let i = 0; i < profiles.length; i++) {
        const { rise, wave, rate, offset } = profiles[i];
        const angle = phase * rate - x / wave + offset;
        const stroke = Math.sin(angle) + .28 * Math.sin(2 * angle + x / 370 - .7);
        const gap = Math.min(edges[i + 2] - edges[i + 1], edges[i + 3] - edges[i + 2]);
        const limit = gap * (i === 0 ? .43 : .35);
        const push = stroke * rise * trim * seams[i] * amount * (.54 + .46 * roll);
        let lift = 0;
        if (i > 0) {
          lift = Math.abs(tide) * seams[i];
          // Keep nearby seams in order even when their controls differ.
          // A held seam can restrain its immediate neighbors, while the
          // rest of the cloud bank retains its own motion.
          for (let j = 1; j < seams.length; j++) {
            const spacing = Math.abs(edges[j + 2] - edges[i + 2]);
            lift = Math.min(lift, Math.abs(tide) * seams[j] + spacing * .27);
          }
        }
        offsets[i + 2] = Math.max(-limit, Math.min(limit, push)) + Math.sign(tide) * lift;
      }
      // The warm seam can approach the cream seam at the far right.
      offsets[2] = Math.min(offsets[2], offsets[3] + (edges[3] - edges[2]) * .54);
      for (let row = 0; row < rows.length; row++) {
        const { band, fraction, interior } = rows[row];
        const index = (column * rowCount + row) * 3;
        const vertical = offsets[band] + (offsets[band + 1] - offsets[band]) * fraction;
        const profile = profiles[band - 1];
        const horizontal = profile ? glides[band - 1] * interior * trim
          * Math.sin(x / profile.wave + band - 1) : 0;
        points.array[index] = positions[index] + horizontal / unit;
        points.array[index + 1] = positions[index + 1] - vertical / unit;
      }
    }
    points.needsUpdate = true;
  }

  return { geometry, strength, update };
}
