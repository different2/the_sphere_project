# globe_project

An interactive WebGL globe that wraps a texture (an uploaded image, custom
text, or one of a few presets) around a sphere, rendered either as a crisp
texture or as a Fibonacci-lattice dot pattern.

## Controls

- **Texture** - Laughing Man (default), Earth Map, Text Message, or Upload
  Image.
- **Laughing Man** now plays `assets/laughingman.gif` (with the text ring
  already spinning, baked into its frames) through the exact same
  animated-GIF pipeline as an upload - see "Needs your file" below, this
  asset isn't in the project yet. Falls back to the static
  `assets/laughingman.png` (no animation) if the GIF isn't present, so the
  site works either way. Fetched, decoded and baked once, then cached for
  the rest of the session, so switching back to it after visiting another
  texture is instant.
- **Upload Image** also accepts animated GIFs - drop one in and it
  plays on the globe, looping on its own timing, at whatever Face Count is
  selected. Every frame is decoded and prepared up front (with a brief
  "Preparing frame N/M..." status) so playback itself is just switching
  between ready-made textures - no per-frame decode/re-bake cost while
  it's actually spinning. Long/high-fps GIFs are capped at 60 frames
  (subsampled evenly) to keep that upfront step and GPU memory bounded.
  Per-face override slots don't get their own independent animation - a
  GIF dropped there just shows its first frame as a static image.
- **Your text** *(Text Message mode)* - a full multi-line box now, not just
  one line. Type a paragraph and it word-wraps and auto-sizes to fit; each
  line becomes its own horizontal band/ring around the globe (top line
  near the north, working down). Always uses the full sphere wrap - it
  doesn't use the Faces control below.
- **Faces** *(Upload Image mode only)* - how many times the image appears
  on the sphere: **1** (wraps once around the whole globe, like a world
  map), **2** (front/back), **3** (spaced around the equator), **4** (same
  4 equatorial spots as the 3/6 layouts, no poles), or **6** (the original
  Laughing Man layout: 4 equator + north/south poles). Also drives
  whichever spawned sphere is currently selected in **Spawn a Sphere**
  mode (see below) - each spawned sphere has its own independent Faces
  setting, separate from the main globe's.
- **Per-face** *(Upload Image mode, when Faces > 1)* - a small tile per
  face; click one to give that specific face its own image. Any face left
  untouched just uses the main uploaded image, so this is fully optional -
  upload once and every face matches, or override individual faces for a
  mixed look. Uploading a new main image resets any per-face overrides.
  Same deal for a selected spawned sphere - its face tiles/overrides are
  its own, independent of the main globe and every other spawned sphere.
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
  transparent-background animated GIF and downloads it. If an animated
  GIF is currently uploaded, export captures whichever of its frames
  happens to be showing at the moment you click Export, held static for
  the whole export - it doesn't yet cycle the source GIF's own animation
  during export (a reasonable follow-up if you want it, just not in this
  round).

## Notes

- **Needs your file:** this expects `assets/laughingman.gif` to exist and
  doesn't have it yet - drop your file in at that exact path (or send it
  over and I'll place it) and Laughing Man will animate. Until then it
  runs the static-image fallback, same look as before any of this.
- The shader-based ring rotation from the previous round (uniforms,
  `sampleRingFace()`, the per-frame rebuild in `main()`) has been fully
  removed from `fragmentShader.js` and `main.js` - it wasn't working
  reliably, so rather than leave broken/unused code in place, Laughing
  Man's animation is now entirely GIF-based, same mechanism as an
  uploaded GIF. The one real fix that came out of that attempt (the
  `sample` → `latticeSample` rename below) is kept; everything else from
  it is gone.
- The Earth Map preset's texture data is left exactly as-is in this round
  on request - if you're merging this in, re-apply your own fix to
  `textures.js` for it.
- Face counts other than 1/2/3/4/6 aren't supported yet, but
  `getFaceCenters()` in `face-texture.js` is the one place to extend if
  that's ever needed - everything else just asks it "how many faces and
  where."
- **Fixed:** spawned spheres (**Spawn a Sphere**) couldn't actually show
  more than one image - every upload (whether the main image or a
  per-face tile) just overwrote the whole sphere with a new full wrap,
  so a second image always replaced the first instead of landing on its
  own face, and the Faces/Per-face controls did nothing while a spawned
  sphere was selected. The face-layout math (`getFaceCenters`,
  `generateGlobeTexture`, etc.) was only ever reachable from `main.js`;
  it's now pulled out into its own module, `face-texture.js`, that both
  `main.js` and `sphere-field.js` import, so spawned spheres composite
  per-face images the exact same way the main globe does. Also fixed a
  related bug this surfaced: a static image uploaded onto a sphere that
  was already showing a GIF never actually appeared, since the GIF's
  last frame stayed bound for rendering even after `sphere.texture` was
  updated underneath it.
- Fixed a latent GLSL naming collision in `fragmentShader.js` (a local
  variable was named `sample`, which some GLSL compilers treat as a
  reserved word) - purely a rename, no behavior change.
- **Flagged, not fixed:** `fragmentShader.js`'s `uv = uv * 1.0 - 1.0` (in
  `main()`, computing the screen UV coordinates) looks like it should be
  `* 2.0`, and this predates any of my changes - confirmed via `git diff`
  against the original "adding laughing man" commit. With `* 1.0`, the
  visible globe only occupies about a quarter of the frame, pushed into
  one corner, instead of being centered - confirmed by actually compiling
  and rendering the real shader through a headless WebGL context. Still
  not touched, still out of scope unless you want it done.

## Project structure

- `index.html`, `styles.css` - page and UI.
- `main.js` - WebGL setup, texture generation, controls, GIF export.
- `fragmentShader.js` - the sphere/dots/lighting shader.
- `phenomenon.js` - small WebGL rendering helper library.
- `textures.js` - built-in presets + the text-texture generator.
- `vendor/` - a vendored GIF encoder and decoder (see `vendor/README.md`).