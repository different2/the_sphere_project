// ============================================================
// Sphere Field - "many spheres" mode
//
// A full-screen surface (independent of the single main globe)
// where the user can spawn spheres and drop an image or GIF onto
// each one.
//
// ARCHITECTURE (rewritten Sept 2026): previously EVERY sphere was
// its own <canvas> with its own WebGL context, which hard-capped
// the field at ~9 spheres - browsers allow only ~16 live contexts
// per page. Now the whole field is ONE canvas with ONE WebGL
// context: every sphere is drawn into its own viewport/scissor box
// on that shared surface (the classic multi-viewport trick), using
// the exact same fragment shader as before. Sphere content -
// rotation, spin settings, GIF frames, per-face composites - lives
// in plain JS objects; GL resources (textures) all belong to the
// single shared context.
//
// Practical limits are now your GPU/CPU, not the browser:
// empty spheres are nearly free (one shared 1x1 dummy texture);
// each sphere carrying an uploaded image costs one baked texture,
// and an animated GIF up to 40 frames of them (1024x512 each), so
// thousands of textured spheres can exhaust VRAM even though the
// renderer itself happily handles tens of thousands.
//
// Clicking a sphere SELECTS it: the sidebar's spin/glow/scale/etc.
// controls then drive that sphere (see the control bridge at the
// bottom). Delete / Backspace removes it; Escape deselects.
// Shift+drag (or Move mode, toggled with M) repositions a sphere.
// Later-spawned spheres draw on top of earlier ones.
//
// Each sphere also has its own Faces layout (1/2/3/4/6, same as the
// main globe) and per-face image slots - see faceImages/faceCount
// below and regenerateFieldSphereTexture(). Uploading a second
// image (e.g. into a per-face slot via the sidebar while this
// sphere is selected) bakes a real composite through the shared
// generateGlobeTexture(), instead of the earlier behavior where
// every upload just overwrote the whole sphere with a new full
// wrap.
// ============================================================

import {
    parseGIF,
    decompressFrames
} from './vendor/gifuct.esm.js';

import fragmentShader from './fragmentShader.js';

import {
    getAngularRadiusForFaceCount,
    generateGlobeTexture
} from './face-texture.js';

const field =
    document.getElementById('sphereField');

let fieldSpheres = [];
let fieldNextId = 1;

// No functional limit anymore - this is only a guard against
// accidentally spawning a million entries and locking up the tab.
const HARD_LIMIT = 50000;

// The sphere the sidebar is currently driving (or null).
let selectedSphere = null;

// Move mode: dragging repositions spheres without needing Shift.
let moveMode = false;

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

// Shader geometry: with the `scale` uniform pinned at 1, the disc
// radius is 0.64 of the viewport's half-range, i.e. the disc is
// always exactly 64% of the box it's drawn in (see the old
// resizeSphereCanvas comment - kept because the sizing math below
// reproduces it 1:1).
const DISC_FRACTION = 0.64;

// A sphere's GL box never exceeds this many device pixels; past it
// the sphere just renders softer (same 1200px cap the old
// per-canvas version used).
const MAX_BOX_PX = 1200;

// ------------------------------------------------------------
// One shared canvas + GL context for the entire field.
// ------------------------------------------------------------
let fieldCanvas = null;
let gl = null;
let program = null;
let uniforms = null;
let quadBuffer = null;
let dummyTexture = null;

let canvasW = 0;
let canvasH = 0;
let dpr = 1;

// Selection marker - a small DOM ring/label floating over the
// canvas at the selected sphere's position (it was a CSS ::before
// on each sphere canvas before; with one canvas we need one
// movable element instead).
const marker =
    document.createElement('div');

marker.className = 'field-marker';
marker.style.display = 'none';

function sphereDpr() {
    return Math.min(
        Math.max(window.devicePixelRatio || 1, 1),
        2
    );
}

function sizeFieldCanvas() {

    dpr = sphereDpr();

    const w = Math.round(window.innerWidth * dpr);
    const h = Math.round(window.innerHeight * dpr);

    if (fieldCanvas.width !== w || fieldCanvas.height !== h) {

        fieldCanvas.width = w;
        fieldCanvas.height = h;
    }

    canvasW = w;
    canvasH = h;
}

function ensureFieldCanvas() {

    if (gl) {

        sizeFieldCanvas();
        return;
    }

    fieldCanvas =
        document.createElement('canvas');

    fieldCanvas.id = 'fieldCanvas';

    // preserveDrawingBuffer: true, like the old per-sphere contexts -
    // it lets the buffer be re-read (pixel readback, future field
    // exports) at a small perf cost, and antialias stays off since
    // the orb edge comes from the fragment math, not geometry AA.
    gl =
        fieldCanvas.getContext('webgl', {
            alpha: true,
            antialias: false,
            depth: false,
            preserveDrawingBuffer: true
        });

    if (!gl) {

        throw new Error(
            'Sphere field: could not create the shared WebGL context.'
        );
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

    program = gl.createProgram();

    gl.attachShader(program, compile(gl.VERTEX_SHADER, FIELD_VERTEX));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FIELD_FRAGMENT));
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {

        throw new Error(
            gl.getProgramInfoLog(program)
        );
    }

    gl.useProgram(program);

    // Fullscreen quad - drawn once per sphere; each sphere's
    // viewport/scissor box clips it to that sphere's square.
    const quad = new Float32Array([
        -1, -1, 0,
         1, -1, 0,
        -1,  1, 0,
         1, -1, 0,
         1,  1, 0,
        -1,  1, 0
    ]);

    quadBuffer = gl.createBuffer();

    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);

    const aPosition =
        gl.getAttribLocation(program, 'aPosition');

    gl.enableVertexAttribArray(aPosition);
    gl.vertexAttribPointer(aPosition, 3, gl.FLOAT, false, 0, 0);

    const U = name =>
        gl.getUniformLocation(program, name);

    uniforms = {
        uResolution: U('uResolution'),
        uFragOffset: U('uFragOffset'),
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
        uTexture: U('uTexture')
    };

    // Values that never vary per-sphere - set once for the shared
    // context's lifetime (the old per-canvas code set these at
    // context creation).
    gl.uniform1f(uniforms.dotsBrightness, 6);
    gl.uniform1f(uniforms.diffuse, 1.2);
    gl.uniform1f(uniforms.dark, 1);
    gl.uniform3f(uniforms.baseColor, 0.3, 0.6, 1.0);
    gl.uniform1f(uniforms.uUseFaces, 0);
    gl.uniform1i(uniforms.uTexture, 0);

    // A sphere with nothing uploaded samples this fully-transparent
    // 1x1 texture. The old per-context code just left a never-bound
    // unit 0 (black); on the shared context a previously-drawn
    // sphere's texture would still be bound, so an empty sphere
    // would smear another sphere's image over itself.
    dummyTexture = gl.createTexture();

    gl.bindTexture(gl.TEXTURE_2D, dummyTexture);
    gl.texImage2D(
        gl.TEXTURE_2D, 0, gl.RGBA,
        1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE,
        new Uint8Array([0, 0, 0, 0])
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    gl.enable(gl.SCISSOR_TEST);
    gl.clearColor(0, 0, 0, 0);

    // Alpha blending: with 10k spawns, sphere boxes overlap heavily.
    // Each box's corners are transparent; without blending they'd
    // write straight over already-drawn neighbors as rectangular
    // bite-marks (gl_FragColor alpha 0 = overwrite, not skip). With
    // SRC_ALPHA blending, transparent fragments keep what's beneath
    // and overlapping glows composite in spawn order (later = on
    // top), matching the old per-canvas DOM stacking.
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    sizeFieldCanvas();

    field.insertBefore(fieldCanvas, field.firstChild);
    field.appendChild(marker);
}

window.addEventListener('resize', () => {

    if (!gl) return;

    sizeFieldCanvas();
    renderField();
});

// Per-sphere control state, mirroring the main globe's sidebar
// variables (phi/theta/dots/scale/spin/glow/opacity/alpha). Every
// sphere starts from the same defaults; the sidebar writes into
// whichever sphere is selected.
function defaultSphereControls() {

    return {
        spinRate: 0.01 + Math.random() * 0.01,
        paused: false,
        spinType: 'randomized',
        spinSpeedMultiplier: 1.0,
        dots: 25000,
        scale: 1.0,
        glowColor: [0.3, 0.8, 1.0],
        opacity: 1,
        ignoreAlpha: 0,
        useDots: 0
    };
}

// ------------------------------------------------------------
// One spawned sphere: plain JS state (position, rotation,
// controls, textures, optional GIF frame stream). No DOM element,
// no dedicated context - the shared renderer draws it into its own
// box each frame.
// ------------------------------------------------------------
function createFieldSphere(x, y, size) {

    return {
        id: fieldNextId++,
        // Base disc size in CSS px (scale 1) - the drawn box is
        // baseSize * scale / DISC_FRACTION, exactly like the old
        // per-canvas sizing.
        baseSize: size,
        centerX: x,
        centerY: y,
        phi: Math.random() * Math.PI * 2,
        theta: Math.random() * Math.PI * 2,
        texture: null,
        frames: null,
        frameIndex: 0,
        elapsedMs: 0,
        lastTs: null,
        controls: defaultSphereControls(),
        // Per-face static image sources (plain <img> elements),
        // keyed by face slot index - 0 is the primary/main image,
        // same convention as main.js's rawCustomImages. Rebuilt into
        // a single composite texture by regenerateFieldSphereTexture
        // whenever a face's image changes or faceCount changes.
        faceImages: {},
        // Raw File bytes behind each face slot (keyed like
        // faceImages). The <img> sources above become useless after
        // a page reload (their blob: object URLs are revoked), but
        // field presets must survive reloads - so every upload also
        // keeps its original File here, and preset save serializes
        // THESE back into storage. See serializeFieldState().
        sourceFiles: {},
        // For the slot-0 image that came from the typed-text box:
        // the literal string it was rendered from, so selecting a
        // text sphere + Text Message puts the words back in the box
        // for editing instead of resetting it to the default.
        // Cleared by any other primary upload.
        textSources: {},
        faceCount: 1
    };
}

// Remember (or clear) the literal string a slot-0 image was typed
// from. Called by main.js right after a successful typed-text upload;
// any OTHER slot-0 upload clears it via the setFaceImage/GIF reset.
function setSphereTextSource(sphere, text) {

    sphere.textSources = text == null ? {} : { 0: text };
}

// The sphere's square: CSS box (hit-testing, marker placement) and
// device-pixel box (viewport/scissor, capped for GPU sanity).
function sphereBox(s) {

    const scale = Math.max(0.05, s.controls.scale || 1);

    const cssPx = Math.ceil((s.baseSize * scale) / DISC_FRACTION);

    return {
        cssPx,
        devPx: Math.min(
            Math.max(1, Math.round(cssPx * dpr)),
            MAX_BOX_PX
        )
    };
}

// Reposition a sphere so its CENTER lands at (x, y) - CSS px.
function moveSphereTo(sphere, x, y) {

    sphere.centerX = x;
    sphere.centerY = y;

    updateSelectionMarker();
}

// ------------------------------------------------------------
// Rendering - the whole field in one pass over one context.
//
// Multi-viewport trick: per sphere, point gl.viewport + gl.scissor
// at its square region of the shared canvas. The fullscreen quad
// then fills EXACTLY that box (viewport = the [-1,1] -> box
// mapping, scissor clips anything beyond), so the unchanged
// fragment shader's gl_FragCoord/uResolution math sees a square
// [0,1] window and renders the sphere pixel-for-pixel as it used
// to on its own canvas.
// ------------------------------------------------------------
function renderField() {

    if (!gl) {
        return;
    }

    // The scissor test may still be on from a previous frame's last
    // sphere; a clear that respects it would only wipe that one box
    // and leave stale sphere pixels alive forever (a shrunk, moved
    // or deleted sphere's old box would keep its last render).
    gl.disable(gl.SCISSOR_TEST);
    gl.viewport(0, 0, canvasW, canvasH);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.SCISSOR_TEST);

    for (const s of fieldSpheres) {

        const { devPx } =
            sphereBox(s);

        const x0 =
            Math.round(s.centerX * dpr - devPx / 2);

        // CSS y grows downward, GL viewport y grows upward.
        const y0gl =
            canvasH - Math.round(s.centerY * dpr + devPx / 2);

        gl.viewport(x0, y0gl, devPx, devPx);
        gl.scissor(x0, y0gl, devPx, devPx);

        const c = s.controls;

        // The shader's uv math must see THIS box as its [0,1]
        // window: gl_FragCoord is canvas-global, so pass the box's
        // bottom-left corner as the offset.
        gl.uniform2f(uniforms.uFragOffset, x0, y0gl);
        gl.uniform2f(uniforms.uResolution, devPx, devPx);
        gl.uniform1f(uniforms.phi, s.phi);
        gl.uniform1f(uniforms.theta, s.theta);
        gl.uniform1f(uniforms.dots, c.dots || 25000);
        gl.uniform1f(uniforms.scale, 1);
        gl.uniform1f(uniforms.opacity, c.opacity ?? 1);
        gl.uniform1f(uniforms.uIgnoreAlpha, c.ignoreAlpha || 0);
        gl.uniform1f(uniforms.uUseDots, c.useDots || 0);

        const glow = c.glowColor || [0.3, 0.8, 1.0];

        gl.uniform3f(
            uniforms.glowColor,
            glow[0], glow[1], glow[2]
        );

        gl.activeTexture(gl.TEXTURE0);

        if (s.frames && s.frames.length > 0) {

            gl.bindTexture(
                gl.TEXTURE_2D,
                s.frames[s.frameIndex % s.frames.length].texture
            );

        } else if (s.texture) {

            // Explicit bind (not relying on whatever uploadTex()
            // left bound): a static image uploaded onto a sphere
            // that was previously showing a GIF must switch to the
            // new texture.
            gl.bindTexture(gl.TEXTURE_2D, s.texture);

        } else {

            gl.bindTexture(gl.TEXTURE_2D, dummyTexture);
        }

        gl.drawArrays(gl.TRIANGLES, 0, 6);
    }
}

// Single-sphere render entry kept for call-site clarity (spawn,
// uploads, control changes) - one pass redraws everything anyway.
function renderFieldSphere() {

    if (field.classList.contains('active')) {
        renderField();
    }
}

// ------------------------------------------------------------
// Field animation loop - advances every sphere's rotation and GIF
// playback on one shared rAF, then redraws the field once.
// Rotation behavior (spin type, speed, pause) comes from each
// sphere's own controls object, which the sidebar writes into for
// the selected sphere.
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
            const c = s.controls;

            if (!c.paused) {

                if (c.spinType === 'axis') {

                    s.phi +=
                        PHI_RATE *
                        c.spinSpeedMultiplier *
                        dt / 16.7;

                } else {

                    s.phi +=
                        PHI_RATE *
                        c.spinSpeedMultiplier *
                        dt / 16.7;

                    s.theta +=
                        THETA_RATE *
                        c.spinSpeedMultiplier *
                        dt / 16.7;
                }
            }

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
    }

    renderField();

    requestAnimationFrame(fieldTick);
}

function startFieldLoop() {

    if (fieldRunning) return;

    fieldRunning = true;
    requestAnimationFrame(fieldTick);
}

// ------------------------------------------------------------
// Rotation rates matching the main globe's animate() loop, so the
// Spin speed slider means the same thing in both modes.
// ------------------------------------------------------------
const PHI_RATE = 0.002;
const THETA_RATE = 0.0007;

// ------------------------------------------------------------
// Hit-testing: which sphere owns this client-space point?
// The old code got this free (one DOM element per sphere); now the
// canvas is one element, so spheres are plain rects - tested
// topmost-first (last spawned = drawn last = on top).
// ------------------------------------------------------------
function sphereAtPoint(clientX, clientY) {

    for (let i = fieldSpheres.length - 1; i >= 0; i--) {

        const s =
            fieldSpheres[i];

        const half =
            sphereBox(s).cssPx / 2;

        if (
            Math.abs(clientX - s.centerX) <= half &&
            Math.abs(clientY - s.centerY) <= half
        ) {
            return s;
        }
    }

    return null;
}

// ------------------------------------------------------------
// Selection
// ------------------------------------------------------------

function selectSphere(sphere) {

    if (selectedSphere === sphere) {
        return;
    }

    selectedSphere = sphere;

    if (sphere) {

        marker.dataset.label = `Sphere ${sphere.id}`;
        console.log(`sphere ${sphere.id}: SELECTED (sidebar now drives this sphere)`);

    } else {

        console.log('selection cleared');
    }

    updateSelectionMarker();
    notifySelectionChanged();
}

function getSelectedSphere() {

    return selectedSphere;
}

// Sidebar -> selected sphere bridge. main.js registers a callback
// here; every sidebar control change funnels through it.
let selectionChangedCallback = null;

function onSelectionChanged(cb) {

    selectionChangedCallback = cb;
}

function notifySelectionChanged() {

    if (selectionChangedCallback) {
        selectionChangedCallback(selectedSphere);
    }
}

// Sizes/positions the selection marker over the selected sphere.
// Same visual rules as the old CSS ::before badge: it surrounds the
// disc (blue) while the disc is small, and once the disc exceeds
// 36px the marker stays 36px, sits ON the sphere, and turns red.
function updateSelectionMarker() {

    if (!selectedSphere || !fieldCanvas) {

        marker.style.display = 'none';
        return;
    }

    const s =
        selectedSphere;

    const scale = Math.max(0.05, s.controls.scale || 1);

    // Disc radius as fraction of the box (the box clips anything
    // bigger - same clamp the old marker used).
    const discFraction = Math.min(1, 1 / scale);

    const discPx = discFraction * s.baseSize;
    const markerDiameter = Math.min(discPx, 36);
    const overflow = discPx > 36;

    marker.style.display = 'block';
    marker.style.width = `${markerDiameter}px`;
    marker.style.height = `${markerDiameter}px`;
    marker.style.left = `${s.centerX}px`;
    marker.style.top = `${s.centerY}px`;
    marker.classList.toggle('marker-overflow', overflow);
}

function openFilePickerForSphere(sphere) {

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

// ------------------------------------------------------------
// Pointer interaction on the shared canvas: click = select, drag =
// spin (or move with Shift / Move mode), double-click on a sphere =
// file picker, on empty space = spawn. A click with barely any
// movement selects; a drag never changes the selection.
// ------------------------------------------------------------
let downXY = null;
let dragging = false;
let dragSphere = null;
let moving = false;
let lx = 0;
let ly = 0;
let shiftDown = false;

// The old per-canvas code declared shiftDown but never updated it,
// so Shift+drag silently never moved spheres. Keep it live from
// both keyboard state and the shift key held during pointer events.
window.addEventListener('keydown', (e) => {
    if (e.key === 'Shift') shiftDown = true;
});
window.addEventListener('keyup', (e) => {
    if (e.key === 'Shift') shiftDown = false;
});

const wantsMove = () =>
    moveMode || shiftDown;

function updateFieldCursor(clientX, clientY) {

    if (!fieldCanvas) return;

    const s =
        sphereAtPoint(clientX, clientY);

    fieldCanvas.style.cursor =
        s ? (wantsMove() ? 'move' : 'pointer') : 'default';
}

// Set up once - the canvas exists lazily, but events land on the
// field container and forward to whichever canvas state exists.
function attachFieldPointerHandlers() {

    field.addEventListener('pointerdown', (e) => {

        if (!fieldCanvas || e.target !== fieldCanvas) {
            return;
        }

        downXY = [e.clientX, e.clientY];
        dragging = true;
        dragSphere = sphereAtPoint(e.clientX, e.clientY);
        moving = dragSphere && wantsMove();
        lx = e.clientX;
        ly = e.clientY;

        // The pointerId can be invalidated between the event and
        // this call (e.g. a touch-scroll cancelled it) - capture is
        // an optimization, so a failure here shouldn't kill the
        // interaction.
        try {
            fieldCanvas.setPointerCapture(e.pointerId);
        } catch (err) {
            console.warn(
                'field: pointer capture failed (interaction still works):',
                err.message
            );
        }

        if (dragSphere) {

            console.log(
                `sphere ${dragSphere.id}: pointer down (${moving ? 'MOVE' : 'SPIN'} mode)`
            );
        }
    });

    field.addEventListener('pointermove', (e) => {

        if (!dragging) {

            // Hover feedback only - cursor shows what a press
            // would do.
            updateFieldCursor(e.clientX, e.clientY);
            return;
        }

        const dx = e.clientX - lx;
        const dy = e.clientY - ly;
        lx = e.clientX;
        ly = e.clientY;

        if (!dragSphere) {
            return;
        }

        if (moving) {

            moveSphereTo(
                dragSphere,
                dragSphere.centerX + dx,
                dragSphere.centerY + dy
            );

            return;
        }

        dragSphere.phi += dx * 0.01;
        dragSphere.theta += dy * 0.01;
    });

    field.addEventListener('pointerup', (e) => {

        if (!dragging) {
            return;
        }

        dragging = false;

        const wasAClick =
            downXY &&
            Math.hypot(
                e.clientX - downXY[0],
                e.clientY - downXY[1]
            ) < 4;

        downXY = null;

        if (wasAClick) {

            // Plain click selects (so the sidebar drives this
            // sphere); click on empty space deselects. Double-click
            // is what opens the file picker / spawns - see below.
            selectSphere(dragSphere || null);
        }

        dragSphere = null;
    });

    // Double-click a sphere to choose an image/GIF for it;
    // double-click empty space to spawn a new sphere there.
    field.addEventListener('dblclick', (e) => {

        if (!fieldCanvas || e.target !== fieldCanvas) {
            return;
        }

        const s =
            sphereAtPoint(e.clientX, e.clientY);

        if (s) {

            selectSphere(s);
            openFilePickerForSphere(s);

        } else {

            spawnSphereAt(e.clientX, e.clientY);
        }
    });

    // Drop image/GIF onto a sphere.
    field.addEventListener('dragover', (e) => {
        e.preventDefault();
    });

    field.addEventListener('drop', async (e) => {

        e.preventDefault();

        if (!fieldCanvas || e.target !== fieldCanvas) {
            return;
        }

        const file = e.dataTransfer.files[0];
        const s =
            sphereAtPoint(e.clientX, e.clientY);

        if (file && s) {
            await loadFileOntoFieldSphere(s, file);
        }
    });
}

attachFieldPointerHandlers();

// ------------------------------------------------------------
// Move mode
// ------------------------------------------------------------

function setMoveMode(on) {

    moveMode = on;

    if (fieldCanvas) {
        fieldCanvas.style.cursor = '';
    }
}

function isMoveMode() {

    return moveMode;
}

// ------------------------------------------------------------
// Deletion - also frees this sphere's GL textures back to the
// shared context so long sessions can't slowly exhaust VRAM.
// ------------------------------------------------------------
function deleteSphere(sphere) {

    const idx =
        fieldSpheres.indexOf(sphere);

    if (idx === -1) {
        return;
    }

    console.log(`sphere ${sphere.id}: deleting`);

    if (selectedSphere === sphere) {
        selectSphere(null);
    }

    fieldSpheres.splice(idx, 1);

    if (sphere.texture) {
        gl.deleteTexture(sphere.texture);
        sphere.texture = null;
    }

    disposeFieldSphereFrames(sphere);
}

// Frees the GL textures backing sphere.frames (if any) and clears
// it. Split out since both a fresh GIF-as-primary upload and a
// switch into face-composite mode need to stop/discard whatever
// animation was previously playing.
function disposeFieldSphereFrames(sphere) {

    if (sphere.frames) {

        for (const f of sphere.frames) {
            gl.deleteTexture(f.texture);
        }

        sphere.frames = null;
    }
}

// Stores `source` (an <img> or <canvas>) as face slot `faceIndex` on
// `sphere` and rebuilds its composite texture from every face slot
// currently set - this is what makes different images actually land
// on different sides of the sphere instead of each upload just
// replacing the last one (see regenerateFieldSphereTexture below).
//
// A new primary image (faceIndex 0) drops any other face overrides
// and stops GIF playback - the same "start over" rule main.js's
// applyCustomImage uses for the main globe's primary image.
function setFaceImage(sphere, faceIndex, source) {

    if (faceIndex === 0) {
        sphere.faceImages = {};
        sphere.sourceFiles = {};
        sphere.textSources = {};
        disposeFieldSphereFrames(sphere);
    }

    sphere.faceImages[faceIndex] = source;

    regenerateFieldSphereTexture(sphere);
}

// Rebuilds a field sphere's texture from its current faceImages +
// faceCount via the shared generateGlobeTexture() (same per-face
// gnomonic-projection compositing the main globe uses). Un-set face
// slots resolve to the lowest-indexed slot that DOES have an image,
// so e.g. uploading only to slots 1 and 3 of a 4-face sphere fills
// 2 and 4 with slot 1's image rather than leaving them blank.
function regenerateFieldSphereTexture(sphere) {

    const slotIndices =
        Object.keys(sphere.faceImages).map(Number);

    if (slotIndices.length === 0) {

        // Nothing uploaded yet (e.g. Faces was changed before any
        // image exists on this sphere) - nothing to render.
        return;
    }

    const fallbackSlot =
        Math.min(...slotIndices);

    const faceCount =
        sphere.faceCount || 1;

    const angularRadius =
        getAngularRadiusForFaceCount(faceCount);

    let source;

    if (faceCount === 1) {

        source =
            sphere.faceImages[0] ||
            sphere.faceImages[fallbackSlot];

    } else {

        source = [];

        for (let i = 0; i < faceCount; i++) {

            source.push(
                sphere.faceImages[i] ||
                sphere.faceImages[fallbackSlot]
            );
        }
    }

    // Field spheres bake at 1024x512 (vs. the main globe's 2048x1024)
    // - keeps per-sphere GPU memory modest, since every textured
    // sphere holds its own copy of this in the shared context.
    const canvas =
        generateGlobeTexture(
            source,
            angularRadius,
            1024,
            faceCount
        );

    if (sphere.texture) {
        gl.deleteTexture(sphere.texture);
    }

    sphere.texture =
        uploadTex(canvas);

    disposeFieldSphereFrames(sphere);

    renderFieldSphere();
}

// Changes how many faces a field sphere shows (1/2/3/4/6, same
// options as the main globe) and rebakes its texture from whatever
// face images are already set on it.
function setSphereFaceCount(sphere, n) {

    if (!sphere) return;

    console.log(`sphere ${sphere.id}: faceCount = ${n}`);

    sphere.faceCount = n;

    regenerateFieldSphereTexture(sphere);
}

// ------------------------------------------------------------
// Load an image or animated GIF file onto a field sphere, into a
// given face slot (0 = the primary/whole-sphere image, matching
// main.js's per-face slot numbering - omit it for the primary).
//
// GIFs decode via the same gifuct pipeline as the main globe:
// - As the primary image (faceIndex 0): every frame becomes its own
//   full-wrap texture and the sphere animates, same as before - GIFs
//   don't participate in the multi-face system (matching the main
//   globe's own "per-face slots don't get independent animation"
//   behavior, see README).
// - Into a specific face slot (faceIndex > 0): only the first frame
//   is used, as a static image for that face.
//
// (Also the entry point for the sidebar's Upload Image / per-face
// slot controls while a sphere is selected - see main.js's
// fileUpload / per-face-slot bridges.)
// ------------------------------------------------------------
export async function loadFileOntoFieldSphere(sphere, file, faceIndex = 0) {

    console.log(
        `sphere ${sphere.id}: loading ${file.name} (${file.type}, ${(file.size / 1024).toFixed(0)} KB) into face ${faceIndex}`
    );

    if (!file.type.startsWith('image/')) {

        console.warn(
            `sphere ${sphere.id}: rejected non-image file ${file.name}`
        );

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

            // A GIF dropped onto a specific face just shows its
            // first frame there, as a static image - decode/draw one
            // frame and hand it to the same per-face path a static
            // image upload uses, instead of the full animation below
            // (which is reserved for the primary/whole-sphere image).
            if (faceIndex > 0) {

                const f = frames[0];

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

                // Remember the original File too - a loaded preset's
                // spheres must stay editable/re-savable (see
                // sourceFiles in createFieldSphere).
                sphere.sourceFiles[faceIndex] = file;

                setFaceImage(sphere, faceIndex, persistent);

                return;
            }

            const baked = [];

            const maxFrames =
                Math.min(frames.length, 40);

            // Repeat the GIF at every face position, same as a
            // static primary image already does via
            // regenerateFieldSphereTexture - keeps a sphere's Faces
            // setting consistent regardless of whether the primary
            // upload happens to be a GIF or a still image.
            const bakeFaceCount =
                sphere.faceCount || 1;

            const bakeAngularRadius =
                getAngularRadiusForFaceCount(bakeFaceCount);

            // First composite EVERY decoded frame in sequence onto the
            // persistent canvas (the standard GIF approach - patches
            // only cover the changed region, and disposal tells us when
            // to restore). Only AFTER every frame is correctly
            // composited do we subsample down to maxFrames for baking.
            //
            // Previously this loop subsampled the INPUT frames first
            // (drawing only every Nth patch) and composited on top of
            // that subset. Because these GIFs use disposal 0 (keep
            // pixels) with partial-canvas patches, skipping intermediate
            // patches meant their contributions were never drawn, so
            // ring text from skipped frames' positions ghosted/overlapped
            // ("text running into itself"), and consecutive baked frames
            // could end up near-identical - the "GIF sometimes doesn't
            // move" symptom. Composite-all-then-subsample fixes both.
            const compositeAll = [];

            for (let i = 0; i < frames.length; i++) {

                const f = frames[i];

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

                compositeAll.push(snap);

                if (f.disposalType === 2) {

                    pctx.clearRect(
                        f.dims.left,
                        f.dims.top,
                        f.dims.width,
                        f.dims.height
                    );
                }
            }

            const step =
                compositeAll.length / maxFrames;

            for (let i = 0; i < maxFrames; i++) {

                const snap =
                    compositeAll[Math.floor(i * step)];

                baked.push({
                    canvas: generateGlobeTexture(
                        snap,
                        bakeAngularRadius,
                        1024,
                        bakeFaceCount
                    ),
                    delay: Math.max(20, frames[Math.floor(i * step)].delay || 100)
                });
            }

            // A new primary image (GIF or static) starts over -
            // matches main.js's applyCustomImage rule for slot 0.
            sphere.faceImages = {};
            sphere.sourceFiles = {};
            sphere.textSources = {};

            if (sphere.texture) {
                gl.deleteTexture(sphere.texture);
                sphere.texture = null;
            }

            disposeFieldSphereFrames(sphere);

            sphere.frames = baked.map(b => ({
                texture: uploadTex(b.canvas),
                delay: b.delay
            }));

            sphere.sourceFiles[0] = file;

            sphere.frameIndex = 0;
            sphere.elapsedMs = 0;

            renderFieldSphere();

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

            // setFaceImage() already renders (via
            // regenerateFieldSphereTexture), so there's nothing left
            // to do here after it but release the object URL.
            // sourceFiles is written AFTER setFaceImage because a
            // slot-0 upload CLEARS the map (new-primary rule) -
            // writing first would be wiped.
            setFaceImage(sphere, faceIndex, img);

            sphere.sourceFiles[faceIndex] = file;

            URL.revokeObjectURL(url);
        }

    } catch (err) {

        console.error(
            `sphere ${sphere.id}: load FAILED for ${file.name}:`,
            err
        );
    }
}

function uploadTex(source) {

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

// ------------------------------------------------------------
// Public controls (used by main.js's sidebar bridge)
// ------------------------------------------------------------

// All of these just write sphere state now - renderField() uploads
// the per-sphere uniforms on every frame, so no GL calls here.

function setSphereDots(sphere, v) {

    if (!sphere) return;

    console.log(`sphere ${sphere.id}: dots = ${v}`);

    sphere.controls.dots = v;
}

function setSphereScale(sphere, v) {

    if (!sphere) return;

    console.log(`sphere ${sphere.id}: scale = ${v}`);

    sphere.controls.scale = v;

    // The selection marker never grows with the sphere - when the
    // disc outgrows the 36px badge, the badge turns red and sits on
    // the sphere so it stays findable.
    updateSelectionMarker();
}

function setSphereGlowColor(sphere, rgb01) {

    if (!sphere) return;

    console.log(
        `sphere ${sphere.id}: glowColor = rgb(${rgb01.map(n => n.toFixed(2))})`
    );

    sphere.controls.glowColor = rgb01;
}

function setSphereOpacity(sphere, v) {

    if (!sphere) return;

    console.log(`sphere ${sphere.id}: opacity = ${v}`);

    sphere.controls.opacity = v;
}

function setSphereIgnoreAlpha(sphere, on) {

    if (!sphere) return;

    console.log(
        `sphere ${sphere.id}: solid image (ignoreAlpha) = ${on ? 'ON' : 'OFF'}`
    );

    sphere.controls.ignoreAlpha = on ? 1 : 0;
}

function setSpherePaused(sphere, on) {

    if (!sphere) return;

    console.log(`sphere ${sphere.id}: paused = ${on}`);

    sphere.controls.paused = on;
}

function setSphereSpinType(sphere, type) {

    if (!sphere) return;

    console.log(`sphere ${sphere.id}: spinType = ${type}`);

    sphere.controls.spinType = type;

    if (type === 'axis') {
        sphere.theta = 0;
        console.log(`sphere ${sphere.id}: theta reset to 0 (axis spin)`);
    }
}

function setSphereSpinSpeed(sphere, v) {

    if (!sphere) return;

    console.log(`sphere ${sphere.id}: spinSpeed = ${v}x`);

    sphere.controls.spinSpeedMultiplier = v;
}

function setSpherePhi(sphere, v) {

    if (!sphere) return;

    console.log(`sphere ${sphere.id}: phi = ${v.toFixed(2)} rad (${(v * 180 / Math.PI).toFixed(0)}°)`);

    sphere.phi = v;
}

function setSphereTheta(sphere, v) {

    if (!sphere) return;

    console.log(`sphere ${sphere.id}: theta = ${v.toFixed(2)} rad (${(v * 180 / Math.PI).toFixed(0)}°)`);

    sphere.theta = v;
}

function setSphereUseDots(sphere, v) {

    if (!sphere) return;

    console.log(`sphere ${sphere.id}: useDots (fibonacci mode) = ${v}`);

    sphere.controls.useDots = v;
}

// Push the selected sphere's current control values back into the
// sidebar UI (called on selection change).
function getSphereControls(sphere) {

    return sphere ? sphere.controls : null;
}

// ------------------------------------------------------------
// Toolbar + public controls (exposed on window for the UI buttons)
// ------------------------------------------------------------
export function openSphereField() {

    ensureFieldCanvas();

    field.classList.add('active');
    startFieldLoop();
}

// Leaves field mode entirely: tears every sphere down (freeing the
// shared-context textures) and clears the selection, so the app is
// back to the plain single-globe view. The ID counter restarts too,
// so the next session's spheres are labeled 1..N again instead of
// continuing from wherever the last session left off. The canvas
// and its context stay alive for the next visit.
export function closeSphereField() {

    for (const s of [...fieldSpheres]) {
        deleteSphere(s);
    }

    selectSphere(null);

    fieldNextId = 1;

    field.classList.remove('active');
}

export function spawnSphereAt(x, y, size = 160) {

    if (fieldSpheres.length >= HARD_LIMIT) {

        alert(
            `That's ${HARD_LIMIT} spheres - your tab would be unusable. ` +
            'Remove some spheres first.'
        );

        return null;
    }

    ensureFieldCanvas();

    const s =
        createFieldSphere(x, y, size);

    fieldSpheres.push(s);

    renderFieldSphere();

    console.log(
        `sphere ${s.id}: spawned at (${Math.round(x)}, ${Math.round(y)}) size ${size}px (${fieldSpheres.length} active)`
    );

    // New spheres become the active selection immediately, so
    // the sidebar drives the thing you just made.
    selectSphere(s);

    return s;
}

// Console/test helper: spawn n spheres spread over the viewport in
// a grid, e.g. fieldAPI.spawnMany(2000). Spheres start empty
// (transparent 1x1 texture, no per-sphere VRAM), so this measures
// pure renderer throughput.
function spawnMany(n, size = 160) {

    ensureFieldCanvas();

    const cols =
        Math.max(1, Math.ceil(Math.sqrt(n)));

    const cellW =
        window.innerWidth / cols;

    const cellH =
        window.innerHeight / Math.max(1, Math.ceil(n / cols));

    const made = [];

    for (let i = 0; i < n; i++) {

        const cx =
            (i % cols + 0.5) * cellW;

        const cy =
            (Math.floor(i / cols) + 0.5) * cellH;

        const s =
            createFieldSphere(cx, cy, size);

        // Shrink to fit the grid cell (a scale of cssBox terms -
        // baseSize stays the disc-at-scale-1 size, so clamp scale
        // so the box fits without full overlap).
        const fit =
            Math.min(cellW, cellH) * DISC_FRACTION / size;

        s.controls.scale = Math.max(0.05, Math.min(1, fit));

        fieldSpheres.push(s);
        made.push(s);

        if (fieldSpheres.length >= HARD_LIMIT) {
            break;
        }
    }

    renderField();

    console.log(
        `field: spawned ${made.length} spheres (${fieldSpheres.length} total)`
    );

    return made;
}

// ------------------------------------------------------------
// Preset save/load (bridge used by main.js's Presets UI; bytes
// live in IndexedDB there).
//
// serializeFieldState(): snapshot of every sphere plus the image
// File objects in a parallel `blobs` array (IndexedDB stores File
// objects natively, so the whole returned object goes in as one
// record). sourceFiles is what makes this possible - the
// <img>/<canvas> sources alone can't survive a reload (their blob:
// URLs die with the page).
//
// loadFieldState(state): clears the field and rebuilds every sphere,
// re-running each stored File through the normal upload path (so
// GIFs re-animate, composites re-bake, and everything stays fully
// editable - re-saving a loaded preset works unchanged).
// ------------------------------------------------------------
function serializeFieldState() {

    const blobs = [];

    const spheres = fieldSpheres.map(s => {

        const faceSlots = {};

        for (const [slot, file] of Object.entries(s.sourceFiles || {})) {

            if (file) {
                blobs.push(file);
                faceSlots[slot] = blobs.length - 1;
            }
        }

        return {
            baseSize: s.baseSize,
            centerX: s.centerX,
            centerY: s.centerY,
            phi: s.phi,
            theta: s.theta,
            faceCount: s.faceCount,
            controls: s.controls,
            faceSlots,
            textSources: s.textSources || {}
        };
    });

    return { version: 1, spheres, blobs };
}

async function loadFieldState(state) {

    if (!state || state.version !== 1 || !Array.isArray(state.spheres)) {
        throw new Error('not a sphere-field preset');
    }

    ensureFieldCanvas();
    openSphereField();

    for (const s of [...fieldSpheres]) {
        deleteSphere(s);
    }

    let loadedCount = 0;

    for (const rec of state.spheres) {

        const s = createFieldSphere(
            rec.centerX,
            rec.centerY,
            rec.baseSize || 160
        );

        s.faceCount = rec.faceCount || 1;
        s.phi = rec.phi ?? s.phi;
        s.theta = rec.theta ?? s.theta;
        Object.assign(s.controls, rec.controls || {});

        fieldSpheres.push(s);

        // Re-run every stored File through the real upload path.
        const slots = Object.entries(rec.faceSlots || {})
            .sort((a, b) => Number(a[0]) - Number(b[0]));

        for (const [slot, blobIdx] of slots) {

            const file = state.blobs[blobIdx];

            if (!file) {

                console.warn(
                    `preset: sphere ${s.id} slot ${slot}: file missing in storage, skipped`
                );

                continue;
            }

            await loadFileOntoFieldSphere(s, file, Number(slot));
            loadedCount++;
        }

        // ...and ONLY then restore the typed-text strings: a slot-0
        // upload clears textSources (new-primary rule), so applying
        // the stored text before re-uploading would wipe it again.
        s.textSources = rec.textSources || {};
    }

    renderField();

    console.log(
        `field preset loaded: ${fieldSpheres.length} spheres, ${loadedCount} images`
    );

    selectSphere(null);

    return fieldSpheres.length;
}

export function clearFieldSpheres() {

    for (const s of [...fieldSpheres]) {
        deleteSphere(s);
    }
}

export {
    selectSphere,
    getSelectedSphere,
    deleteSphere,
    onSelectionChanged,
    setMoveMode,
    isMoveMode,
    serializeFieldState,
    loadFieldState,
    setSphereDots,
    setSphereScale,
    setSphereGlowColor,
    setSphereOpacity,
    setSphereIgnoreAlpha,
    setSpherePaused,
    setSphereSpinType,
    setSphereSpinSpeed,
    setSpherePhi,
    setSphereTheta,
    setSphereUseDots,
    setSphereFaceCount,
    getSphereControls,
    setSphereTextSource
};

// Escape: deselect a sphere if one is selected, otherwise close the
// field back to the main globe.
window.addEventListener('keydown', (e) => {

    if (!field.classList.contains('active')) {
        return;
    }

    if (e.key === 'Escape') {

        if (selectedSphere) {
            selectSphere(null);
        } else {
            closeSphereField();
        }

        return;
    }

    // Delete/Backspace removes the selected sphere. Skip when the
    // user is typing in the sidebar's text box.
    if (
        (e.key === 'Delete' || e.key === 'Backspace') &&
        selectedSphere &&
        !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)
    ) {
        e.preventDefault();
        deleteSphere(selectedSphere);
    }

    // M toggles Move mode.
    if (
        (e.key === 'm' || e.key === 'M') &&
        !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)
    ) {
        setMoveMode(!moveMode);
    }
});

// Small debug/testing surface (no UI depends on it):
//   fieldAPI.spawnMany(1000)   - stress test
//   fieldAPI.count()           - how many are live
window.fieldAPI = {
    spawnAt: spawnSphereAt,
    spawnMany,
    load: loadFileOntoFieldSphere,
    count: () => fieldSpheres.length,
    spheres: () => fieldSpheres,
    select: selectSphere
};
