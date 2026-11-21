# fif-smf-1 bundles and the fif-ears sidecar

Exports from this app are fif-smf-1 contract files: Standard MIDI File
format 1, PPQ 480, a conductor track named "Tempo" carrying the tempo
meta (0x51) and a time signature meta (0x58) at tick 0, every track
named at tick 0, and channel index 9 reserved for drum classes. The
writer is `buildMidi` in `src/midi.js`; it defaults to 4/4, the meter
of the app grid, and accepts another meter as its third argument.

A bundle adds a `sidecar.json` manifest next to the MIDI file:

```json
{
  "contract": "fif-smf-1",
  "midi": "master.mid",
  "tempo_bpm": 133,
  "tempo_map": [{ "tick": 0, "bpm": 133 }],
  "meter": "4/4",
  "stems": ["../../dataset/kicks-120bpm.wav"],
  "lyrics": null,
  "ears_report": "ears/report.json",
  "provenance": { "tool": "beatboxing-to-midi", "version": "1.0.3" }
}
```

The `stems` list is the normative stem declaration for the bundle. It
names time aligned audio by relative path; audio is referenced, not
copied, when it already lives in this repo under `dataset/`.

## Building the example bundle

```sh
node scripts/make-bundle.mjs
```

This converts `dataset/kicks-120bpm.wav` through the headless path in
`tools/headless.mjs`, writes `examples/fif-smf-1-bundle/master.mid`,
runs fif-ears on the stem, and writes
`examples/fif-smf-1-bundle/ears/report.json` plus the `sidecar.json`
above. Options: `--stem`, `--out`, and `--ears-dir` (or the
`FIF_EARS_DIR` environment variable, or a sibling `../fif-ears`
checkout).

## When there is no mix audio or no fif-ears

The dataset holds single class stems, not a rendered mix. The example
bundle therefore runs fif-ears on the source stem itself, which is the
audio the MIDI was transcribed from. For an export with no audio at
all, or when no fif-ears checkout is available, the script still
writes the bundle and sets `ears_report` to null with an
`ears_status` field recording why. A null report is never replaced by
a fabricated one. The regression suite in `tests/regression.mjs`
asserts the manifest shape either way, and validates the report
against the fields the sidecar relies on whenever one is present.
