// Basic Pitch pitched-event proposer (third-party component, see NOTICE.md).
//
// This module runs Spotify's ICASSP 2022 note-transcription model
// (model/basic-pitch/nmp.onnx, Copyright 2022 Spotify AB, Apache License
// 2.0, used unmodified) and decodes its output with a JavaScript port of
// the model's reference post-processing (framing, unwrapping, and the
// polyphonic note decoder with inferred onsets and the melodia trick).
// The port follows basic-pitch 0.4.0 so the numbers measured against the
// Python reference (see VERIFY.md) carry over.
//
// Role in this app, by design: Basic Pitch proposes sustained pitched
// events (onset, offset, pitch, amplitude). It does not supply pitch
// bends; the built-in YIN contour tracker keeps bends and glides
// (src/pitchlayer.js does the merge). Drum classification never sees it.
//
// The engine loads on demand only: nothing in this file fetches anything
// until createBrowserEngine() is called, and the app calls that only when
// the user enables "Enhanced pitch" and converts. The default path and
// the offline package stay zero-dependency.

export const BP_SR = 22050;
const FFT_HOP = 256;
export const N_SAMPLES = BP_SR * 2 - FFT_HOP; // 43844, one model window
const ANNOT_N_FRAMES = 172; // ANNOTATIONS_FPS (86) * 2 s
const OVERLAP_FRAMES = 30;
const OVERLAP_LEN = OVERLAP_FRAMES * FFT_HOP; // 7680 samples
const HOP_SIZE = N_SAMPLES - OVERLAP_LEN; // 36164
const TRIM = OVERLAP_FRAMES / 2; // frames dropped at each window edge
const MIDI_OFFSET = 21;
const N_BINS = 88;
const MAX_FREQ_IDX = 87;
const ENERGY_TOL = 11;
// Final thresholds, tuned on the drums-only negative control and the
// creator's exam stems (VERIFY.md, v1.0.3): these are the model library's
// own defaults. Every stricter setting measured cost far more real notes
// on the exam stems than it saved in phantom notes, and at these values
// the drums-only phantom rate is 0.275 notes/s, at the benched level of
// the untuned model and under half the YIN layer's 0.66/s.
export const BP_ONSET_THRESH = 0.5;
export const BP_FRAME_THRESH = 0.3;
const MIN_NOTE_LEN = Math.round((127.70 / 1000) * (BP_SR / FFT_HOP)); // 11 frames

// Windowed-sinc resampler (Blackman window, 16-tap half width). Used to
// bring any input sample rate to the model's 22050 Hz.
export function resample(x, srIn, srOut = BP_SR) {
  if (srIn === srOut) return Float32Array.from(x);
  const ratio = srOut / srIn, outLen = Math.round(x.length * ratio), out = new Float32Array(outLen);
  const fc = Math.min(1, ratio), A = 16 / fc;
  for (let j = 0; j < outLen; j++) {
    const t = j / ratio, i0 = Math.max(0, Math.ceil(t - A)), i1 = Math.min(x.length - 1, Math.floor(t + A));
    let sum = 0, wsum = 0;
    for (let i = i0; i <= i1; i++) {
      const d = (t - i) * fc, ph = (t - i) / A;
      const win = 0.42 + 0.5 * Math.cos(Math.PI * ph) + 0.08 * Math.cos(2 * Math.PI * ph); // Blackman
      const s = d === 0 ? 1 : Math.sin(Math.PI * d) / (Math.PI * d);
      const w = fc * s * win;
      sum += x[i] * w; wsum += w;
    }
    // The full kernel's weights sum to 1; normalising by the partial sum
    // keeps the gain exact at the edges, where the kernel is truncated.
    out[j] = wsum ? sum / wsum : 0;
  }
  return out;
}

// Split resampled audio into model windows, exactly as the reference
// implementation does: a half-overlap of leading zeros, then windows of
// N_SAMPLES every HOP_SIZE samples, zero-padded at the tail.
export function windowsFor(x22) {
  const padded = new Float32Array(OVERLAP_LEN / 2 + x22.length);
  padded.set(x22, OVERLAP_LEN / 2);
  const wins = [];
  for (let i = 0; i < padded.length; i += HOP_SIZE) {
    const w = new Float32Array(N_SAMPLES);
    w.set(padded.subarray(i, Math.min(padded.length, i + N_SAMPLES)));
    wins.push(w);
  }
  return wins;
}

// Stitch per-window model outputs back into one (frames x 88) matrix:
// drop TRIM frames at both edges of each window, concatenate, then trim
// to the frame count of the original (unpadded) audio.
export function unwrapOutputs(perWindow, origLen) {
  const total = Math.floor(origLen * (86 / BP_SR));
  const out = new Float32Array(Math.max(0, total) * N_BINS);
  let row = 0;
  for (const w of perWindow) {
    for (let r = TRIM; r < w.frames - TRIM && row < total; r++, row++)
      out.set(w.data.subarray(r * N_BINS, (r + 1) * N_BINS), row * N_BINS);
  }
  return { data: out, frames: Math.min(total, row) };
}

// Frame index to seconds, port of model_frames_to_time (including its
// window-boundary correction term).
export function frameTimes(nFrames) {
  const times = new Float64Array(nFrames);
  const wOff = (FFT_HOP / BP_SR) * (ANNOT_N_FRAMES - N_SAMPLES / FFT_HOP) + 0.0018;
  for (let i = 0; i < nFrames; i++) times[i] = i * (FFT_HOP / BP_SR) - wOff * Math.floor(i / ANNOT_N_FRAMES);
  return times;
}

// The reference decoder: onsets (optionally inferred from frame energy)
// are followed forward until the frame energy at that bin stays below
// the frame threshold for ENERGY_TOL frames; leftover energy is then
// swept up by the melodia trick. frames/onsets are { data, frames }
// matrices of 88 bins. Returns [{ t, dur, note, amp }] in seconds,
// unsorted (the caller sorts), with times already applied.
export function decodeNotes(framesM, onsetsM, onsetThresh = BP_ONSET_THRESH, frameThresh = BP_FRAME_THRESH) {
  const n = framesM.frames, F = framesM.data;
  let O = Float32Array.from(onsetsM.data);
  // Infer onsets from frame differences (n_diff = 2), rescaled to the
  // predicted onsets' maximum, combined by elementwise maximum.
  {
    const diff = new Float32Array(n * N_BINS).fill(Infinity);
    for (let d = 1; d <= 2; d++)
      for (let t = 0; t < n; t++)
        for (let f = 0; f < N_BINS; f++) {
          const v = F[t * N_BINS + f] - (t - d >= 0 ? F[(t - d) * N_BINS + f] : 0);
          if (v < diff[t * N_BINS + f]) diff[t * N_BINS + f] = v;
        }
    for (let i = 0; i < diff.length; i++) if (diff[i] < 0) diff[i] = 0;
    for (let t = 0; t < 2; t++) for (let f = 0; f < N_BINS; f++) diff[t * N_BINS + f] = 0;
    let dMax = 0, oMax = 0;
    for (let i = 0; i < diff.length; i++) if (diff[i] > dMax) dMax = diff[i];
    for (let i = 0; i < O.length; i++) if (O[i] > oMax) oMax = O[i];
    if (dMax > 0) for (let i = 0; i < O.length; i++) { const v = (oMax * diff[i]) / dMax; if (v > O[i]) O[i] = v; }
  }
  // Local maxima of the onset matrix along time (strict, as argrelmax).
  const onsetList = [];
  for (let t = 1; t < n - 1; t++)
    for (let f = 0; f < N_BINS; f++) {
      const v = O[t * N_BINS + f];
      if (v >= onsetThresh && v > O[(t - 1) * N_BINS + f] && v > O[(t + 1) * N_BINS + f]) onsetList.push([t, f]);
    }
  onsetList.sort((a, b) => b[0] - a[0] || b[1] - a[1]); // backwards in time, as the reference iterates
  const rem = Float32Array.from(F), notes = [];
  const zeroSpan = (s, e, f) => {
    for (let t = s; t < e; t++) {
      rem[t * N_BINS + f] = 0;
      if (f < MAX_FREQ_IDX) rem[t * N_BINS + f + 1] = 0;
      if (f > 0) rem[t * N_BINS + f - 1] = 0;
    }
  };
  const ampMean = (s, e, f) => { let a = 0; for (let t = s; t < e; t++) a += F[t * N_BINS + f]; return a / Math.max(1, e - s); };
  for (const [start, f] of onsetList) {
    if (start >= n - 1) continue;
    let i = start + 1, k = 0;
    while (i < n - 1 && k < ENERGY_TOL) { if (rem[i * N_BINS + f] < frameThresh) k++; else k = 0; i++; }
    i -= k;
    if (i - start <= MIN_NOTE_LEN) continue;
    zeroSpan(start, i, f);
    notes.push([start, i, f + MIDI_OFFSET, ampMean(start, i, f)]);
  }
  // Melodia trick: repeatedly take the loudest remaining frame and grow
  // a note around it in both directions, consuming the energy as it goes.
  for (;;) {
    let bi = -1, bv = frameThresh;
    for (let i = 0; i < rem.length; i++) if (rem[i] > bv) { bv = rem[i]; bi = i; }
    if (bi < 0) break;
    const iMid = Math.floor(bi / N_BINS), f = bi % N_BINS;
    rem[bi] = 0;
    let i = iMid + 1, k = 0;
    while (i < n - 1 && k < ENERGY_TOL) {
      if (rem[i * N_BINS + f] < frameThresh) k++; else k = 0;
      rem[i * N_BINS + f] = 0;
      if (f < MAX_FREQ_IDX) rem[i * N_BINS + f + 1] = 0;
      if (f > 0) rem[i * N_BINS + f - 1] = 0;
      i++;
    }
    const iEnd = i - 1 - k;
    i = iMid - 1; k = 0;
    while (i > 0 && k < ENERGY_TOL) {
      if (rem[i * N_BINS + f] < frameThresh) k++; else k = 0;
      rem[i * N_BINS + f] = 0;
      if (f < MAX_FREQ_IDX) rem[i * N_BINS + f + 1] = 0;
      if (f > 0) rem[i * N_BINS + f - 1] = 0;
      i--;
    }
    const iStart = i + 1 + k;
    if (iEnd - iStart <= MIN_NOTE_LEN) continue;
    notes.push([iStart, iEnd, f + MIDI_OFFSET, ampMean(iStart, iEnd, f)]);
  }
  const times = frameTimes(n);
  return notes.map(([s, e, p, a]) => ({ t: times[s], dur: times[e] - times[s], note: p, amp: a })).sort((a, b) => a.t - b.t);
}

// Harmonic-companion suppression. A voice's upper partials make the
// model report extra simultaneous "notes" at harmonic positions of a
// stronger fundamental (octaves, fifths, thirds of the harmonic series).
// Left in, they write a second, wrong melody line into the MIDI (the
// gate-2 exam condition). A note is suppressed when a strictly stronger
// note overlaps it in time and it sits within 1 semitone of a harmonic
// (2nd to 16th) of that stronger note. Single-voice material has no
// true simultaneous pitched lines for this to eat; throat-singing
// overtone melodies are removed by the same rule, a stated limit.
const HARMONIC_OFFSETS = Array.from({ length: 15 }, (_, i) => 12 * Math.log2(i + 2));
export const isHarmonicOffset = d => HARMONIC_OFFSETS.some(h => Math.abs(d - h) <= 1);
export function suppressHarmonics(notes) {
  return notes.filter((b, i) => !notes.some((a, j) => j !== i && a.amp > b.amp &&
    b.t < a.t + a.dur && a.t < b.t + b.dur && isHarmonicOffset(b.note - a.note)));
}

// Full proposal pipeline. runWindow(Float32Array(43844)) must resolve to
// { note: { data, frames }, onset: { data, frames } } for one window.
// Returns { notes, raw }: raw is the decoded list before the harmonic
// filter, notes after it.
export async function proposeNotes(x, sr, runWindow) {
  const x22 = resample(x, sr);
  const wins = windowsFor(x22), perNote = [], perOnset = [];
  for (const w of wins) {
    const out = await runWindow(w);
    perNote.push(out.note); perOnset.push(out.onset);
  }
  const frames = unwrapOutputs(perNote, x22.length), onsets = unwrapOutputs(perOnset, x22.length);
  const raw = decodeNotes(frames, onsets);
  return { notes: suppressHarmonics(raw), raw };
}

// On-demand browser engine: loads ONNX Runtime Web from a CDN and the
// vendored model from this site, only when called. Rejects if either
// fetch fails (no internet, CDN blocked), and the app falls back to the
// built-in pitch tracker with a status note.
const ORT_URL = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/ort.web.bundle.min.mjs';
let browserEngine = null;
export async function createBrowserEngine(modelUrl = 'model/basic-pitch/nmp.onnx') {
  if (browserEngine) return browserEngine;
  const ort = await import(/* @vite-ignore */ ORT_URL);
  const buf = await (await fetch(modelUrl)).arrayBuffer();
  const session = await ort.InferenceSession.create(buf);
  const pick = (out, name) => {
    const t = out[name];
    return { data: t.data, frames: t.dims[1] };
  };
  browserEngine = (x, sr) => proposeNotes(x, sr, async w => {
    const input = new ort.Tensor('float32', w, [1, N_SAMPLES, 1]);
    const out = await session.run({ 'serving_default_input_2:0': input });
    return { note: pick(out, 'StatefulPartitionedCall:1'), onset: pick(out, 'StatefulPartitionedCall:2') };
  });
  return browserEngine;
}
