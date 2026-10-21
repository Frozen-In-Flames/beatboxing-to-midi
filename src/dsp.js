// Zero-dependency DSP: FFT, onset detection, per-event features, YIN pitch.
export function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let b = n >> 1; for (; j & b; b >>= 1) j ^= b; j ^= b;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const a = -2 * Math.PI / len, wr = Math.cos(a), wi = Math.sin(a);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const u = i + k, v = u + len / 2, xr = re[v] * cr - im[v] * ci, xi = re[v] * ci + im[v] * cr;
        re[v] = re[u] - xr; im[v] = im[u] - xi; re[u] += xr; im[u] += xi;
        [cr, ci] = [cr * wr - ci * wi, cr * wi + ci * wr];
      }
    }
  }
}

export const hann = n => Float32Array.from({ length: n }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)));
const W1024 = hann(1024), W2048 = hann(2048);

function spectrum(x, s, N, win) {
  const re = new Float32Array(N), im = new Float32Array(N);
  for (let i = 0; i < N; i++) re[i] = (x[s + i] || 0) * win[i];
  fft(re, im);
  return Float32Array.from({ length: N / 2 }, (_, i) => Math.hypot(re[i], im[i]));
}

// Spectral-flux onset detection with an adaptive threshold. sens > 1 = more sensitive.
export function findOnsets(x, sr, sens = 1) {
  const N = 1024, H = 256, flux = []; let prev = null;
  for (let s = 0; s + N <= x.length; s += H) {
    const m = spectrum(x, s, N, W1024).map(v => Math.log1p(100 * v));
    flux.push(prev ? m.reduce((a, v, i) => a + Math.max(0, v - prev[i]), 0) : 0); prev = m;
  }
  const w = Math.round((0.1 * sr) / H), gap = Math.round((0.05 * sr) / H), out = []; let last = -gap;
  for (let i = 1; i < flux.length - 1; i++) {
    let mean = 0, c = 0;
    for (let j = Math.max(0, i - w); j < Math.min(flux.length, i + w); j++) { mean += flux[j]; c++; }
    if (flux[i] > flux[i - 1] && flux[i] >= flux[i + 1] && flux[i] > (1.5 * mean) / c + 3 / sens && i - last >= gap) {
      out.push((i * H + N / 2) / sr); last = i;
    }
  }
  return out;
}

// YIN pitch estimate for one frame. Returns { f: Hz (0 = none), clarity: 0..1 }.
export function yin(x, s, sr, W = 1024) {
  const t0 = Math.floor(sr / 1000), t1 = Math.floor(sr / 50);
  if (s + W + t1 > x.length) return { f: 0, clarity: 0 };
  const d = new Float32Array(t1 + 1); let run = 0;
  for (let t = 1; t <= t1; t++) {
    let sum = 0; for (let i = 0; i < W; i++) { const df = x[s + i] - x[s + i + t]; sum += df * df; }
    run += sum; d[t] = run ? (sum * t) / run : 1;
  }
  for (let t = t0; t <= t1; t++) if (d[t] < 0.15) { while (t < t1 && d[t + 1] < d[t]) t++; return { f: sr / t, clarity: 1 - d[t] }; }
  return { f: 0, clarity: 0 };
}

// Features for one sound event spanning [t, end] seconds.
export function describe(x, sr, t, end) {
  const s = Math.round(t * sr), e = Math.max(s + 1, Math.min(x.length, Math.round(end * sr)));
  const mag = spectrum(x, s, 2048, W2048), hz = sr / 2048;
  let tot = 1e-9, cs = 0, lo = 0, hi = 0;
  mag.forEach((m, i) => { const p = m * m, f = i * hz; tot += p; cs += p * f; if (f < 200) lo += p; if (f > 4000) hi += p; });
  let zc = 0; for (let i = s + 1; i < e; i++) if (x[i] < 0 !== x[i - 1] < 0) zc++;
  const hop = Math.round(sr * 0.01), env = [];
  for (let i = s; i < e; i += hop) { let a = 0, n = 0; for (let j = i; j < Math.min(e, i + hop); j++, n++) a += x[j] * x[j]; env.push(Math.sqrt(a / n)); }
  const peak = Math.max(...env); let k = env.findIndex((v, i) => i > 0 && v < 0.1 * peak); if (k < 0) k = env.length;
  const fr = [];
  for (let i = 0; i < 4; i++) { const r = yin(x, s + Math.round(0.01 * sr) + i * 512, sr); if (r.f) fr.push(r); }
  return {
    cent: cs / tot / 8000, low: lo / tot, high: hi / tot, zcr: (2 * zc) / (e - s),
    clarity: fr.reduce((a, r) => a + r.clarity, 0) / 4,
    pitch: fr.length ? fr.map(r => r.f).sort((a, b) => a - b)[fr.length >> 1] : 0,
    dur: Math.max(0.05, k * 0.01), rms: peak,
  };
}

export function analyze(x, sr, sens = 1) {
  const ts = findOnsets(x, sr, sens);
  return ts.map((t, i) => ({ t, f: describe(x, sr, t, Math.min(ts[i + 1] ?? Infinity, t + 1, x.length / sr)) }));
}

// Tempo from onset times: how well do onsets line up with a beat, 8th and 16th grid at each candidate BPM (70-180)?
export function estimateBpm(ts) {
  if (ts.length < 4) return 120;
  const c = P => { let a = 0, b = 0; for (const t of ts) { a += Math.cos((2 * Math.PI * t) / P); b += Math.sin((2 * Math.PI * t) / P); } return Math.hypot(a, b) / ts.length; };
  let best = 120, bs = -1;
  for (let b = 70; b <= 180; b += 0.25) { const T = 60 / b, s = c(T) + c(T / 2) + c(T / 4); if (s > bs) { bs = s; best = b; } }
  return Math.round(best * 10) / 10;
}
