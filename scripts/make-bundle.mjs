// Build a fif-smf-1 bundle from one dataset stem:
//   node scripts/make-bundle.mjs [--stem dataset/kicks-120bpm.wav]
//                                [--out examples/fif-smf-1-bundle]
//                                [--ears-dir /path/to/fif-ears]
//
// The bundle holds master.mid (a contract file from the headless
// conversion path in tools/headless.mjs), ears/report.json plus
// report.md when a fif-ears checkout is available, and sidecar.json,
// the fif-smf-1 manifest. The sidecar stems list is the normative stem
// declaration (contract proposal D5); it points at the source stem in
// dataset/ by relative path instead of copying audio into the bundle.
//
// fif-ears is found through --ears-dir, the FIF_EARS_DIR environment
// variable, or a sibling ../fif-ears checkout. When none is available,
// or the run fails, the bundle is still written with ears_report null
// and ears_status recording why; nothing is fabricated.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { loadClip, convert, loadDefaultModel } from '../tools/headless.mjs';

const repo = path.join(path.dirname(new URL(import.meta.url).pathname), '..');
const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : dflt; };
const stemRel = opt('stem', 'dataset/kicks-120bpm.wav');
const outRel = opt('out', 'examples/fif-smf-1-bundle');
const earsDir = opt('ears-dir', process.env.FIF_EARS_DIR || path.join(repo, '..', 'fif-ears'));
const stemAbs = path.join(repo, stemRel), outAbs = path.join(repo, outRel);

loadDefaultModel(new URL('../', import.meta.url));
const r = convert(loadClip(stemAbs));
if (!r.midi) throw new Error(`no sounds found in ${stemRel}`);
fs.mkdirSync(outAbs, { recursive: true });
fs.writeFileSync(path.join(outAbs, 'master.mid'), r.midi);

let earsReport = null, earsStatus = 'not_run: no fif-ears checkout found';
if (fs.existsSync(path.join(earsDir, 'ears', 'cli.py'))) {
  try {
    execFileSync('python3', ['-m', 'ears', 'analyze', stemAbs, '--out', path.join(outAbs, 'ears')],
      { cwd: earsDir, env: { ...process.env, PYTHONPATH: earsDir }, stdio: 'pipe' });
    if (fs.existsSync(path.join(outAbs, 'ears', 'report.json'))) { earsReport = 'ears/report.json'; earsStatus = 'ok'; }
    else earsStatus = 'not_run: fif-ears ran but wrote no report.json';
  } catch (e) { earsStatus = 'not_run: fif-ears run failed: ' + String(e.message).split('\n')[0]; }
}

const pkg = JSON.parse(fs.readFileSync(path.join(repo, 'package.json'), 'utf8'));
const sidecar = {
  contract: 'fif-smf-1',
  midi: 'master.mid',
  tempo_bpm: r.bpm,
  tempo_map: [{ tick: 0, bpm: r.bpm }],
  meter: '4/4',
  stems: [path.relative(outAbs, stemAbs).split(path.sep).join('/')],
  lyrics: null,
  ears_report: earsReport,
  ears_status: earsStatus,
  provenance: { tool: 'beatboxing-to-midi', version: pkg.version, source_audio: stemRel, events: r.events.length, tracks: r.tracks.map(t => t.name) },
};
fs.writeFileSync(path.join(outAbs, 'sidecar.json'), JSON.stringify(sidecar, null, 2) + '\n');
console.log(`wrote ${outRel}/master.mid and ${outRel}/sidecar.json (ears_report: ${earsReport}, ${earsStatus})`);
