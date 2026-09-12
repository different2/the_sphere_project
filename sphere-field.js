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
//
// Clicking a sphere SELECTS it: the sidebar's spin/glow/scale/etc.
// controls then drive that sphere (see the control bridge at the
// bottom). Delete / Backspace removes it; Escape deselects.
// Shift+drag (or Move mode, toggled with M) repositions a sphere.
//
// Each sphere also has its own Faces layout (1/2/3/4/6, same as the
// main globe) and per-face image slots - see faceImages/faceCount
// below and regenerateFieldSphereTexture(). Uploading a second image
// (e.g. into a per-face slot via the sidebar while this sphere is
// selected) bakes a real composite through the shared
// generateGlobeTexture(), instead of the earlier behavior where every
// upload just overwrote the whole sphere with a new full wrap.
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

const MAX_FIELD_SPHERES = 9;

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
        ignoreAlpha: 0
    };
}

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

    // Without this the viewport stays [0,0,0,0] - nothing ever
    // rasterizes, and the canvas shows only whatever bleeds through
    // from behind (the main globe), which looks like a displaced
    // half-sphere overlapping a real one.
    gl.viewport(0, 0, el.width, el.height);
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
        program,
        uniforms,
        // Base canvas size in px - the canvas itself never changes;
        // visual sphere size comes from the scale uniform, so the
        // disc can grow well beyond the canvas without reallocating
        // the GL surface.
        baseSize: size,
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
        faceCount: 1
    };

    // --------------------------------------------------------
    // Pointer interaction: click = select, drag = spin (or move
    // with Shift / Move mode). A click with barely any movement
    // selects; a drag never changes the selection.
    // --------------------------------------------------------
    let downXY = null;
    let dragging = false;
    let moving = false;
    let lx = 0;
    let ly = 0;
    let shiftDown = false;

    const wantsMove = () =>
        moveMode || shiftDown;

    el.addEventListener('pointerdown', (e) => {

        downXY = [e.clientX, e.clientY];
        dragging = true;
        moving = wantsMove();
        lx = e.clientX;
        ly = e.clientY;

        // The pointerId can be invalidated between the event and
        // this call (e.g. a touch-scroll cancelled it) - capture is
        // an optimization, so a failure here shouldn't kill the
        // interaction.
        try {
            el.setPointerCapture(e.pointerId);
        } catch (err) {
            console.warn(
                `sphere ${sphere.id}: pointer capture failed (interaction still works):`,
                err.message
            );
        }

        console.log(
            `sphere ${sphere.id}: pointer down (${moving ? 'MOVE' : 'SPIN'} mode)`
        );
    });

    el.addEventListener('pointermove', (e) => {

        if (!dragging) {

            // Hover feedback only - cursor shows what a press
            // would do.
            el.classList.toggle('force-move', wantsMove());
            return;
        }

        const dx = e.clientX - lx;
        const dy = e.clientY - ly;
        lx = e.clientX;
        ly = e.clientY;

        if (moving) {

            moveSphereTo(
                sphere,
                sphere.centerX + dx,
                sphere.centerY + dy
            );

            return;
        }

        sphere.phi += dx * 0.01;
        sphere.theta += dy * 0.01;
    });

    el.addEventListener('pointerup', (e) => {

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
            // sphere). Double-click is what opens the file picker -
            // see the dblclick listener below.
            selectSphere(sphere);
        }
    });

    // Double-click a sphere to choose an image/GIF for it (single
    // drag/drop also works).
    el.addEventListener('dblclick', (e) => {

        e.stopPropagation();

        selectSphere(sphere);
        openFilePickerForSphere(sphere);
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

    field.appendChild(el);

    // Track center coordinates for move-drag (style.left/top hold
    // the top-left corner).
    sphere.centerX = x;
    sphere.centerY = y;

    return sphere;
}

// Reposition a sphere so its CENTER lands at (x, y).
function moveSphereTo(sphere, x, y) {

    const w = sphere.el.offsetWidth;
    const h = sphere.el.offsetHeight;

    sphere.centerX = x;
    sphere.centerY = y;

    sphere.el.style.left = `${x - w / 2}px`;
    sphere.el.style.top = `${y - h / 2}px`;
}

// Resize a sphere's canvas when its scale changes.
//
// Shader geometry: the disc's diameter is always 0.64 * (scale
// uniform) * canvasWidth. That means ANY scale-uniform value other
// than 1 eventually overflows the canvas and clips the sphere into
// a square. So for field spheres we keep the uniform at 1 and do
// ALL sizing through the canvas itself: the disc is then always
// exactly 64% of the canvas, and growing/shrinking the canvas CSS
// size grows/shrinks the sphere linearly - never clipped, never
// square, at any scale.
function resizeSphereCanvas(sphere) {

    const scale = Math.max(0.05, sphere.controls.scale || 1);

    // Visual disc = baseSize * scale; disc = 0.64 * canvas, so:
    const cssSize = Math.ceil(sphere.baseSize * scale / 0.64);

    // GL buffer follows the CSS size (capped for GPU sanity - past
    // the cap CSS stretch keeps the exact visual size, just softer).
    const maxBuffer = 1200;
    const bufferPx = Math.min(cssSize, maxBuffer);

    // Keep the scale uniform pinned at 1 - see the comment above.
    sphere.gl.useProgram(sphere.program);
    sphere.gl.uniform1f(sphere.uniforms.scale, 1);

    if (
        sphere.el.width !== bufferPx ||
        sphere.el.height !== bufferPx ||
        parseFloat(sphere.el.style.width) !== cssSize
    ) {

        const oldW = sphere.el.width;

        sphere.el.width = bufferPx;
        sphere.el.height = bufferPx;
        sphere.el.style.width = `${cssSize}px`;
        sphere.el.style.height = `${cssSize}px`;

        moveSphereTo(sphere, sphere.centerX, sphere.centerY);

        // Resizing a canvas clears it and resets GL state.
        sphere.gl.viewport(0, 0, sphere.el.width, sphere.el.height);
        sphere.gl.uniform2f(
            sphere.uniforms.uResolution,
            sphere.el.width,
            sphere.el.height
        );

        console.log(
            `sphere ${sphere.id}: canvas resized ${oldW} -> ${bufferPx} (css ${cssSize}px, scale ${scale})`
        );
    }

    // Selection marker hugs the disc (64% of the canvas) + margin.
    sphere.el.style.setProperty('--sel-radius', '70%');

    renderFieldSphere(sphere, sphere.phi, sphere.theta);
    updateSelectionMarker(sphere);
}

// ------------------------------------------------------------
// Selection
// ------------------------------------------------------------

function selectSphere(sphere) {

    if (selectedSphere === sphere) {
        return;
    }

    if (selectedSphere) {
        selectedSphere.el.classList.remove('selected');
    }

    selectedSphere = sphere;

    if (sphere) {

        sphere.el.classList.add('selected');
        sphere.el.dataset.label = `Sphere ${sphere.id}`;

        console.log(`sphere ${sphere.id}: SELECTED (sidebar now drives this sphere)`);
    } else {

        console.log('selection cleared');
    }

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
// Move mode
// ------------------------------------------------------------

function setMoveMode(on) {

    moveMode = on;

    for (const s of fieldSpheres) {
        s.el.classList.toggle('move-mode', on);
    }
}

function isMoveMode() {

    return moveMode;
}

// ------------------------------------------------------------
// Deletion
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

    const ext =
        sphere.gl.getExtension('WEBGL_lose_context');

    if (ext) ext.loseContext();

    sphere.el.remove();
}

// Frees the GL textures backing sphere.frames (if any) and clears
// it. Split out since both a fresh GIF-as-primary upload and a
// switch into face-composite mode need to stop/discard whatever
// animation was previously playing.
function disposeFieldSphereFrames(sphere) {

    if (sphere.frames) {

        for (const f of sphere.frames) {
            sphere.gl.deleteTexture(f.texture);
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
    // - keeps per-sphere GPU memory modest, since up to 9 of these
    // WebGL contexts can be active at once.
    const canvas =
        generateGlobeTexture(
            source,
            angularRadius,
            1024,
            faceCount
        );

    if (sphere.texture) {
        sphere.gl.deleteTexture(sphere.texture);
    }

    sphere.texture =
        uploadTex(sphere.gl, canvas);

    disposeFieldSphereFrames(sphere);

    renderFieldSphere(sphere, sphere.phi, sphere.theta);
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

            if (sphere.texture) {
                sphere.gl.deleteTexture(sphere.texture);
                sphere.texture = null;
            }

            disposeFieldSphereFrames(sphere);

            sphere.frames = baked.map(b => ({
                texture: uploadTex(sphere.gl, b.canvas),
                delay: b.delay
            }));

            sphere.frameIndex = 0;
            sphere.elapsedMs = 0;

            renderFieldSphere(sphere, sphere.phi, sphere.theta);

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
            setFaceImage(sphere, faceIndex, img);

            URL.revokeObjectURL(url);
        }

    } catch (err) {

        console.error(
            `sphere ${sphere.id}: load FAILED for ${file.name}:`,
            err
        );
    }
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

    gl.useProgram(sphere.program);

    gl.uniform1f(sphere.uniforms.phi, phiVal);
    gl.uniform1f(sphere.uniforms.theta, thetaVal);

    gl.activeTexture(gl.TEXTURE0);

    if (sphere.frames && sphere.frames.length > 0) {

        const frame =
            sphere.frames[
                sphere.frameIndex % sphere.frames.length
            ];

        gl.bindTexture(gl.TEXTURE_2D, frame.texture);

    } else if (sphere.texture) {

        // Explicit on purpose (rather than relying on whatever
        // texture uploadTex() last left bound): without this, a
        // static image uploaded onto a sphere that was previously
        // showing a GIF never actually appeared - sphere.texture got
        // updated, but the GIF's last frame stayed bound and kept
        // being drawn every tick since nothing told the GPU to
        // switch.
        gl.bindTexture(gl.TEXTURE_2D, sphere.texture);
    }

    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
}

// ------------------------------------------------------------
// Field animation loop - advances every sphere's rotation and GIF
// playback on one shared rAF. Rotation behavior (spin type, speed,
// pause) comes from each sphere's own controls object, which the
// sidebar writes into for the selected sphere.
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
// Public controls (used by main.js's sidebar bridge)
// ------------------------------------------------------------

// Rotation rates matching the main globe's animate() loop, so the
// Spin speed slider means the same thing in both modes.
const PHI_RATE = 0.002;
const THETA_RATE = 0.0007;

function setSphereDots(sphere, v) {

    if (!sphere) return;

    console.log(`sphere ${sphere.id}: dots = ${v}`);

    sphere.controls.dots = v;

    sphere.gl.useProgram(sphere.program);
    sphere.gl.uniform1f(sphere.uniforms.dots, v);
}

function setSphereScale(sphere, v) {

    if (!sphere) return;

    console.log(`sphere ${sphere.id}: scale = ${v}`);

    sphere.controls.scale = v;

    sphere.gl.useProgram(sphere.program);
    sphere.gl.uniform1f(sphere.uniforms.scale, v);

    // The selection marker is a FIXED-SIZE badge ring (see CSS) -
    // it never grows with the sphere. When the sphere's rendered
    // disc outgrows the badge, the badge turns red so you can still
    // spot it on/around the giant sphere.
    resizeSphereCanvas(sphere);
}

// Sizes/colors the selection marker for a sphere. Rendered disc
// radius in px is (baseSize/2) / scale (shader: r = 0.8/(scale*0.8)
// of the half-canvas), clamped by the canvas edge.
function updateSelectionMarker(sphere) {

    if (!sphere) return;

    const el = sphere.el;
    const scale = Math.max(0.05, sphere.controls.scale || 1);

    // Disc radius as fraction of the canvas (max 100% - the canvas
    // clips anything bigger).
    const discFraction = Math.min(1, 1 / scale);

    // Marker diameter: the disc size, but never larger than 36px.
    // Once the disc exceeds that, the marker sits ON the sphere
    // (red) instead of surrounding it (blue).
    const discPx = discFraction * sphere.baseSize;
    const markerDiameter = Math.min(discPx, 36);
    const overflow = discPx > 36;

    el.style.setProperty(
        '--sel-size',
        `${markerDiameter}px`
    );

    el.classList.toggle('marker-overflow', overflow);

    if (el.classList.contains('selected')) {

        console.log(
            `sphere ${sphere.id}: selection marker ${overflow ? 'OVERFLOW (red, on-sphere)' : 'surrounding'} - disc ${discPx.toFixed(0)}px`
        );
    }
}

function setSphereGlowColor(sphere, rgb01) {

    if (!sphere) return;

    console.log(
        `sphere ${sphere.id}: glowColor = rgb(${rgb01.map(n => n.toFixed(2))})`
    );

    sphere.controls.glowColor = rgb01;

    sphere.gl.useProgram(sphere.program);
    sphere.gl.uniform3f(
        sphere.uniforms.glowColor,
        rgb01[0],
        rgb01[1],
        rgb01[2]
    );
}

function setSphereOpacity(sphere, v) {

    if (!sphere) return;

    console.log(`sphere ${sphere.id}: opacity = ${v}`);

    sphere.controls.opacity = v;

    sphere.gl.useProgram(sphere.program);
    sphere.gl.uniform1f(sphere.uniforms.opacity, v);
}

function setSphereIgnoreAlpha(sphere, on) {

    if (!sphere) return;

    console.log(
        `sphere ${sphere.id}: solid image (ignoreAlpha) = ${on ? 'ON' : 'OFF'}`
    );

    sphere.controls.ignoreAlpha = on ? 1 : 0;

    sphere.gl.useProgram(sphere.program);
    sphere.gl.uniform1f(
        sphere.uniforms.uIgnoreAlpha,
        on ? 1 : 0
    );
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

    sphere.gl.useProgram(sphere.program);
    sphere.gl.uniform1f(
        sphere.uniforms.uUseDots,
        v
    );
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

    field.classList.add('active');
    startFieldLoop();
}

// Leaves field mode entirely: tears every sphere down (freeing the
// WebGL contexts) and clears the selection, so the app is back to
// the plain single-globe view. The ID counter restarts too, so the
// next session's spheres are labeled 1..N again instead of
// continuing from wherever the last session left off.
export function closeSphereField() {

    for (const s of [...fieldSpheres]) {
        deleteSphere(s);
    }

    selectSphere(null);

    fieldNextId = 1;

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

        console.log(
            `sphere ${s.id}: spawned at (${Math.round(x)}, ${Math.round(y)}) size ${size}px (${fieldSpheres.length} active)`
        );

        // New spheres become the active selection immediately, so
        // the sidebar drives the thing you just made.
        selectSphere(s);
    }

    return s;
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
    getSphereControls
};

// Double-click empty space spawns a sphere there.
field.addEventListener('dblclick', (e) => {

    if (e.target === field) {
        spawnSphereAt(e.clientX, e.clientY);
    }
});

// Click empty field space deselects.
field.addEventListener('pointerdown', (e) => {

    if (e.target === field && selectedSphere) {
        selectSphere(null);
    }
});

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