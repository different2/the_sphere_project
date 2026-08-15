# globe_project

An interactive WebGL globe that wraps a texture (an uploaded image, custom
text, or one of a few presets) around a sphere, rendered either as a crisp
texture or as a Fibonacci-lattice dot pattern.

## Controls

- **Texture** - Laughing Man (default), Earth Map, Text Message, or Upload
  Image.
- **Laughing Man's text ring** spins on its own, continuously, while the
  smiley face stays upright - on every visible copy of the logo at once,
  correctly oriented no matter which side of the sphere it's on. Not a
  toggle right now; it's just how Laughing Man looks. Automatically turns
  off (and back on) as you switch texture modes.
- **Your text** *(Text Message mode)* - a full multi-line box now, not just
  one line. Type a paragraph and it word-wraps and auto-sizes to fit; each
  line becomes its own horizontal band/ring around the globe (top line
  near the north, working down). Always uses the full sphere wrap - it
  doesn't use the Faces control below.
- **Faces** *(Upload Image mode only)* - how many times the image appears
  on the sphere: **1** (wraps once around the whole globe, like a world
  map), **2** (front/back), **3** (spaced around the equator), **4** (same
  4 equatorial spots as the 3/6 layouts, no poles), or **6** (the original
  Laughing Man layout: 4 equator + north/south poles).
- **Per-face** *(Upload Image mode, when Faces > 1)* - a small tile per
  face; click one to give that specific face its own image. Any face left
  untouched just uses the main uploaded image, so this is fully optional -
  upload once and every face matches, or override individual faces for a
  mixed look. Uploading a new main image resets any per-face overrides.
- **Fibonacci dots** - toggle between the dotted globe look and a crisp
  direct texture, independent of which texture/face count is active.
- **Spin** - **Randomized** is the original tumbling dual-axis motion;
  **Axis** is a clean single-axis spin, like a globe on a stand - selecting
  it resets the tilt (Theta) to 0 so the poles sit straight up/down, while
  the spin itself (Phi) keeps going without a jump.
- **Pause spin** - stops the automatic rotation so the Phi/Theta sliders
  give full manual control instead of being overwritten every frame.
- **Phi / Theta / Dot Count / Scale** - manual rotation, dot density, and
  size controls (unchanged).
- **Export Loopable GIF** - renders the current globe (whatever
  texture/faces/dots/spin settings are active) as a seamlessly-looping,
  transparent-background animated GIF and downloads it.

## Notes

- The Earth Map preset's texture data is left exactly as-is in this round
  on request - if you're merging this in, re-apply your own fix to
  `textures.js` for it.
- Face counts other than 1/2/3/4/6 aren't supported yet, but
  `getFaceCenters()` in `main.js` is the one place to extend if that's
  ever needed - everything else just asks it "how many faces and where."
- Fixed a latent GLSL naming collision in `fragmentShader.js` (a local
  variable was named `sample`, which some GLSL compilers treat as a
  reserved word) - purely a rename, no behavior change, found while
  setting up real shader-compilation testing for the ring feature below.
- **Flagged, not fixed:** `fragmentShader.js`'s `uv = uv * 1.0 - 1.0` (in
  `main()`, computing the screen UV coordinates) looks like it should be
  `* 2.0`, and this predates any of my changes - confirmed via `git diff`
  against the original "adding laughing man" commit. With `* 1.0`, the
  visible globe only occupies about a quarter of the frame, pushed into
  one corner, instead of being centered - confirmed by actually compiling
  and rendering the real shader through a headless WebGL context. I
  didn't touch it since it's out of scope for what was asked this round,
  but wanted to flag it clearly in case it's not intentional.

## Laughing Man ring geometry

`fragmentShader.js`'s `sampleRingFace()` reprojects the raw
`assets/laughingman.png` per-pixel, at render time, to spin just the
outer text ring while the face stays fixed - see the function's comments
for the full approach. The face/ring boundary (415px from center, in the
logo's own 1090x976 pixel space) and the six face centers/28-degree
angular radius are hardcoded to match this one specific built-in asset -
this isn't a general per-face-image animation system.

## Project structure

- `index.html`, `styles.css` - page and UI.
- `main.js` - WebGL setup, texture generation, controls, GIF export.
- `fragmentShader.js` - the sphere/dots/lighting shader.
- `phenomenon.js` - small WebGL rendering helper library.
- `textures.js` - built-in presets + the text-texture generator.
- `vendor/` - a small vendored GIF encoder (see `vendor/README.md`).
