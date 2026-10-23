// Event classifier: rule-based fallback, upgraded to k-NN once the user records calibration samples.
import { predict } from './model.js';

// Two built-in models ship side by side, and the page lets the user pick which one is active.
// 'avp' (model/model.json) is the general model, trained on 25 voices from the AVP dataset.
// 'aries' (model/model-aries.json) is the personal model, trained only on the creator's own
// voice recordings; its training audio ships in dataset/ with PROVENANCE.md. The general
// model stays the default because the personal model is measurably worse on other voices
// (see README). Calibration, when present, overrides either built-in model.
const registry = {};
let activeName = 'avp';
export let model = null;
export function setModel(name, m) {
  registry[name] = m;
  if (name === activeName) model = m;
}
export function selectModel(name) {
  if (registry[name]) { activeName = name; model = registry[name]; }
  return activeName;
}
export const activeModelName = () => activeName;
export const CLASSES = ['kick', 'snare', 'hat', 'bass', 'hum', 'sfx'];
export const vec = f => [f.cent, f.low, f.high, f.zcr, f.clarity, f.dur];

export function heuristic(f) {
  if (f.clarity > 0.6 && f.pitch && f.dur >= 0.2) return f.pitch < 130 ? 'bass' : 'hum';
  if (f.low > 0.5) return 'kick';
  if (f.high > 0.35) return 'hat';
  if (f.cent > 0.15) return 'snare';
  return 'sfx';
}

// cal: [{ label, f }]. Uses z-normalised features and a distance-weighted vote of the 3 nearest samples.
export function classify(f, cal) {
  // Trained model (the active built-in, if loaded) or rules, until calibration covers at least two sound types.
  if (cal.length < 3 || new Set(cal.map(c => c.label)).size < 2) return model ? predict(model, vec(f)) : heuristic(f);
  const V = cal.map(c => vec(c.f)), n = V.length, q = vec(f);
  const mu = q.map((_, j) => V.reduce((a, v) => a + v[j], 0) / n);
  const sd = mu.map((m, j) => Math.sqrt(V.reduce((a, v) => a + (v[j] - m) ** 2, 0) / n) || 1);
  const votes = {};
  V.map((v, i) => [Math.sqrt(v.reduce((a, x, j) => a + ((x - q[j]) / sd[j]) ** 2, 0)), cal[i].label])
    .sort((a, b) => a[0] - b[0]).slice(0, Math.min(3, n))
    .forEach(([d, l]) => (votes[l] = (votes[l] || 0) + 1 / (d + 1e-6)));
  return Object.entries(votes).sort((a, b) => b[1] - a[1])[0][0];
}
