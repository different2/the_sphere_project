# globe_project

An interactive WebGL globe that wraps a texture (an uploaded image, custom
text, or one of a few presets) around a sphere, rendered either as a crisp
texture or as a Fibonacci-lattice dot pattern.

## Controls

- **Texture** - Laughing Man (default), Earth Map, Text Message, or Upload
  Image.
- **Your text** *(Text Message mode)* - type anything; it replaces the
  default "HELLO WORLD!" on the globe live as you type.
- **Faces** *(Upload Image / Text Message modes)* - how many times the
  image/text appears on the sphere:
  - **1 (wrap)** - stretched once around the whole globe, like a world map.
  - **2** - two copies, front and back.
  - **3** - three copies spaced evenly around the equator.
- **Fibonacci dots** - toggle between the dotted globe look and a crisp
  direct texture, independent of which texture/face count is active.
- **Spin** - **Randomized** is the original tumbling dual-axis motion;
  **Axis** is a clean single-axis spin, like a globe on a stand.
- **Phi / Theta / Dot Count / Scale** - manual rotation, dot density, and
  size controls (unchanged).
- **Export Loopable GIF** - renders the current globe (whatever
  texture/faces/dots/spin settings are active) as a seamlessly-looping,
  transparent-background animated GIF and downloads it.

## Project structure

- `index.html`, `styles.css` - page and UI.
- `main.js` - WebGL setup, texture generation, controls, GIF export.
- `fragmentShader.js` - the sphere/dots/lighting shader.
- `phenomenon.js` - small WebGL rendering helper library.
- `textures.js` - built-in presets + the text-texture generator.
- `vendor/` - a small vendored GIF encoder (see `vendor/README.md`).
