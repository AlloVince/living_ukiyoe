// Ukiyo-e V5 constants. Verbatim JS port of the Radio theme's
// `themes/ukiyoe/constants.ts` — the frozen print coordinates and the final
// Demo's default motion values. Do not re-tune.
export const LOOP_SECONDS = 28;
export const TAU = 2 * Math.PI;

export const MASTER_WIDTH = 1400;
export const MASTER_HEIGHT = 957;
export const UNIT = 450;
export const ORIGIN_X = 700;
export const ORIGIN_Y = 480;

export const SKY_GROUP_COUNT = 6;
export const DEFAULT_CLOUD_STRENGTHS = [0.3, 1.5, 1.1, 0.7, 0.1, 0.1];

export const DEFAULT_SPRAY_DISTANCE = 50;
export const DEFAULT_SPRAY_LIMIT = 100;

export const SWELLS = {
  "lower-left": { focus: [474, 598], heading: [0.91, -0.42], stride: 188, rate: 1, offset: 0.2, reach: [7.5, 4.8] },
  "lower-center": { focus: [704, 766], heading: [0.87, 0.49], stride: 155, rate: 1, offset: 2.25, reach: [9, 5.7] },
  "lower-right": { focus: [1140, 842], heading: [-0.94, -0.34], stride: 225, rate: 2, offset: 3.5, reach: [11.5, 5.4] },
  "upper-wave": { focus: [975, 694], heading: [0.93, -0.36], stride: 310, rate: 2, offset: 0.9, reach: [1.5, 1.3] }
};

export const BOATS = [
  { name: "boat-left", carrier: "lower-left", hull: [239, 687], order: 6.15 },
  { name: "boat-near", carrier: "lower-center", hull: [830, 899], order: 6.1 },
  { name: "boat-far", carrier: "upper-wave", hull: [930, 720], order: 4.55 }
];

export const JOINS = [
  { name: "join-hero-left", rear: "hero", front: "lower-left", swell: undefined, order: 5.02 },
  { name: "join-hero-center", rear: "hero", front: "lower-center", swell: undefined, order: 5.021 },
  { name: "join-upper-center", rear: "upper-wave", front: "lower-center", swell: "upper-wave", order: 4.532 },
  { name: "join-upper-right", rear: "upper-wave", front: "lower-right", swell: "upper-wave", order: 4.533 },
  { name: "join-center-left", rear: "lower-center", front: "lower-left", swell: "lower-center", order: 5.934 },
  { name: "join-center-right", rear: "lower-center", front: "lower-right", swell: "lower-center", order: 5.935 },
  { name: "join-left-right", rear: "lower-left", front: "lower-right", swell: "lower-left", order: 6.136 }
];

export const PLATE_WINDOWS = {
  // Owner decision (2026-11-10): the cartouche/signature/seal plate belongs in
  // the final artwork. Window from the lab's plate-windows.json (the Radio
  // migration had stripped it along with the layer itself).
  inscription: [55, 123, 306, 639],
  "boat-left": [98, 898, 700, 1388],
  "boat-near": [1147, 1436, 2270, 1821],
  "boat-far": [1536, 994, 2534, 1458],
  "hero-boat-foam": [64, 1044, 353, 1264],
  "join-hero-left": [28, 1041, 1181, 1499],
  "join-hero-center": [1082, 1093, 1406, 1385],
  "join-upper-center": [1393, 1206, 2772, 1575],
  "join-upper-right": [2572, 1213, 2772, 1406],
  "join-center-left": [985, 1083, 1466, 1892],
  "join-center-right": [1429, 1217, 2772, 1892],
  "join-left-right": [1429, 1867, 1544, 1892],
  // The print's own flecks and spray. Windows copied from the lab's
  // plate-windows.json: Radio's final picture had dropped the layer, so the
  // migration never carried these crops across.
  "sky-spray": [70, 31, 2741, 1386],
  "hero-marks": [93, 501, 1423, 1407],
  "upper-marks": [2618, 1169, 2643, 1191],
  "lower-center-marks": [1096, 1478, 1726, 1677],
  "lower-left-marks": [75, 1173, 1131, 1880]
};
