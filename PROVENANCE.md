# Provenance manifest: Aries Hilton voice dataset → v1.0.2 personal model weights

This file exists so the provenance of the personal model weights in
`model/model-aries.json` is public and auditable: those weights were trained
**only** on the recordings in `dataset/`, made by the person named below.
His data is the weights. Nothing in the training set came from any other
dataset, voice, or synthetic generator.

## The recording session

- **Recorded by:** Aries Hilton (the artist and developer of Beatboxing to MIDI)
- **Date:** October 23, 2026
- **Conditions:** dry recordings, **no presets, no autotune, no effects**,
  made in a rented treated room for clean takes
- **Format as supplied:** 44.1 kHz, 16-bit, stereo WAV, one stem per sound class
- **Consent basis:** these are Aries Hilton's own recordings of his own voice,
  recorded by him for this exact purpose and supplied by him to train his own
  model. The model trained on them is in his likeness because it is made of him.

## The stems (dataset/)

Durations are measured from the files. SHA-256 hashes let anyone verify the
files in this repository are the files the weights were trained from.

| File | Duration | Class (ground truth) | Key / BPM ground truth | SHA-256 |
|---|---|---|---|---|
| bass-c-minor.wav | 56.03 s | bass (pitched vocal bass) | C minor | 8ac23329af5c665dca6cffbbd4c1eb7bf0066c5a736ff8dff183d6cc406e42d1 |
| clicks-120bpm.wav | 52.15 s | click | 120 bpm | b2c9f442c4050cd9b30c1ca89231a661c2ede5122941924a3dbe9b1d45d1cebe |
| closed-hi-hats-120bpm.wav | 34.48 s | closed hat | 120 bpm | 2923a9b8cb6e12509b5628f9ada618f9775ac44f8af258c95cfad6414d64da5c |
| humming-c-minor.wav | 51.96 s | hum (pitched) | C minor | 3861ac164d7a317dcb1d686722e33b6c1b242430eabc2307d8f3801af48e3b29 |
| kicks-120bpm.wav | 47.76 s | kick | 120 bpm | 466f93a82480b3592e2af1f3df27385fcfb851f31ae3afb51730a9d8ff3bbf4a |
| lip-rolls-c-minor.wav | 52.71 s | lip roll (pitched) | C minor | 57c2a3ebbde14ce53f964911dd9294ac3867d59a41c1b73bb262a7a12be4e9fb |
| open-hi-hats-120bpm.wav | 29.56 s | open hat | 120 bpm | 9a38d7127e32b99b4b581fa3801e5cf19832bea3edc276a0656c51095ba79ac0 |
| signature-sfx.wav | 47.09 s | signature SFX | (signature sounds) | d9c518bf4974c8c35df67a3a709eb386bcd812fd50f2addc5273f4ea426e41d6 |
| snare-subtypes-120bpm.wav | 55.52 s | snare (multiple subtypes, one track) | 120 bpm | a8759748b9ea737b9980b5d5873482cb0899fa51d430fad1fb3dd0940b76d79b |
| throat-singing-chromatic.wav | 51.99 s | throat singing / throat bass (pitched) | chromatic | cf74a25080e6811413341dd38d4bd3774d281ed4983d7725b2dafef43133f512 |

Total audio: 479.27 s across 10 stems.

## Chain: stems → events → weights

Anyone can retrace the training from these exact files:

1. **Ingest / segmentation:** each stereo stem is downmixed to mono (channel
   mean; the pipeline is mono by design), peak-normalized, padded 0.2 s, and
   segmented with the shipped app's own onset detection (`analyze()` in
   `src/dsp.js`, spectral flux, sensitivity 1). Each detected event inherits
   its stem's label. Yield: **1,092 events** (bass 96, click 170, closed
   hat 123, hum 63, kick 158, lip roll 97, open hat 51, sfx 138, snare 157,
   throat 39).
2. **Features** (`vec()` in `src/classify.js`): each event becomes the same
   6-feature vector the shipped app uses: spectral centroid, low-band energy,
   high-band energy, zero-crossing rate, YIN clarity, duration.
3. **Label mapping for the shipped weights** (explicit, see
   `docs/training-aries.md` for rationale): kick→kick, snare→snare,
   closed hat + open hat→hat, bass + lip roll→bass, hum + throat→hum,
   click + signature SFX→sfx. Final label set: `[bass, hat, hum, kick,
   snare, sfx]`, exactly the class list in the app's `src/classify.js`.
4. **Training:** the exact recipe of the shipped `train/train.mjs`: z-scored
   6-feature vectors, one hidden layer of 16 tanh units, 400 epochs, seeded
   LCG (seed 1), same learning-rate schedule. The weights are trained on
   **all 1,092 Aries events and nothing else**. No AVP audio, no synthetic
   rows.
5. **Output:** `model/model-aries.json` (4,523 bytes),
   SHA-256 af7351bdf5e1ae3fbfc69609624de02ab9c2699c5c3e4781c430479ffeb830ef.
   Its shape matches `forward()` in `src/model.js` (mu/sd length 6, W1 16×6,
   W2 6×16).

## What is NOT in this training set

- No AVP dataset audio (that trained the v1.0.1 general model in
  `model/model.json`; the comparison numbers live in
  `docs/training-aries.md`).
- No synthetic/generated examples of any class.
- No other person's voice.

The full measured report (held-out protocol, per-class results, cross-checks
against the general model in both directions) is `docs/training-aries.md`.
