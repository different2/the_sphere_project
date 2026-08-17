# vendor/

Third-party libraries bundled directly into this project (no build step / npm
install required to run the site).

## gifenc.esm.js

- **What**: a small, dependency-free GIF encoder, used by main.js to power
  the "Export Loopable GIF" button.
- **Source**: https://github.com/mattdesl/gifenc (v1.0.3)
- **License**: MIT (see GIFENC_LICENSE.md in this folder)
- **Modifications**: none, other than removing the trailing
  `//# sourceMappingURL=...` comment (the matching .map file isn't included,
  so the comment would just cause a harmless 404 in devtools).

## gifuct.esm.js

- **What**: a GIF decoder (parses an uploaded .gif into its individual
  frames + per-frame delays), used by main.js to power animated GIF
  uploads on the globe.
- **Source**: https://github.com/matt-way/gifuct-js (v2.1.2), bundled
  together with its one dependency (`js-binary-schema-parser`, also MIT)
  into a single ES module file with esbuild, since the published package
  only ships a CommonJS build and this project has no build step.
- **License**: MIT (see GIFUCT_LICENSE.md in this folder)
- **Exports used**: `parseGIF(arrayBuffer)`, `decompressFrames(parsed, true)`
