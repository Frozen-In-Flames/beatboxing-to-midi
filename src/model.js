// Shared math: z-scoring, k-means (SFX clustering), and the tiny neural net used by the trained model.
export const zs = X => {
  const n = X.length, mu = X[0].map((_, j) => X.reduce((a, v) => a + v[j], 0) / n);
  const sd = mu.map((m, j) => Math.sqrt(X.reduce((a, v) => a + (v[j] - m) ** 2, 0) / n) || 1);
  return X.map(v => v.map((x, j) => (x - mu[j]) / sd[j]));
};
const d2 = (a, b) => a.reduce((s, v, i) => s + (v - b[i]) ** 2, 0);

// Farthest-point init, so results are deterministic. Returns a cluster index per row.
export function kmeans(X, k, iters = 30) {
  const C = [X[0].slice()];
  while (C.length < k) {
    let bi = 0, bd = -1;
    X.forEach((x, i) => { const m = Math.min(...C.map(c => d2(x, c))); if (m > bd) { bd = m; bi = i; } });
    C.push(X[bi].slice());
  }
  let a = [];
  for (let it = 0; it < iters; it++) {
    a = X.map(x => C.reduce((b, c, i) => (d2(x, c) < d2(x, C[b]) ? i : b), 0));
    C.forEach((c, i) => {
      const m = X.filter((_, j) => a[j] === i);
      if (m.length) c.forEach((_, j) => (c[j] = m.reduce((s, x) => s + x[j], 0) / m.length));
    });
  }
  return a;
}

// m = { labels, mu, sd, W1[H][d], b1[H], W2[K][H], b2[K] }
export function forward(m, x) {
  const z = x.map((v, j) => (v - m.mu[j]) / m.sd[j]);
  const h = m.W1.map((w, i) => Math.tanh(w.reduce((a, v, j) => a + v * z[j], m.b1[i])));
  const o = m.W2.map((w, i) => w.reduce((a, v, j) => a + v * h[j], m.b2[i]));
  const mx = Math.max(...o), e = o.map(v => Math.exp(v - mx)), s = e.reduce((a, v) => a + v, 0);
  return { z, h, p: e.map(v => v / s) };
}
export const predict = (m, x) => { const { p } = forward(m, x); return m.labels[p.indexOf(Math.max(...p))]; };
