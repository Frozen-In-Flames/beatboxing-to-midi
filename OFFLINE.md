# Running offline

This package is the complete Beatboxing to MIDI (Frozen In Flames Edition) app. It needs no internet connection and no build step.

## Steps
1. Unzip the package.
2. Serve the folder with any static file server, for example:
   ```
   cd beatboxing-to-midi-offline
   python3 -m http.server
   ```
3. Open `http://localhost:8000` in a browser.

## Why the server step is required
The app is written as ES modules (`<script type="module">`). Browsers refuse to load module files from `file://` URLs, so opening `index.html` by double-clicking it will not work. Serving the same folder over local HTTP is the whole fix; nothing is uploaded anywhere.

## What is inside
- `index.html` and `src/`: the app (record or open a clip, convert, download one MIDI per sound type plus a master).
- `model/model.json` and `model/model-aries.json`: the two trained classifiers (general and personal). The app fetches them relative to the page; if both are missing, built-in rules are used instead. A picker in the Convert section chooses between them.
- `PROVENANCE.md`: the audit manifest for the personal model, naming the recordings its weights were trained on and giving a SHA-256 for each one. The recordings themselves live in the `dataset/` folder of the repository; they are not in this zip, so the zip stays small.
- `train/` and `package.json`: the optional training script (`npm run train` with labelled WAVs in `data/<label>/`), for use with Node.js.
- `README.md` and `LICENSE`.

## Network use
None. There are no CDNs, fonts, analytics, or remote calls. The only requests the page makes are the relative `model/model.json` and `model/model-aries.json` from the same folder.
