// Shared per-version state helpers: validators, delta encoding and the
// declarative control schema consumed by the host panel renderer.
const isObject = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const bool = (x, d) => typeof x === 'boolean' ? x : d;
const number = (x, d, min, max, step) => typeof x === 'number' && Number.isFinite(x) && x >= min && x <= max
  && Math.abs((x - min) / step - Math.round((x - min) / step)) < 1e-6 ? x : d;
const enumeration = (x, d, values) => values.includes(x) ? x : d;

export function makeValidate(spec) {
  return (input) => {
    const d = spec.defaults();
    if (!isObject(input)) return d;
    const out = d;
    for (const [key, rule] of Object.entries(spec.fields ?? {})) {
      if (rule.type === 'bool') out[key] = bool(input[key], d[key]);
      else if (rule.type === 'enum') out[key] = enumeration(input[key], d[key], rule.values);
      else if (rule.type === 'number') out[key] = number(input[key], d[key], rule.min, rule.max, rule.step);
      else if (rule.type === 'flags' && isObject(input[key])) {
        for (const name of Object.keys(d[key])) out[key][name] = bool(input[key][name], d[key][name]);
      } else if (rule.type === 'numbers' && isObject(input[key])) {
        for (const name of Object.keys(d[key])) {
          out[key][name] = number(input[key][name], d[key][name], rule.min, rule.max, rule.step);
        }
      } else if (rule.type === 'array' && Array.isArray(input[key])) {
        for (let i = 0; i < d[key].length; i += 1) {
          const item = input[key]?.[i];
          out[key][i] = rule.bool ? bool(item, d[key][i])
            : number(item, d[key][i], rule.min, rule.max, rule.step);
        }
      }
    }
    return out;
  };
}

function diff(value, defaults) {
  if (Array.isArray(value)) {
    return JSON.stringify(value) === JSON.stringify(defaults) ? undefined : value;
  }
  if (isObject(value)) {
    return Object.fromEntries(Object.keys(defaults).flatMap((k) => {
      const v = diff(value[k], defaults[k]);
      return v === undefined ? [] : [[k, v]];
    }));
  }
  return JSON.stringify(value) === JSON.stringify(defaults) ? undefined : value;
}

/** Delta against the version defaults; empty containers are dropped. */
export function encodeDelta(state, defaults) {
  const delta = diff(state, defaults);
  for (const key of Object.keys(delta)) {
    if (isObject(delta[key]) && !Array.isArray(delta[key]) && !Object.keys(delta[key]).length) delete delta[key];
  }
  return delta;
}

/** Uniform slider/check/select/panel-schema renderer contract (data only). */
export const CONTROL_KINDS = ['check', 'slider', 'select', 'group', 'layers', 'inkLayers', 'phases', 'clouds', 'action', 'note'];
