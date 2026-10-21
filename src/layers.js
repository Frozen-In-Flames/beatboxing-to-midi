// Layer separation (harmonic vs percussive) and pitch-contour note tracking.
import { fft, yin, hann } from './dsp.js';
const N = 1024, H = 256, B = N / 2 + 1, K = 8, win = hann(N); // median filters are 2K+1 = 17 taps wide

// Median-filtering HPSS (Fitzgerald 2010): steady tones are smooth along time, clicks and hats along frequency.
// Cost grows with clip length, so keep clips under about 30 s.
export function hpss(x) {
  const nF = Math.max(1, Math.floor((x.length - N) / H) + 1), RE = [], IM = [], M = [], tap = new Float32Array(2 * K + 1);
  for (let f = 0; f < nF; f++) {
    const re = new Float32Array(N), im = new Float32Array(N);
    for (let i = 0; i < N; i++) re[i] = (x[f * H + i] || 0) * win[i];
    fft(re, im); RE.push(re); IM.push(im);
    M.push(Float32Array.from({ length: B }, (_, k) => Math.hypot(re[k], im[k])));
  }
  const med = get => { for (let i = 0; i < tap.length; i++) tap[i] = get(i); return tap.sort()[K]; };
  const harm = new Float32Array(x.length);
  for (let f = 0; f < nF; f++) {
    const m = new Float32Array(B);
    for (let k = 0; k < B; k++) {
      const h = med(i => M[Math.min(nF - 1, Math.max(0, f - K + i))][k]);
      const p = med(i => M[f][Math.min(B - 1, Math.max(0, k - K + i))]);
      m[k] = (h * h) / (h * h + p * p + 1e-12);
    }
    const re = new Float32Array(N), im = new Float32Array(N);
    for (let k = 0; k < N; k++) { const g = m[k < B ? k : N - k]; re[k] = RE[f][k] * g; im[k] = -IM[f][k] * g; }
    fft(re, im); // conjugate trick = inverse FFT; Hann at 75% overlap sums to 2
    for (let i = 0; i < N && f * H + i < x.length; i++) harm[f * H + i] += re[i] / N / 2;
  }
  return { harm, perc: x.map((v, i) => v - harm[i]) };
}

// Tracks pitch every 10 ms. A jump over 1 semitone between frames starts a new note; smaller movement
// (a glide) stays one note and is written as pitch-bend points relative to the note's median pitch.
export function pitchNotes(x, sr) {
  const D = 4, sd = sr / D, xd = new Float32Array(Math.floor(x.length / D)), W = 512, hop = Math.round(sd * 0.01), fr = [];
  for (let i = 0; i < xd.length; i++) { let a = 0; for (let j = 0; j < D; j++) a += x[i * D + j]; xd[i] = a / D; }
  let peak = 1e-9;
  for (let s = 0; s + W <= xd.length; s += hop) {
    let e = 0; for (let i = 0; i < W; i++) e += xd[s + i] ** 2; e = Math.sqrt(e / W); peak = Math.max(peak, e);
    fr.push({ t: (s + W / 2) / sd, e, ...yin(xd, s, sd, W) });
  }
  const notes = []; let cur = null;
  const close = () => {
    if (cur && cur.pts.length >= 6) {
      const st = cur.pts.map(q => q.st).sort((a, b) => a - b), base = Math.round(st[st.length >> 1]), t0 = cur.pts[0].t;
      notes.push({
        t: t0, dur: cur.pts[cur.pts.length - 1].t - t0 + 0.01, note: Math.min(127, Math.max(0, base)),
        vel: Math.min(127, Math.max(20, Math.round((cur.e / peak) * 110))), label: base < 48 ? 'bass' : 'hum',
        bends: cur.pts.filter((_, i) => i % 2 === 0).map(q => ({ t: q.t, semis: Math.max(-12, Math.min(12, q.st - base)) })),
      });
    }
    cur = null;
  };
  for (const p of fr) {
    const ok = p.f > 0 && p.clarity > 0.7 && p.e > 0.05 * peak, st = ok ? 69 + 12 * Math.log2(p.f / 440) : 0;
    if (cur && (!ok || Math.abs(st - cur.pts[cur.pts.length - 1].st) > 1)) close();
    if (ok) { cur ||= { pts: [], e: 0 }; cur.pts.push({ t: p.t, st }); cur.e = Math.max(cur.e, p.e); }
  }
  close();
  return notes;
}
