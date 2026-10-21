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
- `model/model.json`: the trained classifier, if one was committed. The app fetches it relative to the page; if it is missing, built-in rules are used instead.
- `train/` and `package.json`: the optional training script (`npm run train` with labelled WAVs in `data/<label>/`), for use with Node.js.
- `README.md` and `LICENSE`.

## Network use
None. There are no CDNs, fonts, analytics, or remote calls. The only request the page makes is the optional relative `model/model.json` from the same folder.
