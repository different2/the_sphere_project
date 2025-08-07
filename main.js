import Phenomenon from 'phenomenon';
import icosphere from 'primitive-icosphere';

// Load shader source as strings
import vertexShaderSrc from './vertex.glsl?raw';
import fragmentShaderSrc from './fragment.glsl?raw';

async function main() {
  const canvas = document.getElementById('globe');
  const gl = canvas.getContext('webgl');

  // Resize canvas to fill window
  function resize() {
    canvas.width = window.innerWidth * window.devicePixelRatio;
    canvas.height = window.innerHeight * window.devicePixelRatio;
    gl.viewport(0, 0, canvas.width, canvas.height);
  }
  resize();
  window.addEventListener('resize', resize);

  // Create sphere geometry from icosphere
  const { positions, normals, cells } = icosphere(4);

  // Phenomenon expects flat arrays
  const flatPositions = new Float32Array(positions.flat());
  const flatNormals = new Float32Array(normals.flat());

  const renderer = new Phenomenon.Renderer({ canvas, dpr: window.devicePixelRatio });
  const program = new Phenomenon.Program(gl, {
    vertex: vertexShaderSrc,
    fragment: fragmentShaderSrc,
    uniforms: {
      uProjectionMatrix: { type: 'mat4', value: new Float32Array(16) },
      uViewMatrix: { type: 'mat4', value: new Float32Array(16) },
      uModelMatrix: { type: 'mat4', value: new Float32Array(16) },
    },
  });

  const geometry = new Phenomenon.Geometry(gl, {
    position: { size: 3, data: flatPositions },
    normal: { size: 3, data: flatNormals },
  });

  const mesh = new Phenomenon.Mesh(gl, {
    geometry,
    program,
  });

  // Matrix utilities
  const mat4 = {
    perspective: (out, fovy, aspect, near, far) => {
      const f = 1.0 / Math.tan(fovy / 2);
      out[0] = f / aspect;
      out[1] = 0; out[2] = 0; out[3] = 0;
      out[4] = 0; out[5] = f; out[6] = 0; out[7] = 0;
      out[8] = 0; out[9] = 0; out[10] = (far + near) / (near - far); out[11] = -1;
      out[12] = 0; out[13] = 0; out[14] = (2 * far * near) / (near - far); out[15] = 0;
      return out;
    },
    lookAt: (out, eye, center, up) => {
      const x0 = eye[0], x1 = eye[1], x2 = eye[2];
      const y0 = up[0], y1 = up[1], y2 = up[2];

      let zx = eye[0] - center[0];
      let zy = eye[1] - center[1];
      let zz = eye[2] - center[2];

      let len = Math.sqrt(zx * zx + zy * zy + zz * zz);
      zx /= len; zy /= len; zz /= len;

      let xx = y1 * zz - y2 * zy;
      let xy = y2 * zx - y0 * zz;
      let xz = y0 * zy - y1 * zx;

      len = Math.sqrt(xx * xx + xy * xy + xz * xz);
      xx /= len; xy /= len; xz /= len;

      let yx = zy * xz - zz * xy;
      let yy = zz * xx - zx * xz;
      let yz = zx * xy - zy * xx;

      out[0] = xx; out[1] = yx; out[2] = zx; out[3] = 0;
      out[4] = xy; out[5] = yy; out[6] = zy; out[7] = 0;
      out[8] = xz; out[9] = yz; out[10] = zz; out[11] = 0;
      out[12] = -(xx * x0 + xy * x1 + xz * x2);
      out[13] = -(yx * x0 + yy * x1 + yz * x2);
      out[14] = -(zx * x0 + zy * x1 + zz * x2);
      out[15] = 1;

      return out;
    },
    identity: (out) => {
      out[0] = 1; out[1] = 0; out[2] = 0; out[3] = 0;
      out[4] = 0; out[5] = 1; out[6] = 0; out[7] = 0;
      out[8] = 0; out[9] = 0; out[10] = 1; out[11] = 0;
      out[12] = 0; out[13] = 0; out[14] = 0; out[15] = 1;
      return out;
    },
    rotateY: (out, a, rad) => {
      const c = Math.cos(rad), s = Math.sin(rad);
      out[0] = c; out[1] = 0; out[2] = -s; out[3] = 0;
      out[4] = 0; out[5] = 1; out[6] = 0; out[7] = 0;
      out[8] = s; out[9] = 0; out[10] = c; out[11] = 0;
      out[12] = 0; out[13] = 0; out[14] = 0; out[15] = 1;
      return out;
    }
  };

  let time = 0;

  function render() {
    time += 0.01;

    const aspect = canvas.width / canvas.height;
    const projectionMatrix = new Float32Array(16);
    mat4.perspective(projectionMatrix, Math.PI / 4, aspect, 0.1, 100);

    const viewMatrix = new Float32Array(16);
    mat4.lookAt(viewMatrix, [0, 0, 4], [0, 0, 0], [0, 1, 0]);

    const modelMatrix = new Float32Array(16);
    mat4.identity(modelMatrix);
    mat4.rotateY(modelMatrix, modelMatrix, time);

    program.uniforms.uProjectionMatrix.value = projectionMatrix;
    program.uniforms.uViewMatrix.value = viewMatrix;
    program.uniforms.uModelMatrix.value = modelMatrix;

    renderer.render({ scene: mesh });

    requestAnimationFrame(render);
  }

  requestAnimationFrame(render);
}

main();
