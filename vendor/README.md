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
