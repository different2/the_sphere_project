// ============================================================
// Sphere Field - "many spheres" mode
//
// A separate full-screen surface (independent of the single main
// globe) where the user can spawn any number of spheres and drop an
// image or GIF onto each one. Every sphere is its own tiny WebGL
// context rendering the same fragment-shader pipeline as the main
// globe (crisp texture mode), animated on a shared rAF loop.
//
// Browsers cap active WebGL contexts (~8-16). Spawning beyond the
// cap shows a warning instead of silently breaking; recycling old
// contexts is deliberately NOT automatic, since each sphere's
// uploaded content would be lost.
// ============================================================

import {
    parseGIF,
    decompressFrames
} from './vendor/gifuct.esm.js';

import fragmentShader from './fragmentShader.js';

const field =
    document.getElementById('sphereField');

let fieldSpheres = [];
let fieldNextId = 1;
let fieldSpawnCount = 0;

const MAX_FIELD_SPHERES = 9;

// Shared vertex shader - fullscreen quad, same trick as the main
// globe (all geometry math happens in the fragment shader).
const FIELD_VERTEX = /*glsl*/`
    attribute vec3 aPosition;

    void main() {
        gl_Position = vec4(aPosition, 1.0);
    }
`;

// Same fragment shader source as the main globe.
const FIELD_FRAGMENT = fragmentShader;

// ------------------------------------------------------------
// One spawned sphere: own canvas, GL context, program, texture,
// rotation state, optional GIF frame stream.
// ------------------------------------------------------------
function createFieldSphere(x, y, size) {

    const el =
        document.createElement('canvas');

    el.className = 'field-sphere';
    el.width = size * 2;
    el.height = size * 2;
    el.style.width = `${size}px`;
    el.style.height = `${size}px`;
    el.style.left = `${x - size / 2}px`;
    el.style.top = `${y - size / 2}px`;

    const gl =
        el.getContext('webgl', {
            alpha: true,
            antialias: true,
            depth: false,
            preserveDrawingBuffer: true
        });

    if (!gl) {

        el.remove();

        return null;
    }

    function compile(type, src) {

        const s = gl.createShader(type);

        gl.shaderSource(s, src);
        gl.compileShader(s);

        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {

            throw new Error(
                gl.getShaderInfoLog(s)
            );
        }

        return s;
    }

    const program = gl.createProgram();

    gl.attachShader(program, compile(gl.VERTEX_SHADER, FIELD_VERTEX));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FIELD_FRAGMENT));
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {

        throw new Error(
            gl.getProgramInfoLog(program)
        );
    }

    gl.useProgram(program);

    // Fullscreen quad
    const quad = new Float32Array([
        -1, -1, 0,
         1, -1, 0,
        -1,  1, 0,
         1, -1, 0,
         1,  1, 0,
        -1,  1, 0
    ]);

    const buf = gl.createBuffer();

    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);

    const aPosition =
        gl.getAttribLocation(program, 'aPosition');

    gl.enableVertexAttribArray(aPosition);
    gl.vertexAttribPointer(aPosition, 3, gl.FLOAT, false, 0, 0);

    const U = name =>
        gl.getUniformLocation(program, name);

    const uniforms = {
        uResolution: U('uResolution'),
        phi: U('phi'),
        theta: U('theta'),
        dots: U('dots'),
        scale: U('scale'),
        baseColor: U('baseColor'),
        glowColor: U('glowColor'),
        dotsBrightness: U('dotsBrightness'),
        diffuse: U('diffuse'),
        dark: U('dark'),
        opacity: U('opacity'),
        uIgnoreAlpha: U('uIgnoreAlpha'),
        uUseDots: U('uUseDots'),
        uUseFaces: U('uUseFaces'),
        uFaceCountF: U('uFaceCountF'),
        uTexture: U('uTexture')
    };

    gl.uniform2f(uniforms.uResolution, el.width, el.height);
    gl.uniform1f(uniforms.dots, 25000);
    gl.uniform1f(uniforms.scale, 1.0);
    gl.uniform3f(uniforms.baseColor, 0.3, 0.6, 1.0);
    gl.uniform3f(uniforms.glowColor, 0.3, 0.8, 1.0);
    gl.uniform1f(uniforms.dotsBrightness, 6);
    gl.uniform1f(uniforms.diffuse, 1.2);
    gl.uniform1f(uniforms.dark, 1);
    gl.uniform1f(uniforms.opacity, 1);
    gl.uniform1f(uniforms.uIgnoreAlpha, 0);
    gl.uniform1f(uniforms.uUseDots, 0);
    gl.uniform1f(uniforms.uUseFaces, 0);
    gl.uniform1i(uniforms.uTexture, 0);

    const sphere = {
        id: fieldNextId++,
        el,
        gl,
        uniforms,
        phi: Math.random() * Math.PI * 2,
        theta: Math.random() * Math.PI * 2,
        spinRate: 0.01 + Math.random() * 0.01,
        texture: null,
        frames: null,
        frameIndex: 0,
        elapsedMs: 0,
        lastTs: null
    };

    // Drag to spin this sphere
    let dragging = false;
    let lx = 0;
    let ly = 0;

    el.addEventListener('pointerdown', (e) => {

        dragging = true;
        lx = e.clientX;
        ly = e.clientY;
        el.setPointerCapture(e.pointerId);
    });

    el.addEventListener('pointermove', (e) => {

        if (!dragging) return;

        sphere.phi += (e.clientX - lx) * 0.01;
        sphere.theta += (e.clientY - ly) * 0.01;

        lx = e.clientX;
        ly = e.clientY;
    });

    el.addEventListener('pointerup', () => {
        dragging = false;
    });

    // Drop image/GIF onto it
    el.addEventListener('dragover', (e) => e.preventDefault());

    el.addEventListener('drop', async (e) => {

        e.preventDefault();

        const file = e.dataTransfer.files[0];

        if (file) {
            await loadFileOntoFieldSphere(sphere, file);
        }
    });

    // Click with no drag = pick a file for this sphere
    let downXY = null;

    el.addEventListener('pointerdown', (e) => {
        downXY = [e.clientX, e.clientY];
    });

    el.addEventListener('pointerup', (e) => {

        if (
            downXY &&
            Math.hypot(e.clientX - downXY[0], e.clientY - downXY[1]) < 4
        ) {

            const input =
                document.createElement('input');

            input.type = 'file';
            input.accept = 'image/*';

            input.onchange = async () => {

                if (input.files[0]) {
                    await loadFileOntoFieldSphere(sphere, input.files[0]);
                }
            };

            input.click();
        }

        downXY = null;
    });

    field.appendChild(el);

    return sphere;
}

// ------------------------------------------------------------
// Load an image or animated GIF file onto a field sphere.
// GIFs decode via the same gifuct pipeline as the main globe;
// every frame becomes its own full-wrap texture.
// ------------------------------------------------------------
async function loadFileOntoFieldSphere(sphere, file) {

    if (!file.type.startsWith('image/')) {
        return;
    }

    try {

        if (file.type === 'image/gif') {

            const buf =
                await file.arrayBuffer();

            const parsed =
                parseGIF(buf);

            const frames =
                decompressFrames(parsed, true);

            if (frames.length === 0) {
                return;
            }

            // Composite patches into full canvases
            const w = parsed.lsd.width;
            const h = parsed.lsd.height;

            const persistent =
                document.createElement('canvas');

            persistent.width = w;
            persistent.height = h;

            const pctx =
                persistent.getContext('2d');

            const baked = [];

            const maxFrames =
                Math.min(frames.length, 40);

            const step =
                frames.length / maxFrames;

            for (let i = 0; i < maxFrames; i++) {

                const f = frames[Math.floor(i * step)];

                const patch =
                    document.createElement('canvas');

                patch.width = f.dims.width;
                patch.height = f.dims.height;

                patch
                    .getContext('2d')
                    .putImageData(
                        new ImageData(
                            new Uint8ClampedArray(f.patch),
                            f.dims.width,
                            f.dims.height
                        ),
                        0, 0
                    );

                pctx.drawImage(patch, f.dims.left, f.dims.top);

                const snap =
                    document.createElement('canvas');

                snap.width = w;
                snap.height = h;

                snap.getContext('2d').drawImage(persistent, 0, 0);

                baked.push({
                    canvas: bakeFullWrap(snap),
                    delay: Math.max(20, f.delay || 100)
                });

                if (f.disposalType === 2) {

                    pctx.clearRect(
                        f.dims.left,
                        f.dims.top,
                        f.dims.width,
                        f.dims.height
                    );
                }
            }

            sphere.frames = baked.map(b => ({
                texture: uploadTex(sphere.gl, b.canvas),
                delay: b.delay
            }));

            sphere.frameIndex = 0;
            sphere.elapsedMs = 0;

        } else {

            const url =
                URL.createObjectURL(file);

            const img =
                await new Promise((resolve, reject) => {

                    const i = new Image();

                    i.onload = () => resolve(i);
                    i.onerror = reject;
                    i.src = url;
                });

            sphere.texture =
                uploadTex(sphere.gl, bakeFullWrap(img));

            URL.revokeObjectURL(url);
        }

        renderFieldSphere(sphere, sphere.phi, sphere.theta);

    } catch (err) {

        console.error('field sphere load failed:', err);
    }
}

// Full-wrap bake (same horizontal flip as generateFullWrapTexture)
function bakeFullWrap(source) {

    const tw = 1024;
    const th = 512;

    const c =
        document.createElement('canvas');

    c.width = tw;
    c.height = th;

    const ctx = c.getContext('2d');

    ctx.translate(tw, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(source, 0, 0, tw, th);

    return c;
}

function uploadTex(gl, source) {

    const t = gl.createTexture();

    gl.bindTexture(gl.TEXTURE_2D, t);

    gl.texImage2D(
        gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source
    );

    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    return t;
}

function renderFieldSphere(sphere, phiVal, thetaVal) {

    const gl = sphere.gl;

    gl.useProgram(sphere.program || gl.getParameter(gl.CURRENT_PROGRAM));

    gl.uniform1f(sphere.uniforms.phi, phiVal);
    gl.uniform1f(sphere.uniforms.theta, thetaVal);

    if (sphere.frames && sphere.frames.length > 0) {

        const frame =
            sphere.frames[
                sphere.frameIndex % sphere.frames.length
            ];

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, frame.texture);
    }

    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
}

// ------------------------------------------------------------
// Field animation loop - advances every sphere's rotation and GIF
// playback on one shared rAF.
// ------------------------------------------------------------
let fieldRunning = false;

function fieldTick(ts) {

    if (!field.classList.contains('active')) {

        fieldRunning = false;
        return;
    }

    for (const s of fieldSpheres) {

        if (s.lastTs !== null) {

            const dt = ts - s.lastTs;

            s.phi += s.spinRate * dt / 16.7;

            if (s.frames && s.frames.length > 0) {

                s.elapsedMs += dt;

                let guard = 0;

                while (
                    s.elapsedMs >=
                        s.frames[s.frameIndex].delay &&
                    guard < s.frames.length
                ) {

                    s.elapsedMs -=
                        s.frames[s.frameIndex].delay;

                    s.frameIndex =
                        (s.frameIndex + 1) %
                        s.frames.length;

                    guard++;
                }
            }
        }

        s.lastTs = ts;

        renderFieldSphere(s, s.phi, s.theta);
    }

    requestAnimationFrame(fieldTick);
}

function startFieldLoop() {

    if (fieldRunning) return;

    fieldRunning = true;
    requestAnimationFrame(fieldTick);
}

// ------------------------------------------------------------
// Toolbar + public controls (exposed on window for the UI buttons)
// ------------------------------------------------------------
export function openSphereField() {

    field.classList.add('active');
    startFieldLoop();
}

export function closeSphereField() {

    field.classList.remove('active');
}

export function spawnSphereAt(x, y, size = 160) {

    if (fieldSpheres.length >= MAX_FIELD_SPHERES) {

        alert(
            `Browser WebGL context limit reached (~${MAX_FIELD_SPHERES} spheres). ` +
            'Remove some spheres first.'
        );

        return null;
    }

    const s =
        createFieldSphere(x, y, size);

    if (s) {

        fieldSpheres.push(s);

        renderFieldSphere(s, s.phi, s.theta);
    }

    return s;
}

export function clearFieldSpheres() {

    for (const s of fieldSpheres) {

        const ext =
            s.gl.getExtension('WEBGL_lose_context');

        if (ext) ext.loseContext();

        s.el.remove();
    }

    fieldSpheres = [];
}

// Double-click empty space spawns a sphere there.
field.addEventListener('dblclick', (e) => {

    if (e.target === field) {
        spawnSphereAt(e.clientX, e.clientY);
    }
});

// Escape closes the field back to the main globe.
window.addEventListener('keydown', (e) => {

    if (
        e.key === 'Escape' &&
        field.classList.contains('active')
    ) {

        closeSphereField();
    }
});
