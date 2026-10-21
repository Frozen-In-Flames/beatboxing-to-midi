# Real weights for Beatboxing to MIDI: training report

These weights shipped in v1.0.1: the model described here is the committed
`model/model.json`. This report is the training record for it, preserved
from the staging report written before the swap.

## Headline: accuracy on voices the model never heard

Participant-held-out evaluation (train on 20 of 25 AVP participants, grade on
the 5 unseen participants 5, 10, 16, 22, 28; 809 detected drum events):

| Model | Overall | Kick | Snare | Hat |
|---|---|---|---|---|
| **New real model** | **60.3%** | **76.0%** | 41.7% | **61.2%** |
| Shipped synthetic model (same test set) | 38.2% | 12.2% | 90.2% | 25.5% |

The synthetic model's 90.2% snare is not skill: on real voices it calls most
things snare (of 384 held-out hats it got 98 right and sent 151 to snare; of
221 kicks it sent 78 to snare and 71 to hum). The real model is better
overall and dramatically better on kick and hat, and worse on snare recall
because it no longer uses snare as the default answer.

## Method

- **Data.** Amateur Vocal Percussion dataset (Delgado et al. 2019), Personal
  modality, all 25 participants. Isolated-utterance files map by filename:
  `Kick` to kick, `Snare` to snare, `HHclosed` and `HHopened` both to hat
  (the app has a single hat class). AVP audio is already 44.1 kHz mono 16-bit
  PCM, so no conversion was needed.
- **Extraction** replicates `train/train.mjs` exactly: peak-normalize each
  file, pad 0.2 s, run the app's own `analyze()`, take `vec()` of each
  detected event. Rows extracted: kick 993, snare 946, hat 1,839, plus the
  scaffold's synthetic bass 20 and hum 20, total 3,818. The detector found
  3,778 AVP events against 2,881 annotated onsets (about 1.31 per onset):
  split events carry their file's label, the same treatment `train.mjs`
  gives its own data, and the same splitting the runtime detector produces.
- **Training** replicates `train.mjs`'s recipe exactly (same seeded RNG,
  H=16 hidden units, 400 epochs, same learning-rate schedule, z-scored
  6-feature vectors, labels `[bass, hat, hum, kick, snare]`). The stock
  script was not run directly because it hardcodes a random per-row 80/20
  split (which leaks the same voice into train and test) and writes over
  `model/model.json`. Drivers and raw results:
  `~/workspace/beatbox-to-midi-eval/avp/train-data/`
  (`extract.mjs`, `train-real.mjs`, `final-train.mjs`, `split-results.json`).
- **Two recipes were compared** on the held-out split. A: natural class
  counts. B: bass/hum rows repeated 25x to fight the drum majority. B scored
  worse on unseen voices (56.1% vs 60.3%), so A is the shipped recipe. B did
  fit bass/hum at 100% vs A's 95% (training fit, 40 rows); that did not
  outweigh 4.2 points of real-voice accuracy.

## Label coverage: why bass and hum are in a "real data" model

Read of `src/classify.js`: when a model is loaded and the user has calibrated
fewer than two sound types, **every** event is classified by
`predict(model, ...)`. The model's label list is therefore the app's whole
label space in that mode. A model trained only on AVP drums would have made
bass and hum unreachable without calibration, breaking the non-layered
bass/hum path the shipped app has today. So the real model keeps the shipped
label set exactly: AVP provides real kick/snare/hat, and bass/hum rows are
the scaffold's existing synthetic training files (the same ones the shipped
model learned those classes from). SFX is unaffected either way: no model
label produces it, and its clustering path is unchanged.

## The final model (now the committed `model/model.json`)

Trained with recipe A on **all** 25 participants plus the synthetic bass/hum
rows (3,818 rows). Fit on its own training data, reported as fit and nothing
more: **66.9% overall** (kick 76.6%, snare 40.0%, hat 74.9%, bass 95%,
hum 95%). Training fit sitting close to the held-out score says the gap is
not overfitting; see the snare note under Limits.

Determinism: training is fully seeded. Two independent runs of the final
training produced byte-identical files.

- File: `model.json`, 4,235 bytes
- md5: `52c8936f36492a0a0a49b64491d2fab6`
- Shape matches `forward()` in `src/model.js`: labels
  `[bass, hat, hum, kick, snare]`, mu/sd length 6, W1 16x6, W2 5x16.

## Second benchmark: the shipped code, graded on improvisation

The AVP harness was repointed from the first upload's modules to the shipped
scaffold's `src/` and rerun (25 participants, 1,434 labeled improvisation
onsets, onset recall 99.4% in every configuration). These voices were in the
final model's training data; their improvisation performances were not.

| Configuration (shipped code) | Accuracy | Kick | Snare | Hat |
|---|---|---|---|---|
| Rules only, no model | 40.8% | 2.5% | 22.5% | 84.9% |
| Shipped synthetic model | 32.8% | 4.1% | 79.9% | 33.9% |
| **New real model** | **71.9%** | **80.8%** | 41.7% | **79.6%** |
| k-NN after calibrating 5/class | 74.5% | 77.1% | 53.7% | 78.2% |

Two honest readings: the synthetic model was worse than no model on real
voices, and per-user calibration (74.5%) still edges out the new built-in
model (71.9%), which is exactly the product story the README already tells.
Raw output: `train-data/results-shipped-code.json`.

## Regression check (scaffold copy, model swapped, nothing in the repo touched)

The VERIFY.md ground-truth battery was replicated in Node against a copy of
the scaffold (`regress.mjs`, same code path as `src/app.js`):

- **Layered clip, layers ON (the must-not-break case): PASS, exact.**
  `hat 8, bass 1`; the master MIDI holds exactly 8 hat notes (channel 9,
  note 42) and exactly 1 pitched note, MIDI 45 on channel 0. Identical to
  the shipped model.
- **Layered clip, layers OFF (negative control):** kick 18, hat 6, bass 5
  (shipped: kick 20, hat 6, bass 3). Still the fragmented wrong answer the
  control exists to produce.
- **Glide clip:** hum notes at MIDI 57 and 67 with **126 pitch-bend
  events**, identical to shipped. Percussive extras: kick 3 (shipped:
  kick 2 plus sfx1 1; these are the tone's attack/jump/release
  discontinuities VERIFY.md already documents, not drums in the clip).
- **Owner's Human_SFX 12 s excerpt, layers ON:** hat 60, snare 20, hum 22
  (shipped model: snare 76, hat 3, hum 22, sfx1 1). There are no ground-truth
  labels for this clip, so neither count set is graded; the hum count is
  unchanged and the drum redistribution is the expected direction given the
  synthetic model's measured hat-to-snare confusion on real voices. Flagged
  plainly because the numbers moved: this is the one behavior where "same
  as before" cannot be claimed.
- **MIDI validity:** all 30 files emitted across every scenario and both
  models parse clean under mido (format 1, PPQ 480, exact note on/off
  pairing, notes in range).

## Honest limits

- **Snare is the weak class, and it is a feature limit, not a tuning miss.**
  Held-out 41.7%, and only 40.0% fit even on its own training data: in the
  6-feature space, amateur "pf" snares genuinely overlap hats and kicks, and
  this small net cannot carve them apart. The published reference for this
  technique (Ramires LVT) also has snare as its worst class. Fixing this
  means new features, which is a design change, not a training change.
- **Bass, hum, and SFX have no real labeled ground truth.** AVP contains
  none. Those classes still rest on 20 synthetic events each; their
  real-model behavior is verified only by training fit (95%) and by the
  layered/glide regressions above, not by graded real audio.
- **AVP participants are amateurs.** The owner's own labeled recording
  remains the gold-standard test this model has not been graded against.
- One AVP ground-truth onset carries a code outside the kd/sd/hhc/hho map;
  it appears as an "undefined" row in the harness confusion counts (1 of
  1,434) and is excluded from per-class figures.
- Hat merges closed and open AVP hats into the app's single hat class, by
  design of the app, not the dataset.

## Attribution (this text appears in the README, as these weights shipped)

> The built-in classifier weights in `model/model.json` were trained on the
> Amateur Vocal Percussion (AVP) dataset by Delgado et al. (2019),
> available at https://doi.org/10.5281/zenodo.3250230 under the Creative
> Commons Attribution 4.0 International license (CC-BY-4.0). The dataset
> provided the kick, snare, and hat training audio; the bass and hum classes
> were trained on synthetic examples generated for this project. No AVP
> audio files are distributed with this project; only the trained weights
> derived from them.
