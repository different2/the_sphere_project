import createGlobe from './index.js'; // The file you pasted

// Load the shader code and texture here
import fragment from './shader.glsl'; // This must be your GLSL fragment shader
import texture from './texture.jpg';  // Your map texture image

const canvas = document.getElementById('globe');

const globe = createGlobe(canvas, {
  devicePixelRatio: 2,
  width: 600,
  height: 600,
  phi: 0,
  theta: 0,
  dark: 1,
  diffuse: 1.2,
  mapBrightness: 6,
  mapBaseBrightness: 0.1,
  baseColor: [1, 1, 1],
  markerColor: [251 / 255, 100 / 255, 21 / 255],
  glowColor: [1, 1, 1],
  markers: [{ location: [37.7749, -122.4194], size: 0.05 }],
  onRender: (state) => {
    state.phi += 0.005;
    state.theta = Math.sin(state.phi) * 0.2;
    return state;
  },
  context: {},
});

// Inject shader and texture as globals if needed
window.__TEXTURE__ = texture;
window.GLSLX_SOURCE_MAIN = fragment;
