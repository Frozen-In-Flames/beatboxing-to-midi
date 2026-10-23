# Beatboxing to MIDI: Aries voice-only retrain (candidate v1.0.2) + Basic Pitch real-voice exam

Date: 2026-10-23. Scope: train a personal model on Aries Hilton's own studio
recordings **only**, grade it honestly, cross-check it against the shipped
AVP-trained model in both directions, and run the Basic Pitch gate-2 exam on
his real pitched voice. This document is the training record for the v1.0.2
release: the weights it recommends shipped as `model/model-aries.json`, and
the recordings it grades ship in `dataset/` with `PROVENANCE.md`.

All training/eval reuses the shipped code paths — `analyze()` / `vec()` from
`src/dsp.js` + `src/classify.js`, the MLP and recipe of `train/train.mjs`
(H=16, 400 epochs, seeded LCG, z-scored 6-feature vectors) — exactly as the
AVP training did. Scripts and raw output: `work/ingest.mjs`,
`work/train-aries.mjs`, `work/train-results.json`, `work/audit.json`.

## 1. Dataset inventory

Recorded by Aries Hilton on Oct 23, 2026, dry, no presets, no autotune, in a
rented treated room. 44.1 kHz / 16-bit / stereo WAV, one stem per class;
labels and key/BPM are his ground truth from the session. Stereo was
downmixed to mono (channel mean) at ingest — the pipeline is mono by design.
(Contrast: `train.mjs`'s own WAV reader would silently have taken the left
channel only.)

| Stem | Duration | Events detected | Events/s | Mean clarity | Mean pitch (describe) |
|---|---|---|---|---|---|
| bass-c-minor.wav (C minor) | 56.03 s | 96 | 1.71 | 0.009 | 9.5 Hz* |
| clicks-120bpm.wav | 52.15 s | 170 | 3.26 | 0.014 | — |
| closed-hi-hats-120bpm.wav | 34.48 s | 123 | 3.57 | 0.000 | — |
| humming-c-minor.wav (C minor) | 51.96 s | 63 | 1.21 | 0.559 | 106.7 Hz |
| kicks-120bpm.wav | 47.76 s | 158 | 3.31 | 0.000 | — |
| lip-rolls-c-minor.wav (C minor) | 52.71 s | 97 | 1.84 | 0.167 | 28.0 Hz* |
| open-hi-hats-120bpm.wav | 29.56 s | 51 | 1.73 | 0.000 | — |
| signature-sfx.wav | 47.09 s | 138 | 2.93 | 0.131 | — |
| snare-subtypes-120bpm.wav | 55.52 s | 157 | 2.83 | 0.001 | — |
| throat-singing-chromatic.wav | 51.99 s | 39 | 0.75 | 0.702 | 81.5 Hz |
| **Total** | **479.27 s** | **1,092** | | | |

Sanity audit: densities are plausible for the material — drum stems at
120 bpm land at 2.8–3.6 events/s (beats plus subdivisions plus the detector's
known ~1.3 splits-per-onset behavior from the AVP extraction), pitched stems
segment more sparsely (0.75–1.84/s) because sustained tones produce few
onsets. Feature means are class-sensible: closed hats are almost pure
high-band energy (mean high 0.958), lip rolls carry the most low-band energy
of any class (0.501), throat and hum are the only high-clarity (voiced)
classes (0.702 / 0.559). *The low "mean pitch" figures for bass and lip roll
are a `describe()` artifact: its short-frame YIN rarely locks on those
pulse-like sounds (clarity 0.009 / 0.167), so most events report pitch 0.
The pitched-layer exam in §5 uses the proper contour tracker instead.

**Class mapping (explicit decision).** The app has no click or lip-roll
class, and a single hat class. Two label spaces were trained:

- **Native (10 classes):** bass, click, hat_closed, hat_open, hum, kick,
  liproll, sfx, snare, throat — his taxonomy as recorded.
- **Collapsed (6 classes, the candidate architecture):** labels
  `[bass, hat, hum, kick, snare, sfx]` — exactly `CLASSES` in
  `src/classify.js`. Mapping: closed + open hat → hat (mirrors the AVP
  treatment); lip roll → bass (it is a pitched sub-bass technique, in C
  minor, with the lowest spectral profile in the set); throat → hum (a
  sustained voiced sound; its clarity 0.702 groups it with hum's 0.559,
  not with the bass stem's pulse-like 0.009); click → sfx (clicks are NOT
  hat-like — mean high-band energy 0.077 vs closed hat's 0.958 — and sfx is
  the app's designated class for signature non-drum sounds); signature
  SFX → sfx.

## 2. Voice-only model: held-out results

Protocol: stratified 80/20 event split (seeded), train on ~80%, grade on the
unseen ~20%. **Read this caveat before the numbers:** events from the same
stem appear on both sides of the split. This measures accuracy on unseen
*events* from these sessions — the only protocol a single voice in a single
session supports — and it will be optimistic relative to a future session on
a different day in a different room. The AVP 60.3% figure, by contrast, was
participant-held-out (whole unseen people). They are not the same kind of
held-out, and this report does not pretend otherwise.

### Collapsed 6-class candidate (221 held-out events)

| | Overall | bass | hat | hum | kick | snare | sfx |
|---|---|---|---|---|---|---|---|
| **Aries MLP (voice-only)** | **62.4%** | 51.3% | 74.3% | 66.7% | 53.1% | **53.1%** | 71.0% |
| Shipped rules (heuristic) | 37.6% | 2.6% | 85.7% | 38.1% | 25.0% | 62.5% | 25.8% |
| k-NN calibration, 3/class | 41.6% | 17.9% | 71.4% | 66.7% | 46.9% | 46.9% | 25.8% |
| k-NN calibration, 5/class | 41.6% | 38.5% | 71.4% | 61.9% | 43.8% | 53.1% | 12.9% |
| k-NN calibration, 10/class | 49.3% | 35.9% | 74.3% | 42.9% | 68.8% | 59.4% | 30.6% |

Confusion shape (held-out): bass leaks to sfx (12 of 39) — lip-roll and bass
events straddle the sfx bucket; kick leaks to sfx (11 of 32); snare leaks to
sfx (10 of 32). The heterogeneous sfx class (clicks + signature sounds) is
the gravity well of this feature space.

**Snare, called out as required:** 53.1% held-out on his own voice, against
41.7% participant-held-out for the AVP model and 28.1% for the shipped model
grading *his* snares (§3). That is a real improvement — roughly +11 points
over the AVP benchmark and +25 over what the shipped model does to him —
and snare is still tied for the weakest drum class here. It is not fixed;
it is less bad, on the voice it was trained on. Honest ceiling note below.

**The calibration surprise:** on AVP, few-shot k-NN calibration (74.5%)
beat the built-in model (71.9%). On Aries's own data the order flips:
k-NN tops out at 49.3% (10/class) against the trained MLP's 62.4%. The
likely mechanism is visible in the per-class rows — with a heterogeneous
sfx class and lip-roll/bass overlap, 3-nearest-neighbour voting in 6
features is too local; the MLP's global boundaries do better. Product
consequence: for this voice, the trained personal model is the better
default, and the "teach it your sounds" flow is the weaker path — the
reverse of the AVP story. Reported as measured, not as preferred.

### Native 10-class model (223 held-out events)

Overall **59.6%**. Per class: hat_closed 88.0%, bass 80.0%, click 76.5%,
throat 62.5%, kick 62.5%, hum 53.8%, liproll 45.0%, snare 43.8%, sfx 39.3%,
hat_open 27.3%. Splitting the hats costs more than it buys at this dataset
size (open hat has only 51 events; 3 of its 11 held-out events go to
hat_closed) — evidence for keeping the app's single hat class in the
candidate. The native model is reported for the record; it is not the
candidate.

### Snare subtypes (clustering check)

The snare stem holds multiple subtypes in one track, unlabeled. Running the
project's own k-means (z-scored features) on the 157 snare events: k=3
yields clusters of **95 / 61 / 1**. The singleton is one voiced outlier
(clarity 0.218 where the rest sit at ~0). The two real families are
timbrally opposed — a dark family (centroid 0.189, low-band 0.236,
high-band 0.086: kick-leaning) and a bright family (centroid 0.476,
high-band 0.391: hat-leaning). k=4 splits a fourth group of 28 longer
sounds (mean duration 0.415 s vs 0.16–0.28 s). Conclusion: his "subtypes"
really are at least two distinct instruments living on opposite sides of
the snare region — which is precisely why snare confuses in both
directions, and why no 6-feature classifier will fully separate a class
whose members imitate kick and hat respectively. The clusters are
reported, not named: without per-subtype labels from Aries, naming them
would be invention.

## 3. Cross-checks: the domain gap, in both directions

Same shipped model file, same Aries held-out events, shared label subset
(bass/hat/hum/kick/snare; 159 events — sfx events excluded because the
shipped model has no sfx output):

| Grader → test | Overall | bass | hat | hum | kick | snare |
|---|---|---|---|---|---|---|
| **Shipped AVP model → Aries held-out** | **39.6%** | **0.0%** | 77.1% | 9.5% | 78.1% | 28.1% |
| Aries model → Aries held-out (§2) | 62.4% | 51.3% | 74.3% | 66.7% | 53.1% | 53.1% |
| **Aries model → AVP held-out participants' drums (809 events)** | **34.1%** | — | 28.4% | — | 40.7% | 37.7% |
| Aries model → all AVP drum rows (3,778 events) | 31.8% | — | 40.0% | — | 26.0% | 21.9% |

- **The shipped model cannot hear his bass at all: 0 of 39.** His real
  vocal bass goes to kick (28) and hat (9). The shipped bass class was
  trained on 20 synthetic sine events; his bass is a different physical
  sound. His hum fares little better (9.5%, mostly read as kick). His
  kick and hat, by contrast, transfer well (78.1% / 77.1%) — drum
  transients are more universal than pitched technique. His held-out sfx
  events (62), which the shipped model must force into its five labels,
  come out kick 32, snare 20, hat 9, bass 1.
- **The personal model does not travel either: 34.1%** on unseen AVP
  voices (vs the AVP model's own 60.3% participant-held-out on that same
  material). A model of one mouth is a model of one mouth. This is the
  personal-vs-general tradeoff measured, not theorized: **+22.8 points on
  his voice, −26.2 points on everyone else's.**
- Pipeline sanity: re-grading the shipped final weights on the AVP
  isolated rows of the "held-out" participants returns 70.0%, not 60.3% —
  because the final shipped model was trained on all 25 participants, so
  those voices are seen for it. The 60.3% participant-held-out figure in
  `docs/training-avp.md` remains the correct unseen-voice number for the
  AVP recipe; 70.0% is a fit-flavored number and is labeled as such here.

## 4. Candidate weights (v1.0.2)

Trained with the same recipe on **all 1,092 Aries events** (the
`final-train.mjs` pattern: after the split experiment, the shipping
candidate trains on everything). Labels `[bass, hat, hum, kick, snare,
sfx]`, 4,523 bytes, SHA-256
af7351bdf5e1ae3fbfc69609624de02ab9c2699c5c3e4781c430479ffeb830ef.
Training fit (on its own data, labeled as fit): **74.1%** overall — bass
76.7%, hat 91.4%, hum 74.5%, sfx 74.7%, kick 67.1%, snare 57.3%. The gap
between fit (74.1%) and the split model's held-out score (62.4%) is the
honest expectation band for new material from the same voice and setup.

## 5. Basic Pitch real-voice exam (gate 2)

Method: both pitched engines ran on identical mono downmixes of his three
pitched stems. Basic Pitch via the bench's ONNX route (library defaults);
the incumbent via the app's own layers path (HPSS → `pitchNotes` YIN
contour). Ground truth is key-level only — C natural minor collection
{C D Eb F G Ab Bb} for hum and bass, chromatic for throat — because no
per-note transcription of his performance exists. Pitch-class-in-collection
is therefore a proxy: it cannot fully separate a performer playing outside
the collection from a tracker misreading. Where both systems independently
produce the same "out-of-scale" pitch classes in near-identical counts,
the evidence points at the source (performance chromaticism and harmonic
content), not at one tracker hallucinating alone. Reported with that limit
attached.

| Clip | System | Notes | Pitched coverage | In C minor | Median note |
|---|---|---|---|---|---|
| Hum (52.0 s) | Basic Pitch | 122 | 47.5 s* | 49.2% | 51 (Eb3) |
| | YIN (incumbent) | 127 | 40.3 s | 57.5% | 52 (E3) |
| Bass (56.0 s) | Basic Pitch | 67 | 17.2 s | 62.7% | 48 (C3) |
| | YIN (incumbent) | 10 | **1.5 s** | 80.0% | 43 (G2) |
| Throat (52.0 s) | Basic Pitch | 70 | 42.8 s | chromatic | 45 (A2) |
| | YIN (incumbent) | 85 | 17.2 s | chromatic | 45 (A2) |

*Basic Pitch coverage can exceed single-voice time because it emits
simultaneous harmonic notes (see below).

**Hum.** A near-tie on segmentation (122 vs 127 notes), both systems
centered on the same 48–52 core. YIN's pitch classes sit in the
collection more often (57.5% vs 49.2%). The dominant out-of-scale class
for *both* is E natural (39 of YIN's notes, 38 of Basic Pitch's), with
C# second (15 vs 21) — agreement that implicates the performance/harmonics
more than either tracker. Basic Pitch additionally emits high harmonic
phantom notes (up to MIDI 93; YIN caps at 76) and simultaneous octave
companions (51+63 pairs), inflating its count and duration.

**Bass — the decisive result.** The incumbent is nearly blind to his
vocal bass through the layers path: 10 notes covering 1.5 s of a 56 s
bass performance (the clarity gate rejects his pulse-like bass, exactly
as the ingest audit foreshadowed). Basic Pitch recovers an actual bass
line: 67 notes, 17.2 s of coverage, median exactly C3, anchored on
repeated C (MIDI 48) — the tonic of the stated key. Its errors are
harmonic companions (64/65 stacks) and scattered chromatic reads
(E 8, C# 10, B 6), not absence. On his bass, this is not close.

**Throat (chromatic).** Both systems agree the performance lives on a
44/45 (Ab2/A2) fundamental for long stretches — median 45 for both.
Distinct fundamental pitch classes: 7 of 12 for each (neither tracker
recovers a full chromatic ladder from the fundamentals; the upper
"notes" both emit — Basic Pitch 56/63/73–75, YIN 63/64/76/77 — are
throat-singing overtones, which are physically real in this technique
and ambiguous as "notes"). Basic Pitch sustains far more coverage
(42.8 s vs 17.2 s; mean note duration 0.612 s vs 0.203 s — YIN fragments
the line), and its stepwise-motion share is comparable (66.7% vs 63.1%
of intervals ≤ 2 semitones), with a smaller mean absolute interval
(6.39 vs 9.08 — YIN leaps to its harmonic notes more).

**Bends.** Both emit bend data (Basic Pitch: 1,486–4,110 bend points per
clip; YIN: 77–2,044). The AVP-era bench already established that Basic
Pitch's bend representation is stepped/saturating while YIN's contour is
continuous and ground-truth-verified on glides; nothing on his voice
overturns that, and his hum/bass lines here are sustained-note material,
not glide material. Speed: Basic Pitch 1.3–1.8 s per ~52 s clip; the
HPSS+YIN path 9.3–10.0 s per clip on this machine.

### Exam verdict

**Gate 2: PASSED, with the agreed boundary intact and one condition.**
On Aries's real voice, Basic Pitch earns the sustained-pitched-event
seat *more* decisively than the synthetic battery suggested — because
the incumbent's weakness turned out to be his bass specifically, where
YIN recovers almost nothing (1.5 s of 56 s) and Basic Pitch recovers
the line. The boundary stands as agreed: **Basic Pitch proposes
sustained pitched events (bass first, hum/throat sustained lines),
YIN keeps pitch bends and sole ownership of glides, drum classification
is untouched.** The condition: Basic Pitch needs a harmonic-companion
filter before integration — its simultaneous octave/overtone notes
(51+63 pairs, MIDI 85–93 phantoms on hum) must be suppressed or the
MIDI gains a second, wrong melody line. On hum alone the incumbent
remains slightly cleaner in-scale (57.5% vs 49.2%); the hybrid should
treat hum as contested territory where YIN's contour arbitrates,
not as a Basic Pitch walkover.

## 6. Ship / no-ship recommendation for v1.0.2

**SHIP — as the Aries personal model, labeled as such; do NOT silently
replace the AVP model as the universal default.**

- For the product's actual story — *his* software, *his* voice — the
  candidate is strictly better on the only voice that story is about:
  62.4% vs 39.6% held-out, bass 51.3% vs 0.0%, snare 53.1% vs 28.1%,
  hum 66.7% vs 9.5%, and it adds a real sfx class the shipped model
  cannot produce.
- As a general model it is *worse* (34.1% vs 60.3% on AVP voices).
  Shipping it as "the improved model" without the personal label would
  be a false claim. Shipping it as "trained entirely on the creator's
  own voice — the dataset and provenance ship with it" is a true claim,
  and the stronger one.
- Recommended packaging: v1.0.2 ships both weight files (AVP general
  model retained, Aries personal model added and defaulted for his
  builds), the release includes the provenance package (10 source stems
  + PROVENANCE.md + candidate weights), and the release notes carry the
  held-out numbers from §2 and the domain-gap numbers from §3 verbatim.
- Known limits that must ship in the notes, not under them: held-out
  here means unseen events from the same sessions; snare remains the
  weak class at 53.1%; the sfx class is a heterogeneous bucket; a
  second-session recording (different day/room) is the obvious next
  validation and does not exist yet.

Artifacts: candidate weights at `model-candidate-v1.0.2.json` (this
folder) and in `release-package/` with `PROVENANCE.md` and the 10 source
stems under `release-package/dataset/`. Release package total:
84,549,699 bytes (~81 MB). No commit, push, tag, or release was made.

## Outcome (added at ship time)

Shipped in v1.0.2 as recommended, with one deliberate difference from the
packaging note above: the personal model is selectable in the app and
clearly labeled, and the AVP general model remains the default for every
user, not only for non-author builds. The numbers argue for exactly that:
the personal model wins on the creator's voice and loses on everyone
else's, so the honest default is the general model and the honest label
is on the picker. The 10 source stems ship in `dataset/`, the manifest
in `PROVENANCE.md`, the weights at `model/model-aries.json`.
