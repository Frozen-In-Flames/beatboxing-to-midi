// Trains the small classifier. Usage: node train/train.mjs data
// Data layout: data/<label>/*.wav  (16-bit PCM; single hits or loops of one sound). Writes model/model.json.
import fs from 'node:fs'; import path from 'node:path';
import { analyze } from '../src/dsp.js'; import { vec } from '../src/classify.js'; import { forward } from '../src/model.js';

function wav(p) {
  const b = fs.readFileSync(p); let o = 12, ch = 1, sr = 44100, bits = 16, x;
  while (o + 8 <= b.length) {
    const id = b.toString('ascii', o, o + 4), n = b.readUInt32LE(o + 4);
    if (id === 'fmt ') { ch = b.readUInt16LE(o + 10); sr = b.readUInt32LE(o + 12); bits = b.readUInt16LE(o + 22); }
    if (id === 'data') {
      if (bits !== 16) throw new Error(p + ': need 16-bit PCM');
      const m = Math.floor(Math.min(n, b.length - o - 8) / (2 * ch)); x = new Float32Array(m);
      for (let i = 0; i < m; i++) x[i] = b.readInt16LE(o + 8 + i * 2 * ch) / 32768;
    }
    o += 8 + n + (n & 1);
  }
  return { x, sr };
}

const dir = process.argv[2] || 'data', rows = [];
const labels = fs.readdirSync(dir).filter(d => fs.statSync(path.join(dir, d)).isDirectory()).sort();
labels.forEach((l, y) => fs.readdirSync(path.join(dir, l)).filter(f => /\.wav$/i.test(f)).forEach(f => {
  const { x, sr } = wav(path.join(dir, l, f)), pk = x.reduce((m, v) => Math.max(m, Math.abs(v)), 0) || 1, pad = Math.round(sr * 0.2);
  const y2 = new Float32Array(x.length + 2 * pad); x.forEach((v, i) => (y2[pad + i] = v / pk)); // pad so a hit at t=0 is detected
  analyze(y2, sr).forEach(e => rows.push({ v: vec(e.f), y }));
}));
if (rows.length < 20) throw new Error(`Only ${rows.length} sounds found. Add more labelled audio.`);

let seed = 1; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
rows.sort(() => rnd() - 0.5);
const cut = Math.floor(rows.length * 0.8), tr = rows.slice(0, cut), va = rows.slice(cut), d = rows[0].v.length, H = 16, K = labels.length;
const mu = rows[0].v.map((_, j) => tr.reduce((a, r) => a + r.v[j], 0) / tr.length);
const sd = mu.map((m, j) => Math.sqrt(tr.reduce((a, r) => a + (r.v[j] - m) ** 2, 0) / tr.length) || 1);
const R = (a, b) => Array.from({ length: a }, () => Array.from({ length: b }, () => (rnd() - 0.5) * 0.6));
const m = { labels, mu, sd, W1: R(H, d), b1: Array(H).fill(0), W2: R(K, H), b2: Array(K).fill(0) };

for (let ep = 0; ep < 400; ep++) {
  const lr = 0.05 * (1 - ep / 400) + 0.005; tr.sort(() => rnd() - 0.5);
  for (const { v, y } of tr) {
    const { z, h, p } = forward(m, v), g = p.map((q, i) => q - (i === y ? 1 : 0));
    const dh = h.map((hj, j) => g.reduce((s, gi, i) => s + gi * m.W2[i][j], 0) * (1 - hj * hj));
    g.forEach((gi, i) => { h.forEach((hj, j) => (m.W2[i][j] -= lr * gi * hj)); m.b2[i] -= lr * gi; });
    dh.forEach((dj, j) => { z.forEach((zk, k) => (m.W1[j][k] -= lr * dj * zk)); m.b1[j] -= lr * dj; });
  }
}
const acc = s => s.filter(({ v, y }) => { const p = forward(m, v).p; return p.indexOf(Math.max(...p)) === y; }).length / (s.length || 1);
console.log(`${rows.length} sounds, labels: ${labels.join(', ')}\ntrain ${(acc(tr) * 100).toFixed(1)}%  held-out ${(acc(va) * 100).toFixed(1)}%`);
fs.mkdirSync('model', { recursive: true }); fs.writeFileSync('model/model.json', JSON.stringify(m));
