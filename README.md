# Beatboxing to MIDI (Frozen In Flames Edition)

A static web app that turns a beatbox recording into fully programmed MIDI: the drums apart from the bass apart from the humming apart from all other SFX. You get one MIDI file per sound type (kick, snare, hat, bass, hum, sfx1, sfx2, ...) plus a master file with every track. Everything runs in the browser, so it works on GitHub Pages with no backend and no build step.

## Authorship and version history
Beatboxing to MIDI (Frozen In Flames Edition) was created, designed, and built by Aries Hilton (Frozen In Flames). It is an original work: the onset detection, classification, calibration, layer separation, and MIDI export pipeline was designed and shipped by its author before any third-party transcription component was involved in it.

Dated record:
- v1.0.0, October 2026: first public release.
- v1.0.1, October 2026: built-in classifier retrained on real labeled audio (the AVP dataset, CC-BY-4.0), scoring 60.3% on voices never heard in training.
- v1.0.2, October 2026: the first personal model, trained only on the creator's own voice recordings. The recordings themselves ship in `dataset/` with the audit manifest in `PROVENANCE.md`, so the weights can be traced back to the exact audio they were trained on.
- v1.0.3, October 2026: the Basic Pitch pitched layer. Spotify's Basic Pitch (Apache License 2.0, Copyright 2022 Spotify AB; see `NOTICE.md`) is incorporated as a credited third-party component that proposes sustained bass and hum notes when the user enables "Enhanced pitch". The creator's own pitch tracker keeps pitch bends and glides, and both drum models are unchanged. The component was benchmarked against the existing pipeline before it was incorporated (2026-10-23) and admitted only where it measured better.

## What it does
- Record from the mic (browser voice processing switched off, since it smears hats) or open an audio file.
- Onset detection (spectral flux) finds each sound; per-event features and YIN pitch describe it.
- Classification three ways, in order: your own calibration samples (nearest neighbour), the active built-in model, or built-in rules. Two built-in models ship with the app, and a picker in the Convert section chooses between them: the general model (`model/model.json`) and the Aries personal model (`model/model-aries.json`).
- Layer separation (HPSS) splits a clip into a harmonic layer and a percussive layer, so a hum under hats is tracked as pitch while the hats are detected as drums.
- Enhanced pitch (optional, online): with layer separation on, an "Enhanced pitch" toggle brings in the Basic Pitch model to propose sustained bass and hum notes. It loads on demand at convert time and changes nothing unless you turn it on. Pitch bends and glides still come from the built-in tracker. See the Enhanced pitch section below.
- Pitch bends: a pitch jump over 1 semitone starts a new note; smaller movement stays one note with pitch-bend points (bend range 12 semitones).
- Tempo is detected from the onsets when the Tempo box is left blank, and can snap events to 16th notes.
- Unknown SFX are clustered by timbre into `sfx1`, `sfx2`, and so on, each with its own MIDI note and file. Name a cluster in the page and those sounds become calibration samples and the conversion reruns.
- Drums use General MIDI notes on channel 10. Bass and hum use the detected pitch. Velocity comes from event loudness.

## Run it online
Push to GitHub, then Settings > Pages > deploy from the main branch. `index.html` at the repo root loads `src/app.js`; no build step.

## Run it offline
Download `dist/beatboxing-to-midi-offline.zip` (or zip this repo yourself), unzip it, serve the folder locally, and open it in a browser:

```
cd beatboxing-to-midi-offline
python3 -m http.server
# open http://localhost:8000
```

A local server is required because browsers will not load ES modules from `file://`. By default the app makes no external network requests; the only files it fetches are the classifier model files next to it. The one exception is the Enhanced pitch toggle (online use only): enabling it fetches ONNX Runtime Web from a CDN plus the Basic Pitch model served with the page. In the offline package the toggle simply reports itself unavailable and the built-in pitch tracker is used. See `OFFLINE.md` in the zip for details.

## Built-in models and measured accuracy
Two trained models ship with the app. The picker in the Convert section chooses which one labels your sounds, and the page states which is active. Your own calibration, when present, overrides both. The general model is the default, for the measured reason in the personal model section below: the personal model wins on its own voice and loses on everyone else's, so it is offered as a labeled choice, never swapped in silently.

### General model (v1.0.1, `model/model.json`)
Trained on real labeled beatbox audio, not synthetic examples. Accuracy was measured two ways; both numbers are reported because they answer different questions:

- **Voices the model never heard** (trained on 20 of 25 people, graded on the 5 unseen ones): **60.3% overall** (kick 76.0%, snare 41.7%, hat 61.2%). This is the honest estimate for a brand-new user.
- **Benchmark protocol on the shipped code** (graded on full improvisation takes; those voices were in the training data, the performances were not): **71.9%**.
- **Your own calibration still wins**: teaching it 5 samples per sound scores 74.5% on the same benchmark, so calibrating with your own voice remains the most accurate path.

Full method, confusion counts, and limits: `docs/training-avp.md`.

> The built-in classifier weights in `model/model.json` were trained on the Amateur Vocal Percussion (AVP) dataset by Delgado et al. (2019), available at https://doi.org/10.5281/zenodo.3250230 under the Creative Commons Attribution 4.0 International license (CC-BY-4.0). The dataset provided the kick, snare, and hat training audio; the bass and hum classes were trained on synthetic examples generated for this project. No AVP audio files are distributed with this project; only the trained weights derived from them.

### Personal model (v1.0.2, `model/model-aries.json`)
Trained only on the creator's own voice: 1,092 sounds segmented from the 10 studio stems in `dataset/` (479 s of audio, recorded dry on October 23, 2026, no presets, no autotune). No other voice, no other dataset, and no synthetic example is in it. The full audit chain from recordings to weights is in `PROVENANCE.md`; the full training record is `docs/training-aries.md`.

- **On his held-out sounds** (trained on 80% of the segmented events, graded on the unseen 20%): **62.4% overall** (hat 74.3%, sfx 71.0%, hum 66.7%, kick 53.1%, snare 53.1%, bass 51.3%). The caveat matters: held-out here means unseen events from the same recording session. It is not the same kind of held-out as the general model's unseen-voices figure, and the two numbers should not be read as a head-to-head.
- **The general model grading his sounds on the same held-out events: 39.6%**, and his bass scores **0.0%** (0 of 39). The general model's bass class was trained on synthetic tones; his real vocal bass is a different physical sound, and it reads as kick and hat to that model. The personal model exists because of gaps like this.
- **The tradeoff runs both ways**: the personal model scores **34.1%** on the AVP voices (against the general model's 60.3% participant-held-out there). A model of one mouth is a model of one mouth.
- **Calibration note**: on the creator's own data, few-sample calibration tops out at 49.3% (10 samples per class; 41.6% at 3 and at 5 per class), below the trained personal model's 62.4%. The usual advice that calibration wins was measured on the general model's benchmark; on this voice, the trained model wins. Both results are reported as measured.

## Enhanced pitch (v1.0.3, optional, online)
The built-in pitch tracker (YIN over the HPSS harmonic layer) is good at bends and glides and weak at one measured thing: sustained vocal bass. On the creator's own 56 s bass stem it recovered 10 notes covering 1.5 s; the rest failed its clarity gate, because his bass is a pulse-like sound, not a clean tone. Basic Pitch, a transcription model built for sustained pitched notes, recovered the line. v1.0.3 therefore splits the pitched layer by measured strength:

- **Basic Pitch proposes sustained pitched events** (onset, offset, pitch) when you enable the "Enhanced pitch" toggle. It reads the raw clip, no HPSS needed.
- **The built-in tracker keeps pitch bends and glides.** A note whose bend contour travels (a glide) is kept exactly as the built-in tracker wrote it, and Basic Pitch proposals overlapping it are dropped. Where the two agree on a note, the built-in version wins, because its bend contour is continuous where the model's is stepped.
- **Harmonic-companion suppression.** A voice's upper partials make the model report extra simultaneous notes at harmonic positions of a stronger fundamental; left in, they write a second, wrong melody line into the MIDI. A filter in `src/basicpitch.js` suppresses a note when a strictly stronger note overlaps it in time and it sits within 1 semitone of a harmonic (2nd to 16th) of that stronger note. Measured on the creator's stems, simultaneous harmonic companions went from 2 to 0 (bass), 25 to 0 (hum), and 18 to 0 (throat), at a cost of 2, 25, and 18 notes respectively: bass kept 65 of 67 notes, hum 99 of 124, throat 54 of 72.
- **Thresholds.** The model runs at its library default thresholds (onset 0.5, frame 0.3, minimum note length 127.70 ms), chosen by measurement: on the drums-only negative control (83.6 s of AVP improvisations and hat clicks, where every pitched note is a hallucination), the tuned configuration produces 22 phantom notes, 0.263 per second, at the benched untuned level (0.28/s) and well under the built-in layer's 0.66/s. Every stricter threshold setting tested cost far more real notes than it saved in phantoms (raising the frame threshold to 0.4 cut the bass line's coverage from 17.2 s to 7.3 s).

Measured on the creator's stems, app path, enhanced pitch on: the bass stem yields 65 pitched events covering 16.5 s (the built-in tracker alone: 10 notes); the hum stem 92 pitched events (built-in: 127 notes, cleaner in key but more fragmented); the throat-singing stem 55 (built-in: 85, fragmented). Full protocol and tables: `VERIFY.md`.

The cost is stated plainly: the toggle is an online feature. Turning it on fetches ONNX Runtime Web (about 4 MB) from a CDN and the 228 KB model from this site, on demand, at convert time. Off, or offline, everything behaves exactly as v1.0.2. The model ships unmodified in `model/basic-pitch/nmp.onnx` under its Apache License 2.0 terms; attribution, the courtesy citation, and the license text are in `NOTICE.md` and `model/basic-pitch/LICENSE.basic-pitch.txt`.

## Teach it your sounds (calibration)
Record yourself repeating one sound, pick its name, then "Add clip as samples". Five or more repeats per sound works best. Calibration takes over once it covers at least two different sound types with at least three samples total; until then the trained model or the built-in rules do the labelling. Samples live in your browser's localStorage.

## Train a model
Put labelled WAV files in `data/<label>/` (for example `data/kick/*.wav`, 16-bit PCM) and run:

```
npm run train
```

The script prints training and held-out accuracy and writes `model/model.json`. Commit that file and the app uses it automatically whenever you have not calibrated. Check the licence of any dataset you train on before publishing a model trained on it: public vocal-percussion datasets can supply the audio, but their licences vary.

The `dataset/` folder in this repo is a worked example of a fully published training set: the personal model's audio, the label and key/BPM ground truth for every stem, and a SHA-256 provenance manifest ship together, so anyone can retrain from the same files and compare the resulting weights.

## How it works
A beatbox is one mouth on one channel, so there are no stems to separate. The app finds each sound and classifies it:

1. `src/dsp.js` detects onsets (spectral flux) and measures each sound: spectral centroid, low and high energy, zero crossings, decay length, and pitch (YIN). It also estimates tempo from onset times.
2. `src/layers.js` splits layers (median-filter HPSS) and tracks pitch contours into notes with bends.
3. `src/basicpitch.js` (only when Enhanced pitch is on) runs the Basic Pitch model and decodes its output into sustained pitched-event proposals, with the harmonic-companion filter applied. `src/pitchlayer.js` merges those proposals with the built-in tracker's notes under the boundary described above.
4. `src/classify.js` labels each sound (rules, trained model, or calibration k-NN), and `src/model.js` holds the shared math: z-scoring, k-means for SFX clusters, and the small neural net the trained model uses.
5. `src/midi.js` writes standard MIDI files (format 1, one track per class plus a master).

## Limits
- Snare is the weak class, and the limit is the feature space, not the tuning: the general model fits snare at only 40% even on its own training data, because amateur "pf" snares genuinely overlap hats and kicks in the measured features. Per-user calibration (74.5% on the benchmark) is the current best fix for the general model. The personal model's held-out snare is 53.1% on the creator's voice (up from 41.7% for the general model on unseen voices, and 28.1% for the general model grading his snares), and it is still the weakest drum class: his snare subtypes measure as two opposed families, one kick-like and one hat-like, so the class confuses in both directions.
- Bass and hum ground truth depends on the model. The general model's bass and hum classes rest on synthetic training examples (the AVP dataset contains none), verified by the ground-truth clips in `VERIFY.md` rather than graded real audio. The personal model's bass and hum are trained on real labeled recordings, of exactly one voice.
- Personal model scope: one voice, one session. Its 62.4% held-out figure grades unseen events from the same recordings it trained on; a different day or room is expected to score lower, and other voices score much lower (34.1% on the AVP voices). A second-session validation does not exist yet.
- The personal model's sfx class is a mixed bucket by design: it holds his clicks and his signature sounds, which is where sounds that fit nowhere else also land in its confusion counts.
- Layer separation (HPSS) is slow on long clips, so keep clips under about 30 s.
- A glide inside one note is written as pitch-bend points; a pitch jump over 1 semitone starts a new note.
- Tempo detection reads a uniform 8th-note grid at slow tempos as double tempo (a uniform grid carries no accent information to tell the two apart). Quarter-note patterns are detected exactly.
- Unknown sounds that sit inside a known class's feature range (for example a soft noise burst among snares) are labelled as that class; clearly distinct timbres are the ones that reach the SFX clusters.
- Calibration samples live in your browser's localStorage.
- Enhanced pitch needs an internet connection and downloads about 4 MB of runtime the first time it is used in a session. It is off by default and the offline package does not include it.
- The harmonic-companion filter removes throat-singing overtone melodies along with the model's spurious companions: an overtone line is a real second melody in that technique, but it sits at harmonic positions of a stronger fundamental, which is exactly what the filter suppresses. The built-in tracker path remains available for that material by leaving the toggle off.
- On hum, the enhanced layer's proposals are not uniformly better: the built-in tracker's notes sat in the stated key more often in the gate-2 exam (57.5% versus 49.2% of notes in C minor). The merge treats hum as contested territory (agreement goes to the built-in note), but a hum line the two segment differently follows the proposals.

## Roadmap
An event timeline view, and a second-session validation recording for the personal model.

## License
MIT, Copyright (c) 2026 Aries Hilton. See `LICENSE`.
