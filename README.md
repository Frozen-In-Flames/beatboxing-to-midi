# Beatboxing to MIDI (Frozen In Flames Edition)

A static web app that turns a beatbox recording into fully programmed MIDI: the drums apart from the bass apart from the humming apart from all other SFX. You get one MIDI file per sound type (kick, snare, hat, bass, hum, sfx1, sfx2, ...) plus a master file with every track. Everything runs in the browser, so it works on GitHub Pages with no backend and no build step.

## What it does
- Record from the mic (browser voice processing switched off, since it smears hats) or open an audio file.
- Onset detection (spectral flux) finds each sound; per-event features and YIN pitch describe it.
- Classification three ways, in order: your own calibration samples (nearest neighbour), a trained model (`model/model.json`) if one is committed, or built-in rules.
- Layer separation (HPSS) splits a clip into a harmonic layer and a percussive layer, so a hum under hats is tracked as pitch while the hats are detected as drums.
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

A local server is required because browsers will not load ES modules from `file://`. The app makes no external network requests; the only file it ever fetches is the optional `model/model.json` next to it. See `OFFLINE.md` in the zip for details.

## Teach it your sounds (calibration)
Record yourself repeating one sound, pick its name, then "Add clip as samples". Five or more repeats per sound works best. Calibration takes over once it covers at least two different sound types with at least three samples total; until then the trained model or the built-in rules do the labelling. Samples live in your browser's localStorage.

## Train a model
Put labelled WAV files in `data/<label>/` (for example `data/kick/*.wav`, 16-bit PCM) and run:

```
npm run train
```

The script prints training and held-out accuracy and writes `model/model.json`. Commit that file and the app uses it automatically whenever you have not calibrated. Check the licence of any dataset you train on before publishing a model trained on it: public vocal-percussion datasets can supply the audio, but their licences vary.

## How it works
A beatbox is one mouth on one channel, so there are no stems to separate. The app finds each sound and classifies it:

1. `src/dsp.js` detects onsets (spectral flux) and measures each sound: spectral centroid, low and high energy, zero crossings, decay length, and pitch (YIN). It also estimates tempo from onset times.
2. `src/layers.js` splits layers (median-filter HPSS) and tracks pitch contours into notes with bends.
3. `src/classify.js` labels each sound (rules, trained model, or calibration k-NN), and `src/model.js` holds the shared math: z-scoring, k-means for SFX clusters, and the small neural net the trained model uses.
4. `src/midi.js` writes standard MIDI files (format 1, one track per class plus a master).

## Limits
- Layer separation (HPSS) is slow on long clips, so keep clips under about 30 s.
- A glide inside one note is written as pitch-bend points; a pitch jump over 1 semitone starts a new note.
- Tempo detection reads a uniform 8th-note grid at slow tempos as double tempo (a uniform grid carries no accent information to tell the two apart). Quarter-note patterns are detected exactly.
- Unknown sounds that sit inside a known class's feature range (for example a soft noise burst among snares) are labelled as that class; clearly distinct timbres are the ones that reach the SFX clusters.
- Calibration samples live in your browser's localStorage.

## Roadmap
An event timeline view and a better pitch tracker for noisy rooms.

## License
MIT, Copyright (c) 2026 Aries Hilton. See `LICENSE`.
