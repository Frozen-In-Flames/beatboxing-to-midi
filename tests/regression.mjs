// Dataset regression for the fif-smf-1 contract (D4) and the published
// ground truth in PROVENANCE.md.
//
// What runs headless: onset detection, classification with the shipped
// general model, tempo estimation, and the MIDI writer, over every clip
// in dataset/, through tools/headless.mjs (the app.js conversion path
// with the browser pieces replaced). What does not run headless: the
// HPSS layers path and the Basic Pitch path, which need the browser
// runtime (Web Audio decode and ONNX Runtime Web). Everything downstream
// of them is the writer and parser exercised here.
//
// Assertions:
//   1. analyze() event counts per clip equal the PROVENANCE.md chain
//      counts exactly (1,092 events in total).
//   2. Every master export and every per-class export parses as a
//      fif-smf-1 contract file: format 1, PPQ 480, conductor named
//      "Tempo" with tempo (0x51) and time signature (0x58) at tick 0,
//      every track named at tick 0, no lyric metas.
//   3. Drum class notes sit only on channel 9; pitched classes (bass,
//      hum) never sit on channel 9.
//   4. Negative control: a hand-built file with an unnamed conductor
//      and no time signature fails the contract check.
// Class labels and tempo estimates on single-stem clips are reported,
// not asserted: the general model is documented at 39.6% on this voice
// (docs/training-aries.md), and the tempo estimator is documented to
// double on uniform grids (VERIFY.md verdict 2). The numbers printed
// below are the measured regression numbers for this run.
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadClip, convert, loadDefaultModel, contractFailures, channelFailures, parseSmf } from '../tools/headless.mjs';
import { buildMidi } from '../src/midi.js';

const root = new URL('../', import.meta.url);
const datasetDir = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'dataset');

// PROVENANCE.md, chain step 1: events segmented from each stem.
const EXPECTED_EVENTS = {
  'bass-c-minor.wav': 96,
  'clicks-120bpm.wav': 170,
  'closed-hi-hats-120bpm.wav': 123,
  'humming-c-minor.wav': 63,
  'kicks-120bpm.wav': 158,
  'lip-rolls-c-minor.wav': 97,
  'open-hi-hats-120bpm.wav': 51,
  'signature-sfx.wav': 138,
  'snare-subtypes-120bpm.wav': 157,
  'throat-singing-chromatic.wav': 39,
};

loadDefaultModel(root);
const results = new Map();
for (const file of Object.keys(EXPECTED_EVENTS)) {
  results.set(file, convert(loadClip(path.join(datasetDir, file))));
}

test('dataset event counts match PROVENANCE.md exactly', () => {
  let total = 0;
  for (const [file, want] of Object.entries(EXPECTED_EVENTS)) {
    const got = results.get(file).events.length; total += got;
    assert.equal(got, want, `${file}: ${got} events, want ${want}`);
  }
  assert.equal(total, 1092);
});

test('every master and per-class export is a fif-smf-1 contract file', () => {
  for (const [file, r] of results) {
    assert.ok(r.midi, `${file}: no master export`);
    const { failures, smf } = contractFailures(r.midi);
    assert.deepEqual(failures, [], `${file} master: ${failures.join('; ')}`);
    assert.deepEqual(channelFailures(smf, r.tracks.map(t => t.name)), [], `${file} master channels`);
    for (const [name, bytes] of r.perClass) {
      const pc = contractFailures(bytes);
      assert.deepEqual(pc.failures, [], `${file} per-class ${name}: ${pc.failures.join('; ')}`);
      assert.equal(pc.smf.ntrk, 2, `${file} per-class ${name}: conductor plus one track`);
    }
  }
});

test('writer emits the requested meter and defaults to 4/4', () => {
  const t = [{ name: 'kick', channel: 9, notes: [{ time: 0, dur: 0.1, note: 36, vel: 100 }] }];
  const dflt = contractFailures(buildMidi(t, 120));
  assert.deepEqual(dflt.failures, []);
  const seven = contractFailures(buildMidi(t, 120, { numerator: 7, denominator: 8 }), { meter: '7/8' });
  assert.deepEqual(seven.failures, []);
  assert.throws(() => buildMidi(t, 120, { numerator: 4, denominator: 3 }), /bad meter/);
});

test('negative control: unnamed conductor without time signature fails', () => {
  // Hand-built format 1 file in the pre-D4 shape: conductor with only a
  // tempo meta, one unnamed body track.
  const vlq = n => { const b = [n & 127]; while ((n >>= 7)) b.unshift((n & 127) | 128); return b; };
  const chunk = (idS, data) => [...[...idS].map(c => c.charCodeAt(0)), ...(n => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255])(data.length), ...data];
  const trk = evs => chunk('MTrk', [...evs.flatMap(([d, b]) => [...vlq(d), ...b]), 0, 0xff, 0x2f, 0]);
  const old = new Uint8Array([
    ...chunk('MThd', [0, 1, 0, 2, 480 >> 8, 480 & 255]),
    ...trk([[0, [0xff, 0x51, 3, 0x07, 0xa1, 0x20]]]),
    ...trk([[0, [0x99, 36, 100]], [96, [0x89, 36, 0]]]),
  ]);
  const { failures } = contractFailures(old);
  assert.ok(failures.some(f => f.includes('Tempo')), JSON.stringify(failures));
  assert.ok(failures.some(f => f.includes('0x58')), JSON.stringify(failures));
  assert.ok(failures.some(f => f.includes('no name')), JSON.stringify(failures));
});

test('sidecar example bundle matches the fif-smf-1 manifest shape', () => {
  const bundle = new URL('../examples/fif-smf-1-bundle/', import.meta.url);
  const sidecar = JSON.parse(fs.readFileSync(new URL('sidecar.json', bundle), 'utf8'));
  assert.equal(sidecar.contract, 'fif-smf-1');
  for (const k of ['midi', 'tempo_bpm', 'tempo_map', 'meter', 'stems', 'lyrics', 'ears_report', 'provenance']) assert.ok(k in sidecar, `sidecar missing ${k}`);
  assert.equal(sidecar.meter, '4/4');
  assert.ok(Array.isArray(sidecar.stems) && sidecar.stems.length >= 1, 'stems list is normative (D5)');
  assert.equal(sidecar.tempo_map[0].tick, 0);
  assert.equal(sidecar.tempo_map[0].bpm, sidecar.tempo_bpm);
  const master = fs.readFileSync(new URL(sidecar.midi, bundle));
  assert.deepEqual(contractFailures(master).failures, [], 'bundle master is a contract file');
  assert.equal(parseSmf(master).format, 1);
  if (sidecar.ears_report) {
    const report = JSON.parse(fs.readFileSync(new URL(sidecar.ears_report, bundle), 'utf8'));
    assert.equal(report.tool.name, 'fif-ears');
    assert.ok('tempo_bpm' in report.summary && 'key' in report.summary);
    for (const layer of ['signal', 'rhythm', 'structure', 'harmony', 'words', 'events', 'expression']) {
      assert.ok(layer in report.layers, `report missing layer ${layer}`);
      assert.equal(typeof report.layers[layer].status, 'string', `layer ${layer} has no status`);
    }
  }
});

// Measured numbers, printed for the record (not assertions; see header).
for (const [file, r] of results) {
  const counts = {};
  r.events.forEach(e => (counts[e.label] = (counts[e.label] || 0) + 1));
  const notes = r.tracks.reduce((a, t) => a + t.notes.length, 0);
  console.log(`# ${file}: events=${r.events.length} bpm=${r.bpm} classes=${JSON.stringify(counts)} notes=${notes} tracks=${r.tracks.length}`);
}
