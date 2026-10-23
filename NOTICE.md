# Notices and third-party attribution

Beatboxing to MIDI (Frozen In Flames Edition) is an original work by
Aries Hilton (Frozen In Flames), MIT licensed (see `LICENSE`). It
incorporates one third-party component, credited below. The component
was evaluated against the author's existing pipeline in a benchmark
dated 2026-10-23 and incorporated afterward, only where it measured
better. It is a component inside this product, not the origin of it.

---

## Basic Pitch

This product includes Basic Pitch, developed by Spotify AB:

    Copyright 2022 Spotify AB
    https://github.com/spotify/basic-pitch

Licensed under the Apache License, Version 2.0 (the "License"); you may
not use this component except in compliance with the License. You may
obtain a copy of the License at:

    http://www.apache.org/licenses/LICENSE-2.0

The full text of the Apache License, Version 2.0, as distributed with
Basic Pitch, is included in this repository at
`model/basic-pitch/LICENSE.basic-pitch.txt`.

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
implied. See the License for the specific language governing
permissions and limitations under the License.

Component used: the ICASSP 2022 note-transcription model
(`model/basic-pitch/nmp.onnx`, 230,444 bytes, SHA-256
2c3c1d144bfa61ad236e92e169c13535c880469a12a047d4e73451f2c059a0ec),
distributed unmodified. Inference is invoked through the model's
standard ONNX interface from an original JavaScript port of the
model's reference decoding (framing, output unwrapping, and the
polyphonic note decoder).

Changes made by Frozen In Flames: none to the model or its weights.
Basic Pitch output is consumed as one input to an original processing
pipeline (it proposes sustained pitched events; the product's own
tracker supplies pitch bends and glides, and its classifiers label the
drums). No Spotify code is modified in this integration; the decoding
port is an original implementation written against the model's
published behavior and verified against the reference implementation:
identical note counts on the bass, layered, and glide test material,
and within two notes on the hum and throat-singing stems, a difference
traced to the resampler (see `VERIFY.md`).

Courtesy citation, as requested by the Basic Pitch authors:
Bittner, R. M., et al. "A Lightweight Instrument-Agnostic Model for
Polyphonic Note Transcription and Multipitch Estimation." ICASSP 2022.
https://arxiv.org/abs/2203.09893
