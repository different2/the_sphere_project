# The Sphere Project — A Learning Journey

This document maps the old folders that used to clutter the workspace onto
branches of this repo, and explains what each stage of the journey actually
was: what the code did, what problem it was wrestling with at the time, and
what survived into the current version.

Everything described below still exists — each stage lives on as a branch,
so you can check out any era and run it.

**A note on authorship:** this project began as a way to learn GLSL through
a free online course. Most of the code along the way was written with
Claude/Gemini/ChatGPT, and a few pieces were adapted from the course
material itself. The journey below is about *understanding* — what each
version did, what problem it was wrestling with, and what carried forward.

## Timeline

| Date (2025) | Folder (original name) | Branch | One-line summary |
|---|---|---|---|
| Aug 7 | `globe` | `experiment-cobe-library` | First success: someone else's globe library |
| Aug 7 | `cobe` | `experiment-cobe-hacked` | Trying to crack that library open |
| Aug 7 | `globejs` | `experiment-raw-webgl` | Building a sphere from scratch, no globe library |
| Aug 9 | `globelearning copy` | `early-sphere-two-sided` | The breakthrough: raymarched dot-sphere |
| Aug 10 | `claudes_globe` | *(same branch)* | Same code + a shareable single-file build |
| Aug 11 | `globelearning` | `seam-debugging` | Fighting the texture-wrap seam |
| Aug 26 | `latest_working_globe` | `midstage-first-textures` | Real images on the sphere at last |
| Aug 13→ | *(this repo, main)* | `main` | GIFs, per-face layouts, text rings, the sphere field |

---

## Stage −1 — Before everything: the Cobe-via-Svelte dead end (Jan 2025)

Months before any of the folders above, the actual first contact: found
**Cobe** (shuding's 5KB WebGL globe) and its official **Svelte example**,
which ran inside an online sandbox with its real dependencies tucked away in
config panels. Created an empty SvelteKit scaffold (`Svelte/globe`,
Jan 20, 2025) to try it locally — and then chased what was actually
underneath instead. Discovery: **Cobe is just a thin wrapper around
Phenomenon**, a low-level WebGL API. Downloaded Phenomenon's source three
days later (`here-s-phenomenon/`, Jan 23, 2025), skipped both Cobe and
Svelte entirely, and learned the underlying library directly.

No code was ever written in that scaffold (it stayed stock boilerplate until
deleted in Aug 2026) — but the detour set the whole route: Phenomenon study →
particle experiments → raw WebGL below. Even the dot-globe look from Stage 0a
was, unknown at the time, Phenomenon doing the rendering under Cobe.

---

## Stage 0a — `experiment-cobe-library` (folder was `globe`, Aug 7)

The very first thing that worked. This uses the **cobe** library (a npm
package by shuding) through Parcel, completely stock:

```js
const globe = createGlobe(canvas, { mapSamples: 16000, ... })
```

A dotted globe with markers on San Francisco and New York, spinning by
advancing `phi += 0.03` every frame. Nothing here is your own shader code —
this was the proof-of-concept: *"a beautiful dot globe is possible in ~30
lines."*

**What it taught:** the look (Fibonacci-lattice dots on a dark sphere)
that the entire project still has today came from this library.

## Stage 0b — `experiment-cobe-hacked` (folder was `cobe`, Aug 7)

Same day, but this time the cobe library's **source code was pasted
directly into the project** (`index.js` is the whole library, with its
internal `GLSLX_NAME_*` identifiers intact). `main.js` tries to feed it a
custom fragment shader and texture by injecting globals
(`window.GLSLX_SOURCE_MAIN = ...`) that the library expects its build step
to have filled in.

Honest status: **this probably never ran** — `main.js` imports
`./shader.glsl` and `./texture.jpg`, neither of which exists in the folder.
It reads like an attempt to reverse-engineer how cobe worked by pulling it
apart rather than reading docs.

**What it taught:** how the library actually renders (one fullscreen quad,
raymarch-style math in the fragment shader, no 3D mesh at all) — the key
insight borrowed for everything that followed.

## Stage 0c — `experiment-raw-webgl` (folder was `globejs`, Aug 7)

Third experiment the same day: forget globes, learn **raw WebGL**. A real
icosphere *mesh* (from `primitive-icosphere`) rendered through the tiny
Phenomenon WebGL helper, with hand-written vertex/fragment shaders and
hand-rolled matrix math (`perspective`, `lookAt`, `rotateY` all written out
by hand in `main.js`). The result is a plain orange-lit rotating ball.

**What it taught:** what WebGL actually is underneath — attributes,
uniforms, mat4 multiplication — which later made the shader work readable.

> Worth keeping around: the hand-rolled `mat4.lookAt` / `perspective`
> utilities. The current project inherits Phenomenon's fixed camera; if you
> ever want free camera control these functions are ready-made.

---

## Stage 1 — `early-sphere-two-sided` (folders were `globelearning copy`
and `claudes_globe`, Aug 9–10)

The breakthrough. Combining stage 0b's insight (fullscreen quad, math in
the fragment shader) with cobe's visual style, rebuilt from scratch: a
sphere defined only by `r = 0.8`, found per-pixel via
`sqrt(r² − uv²)` — no mesh anywhere. Dots come from
`nearestFibonacciLattice()`, which finds the closest point of a
golden-ratio spiral distribution using a clever bit-unpacking hash of the
golden fraction — this function survives nearly unchanged into today's
shader.

Landmasses are **hardcoded rectangles in latitude/longitude space**
(`if (nlat > 0.25 && nlat < 0.75 && nlon > 0.45...)` draws Africa), plus a
sine-noise wobble. Not a real map — a placeholder proving the coordinate
mapping worked.

Two notable things in this stage:

- **The two-sided loop.** `for (int side = 0; side <= 1; side++)` renders
  the *back* hemisphere as well, flipped, layering both sides into the same
  pixel. The current version dropped this and renders the front face only.
- **`debug()` overlay** — errors and status printed straight into the page.
  This was the pre-devtools workflow and it's why the file starts with a
  giant try/catch.

`claudes_globe` is byte-for-byte the same code plus two extras: a
base64-encoded world-map PNG embedded as `texture.js` (first appearance of
an actual map image in the project), and **`claude.html` — the whole app
bundled into one self-contained file** (library, shaders, styles inline),
presumably generated to share a runnable copy in a chat window.

## Stage 2 — `seam-debugging` (folder was `globelearning`, Aug 11)

A pure diagnostic build. The screen splits down the middle:

- **left half**: `mapColor = vec3(nlon, nlat, 0)` — longitude/latitude
  painted directly as color, making the wraparound **seam** (where
  longitude jumps from 1.0 back to 0.0) visible as a hard line;
- **right half**: `0.5 + 0.5*cos(2π·nlon)` — a cosine blend that is
  naturally seamless, demonstrating the standard fix.

This is the stage where the equirectangular-mapping problem got understood:
why textures wrap wrong at the antimeridian and what continuity requires.

> Worth keeping around: the split-screen A/B comparison itself. It's a
> genuinely good debugging harness — any future texture-mapping question
> ("is this seam fixed?") can reuse it in minutes.

---

## Stage 3 — `midstage-first-textures` (folder was `latest_working_globe`,
Aug 26)

Three weeks of gap, then the leap to real images. The shader gains a
`sampler2D uTexture` uniform, and JavaScript gains a **file upload
handler** — any image off disk can be wrapped onto the sphere. The hardcoded
rectangle-continents and the debug overlay are gone.

The `changes and learnings/` folder in this snapshot is exactly what its
name says — notes from the era:

- `fragmentShader_claude_fix.js` vs `fragmentShader_copilot_fix.js` — the
  same texture-mapping bug fixed two ways by two different AI assistants,
  kept side by side to compare.
- `laughingman.js` — a canvas sketch drawing the Laughing Man logo:
  circular ring of text drawn character-by-character around a circle. This
  is the ancestor of the laughing-man texture that is still this project's
  default today.
- `untitled.glsl` — a downloaded GLSL Sandbox-style shader (with the
  `OES_standard_derivatives` extension) kept as study material.

## Stage 4 → now — `main` (this repo)

Everything after Aug 26 happened directly in this repo (then named
`globe_project`, briefly `latest_working_globe_copy`). See README.md for
the current feature set; the short version of what stage 3 grew into:

- animated **GIF textures**, decoded once and frame-cached
- **per-face layouts** (1/2/3/4/6 copies of an image around the sphere,
  with per-face override slots)
- **text rings** — typed paragraphs wrapped as latitude bands
- crisp-texture vs **Fibonacci-dots** toggle
- dual-axis tumble vs single-axis stand spin, pause + manual sliders
- and finally the **sphere field**: multiple spheres in one shared canvas
  that you can select, drag, re-texture and delete

---

## Where old code beats current code

Things worth remembering exist on those branches:

1. **Two-sided rendering** (`early-sphere-two-sided`) — if you ever want
   see-through or translucent spheres showing the far side, that loop is
   the reference implementation.
2. **Split-screen A/B shader harness** (`seam-debugging`) — reusable
   diagnostic pattern for any future texture question.
3. **Hand-rolled mat4 camera** (`experiment-raw-webgl`) — free camera
   control, ready to lift.
4. **Single-file `claude.html` bundling** (`early-sphere-two-sided`) — the
   easiest way to hand someone a runnable copy of the app with zero setup.
5. **Circular-text generator** (`midstage-first-textures`,
   `changes-and-learnings/laughingman.js`) — general-purpose ring-of-text
   drawing, independent of the sphere.

## Housekeeping notes

- `complete_globe_build/` was **not** part of this journey — it's a
  separate small project (a shader-bundling package with its own
  package.json). `complete globe build/` (with a space) held only a PDF
  shader-math cheat sheet.
- Dates in the table are true last-modified dates of each snapshot's files;
  commits on the branches carry these dates as their author dates, so
  GitHub's history shows the real timeline.

---

## Bug traced: spawned-sphere GIF corruption + "sometimes doesn't move" (Sep 2, 2026)

**Symptom:** uploading a GIF (e.g. the Laughing Man `assets/laughingman.gif`)
to a **spawned sphere** (sphere field) showed the ring text ghosting /
overlapping / "running through itself", sometimes looked like the GIF wasn't
animating. The **main globe** was fine.

**Root cause:** there are **two separate GIF-compositing implementations**,
and they differ in one critical way:

- `main.js` `decodeGifFramesProgressive()` — composites **every** decoded
  frame in sequence onto a persistent canvas, then subsamples the *results*.
  Correct.
- `sphere-field.js` `loadFileOntoFieldSphere()` — subsampled the *input*
  frames first (drew only every Nth patch onto the persistent canvas),
  skipping intermediate frames entirely.

The Laughing Man asset is 240 frames of **partial-canvas delta patches**
(extents like `(0,31,670,645)`, not full 676×676) with **disposal 0** (keep
pixels). Because disposal keeps pixels and patches are partial, skipping
intermediate patches meant their ring-text contributions were never drawn —
old positions persisted (ghosting) and consecutive baked frames could come
out near-identical ("GIF doesn't move sometimes").

**Fix:** rewrote the `sphere-field.js` loop to composite every frame first,
collect all snapshots, *then* subsample to `maxFrames` (40) for baking —
matching the main globe. Verified working.

**Lesson — the duplication to watch for:** this bug existed because the same
GIF-compositing logic lives in two modules (`main.js` and `sphere-field.js`)
as near-duplicates with a subtle behavioral difference. Before touching
either, diff the two implementations or factor the composite-into-frames
logic into one shared helper (e.g. in `face-texture.js`, which both already
import) so this can't drift again.

### Note on Graphify (added same day)

Used Graphify (code knowledge graph) to trace this. Verdict: **great as a
navigation/indexing layer** ("where does this live, what calls what,
architecture overview") but **not a substitute for reading the implementation
for a behavioral bug** — it led the trace toward the main globe first because
that's where the visible call chain pointed, and cannot surface semantic
duplication like the two-compositor split above. Query it for all related
functions *across modules* early to catch parallel-implementation traps.
