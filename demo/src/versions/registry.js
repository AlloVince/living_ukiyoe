// Version registry. Each definition is a self-contained scene factory with
// its own state schema, controls and assets; the host (app/main.js) owns the
// renderer, the RAF loop, sizing, the playback envelope and persistence.
// Historical versions are faithful ports of their original sources and must
// not be merged or "improved" towards each other.
import { definition as v5 } from './v5.js';
import { definition as v4 } from './v4.js';
import { definition as v3 } from './v3.js';
import { definition as v2 } from './v2.js';
import { definition as v1 } from './v1.js';

export const VERSIONS = [v1, v2, v3, v4, v5];
export const DEFAULT_VERSION = 'v5';

export function versionById(id) {
  return VERSIONS.find((definition) => definition.id === id) ?? null;
}
