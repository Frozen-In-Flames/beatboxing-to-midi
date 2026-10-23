import { analyze, estimateBpm } from './dsp.js';
import { classify, setModel, selectModel, activeModelName, vec } from './classify.js';
import { kmeans, zs } from './model.js';
import { hpss, pitchNotes } from './layers.js';
import { buildMidi } from './midi.js';

const $ = id => document.getElementById(id);
const DRUM = { kick: 36, snare: 38, hat: 42 }, SFX = [39, 56, 54, 70, 69, 75], CH = { bass: 0, hum: 1 };
let clip = null, rec = null, cal = [];
try { cal = JSON.parse(localStorage.getItem('bb-cal') || '[]'); } catch {}

// Two built-in models ship with the app; the picker in the Convert section chooses between them.
// The general model is the default: the personal model is trained on one voice only (see README).
const MODEL_LABEL = { avp: 'the general model (AVP)', aries: 'the Aries personal model' };
const MODEL_INFO = {
  avp: 'General model: trained on 25 voices from the AVP dataset. Measured 60.3% on voices it never heard. The safer default for a new voice.',
  aries: "Personal model: trained only on the creator's own voice recordings (the audio ships in this repo; see PROVENANCE.md). Measured 62.4% on his held-out sounds and 34.1% on the AVP voices, so expect it to fit voices like his and miss others.",
};
const showModel = () => {
  const name = activeModelName();
  $('modelsel').value = name;
  $('modelinfo').textContent = MODEL_INFO[name];
  showCal();
};
const fetchModel = (name, url) => fetch(url).then(r => (r.ok ? r.json() : null)).then(m => { if (m) { setModel(name, m); showModel(); } }).catch(() => {});
fetchModel('avp', 'model/model.json');
fetchModel('aries', 'model/model-aries.json');
$('modelsel').onchange = () => { selectModel($('modelsel').value); showModel(); };

const showCal = () => {
  const n = {}; cal.forEach(c => (n[c.label] = (n[c.label] || 0) + 1));
  $('calinfo').textContent = cal.length ? Object.entries(n).map(([k, v]) => `${k} ${v}`).join(', ') : `No samples yet. Using ${MODEL_LABEL[activeModelName()]}.`;
};
const saveCal = () => { try { localStorage.setItem('bb-cal', JSON.stringify(cal)); } catch {} showCal(); };

async function load(buf) {
  const ctx = new AudioContext(), a = await ctx.decodeAudioData(buf); ctx.close();
  const x = Float32Array.from(a.getChannelData(0)), pk = x.reduce((m, v) => Math.max(m, Math.abs(v)), 0) || 1;
  clip = { x: x.map(v => v / pk), sr: a.sampleRate };
  $('status').textContent = `Clip ready: ${(x.length / a.sampleRate).toFixed(1)} s`;
}
$('file').onchange = e => e.target.files[0]?.arrayBuffer().then(load);
$('rec').onclick = async () => {
  if (rec?.state === 'recording') return rec.stop();
  const s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
  const chunks = []; rec = new MediaRecorder(s);
  rec.ondataavailable = e => chunks.push(e.data);
  rec.onstop = async () => { s.getTracks().forEach(t => t.stop()); $('rec').textContent = 'Record'; await load(await new Blob(chunks).arrayBuffer()); };
  rec.start(); $('rec').textContent = 'Stop';
};
$('cal').onclick = () => {
  if (!clip) return ($('status').textContent = 'Record or open a clip first.');
  analyze(clip.x, clip.sr, +$('sens').value).forEach(e => cal.push({ label: $('label').value, f: e.f }));
  saveCal();
};
$('clear').onclick = () => { cal = []; saveCal(); };

function run() {
  if (!clip) return ($('status').textContent = 'Record or open a clip first.');
  const sens = +$('sens').value, vel = r => Math.min(127, Math.max(20, Math.round(r * 160)));
  let hits, voiced = [];
  if ($('layers').checked) { // hats and drums from the percussive layer, hums and bass from the harmonic layer
    const { harm, perc } = hpss(clip.x);
    // The percussive layer carries a faint ripple from the harmonic layer (mask jitter on steady
    // tones), which onset detection reads as tiny hits. Drop events under 8% of the layer's loudest
    // event, the same relative gate pitchNotes applies to pitched frames.
    const raw = analyze(perc, clip.sr, sens), pk = raw.reduce((m, e) => Math.max(m, e.f.rms), 0);
    hits = raw.filter(e => e.f.rms >= 0.08 * pk).map(e => ({ ...e, label: classify({ ...e.f, clarity: 0, pitch: 0 }, cal) }));
    hits.forEach(h => { if (h.label in CH) h.label = 'sfx'; });
    voiced = pitchNotes(harm, clip.sr);
  } else hits = analyze(clip.x, clip.sr, sens).map(e => ({ ...e, label: classify(e.f, cal) }));

  const drums = [];
  for (const h of hits) {
    if (h.label in CH) { const p = h.f.pitch; voiced.push({ t: h.t, dur: h.f.dur, label: h.label, vel: vel(h.f.rms), bends: [], note: p ? Math.round(69 + 12 * Math.log2(p / 440)) : h.label === 'bass' ? 36 : 60 }); }
    else drums.push(h);
  }
  const times = [...drums.map(h => h.t), ...voiced.map(n => n.t)].sort((a, b) => a - b);
  if (!times.length) return ($('status').textContent = 'No sounds found. Try raising sensitivity.');
  const bpm = +$('bpm').value || estimateBpm(times); $('bpm').value = bpm;
  const step = 60 / bpm / 4, t0 = times[0], Q = r => ($('quant').checked ? Math.round(r / step) * step : r);

  const by = {}, add = (k, n) => (by[k] ||= []).push(n), sfx = drums.filter(h => h.label === 'sfx');
  drums.filter(h => h.label !== 'sfx').forEach(h => add(h.label, { time: Q(h.t - t0), dur: 0.1, note: DRUM[h.label] ?? 39, vel: vel(h.f.rms) }));
  voiced.forEach(n => {
    const r = n.t - t0, time = Q(r);
    add(n.label, { time, dur: n.dur, note: Math.min(127, Math.max(0, n.note)), vel: n.vel, bends: n.bends.map(b => ({ time: b.t - t0 + time - r, semis: b.semis })) });
  });
  // Unknown sounds: cluster by timbre, one MIDI note per cluster, and let the user name each cluster.
  const groups = [];
  if (sfx.length) {
    const k = sfx.length < 2 ? 1 : Math.min(5, Math.max(1, Math.round(Math.sqrt(sfx.length / 2)))), a = kmeans(zs(sfx.map(h => vec(h.f))), k);
    for (let i = 0; i < k; i++) groups.push(sfx.filter((_, j) => a[j] === i));
  }
  groups.forEach((g, i) => g.forEach(h => add(`sfx${i + 1}`, { time: Q(h.t - t0), dur: 0.1, note: SFX[i], vel: vel(h.f.rms) })));

  const tracks = Object.entries(by).map(([name, notes]) => ({ name, channel: CH[name] ?? 9, bendRange: name in CH ? 12 : 0, notes }));
  const out = $('out'); out.innerHTML = '';
  [['master', tracks], ...tracks.map(t => [t.name, [t]])].forEach(([name, trk]) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([buildMidi(trk, bpm)], { type: 'audio/midi' }));
    a.download = `${name}.mid`; a.textContent = `${name}.mid`; out.append(a);
  });
  const cl = $('clusters'); cl.innerHTML = '';
  groups.forEach((g, i) => {
    if (!g.length) return;
    const row = document.createElement('div'), sel = document.createElement('select'), b = document.createElement('button');
    sel.innerHTML = ['sfx', 'kick', 'snare', 'hat', 'bass', 'hum'].map(c => `<option>${c}</option>`).join('');
    b.textContent = 'Label these sounds';
    b.onclick = () => { g.forEach(h => cal.push({ label: sel.value, f: h.f })); saveCal(); run(); };
    row.append(`sfx${i + 1}: ${g.length} sounds`, sel, b); cl.append(row);
  });
  $('status').textContent = `${bpm} BPM. ` + tracks.map(t => `${t.name} ${t.notes.length}`).join(', ');
}
$('go').onclick = () => { $('status').textContent = 'Working...'; setTimeout(run, 30); };
showModel();
