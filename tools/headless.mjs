// Headless transcription path for Node: the same modules and the same
// conversion steps as src/app.js (non-layers path), with the browser-only
// pieces replaced: WAV decoding is a plain 16-bit PCM reader (the same
// reader shape as train/train.mjs) and the signal is peak-normalised and
// padded by 0.2 s at both ends, which is step 1 of the ingest chain in
// PROVENANCE.md. The layers (HPSS) path and the Basic Pitch path are
// browser/runtime features and are not exercised here; everything from
// onset detection onward (analyze, classify, estimateBpm, buildMidi) is
// the shipped code.
import fs from 'node:fs';
import { analyze, estimateBpm } from '../src/dsp.js';
import { classify, setModel, vec } from '../src/classify.js';
import { kmeans, zs } from '../src/model.js';
import { buildMidi, PPQ } from '../src/midi.js';

export const DRUM = { kick: 36, snare: 38, hat: 42 };
export const SFX_NOTES = [39, 56, 54, 70, 69, 75];
export const CH = { bass: 0, hum: 1 };

export function readWav(p) {
  const b = fs.readFileSync(p); let o = 12, ch = 1, sr = 44100, bits = 16, x;
  while (o + 8 <= b.length) {
    const id = b.toString('ascii', o, o + 4), n = b.readUInt32LE(o + 4);
    if (id === 'fmt ') { ch = b.readUInt16LE(o + 10); sr = b.readUInt32LE(o + 12); bits = b.readUInt16LE(o + 22); }
    if (id === 'data') {
      if (bits !== 16) throw new Error(p + ': need 16-bit PCM');
      const m = Math.floor(Math.min(n, b.length - o - 8) / (2 * ch)); x = new Float32Array(m);
      for (let i = 0; i < m; i++) { let s = 0; for (let c = 0; c < ch; c++) s += b.readInt16LE(o + 8 + (i * ch + c) * 2) / 32768; x[i] = s / ch; }
    }
    o += 8 + n + (n & 1);
  }
  if (!x) throw new Error(p + ': no data chunk');
  return { x, sr };
}

export function loadClip(p) {
  const { x, sr } = readWav(p), pk = x.reduce((m, v) => Math.max(m, Math.abs(v)), 0) || 1, pad = Math.round(sr * 0.2);
  const y = new Float32Array(x.length + 2 * pad); x.forEach((v, i) => (y[pad + i] = v / pk));
  return { x: y, sr, padS: pad / sr };
}

let modelLoaded = false;
export function loadDefaultModel(rootUrl) {
  if (modelLoaded) return;
  const m = JSON.parse(fs.readFileSync(new URL('model/model.json', rootUrl)));
  setModel('avp', m); modelLoaded = true;
}

// Mirrors run() in src/app.js with layer separation off and quantization off.
// Returns { events, bpm, tracks, midi (Uint8Array master), perClass: Map name -> Uint8Array }.
export function convert(clip) {
  const vel = r => Math.min(127, Math.max(20, Math.round(r * 160)));
  const hits = analyze(clip.x, clip.sr, 1).map(e => ({ ...e, label: classify(e.f, []) }));
  const drums = [], voiced = [];
  for (const h of hits) {
    if (h.label in CH) { const p = h.f.pitch; voiced.push({ t: h.t, dur: h.f.dur, label: h.label, vel: vel(h.f.rms), bends: [], note: p ? Math.round(69 + 12 * Math.log2(p / 440)) : h.label === 'bass' ? 36 : 60 }); }
    else drums.push(h);
  }
  const times = [...drums.map(h => h.t), ...voiced.map(n => n.t)].sort((a, b) => a - b);
  if (!times.length) return { events: hits, bpm: null, tracks: [], midi: null, perClass: new Map() };
  const bpm = estimateBpm(times), t0 = times[0];
  const by = {}, add = (k, n) => (by[k] ||= []).push(n), sfx = drums.filter(h => h.label === 'sfx');
  drums.filter(h => h.label !== 'sfx').forEach(h => add(h.label, { time: h.t - t0, dur: 0.1, note: DRUM[h.label] ?? 39, vel: vel(h.f.rms) }));
  voiced.forEach(n => add(n.label, { time: n.t - t0, dur: n.dur, note: Math.min(127, Math.max(0, n.note)), vel: n.vel, bends: [] }));
  const groups = [];
  if (sfx.length) {
    const k = sfx.length < 2 ? 1 : Math.min(5, Math.max(1, Math.round(Math.sqrt(sfx.length / 2)))), a = kmeans(zs(sfx.map(h => vec(h.f))), k);
    for (let i = 0; i < k; i++) groups.push(sfx.filter((_, j) => a[j] === i));
  }
  groups.forEach((g, i) => g.forEach(h => add(`sfx${i + 1}`, { time: h.t - t0, dur: 0.1, note: SFX_NOTES[i], vel: vel(h.f.rms) })));
  const tracks = Object.entries(by).map(([name, notes]) => ({ name, channel: CH[name] ?? 9, bendRange: name in CH ? 12 : 0, notes }));
  const perClass = new Map(tracks.map(t => [t.name, buildMidi([t], bpm)]));
  return { events: hits, bpm, tracks, midi: buildMidi(tracks, bpm), perClass };
}

// Minimal struct-level SMF parser (no dependencies), used to assert the
// fif-smf-1 contract on generated files.
export function parseSmf(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let o = 0;
  const id = () => { const s = String.fromCharCode(...u8.slice(o, o + 4)); o += 4; return s; };
  const u32 = () => { const v = u8[o] * 2 ** 24 + u8[o + 1] * 2 ** 16 + u8[o + 2] * 2 ** 8 + u8[o + 3]; o += 4; return v; };
  const u16 = () => { const v = u8[o] * 256 + u8[o + 1]; o += 2; return v; };
  if (id() !== 'MThd') throw new Error('missing MThd');
  const hlen = u32(), format = u16(), ntrk = u16(), division = u16(); o += hlen - 6;
  const tracks = [];
  for (let t = 0; t < ntrk; t++) {
    if (id() !== 'MTrk') throw new Error('missing MTrk');
    const len = u32(), end = o + len, events = []; let tick = 0, status = 0;
    const vlq = () => { let v = 0, b; do { b = u8[o++]; v = v * 128 + (b & 127); } while (b & 128); return v; };
    while (o < end) {
      tick += vlq(); const b = u8[o];
      if (b === 0xff) { o++; const type = u8[o++], n = vlq(), data = [...u8.slice(o, o + n)]; o += n; events.push({ tick, kind: 'meta', type, data }); status = 0; }
      else if (b === 0xf0 || b === 0xf7) { o++; const n = vlq(); o += n; status = 0; }
      else {
        if (b & 0x80) { status = b; o++; }
        const hi = status & 0xf0, ch = status & 0x0f, d1 = u8[o++];
        const d2 = (hi === 0xc0 || hi === 0xd0) ? null : u8[o++];
        events.push({ tick, kind: 'midi', status: hi, channel: ch, d1, d2 });
      }
    }
    o = end; tracks.push(events);
  }
  return { format, ntrk, division, tracks };
}

// Asserts every fif-smf-1 contract clause that applies to a beatbox export.
// Returns a list of failure strings (empty when the file is a contract file).
export function contractFailures(bytes, { meter = '4/4' } = {}) {
  const f = [], smf = parseSmf(bytes);
  if (smf.format !== 1) f.push(`format ${smf.format}, want 1`);
  if (smf.division !== PPQ) f.push(`division ${smf.division}, want ${PPQ}`);
  const [num, den] = meter.split('/').map(Number);
  const name = ev => ev && ev.type === 0x03 ? String.fromCharCode(...ev.data) : null;
  const metaAt = (evs, type, tick) => evs.find(e => e.kind === 'meta' && e.type === type && e.tick === tick);
  const cond = smf.tracks[0] || [];
  if (name(metaAt(cond, 0x03, 0)) !== 'Tempo') f.push('conductor not named "Tempo" at tick 0');
  const tempo = metaAt(cond, 0x51, 0);
  if (!tempo) f.push('conductor has no tempo meta 0x51 at tick 0');
  const ts = metaAt(cond, 0x58, 0);
  if (!ts) f.push('conductor has no time signature meta 0x58 at tick 0');
  else if (ts.data[0] !== num || ts.data[1] !== Math.log2(den)) f.push(`time signature ${ts.data[0]}/${2 ** ts.data[1]}, want ${meter}`);
  if (tempo && ts) { const bpm = 6e7 / (tempo.data[0] * 65536 + tempo.data[1] * 256 + tempo.data[2]); if (!(bpm > 0)) f.push('tempo value invalid'); }
  smf.tracks.forEach((evs, i) => {
    if (!metaAt(evs, 0x2f, Math.max(...evs.map(e => e.tick), 0)) && !evs.some(e => e.kind === 'meta' && e.type === 0x2f)) f.push(`track ${i} has no end of track meta`);
    if (i > 0 && !name(metaAt(evs, 0x03, 0))) f.push(`track ${i} has no name at tick 0`);
    for (const e of evs) if (e.kind === 'meta' && e.type === 0x05) f.push(`track ${i} emits a lyric meta 0x05, reserved by the contract`);
  });
  return { failures: f, smf };
}

// In a master export, drum classes live on channel 9 and pitched classes
// (bass, hum) never do. Checks note-on events per track name.
export function channelFailures(smf, trackNames) {
  const f = [];
  smf.tracks.forEach((evs, i) => {
    if (i === 0) return;
    const nm = trackNames[i - 1];
    for (const e of evs) {
      if (e.kind !== 'midi' || e.status !== 0x90 || e.d2 === 0) continue;
      if ((nm === 'bass' || nm === 'hum') && e.channel === 9) f.push(`pitched track ${nm} has a note on channel 9`);
      if (!(nm === 'bass' || nm === 'hum') && e.channel !== 9) f.push(`drum class track ${nm} has a note on channel ${e.channel}`);
    }
  });
  return f;
}
