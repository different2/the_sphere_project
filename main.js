// Phenomenon library
import Phenomenon from './phenomenon.js';

// Predefined textures
import { textures, createTextTexture } from './textures.js';

// Fragment shader
import fragmentShader from './fragmentShader.js';

// GIF encoder (vendored, see vendor/README.md)
import { GIFEncoder, quantize, applyPalette } from './vendor/gifenc.esm.js';

// GIF decoder (vendored, see vendor/README.md)
import { parseGIF, decompressFrames } from './vendor/gifuct.esm.js';

// Multi-sphere field mode
import {
    openSphereField,
    spawnSphereAt,
    clearFieldSpheres,
    closeSphereField,
    selectSphere,
    getSelectedSphere,
    deleteSphere,
    onSelectionChanged,
    loadFileOntoFieldSphere,
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
    getSphereControls
} from './sphere-field.js';

const vertexShader = `
attribute vec3 aPosition;

void main() {
    gl_Position = vec4(aPosition, 1.0);
}
`;

// ============================================================
// Canvas setup
// ============================================================

const canvas = document.getElementById('globe');

let p = null;
let instance = null;
let currentTexture = null;

// Animation variables
let phi = 0;
let theta = 0;
let dots = 25000;
let scale = 1.0;

let animationStarted = false;

// 1 = normal dotted globe
// 0 = crisp texture mode
let useDots = 0;

// How many copies of the current custom image appear on the globe.
// Only applies to Upload Image - Text Message always uses the full sphere
// wrap (see applyCustomText).
// 1 = single image stretched to wrap the whole sphere once.
// 2/3/4/6 = that many circular "logo" copies placed around the sphere.
let faceCount = 1;

// 'randomized' = current/default tumbling dual-axis spin.
// 'axis' = clean single-axis spin, like a globe on a stand.
let spinType = 'randomized';

// When true, phi/theta stop auto-incrementing each frame (but the scene
// keeps rendering), so the manual Phi/Theta sliders actually stick instead
// of being overwritten on the next frame.
let isPaused = false;

// Per-frame rotation increments for the live animation. Kept as named
// constants (rather than inline magic numbers) because the GIF exporter
// below needs to know the exact ratio between them to compute a seamless
// loop length.
const PHI_RATE = 0.008;
const THETA_RATE = 0.004;

// User-controlled multiplier on both rates (Spin speed slider). 1 = the
// original speed, 0 = effectively paused (without using Pause spin), >1
// = faster. Exported GIFs use it too so exports match what's on screen.
let spinSpeedMultiplier = 1.0;

// Face size multiplier for custom images - scales every face's angular
// patch without touching the sphere itself (Face Size slider). Applied
// at bake/composite time via getAngularRadiusForFaceCount.
let faceSizeMultiplier = 1.0;

// Tracks what kind of custom content is currently active, so the Face
// Count control knows what to regenerate from when it changes.
// 'image' | 'text' | null
let activeCustomKind = null;

// ============================================================
// Debug logging + dropdown sync helpers
//
// debugLog is off by default (?debug=1 in the URL or
// localStorage.globeDebug = '1' turns it on). It records routing
// decisions and guard exits so "nothing happened" bugs point at the
// exact line where the flow bailed, without spamming the console
// during normal use.
// ============================================================

const DEBUG_ENABLED =
    new URLSearchParams(window.location.search).has('debug') ||
    window.localStorage.getItem('globeDebug') === '1';

function debugLog(...args) {

    if (!DEBUG_ENABLED) {
        return;
    }

    console.log('[debug]', ...args);
}

// Surface async failures that would otherwise vanish silently.
window.addEventListener(
    'unhandledrejection',
    (e) => {

        console.error(
            '[Unhandled promise rejection]',
            e.reason
        );
    }
);

window.addEventListener(
    'error',
    (e) => {

        console.error(
            '[Uncaught error]',
            e.message,
            e.filename ? `${e.filename}:${e.lineno}` : ''
        );
    }
);

// Keeps the Texture dropdown's displayed value in sync with what the
// globe is actually showing. Upload paths change the globe WITHOUT
// moving the dropdown, so the select could sit on a stale value -
// and re-picking that same value then fired no change event at all,
// which looked like "the dropdown does nothing".
// NOTE: references `textureSelect`, declared further down; only ever
// called from event handlers, i.e. after this module has evaluated.
function syncTextureSelect(value) {

    if (!textureSelect) {
        return;
    }

    if (textureSelect.value !== value) {

        debugLog(
            `syncTextureSelect: '${textureSelect.value}' -> '${value}'`
        );

        textureSelect.value = value;
    }
}

// Cached per-face source images for the currently active custom image
// upload, so switching Face Count or editing a single face doesn't
// require re-uploading everything. Keyed by face index (0 = primary,
// used for every face that doesn't have its own override, and used
// as-is for faceCount === 1 full-wrap mode).
let rawCustomImages = {};

// Highest face count the per-face upload UI supports - matches the
// highest value in the Face Count radio group.
const MAX_FACE_SLOTS = 6;

// ============================================================
// Independent per-face animation (shader-composited mode)
//
// Each per-face slot can hold its OWN animated GIF - decoded once,
// uploaded as one WebGL texture per frame, and advanced on its own
// timer inside animate(). The fragment shader composites all six
// face textures live (sampleFaceComposite), so no per-frame CPU
// rebake is needed and every face animates independently.
//
// faceSlotContent[i] = {
//   kind: 'gif' | 'image',
//   frames: [{texture, delay}]   - gif: baked frame textures
//   image: <img>                 - image: static source
//   texture: <WebGLTexture>      - image: uploaded texture
//   width, height,               - source dimensions (for logoScale)
//   frameIndex, elapsedMs        - gif playback state
// }
//
// While this mode is active, uUseFaces=1 and the shader does the
// compositing; the CPU-baked uTexture path is untouched for every
// other texture source. The choose-file pipeline routes GIFs into
// slot 0 of this system when the per-face UI is visible (so a GIF
// chosen either way plays animated), otherwise it keeps using the
// classic whole-globe bake pipeline unchanged.
// ============================================================

const faceSlotContent = {};

let faceCompositeActive = false;

let isExportingGif = false;

// ============================================================
// Animated GIF uploads
//
// Uploading a .gif (via the main Upload Image picker) decodes every
// frame up front, bakes each one through the normal
// generateGlobeTexture() pipeline (same face count as a static
// upload), and uploads each as its own WebGL texture - all before
// playback starts. animate() just switches which pre-baked texture is
// bound, on a timer matching the GIF's own per-frame delays, so
// there's no per-frame decoding/baking cost during playback.
//
// Per-face override slots have their OWN animation system (see
// faceSlotContent above) - a GIF picked through a per-face button
// animates independently on that face, composited live in the shader.
// ============================================================

// Bake resolution for GIF frames - smaller than the 2048 used for
// static images, since this cost is paid once per FRAME rather than
// once per upload.
const GIF_BAKE_TEX_WIDTH = 1024;

// Upper bound on how many frames get baked - very long/high-fps GIFs
// are subsampled down to this, to keep upload processing time and
// GPU memory bounded.
const MAX_GIF_FRAMES = 60;

// The decoded (but not yet re-baked) source frames of the currently
// active user-uploaded GIF, kept around so changing Face Count can
// re-bake at the new count without re-decoding the file. null when no
// user GIF is active.
let rawGifFrames = null;

// The current user-uploaded GIF's pre-baked, ready-to-display WebGL
// textures + each frame's delay in ms. null when no user GIF is
// active. Always faceCount-aware (see rebakeAnimatedGifFrames).
let animatedGifFrames = null;

// The Laughing Man preset's own baked frames (see loadLaughingMan) -
// fetched, decoded and baked once, then cached for the rest of the
// session. Kept entirely separate from animatedGifFrames/rawGifFrames
// above so switching away from an uploaded GIF (which deletes its
// textures) never touches this cache, and vice versa.
let laughingManFrames = null;

// Whichever of animatedGifFrames / laughingManFrames is currently
// driving playback - the two are mutually exclusive (selecting one
// deactivates the other), so animate() just cycles through this one
// pointer without needing to know which source it came from. null
// when the active texture isn't animated at all (a static image,
// Earth, or text).
let activeAnimatedFrames = null;

let animatedGifFrameIndex = 0;
let animatedGifElapsedMs = 0;
let lastAnimationTimestamp = null;

let isProcessingGif = false;

// Monotonically-increasing counter representing "the current
// texture-loading intent". Several texture-loading paths are async
// (fetching/decoding a GIF, waiting for an <img> to decode) and yield
// control while they work, so the person can switch to a different
// texture before an earlier one finishes. Each such path captures
// this value when it starts and checks it's unchanged before actually
// updating what's displayed - if it's changed, something newer has
// since been requested, so the update is skipped (the work already
// done may still be cached, depending on the path) rather than
// clobbering whatever's since been chosen. Without this, e.g.
// selecting Earth right after the page loads could still get silently
// overridden a moment later when Laughing Man's own background load
// finishes and unconditionally rebinds itself.
let loadGeneration = 0;

// The name of the last file chosen via the main upload <input>, kept
// purely for display (see showUploadStatusIdle below). The <input>'s
// own value gets reset to '' right after each file is read so the
// SAME file can be re-selected later - which also reverts its native
// "No file chosen" text, so uploadStatus is used to show the actual
// last-chosen filename instead.
let lastUploadedFileName = null;

// ============================================================
// Canvas resizing
// ============================================================

function resizeCanvas() {
    const width = window.innerWidth;
    const height = window.innerHeight;

    // CSS layout size only - the DRAWING BUFFER is owned by
    // Phenomenon's own resize handler (client size x
    // devicePixelRatio). Setting canvas.width/height here as well
    // made the two handlers fight over the buffer size, leaving
    // uResolution and gl_FragCoord in different coordinate spaces
    // depending on which handler ran last.
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';

    if (p && p.gl) {
        p.gl.viewport(0, 0, p.gl.drawingBufferWidth, p.gl.drawingBufferHeight);

        if (instance) {
            // Always the true buffer size, matching gl_FragCoord's
            // space exactly (same convention as sphere-field.js).
            p.uniforms.uResolution = {
                type: "vec2",
                value: [
                    p.gl.drawingBufferWidth,
                    p.gl.drawingBufferHeight
                ]
            };
        }
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', resizeCanvas);
} else {
    resizeCanvas();
}

// ============================================================
// Load normal image
// ============================================================

function loadImage(imageSrc) {
    return new Promise((resolve, reject) => {
        const image = new Image();

        image.onload = () => {
            console.log(
                `Image loaded: ${image.width}x${image.height}`
            );

            resolve(image);
        };

        image.onerror = () => {
            reject(
                new Error(
                    `Failed to load image: ${imageSrc}`
                )
            );
        };

        image.src = imageSrc;
    });
}

// ============================================================
// WebGL texture creation
// ============================================================

function createTexture(gl, imageData) {
    return new Promise((resolve, reject) => {

        const image = new Image();

        image.onload = function() {

            try {

                console.log(
                    `Loading image: ${image.width}x${image.height}`
                );

                // See uploadCanvasAsTexture for why this is saved and
                // restored rather than just unbinding to null - this
                // function is async (waits for the Image to load), so
                // something else may be actively relying on whatever
                // is currently bound by the time this callback runs.
                const previousBinding =
                    gl.getParameter(gl.TEXTURE_BINDING_2D);

                const texture =
                    gl.createTexture();

                if (!texture) {
                    throw new Error(
                        "WebGL could not create the texture"
                    );
                }

                gl.bindTexture(
                    gl.TEXTURE_2D,
                    texture
                );

                gl.texImage2D(
                    gl.TEXTURE_2D,
                    0,
                    gl.RGBA,
                    gl.RGBA,
                    gl.UNSIGNED_BYTE,
                    image
                );

                gl.texParameteri(
                    gl.TEXTURE_2D,
                    gl.TEXTURE_WRAP_S,
                    gl.CLAMP_TO_EDGE
                );

                gl.texParameteri(
                    gl.TEXTURE_2D,
                    gl.TEXTURE_WRAP_T,
                    gl.CLAMP_TO_EDGE
                );

                gl.texParameteri(
                    gl.TEXTURE_2D,
                    gl.TEXTURE_MIN_FILTER,
                    gl.LINEAR
                );

                gl.texParameteri(
                    gl.TEXTURE_2D,
                    gl.TEXTURE_MAG_FILTER,
                    gl.LINEAR
                );

                const error =
                    gl.getError();

                if (error !== gl.NO_ERROR) {

                    console.error(
                        "WebGL error while creating texture:",
                        error
                    );

                    gl.bindTexture(
                        gl.TEXTURE_2D,
                        previousBinding
                    );

                    gl.deleteTexture(texture);

                    throw new Error(
                        `WebGL texture error: ${error}`
                    );
                }

                gl.bindTexture(
                    gl.TEXTURE_2D,
                    previousBinding
                );

                console.log(
                    `Texture created successfully: ${image.width}x${image.height}`
                );

                resolve(texture);

            } catch (error) {

                reject(error);

            }
        };

        image.onerror = function() {

            reject(
                new Error(
                    "Failed to load image"
                )
            );

        };

        image.src = imageData;
    });
}

// ============================================================
// Vector helpers for custom globe texture generation
// ============================================================

function normalize(v) {

    const length = Math.hypot(
        v.x,
        v.y,
        v.z
    );

    return {
        x: v.x / length,
        y: v.y / length,
        z: v.z / length
    };
}

function dot3(a, b) {

    return (
        a.x * b.x +
        a.y * b.y +
        a.z * b.z
    );
}

function cross3(a, b) {

    return {
        x: a.y * b.z - a.z * b.y,
        y: a.z * b.x - a.x * b.z,
        z: a.x * b.y - a.y * b.x
    };
}

// ============================================================
// Create a tangent basis for a point on the sphere
// ============================================================

function createTangentBasis(center) {

    let reference;

    /*
     * Don't use a reference vector parallel to the
     * surface normal.
     *
     * This is especially important at the north/south poles.
     */
    if (Math.abs(center.y) < 0.9) {

        reference = {
            x: 0,
            y: 1,
            z: 0
        };

    } else {

        reference = {
            x: 0,
            y: 0,
            z: 1
        };

    }

    const east =
        normalize(
            cross3(
                reference,
                center
            )
        );

    const north =
        normalize(
            cross3(
                center,
                east
            )
        );

    return {
        east,
        north
    };
}

// ============================================================
// Face layouts for the custom-content globe texture
//
// faceCount === 1 is handled separately (see generateFullWrapTexture) -
// the image/text is stretched to cover the whole sphere once instead of
// being placed as discrete circular "logo" copies.
//
// For 2 and 3 faces, one center is always placed at (0,0,1) - dead center
// of the default (unrotated) camera view - so something is visible
// immediately without having to spin the globe first. This matches how
// the original 6-face layout already had an equatorial face front-and-
// center by default.
// ============================================================

function getFaceCenters(faceCount) {

    if (faceCount === 2) {

        return [
            { x: 0, y: 0, z: 1 },
            { x: 0, y: 0, z: -1 }
        ];
    }

    if (faceCount === 3) {

        const centers = [];

        for (let i = 0; i < 3; i++) {

            const lon =
                Math.PI / 2 +
                (i / 3) * Math.PI * 2;

            centers.push({
                x: Math.cos(lon),
                y: 0,
                z: Math.sin(lon)
            });
        }

        return centers;
    }

    if (faceCount === 4) {

        // The same four equatorial positions used by the 6-face
        // layout below, just without the two poles. This keeps 4->6
        // a consistent progression: going from 4 to 6 faces only
        // adds the poles, it doesn't rearrange anything that was
        // already placed.
        return [
            { x: 0, y: 0, z: 1 },
            { x: 1, y: 0, z: 0 },
            { x: 0, y: 0, z: -1 },
            { x: -1, y: 0, z: 0 }
        ];
    }

    // 6 faces: original Laughing Man layout (unchanged).
    // Two poles + four equatorial positions.
    return [

        // North pole
        { x: 0, y: 1, z: 0 },

        // South pole
        { x: 0, y: -1, z: 0 },

        // Equator
        { x: 1, y: 0, z: 0 },
        { x: 0, y: 0, z: 1 },
        { x: -1, y: 0, z: 0 },
        { x: 0, y: 0, z: -1 }
    ];
}

// Bigger patches look better when there are fewer of them spread around
// the sphere. 6 keeps the original Laughing Man sizing untouched.
//
// NOTE for future face counts (5, 7-10, etc.): this is intentionally a
// simple per-count lookup rather than a general N-point sphere-distribution
// algorithm, since only 1/2/3/4/6 are needed today. If more counts are
// added later, getFaceCenters() above is the function to generalize (e.g.
// a Fibonacci-sphere or similar even-distribution formula) - everything
// else (generateGlobeTexture, the per-face image UI, etc.) already just
// asks "how many faces, and what are their centers" and doesn't otherwise
// care what count it is.
function getAngularRadiusForFaceCount(faceCount) {

    const base =
        faceCount === 2 ? 45 :
        faceCount === 3 ? 36 :
        faceCount === 4 ? 32 :
        28;

    // Face Size slider scales every patch. Clamped so patches can
    // never grow past the hemisphere (cos 90° = 0) - beyond that the
    // gnomonic projection degenerates.
    return Math.min(
        89,
        base * faceSizeMultiplier
    );
}

// ============================================================
// Generate a "1 face" globe texture: the source image/text is
// stretched to cover the whole equirectangular map once, i.e. it
// wraps around the entire sphere instead of repeating.
//
// This needs a horizontal flip to appear correctly oriented (not
// mirrored) when sampled onto the sphere - verified against the
// shader's actual texture-coordinate formula, the same flip the
// original text preset already relied on.
// ============================================================

function generateFullWrapTexture(
    sourceImg,
    texWidth = 2048
) {

    const texHeight =
        texWidth / 2;

    const canvas =
        document.createElement('canvas');

    canvas.width = texWidth;
    canvas.height = texHeight;

    const ctx =
        canvas.getContext('2d');

    ctx.save();

    ctx.translate(texWidth, 0);
    ctx.scale(-1, 1);

    ctx.drawImage(
        sourceImg,
        0,
        0,
        texWidth,
        texHeight
    );

    ctx.restore();

    return canvas;
}

// ============================================================
// Generate multi-logo globe texture
//
// faceCount = 1: delegates to generateFullWrapTexture (see above).
// `source` is a single image/canvas in that case.
//
// faceCount = 2/3/4/6: places that many circular copies around the
// sphere (gnomonic tangent-plane projection per face). `source` here
// is an ARRAY of length faceCount - one image per face, so each face
// can (optionally) show something different. Each face's image keeps
// its own aspect ratio/scale, computed independently, so mixing a
// portrait photo on one face and a square logo on another still
// fills each circular patch sensibly.
// ============================================================

function generateGlobeTexture(
    source,
    angularRadiusDeg = 28,
    texWidth = 2048,
    faceCount = 6
) {

    if (faceCount === 1) {

        return generateFullWrapTexture(
            source,
            texWidth
        );
    }

    const texHeight =
        texWidth / 2;

    const canvas =
        document.createElement('canvas');

    canvas.width =
        texWidth;

    canvas.height =
        texHeight;

    const ctx =
        canvas.getContext('2d', {
            willReadFrequently: true
        });

    if (!ctx) {
        throw new Error(
            "Could not create 2D canvas context"
        );
    }

    // --------------------------------------------------------
    // Face positions for this face count
    // --------------------------------------------------------

    const centers =
        getFaceCenters(faceCount);

    // --------------------------------------------------------
    // Create tangent coordinate systems
    // --------------------------------------------------------

    const bases =
        centers.map(
            center =>
                createTangentBasis(center)
        );

    // --------------------------------------------------------
    // Angular size shared by every face
    // --------------------------------------------------------

    const radiusRad =
        angularRadiusDeg *
        Math.PI /
        180;

    const halfSize =
        Math.tan(radiusRad);

    // --------------------------------------------------------
    // Per-face image resources.
    //
    // `source` is either one image (same picture on every face) or
    // an array with one entry per face (different picture per face).
    // Each face reads its own pixels and computes its own logoScale
    // from its own width/height, since different faces can have
    // different source images with different dimensions.
    // --------------------------------------------------------

    const images =
        Array.isArray(source) ?
            source :
            centers.map(() => source);

    const faces =
        images.map((img) => {

            const logoCanvas =
                document.createElement('canvas');

            logoCanvas.width =
                img.width;

            logoCanvas.height =
                img.height;

            const logoCtx =
                logoCanvas.getContext('2d', {
                    willReadFrequently: true
                });

            logoCtx.drawImage(
                img,
                0,
                0
            );

            const pixels =
                logoCtx.getImageData(
                    0,
                    0,
                    img.width,
                    img.height
                ).data;

            const logoRadius =
                Math.max(
                    img.width,
                    img.height
                ) / 2;

            return {
                width: img.width,
                height: img.height,
                pixels,
                logoScale: halfSize / logoRadius
            };
        });

    // --------------------------------------------------------
    // Output pixel buffer
    // --------------------------------------------------------

    const imageData =
        ctx.createImageData(
            texWidth,
            texHeight
        );

    const data =
        imageData.data;

    // --------------------------------------------------------
    // Convert longitude / latitude to sphere direction
    // --------------------------------------------------------

    function toCart(lon, lat) {

        const cosLat =
            Math.cos(lat);

        return {
            x: cosLat * Math.cos(lon),
            y: Math.sin(lat),
            z: cosLat * Math.sin(lon)
        };
    }

    // --------------------------------------------------------
    // Bilinear sample from a given face's image
    // --------------------------------------------------------

    function sampleFace(face, lx, ly) {

        if (
            lx < 0 ||
            ly < 0 ||
            lx >= face.width ||
            ly >= face.height
        ) {
            return null;
        }

        const x0 =
            Math.floor(lx);

        const y0 =
            Math.floor(ly);

        const x1 =
            Math.min(
                x0 + 1,
                face.width - 1
            );

        const y1 =
            Math.min(
                y0 + 1,
                face.height - 1
            );

        const fx =
            lx - x0;

        const fy =
            ly - y0;

        function pixel(x, y) {

            const index =
                (y * face.width + x) * 4;

            return [
                face.pixels[index],
                face.pixels[index + 1],
                face.pixels[index + 2],
                face.pixels[index + 3]
            ];
        }

        const p00 =
            pixel(x0, y0);

        const p10 =
            pixel(x1, y0);

        const p01 =
            pixel(x0, y1);

        const p11 =
            pixel(x1, y1);

        const result = [];

        for (
            let channel = 0;
            channel < 4;
            channel++
        ) {

            const top =
                p00[channel] * (1 - fx) +
                p10[channel] * fx;

            const bottom =
                p01[channel] * (1 - fx) +
                p11[channel] * fx;

            result[channel] =
                top * (1 - fy) +
                bottom * fy;
        }

        return result;
    }

    // --------------------------------------------------------
    // Generate texture
    // --------------------------------------------------------

    for (
        let y = 0;
        y < texHeight;
        y++
    ) {

        const v =
            y / (texHeight - 1);

        const lat =
            (1 - v) * Math.PI -
            Math.PI / 2;

        for (
            let x = 0;
            x < texWidth;
            x++
        ) {

            const u =
                x / (texWidth - 1);

            const lon =
                u * Math.PI * 2 -
                Math.PI;

            const dir =
                toCart(
                    lon,
                    lat
                );

            let output = null;

            // ------------------------------------------------
            // Try each face
            // ------------------------------------------------

            for (
                let i = 0;
                i < centers.length;
                i++
            ) {

                const center =
                    centers[i];

                const basis =
                    bases[i];

                const face =
                    faces[i];

                const centerDot =
                    dot3(
                        dir,
                        center
                    );

                if (centerDot <= 0) {
                    continue;
                }

                const angle =
                    Math.acos(
                        Math.max(
                            -1,
                            Math.min(
                                1,
                                centerDot
                            )
                        )
                    );

                if (angle > radiusRad) {
                    continue;
                }

                // --------------------------------------------
                // Gnomonic tangent-plane projection
                // --------------------------------------------

                const tangentX =
                    dot3(
                        dir,
                        basis.east
                    ) / centerDot;

                const tangentY =
                    dot3(
                        dir,
                        basis.north
                    ) / centerDot;

                // --------------------------------------------
                // Convert tangent position to this face's
                // image pixels
                // --------------------------------------------

                const lx =
                    tangentX / face.logoScale +
                    face.width / 2;

                const ly =
                    face.height / 2 -
                    tangentY / face.logoScale;

                const sampled =
                    sampleFace(
                        face,
                        lx,
                        ly
                    );

                if (
                    sampled &&
                    sampled[3] > 0
                ) {

                    output =
                        sampled;

                    break;
                }
            }

            // ------------------------------------------------
            // Write pixel
            // ------------------------------------------------

            const index =
                (y * texWidth + x) * 4;

            if (output) {

                data[index] =
                    output[0];

                data[index + 1] =
                    output[1];

                data[index + 2] =
                    output[2];

                data[index + 3] =
                    output[3];

            } else {

                data[index] = 0;
                data[index + 1] = 0;
                data[index + 2] = 0;
                data[index + 3] = 0;

            }
        }
    }

    ctx.putImageData(
        imageData,
        0,
        0
    );

    console.log(
        `Generated ${texWidth}x${texHeight} texture (${faceCount} face(s))`
    );

    return canvas;
}

// ============================================================
// Load a normal texture
//
// This only loads/binds the WebGL texture. It does NOT touch
// useDots - callers decide the appropriate dots on/off default for
// whatever they just loaded (see setUseDots below).
// ============================================================

async function loadTexture(
    textureData
) {

    if (!p || !p.gl) {

        console.warn(
            "WebGL is not ready yet"
        );

        return;
    }

    loadGeneration++;

    const myGeneration =
        loadGeneration;

    try {

        console.log(
            "Loading new texture..."
        );

        const texture =
            await createTexture(
                p.gl,
                textureData
            );

        if (myGeneration !== loadGeneration) {

            // A newer texture request came in while this one was
            // still loading - don't touch the display, and free this
            // now-unneeded texture rather than leaking it.
            p.gl.deleteTexture(texture);

            console.log(
                "Texture finished loading but a newer one was requested in the meantime - discarding"
            );

            return;
        }

        p.gl.activeTexture(
            p.gl.TEXTURE0
        );

        p.gl.bindTexture(
            p.gl.TEXTURE_2D,
            texture
        );

        currentTexture =
            texture;

        console.log(
            "Texture loaded successfully"
        );

        debugLog(
            `loadTexture outcome: bound texture to unit 0, ` +
            `${texture.image ? `${texture.image.width}x${texture.image.height}` : 'size n/a'}, ` +
            `uUseDots=${useDots}, uUseFaces=${faceCompositeActive ? 1 : 0}`
        );

    } catch (error) {

        console.error(
            "Failed to load texture:",
            error
        );
    }
}

// ============================================================
// Immediately binds whichever frame animatedGifFrameIndex currently
// points to within activeAnimatedFrames. Needed right after switching
// to an animated source (cache-hit or freshly baked) since animate()'s
// own cycling logic only rebinds when a frame boundary is crossed -
// without this there'd be a flash of whatever texture unit 0 last had
// bound, until that first crossing happens.
// ============================================================

function bindActiveAnimatedFrame() {

    if (
        !activeAnimatedFrames ||
        activeAnimatedFrames.length === 0 ||
        !p ||
        !p.gl
    ) {
        return;
    }

    p.gl.activeTexture(p.gl.TEXTURE0);

    p.gl.bindTexture(
        p.gl.TEXTURE_2D,
        activeAnimatedFrames[animatedGifFrameIndex].texture
    );
}

// ============================================================
// Load Laughing Man as a globe texture
//
// Always the original fixed 6-face layout - the Face Count control
// only applies to Upload Image / Text Message.
//
// GIF-based: assets/laughingman.gif (with the text ring already
// spinning, baked into its own frames) plays the same way an uploaded
// GIF does, through the exact same decode/bake/playback pipeline.
// Fetched, decoded and baked once, then cached in laughingManFrames
// for the rest of the session - switching back to Laughing Man after
// visiting another texture just restores the cache instead of redoing
// that work.
//
// Falls back to the static assets/laughingman.png (no animation) if
// the GIF asset isn't present, so the site still works if that file
// is ever missing.
// ============================================================

// ============================================================
// Quick check for whether a decoded GIF frame has any meaningful
// transparency, sampling a subset of pixels rather than the whole
// canvas for speed. Some GIFs (including the bundled Laughing Man
// asset) encode frame 0 as a complete, fully-opaque reference image
// with NO transparency, only using proper alpha from frame 1 onward -
// see loadLaughingMan, which uses this to avoid picking such a frame
// as the quick preview.
// ============================================================

function hasUsableTransparency(canvas) {

    const ctx = canvas.getContext('2d');

    const { width, height } = canvas;

    const data =
        ctx.getImageData(0, 0, width, height).data;

    const totalPixels = width * height;

    const sampleStride =
        Math.max(
            1,
            Math.floor(totalPixels / 2000)
        );

    let transparent = 0;
    let sampled = 0;

    for (
        let i = 0;
        i < totalPixels;
        i += sampleStride
    ) {

        sampled++;

        if (data[i * 4 + 3] < 128) {
            transparent++;
        }
    }

    return (
        sampled > 0 &&
        (transparent / sampled) > 0.05
    );
}

async function loadLaughingMan() {

    if (!p || !p.gl) {

        console.warn(
            "WebGL is not ready yet"
        );

        return;
    }

    setUseDots(false);

    loadGeneration++;

    const myGeneration =
        loadGeneration;

    if (laughingManFrames) {

        activeAnimatedFrames = laughingManFrames;
        animatedGifFrameIndex = 0;
        animatedGifElapsedMs = 0;

        bindActiveAnimatedFrame();

        console.log(
            "Laughing Man loaded from cache"
        );

        return;
    }

    try {

        console.log(
            "Loading Laughing Man..."
        );

        const response =
            await fetch(textures.laughingManGif);

        if (!response.ok) {

            throw new Error(
                `GIF asset responded with ${response.status}`
            );
        }

        const arrayBuffer =
            await response.arrayBuffer();

        // ----------------------------------------------------
        // Bake + bind an early frame as soon as a good one is
        // decoded, and return right after - createGlobe() awaits this
        // whole function before starting the live animation loop, so
        // previously the canvas stayed blank until the ENTIRE GIF was
        // both decoded AND baked (measured 12+ seconds for this asset
        // - decoding alone, not baking, turned out to be the dominant
        // cost). Decoding runs in small batches (see
        // decodeGifFramesProgressive) so the page stays responsive
        // throughout. Every frame still gets decoded/composited in
        // order (needed for correct GIF disposal handling across the
        // sequence) but only the ones kept after MAX_GIF_FRAMES
        // subsampling get the pricier texture bake. Everything after
        // the preview frame happens in the background (see the
        // .then() chain) without being awaited here, appended to the
        // SAME array laughingManFrames/activeAnimatedFrames already
        // point to - animate() re-reads .length every tick, so it
        // naturally starts including them as they arrive.
        //
        // The preview frame is deliberately NOT always frame 0: some
        // GIFs (this one included) encode frame 0 as a complete,
        // fully-OPAQUE reference image with no transparency at all,
        // relying on later frames (which use proper alpha) for the
        // actual intended look - fine as one brief instant in a
        // looping animation, but jarring as the very first (and for a
        // moment, only) thing shown. hasUsableTransparency skips past
        // that kind of frame for preview purposes; every frame still
        // gets baked and included, in order, for the real playback.
        // ----------------------------------------------------

        const angularRadius =
            getAngularRadiusForFaceCount(6);

        const bakedFrames = [];

        let resolveFirstFrame;
        let rejectFirstFrame;

        const firstFrameReady = new Promise(
            (resolve, reject) => {
                resolveFirstFrame = resolve;
                rejectFirstFrame = reject;
            }
        );

        let keepIndices = null;

        function shouldKeep(index, total) {

            if (!keepIndices) {

                const keepCount =
                    Math.min(total, MAX_GIF_FRAMES);

                const step = total / keepCount;

                keepIndices = new Set();

                for (let i = 0; i < keepCount; i++) {
                    keepIndices.add(Math.floor(i * step));
                }

                if (total > MAX_GIF_FRAMES) {

                    console.log(
                        `Laughing Man GIF has ${total} frames, subsampled to ${MAX_GIF_FRAMES}`
                    );
                }
            }

            return keepIndices.has(index);
        }

        // Don't hold out for a transparent frame forever - a GIF with
        // no transparency at all (e.g. a plain photo sequence) is
        // completely valid, so after this many kept-and-baked frames
        // the preview shows whatever's baked so far regardless.
        const MAX_PREVIEW_LOOKAHEAD = 5;

        let previewShown = false;

        const decodePromise =
            decodeGifFramesProgressive(
                arrayBuffer,
                (frame, index, total) => {

                    if (!shouldKeep(index, total)) {
                        return;
                    }

                    const baked =
                        generateGlobeTexture(
                            frame.canvas,
                            angularRadius,
                            GIF_BAKE_TEX_WIDTH,
                            6
                        );

                    const texture =
                        uploadCanvasAsTexture(p.gl, baked);

                    bakedFrames.push({
                        texture,
                        delay: frame.delay
                    });

                    const readyForPreview =
                        !previewShown &&
                        (
                            hasUsableTransparency(frame.canvas) ||
                            bakedFrames.length >= MAX_PREVIEW_LOOKAHEAD
                        );

                    if (readyForPreview) {

                        previewShown = true;

                        // Always cache, regardless of whether this is
                        // still the active selection - if the person
                        // switches back to Laughing Man later, it
                        // should be ready (or further along) rather
                        // than starting over.
                        laughingManFrames = bakedFrames;

                        if (myGeneration === loadGeneration) {

                            activeAnimatedFrames = bakedFrames;

                            // Point at the frame that just qualified
                            // (most recently pushed), not necessarily
                            // index 0 - see the note above.
                            animatedGifFrameIndex =
                                bakedFrames.length - 1;

                            animatedGifElapsedMs = 0;

                            bindActiveAnimatedFrame();

                            if (uploadStatus) {
                                uploadStatus.textContent = '';
                            }

                            console.log(
                                `Laughing Man preview ready (frame ${index}) - decoding/baking the rest in the background`
                            );

                        } else {

                            console.log(
                                `Laughing Man preview ready (frame ${index}) but a different texture is now selected - caching in the background without changing the display`
                            );
                        }

                        resolveFirstFrame();
                    }
                }
            );

        // Fire-and-forget: intentionally not awaited here, so this
        // function returns as soon as the preview frame is ready (see
        // above).
        decodePromise.then(() => {

            // Safety net: resolves firstFrameReady even if the GIF
            // turned out to have zero usable frames (onFrame was
            // never called) - the empty-frames check right below then
            // handles that case the same way it always has. A no-op
            // if the preview already resolved this above.
            resolveFirstFrame();

            console.log(
                `Laughing Man loaded: ${bakedFrames.length} frame(s)`
            );

        }).catch((error) => {

            if (bakedFrames.length === 0) {

                // Never got a preview frame - reject so the await
                // below throws and this falls back to the static
                // image, matching the original behavior.
                rejectFirstFrame(error);

            } else {

                console.error(
                    "Failed decoding/baking remaining Laughing Man frames:",
                    error
                );
            }
        });

        await firstFrameReady;

        if (bakedFrames.length === 0) {
            throw new Error(
                "Laughing Man GIF has no frames"
            );
        }

    } catch (error) {

        console.warn(
            "Laughing Man GIF not available, falling back to the static image:",
            error.message
        );

        await loadLaughingManStaticFallback();
    }
}

// ============================================================
// Static-image fallback for loadLaughingMan(), used only if
// assets/laughingman.gif can't be fetched/decoded (e.g. it hasn't
// been added to the project). Same six-logo layout, just not
// animated - matches how Laughing Man looked before any GIF support.
// ============================================================

async function loadLaughingManStaticFallback() {

    try {

        const image =
            await loadImage(
                textures.laughingMan
            );

        const generatedCanvas =
            generateGlobeTexture(
                image,
                28,
                2048,
                6
            );

        const textureData =
            generatedCanvas.toDataURL(
                'image/png'
            );

        await loadTexture(textureData);

        activeAnimatedFrames = null;

        console.log(
            "Laughing Man static fallback loaded"
        );

    } catch (error) {

        console.error(
            "Failed to load Laughing Man fallback:",
            error
        );
    }
}

// ============================================================
// Decode a GIF ArrayBuffer into full-canvas RGBA frames, IN BATCHES,
// yielding to the browser between batches.
//
// GIF frames are often just the CHANGED region of the canvas, not the
// whole image, so each one gets composited onto a persistent canvas
// (the standard approach - see vendor/README.md) rather than used
// directly. This covers the vast majority of real-world GIFs
// (disposal "draw over, don't clear"); the rarer restore-to-
// background/previous disposal modes may show minor artifacts rather
// than being pixel-perfect, which is a reasonable tradeoff for how
// this is actually going to be used (a short, clean, purpose-made
// loop rather than an arbitrary found GIF).
//
// decompressFrames() (the vendored decoder) decompresses every
// frame's full RGBA patch in one synchronous call - for a large,
// many-frame GIF that's several seconds of solid main-thread work
// (measured ~12s for the 240-frame/8.5MB Laughing Man source), during
// which nothing can render or respond to input at all. Calling it
// repeatedly on small SLICES of parsed.frames instead (it only reads
// frames/gct off whatever object it's given, so a shallow copy with a
// sliced frames array decodes just that slice) gets the same result
// broken into small enough pieces to yield between, without changing
// what gets decoded or how compositing/disposal works - every frame
// is still processed in order exactly as before, onFrame is just
// called as each one becomes ready instead of after all of them are.
// ============================================================

const GIF_DECODE_BATCH_SIZE = 4;

async function decodeGifFramesProgressive(arrayBuffer, onFrame) {

    const parsed =
        parseGIF(arrayBuffer);

    const totalFrames =
        parsed.frames.filter(f => f.image).length;

    const width = parsed.lsd.width;
    const height = parsed.lsd.height;

    const persistentCanvas =
        document.createElement('canvas');

    persistentCanvas.width = width;
    persistentCanvas.height = height;

    const persistentCtx =
        persistentCanvas.getContext('2d');

    const patchCanvas =
        document.createElement('canvas');

    const patchCtx =
        patchCanvas.getContext('2d');

    let producedIndex = 0;

    for (
        let start = 0;
        start < parsed.frames.length;
        start += GIF_DECODE_BATCH_SIZE
    ) {

        const batchFrames =
            decompressFrames(
                {
                    ...parsed,
                    frames: parsed.frames.slice(
                        start,
                        start + GIF_DECODE_BATCH_SIZE
                    )
                },
                true
            );

        for (const frame of batchFrames) {

            const { dims } = frame;

            patchCanvas.width = dims.width;
            patchCanvas.height = dims.height;

            const patchImageData =
                patchCtx.createImageData(
                    dims.width,
                    dims.height
                );

            patchImageData.data.set(frame.patch);

            patchCtx.putImageData(
                patchImageData,
                0,
                0
            );

            persistentCtx.drawImage(
                patchCanvas,
                dims.left,
                dims.top
            );

            // Snapshot the full canvas as this frame's result - has to
            // be a fresh canvas per frame since persistentCanvas keeps
            // getting drawn on for subsequent frames.
            const frameCanvas =
                document.createElement('canvas');

            frameCanvas.width = width;
            frameCanvas.height = height;

            frameCanvas
                .getContext('2d')
                .drawImage(persistentCanvas, 0, 0);

            if (frame.disposalType === 2) {

                persistentCtx.clearRect(
                    dims.left,
                    dims.top,
                    dims.width,
                    dims.height
                );
            }

            onFrame(
                {
                    canvas: frameCanvas,
                    delay: Math.max(20, frame.delay || 100)
                },
                producedIndex,
                totalFrames
            );

            producedIndex++;
        }

        // Yield so the tab stays responsive between batches.
        await new Promise(
            (resolve) => requestAnimationFrame(resolve)
        );
    }
}

// ============================================================
// Upload a canvas directly as a WebGL texture (no data-URL/Image
// round trip - texImage2D accepts a canvas source directly). Used for
// GIF frames since there can be dozens of them; the normal
// createTexture() path (used for everything else) goes through a
// data URL because it's called in more places that don't already
// have a canvas in hand.
// ============================================================

function uploadCanvasAsTexture(gl, canvas) {

    // Uploading a new texture shouldn't disturb whatever texture is
    // currently bound and actively being displayed (e.g. while this
    // runs as part of baking further GIF frames in the background -
    // see loadLaughingMan and rebakeAnimatedGifFrames). Restoring the
    // prior binding instead of unconditionally clearing it to null
    // keeps this function safe to call at any time, not just before
    // anything else is on screen.
    const previousBinding =
        gl.getParameter(gl.TEXTURE_BINDING_2D);

    const texture =
        gl.createTexture();

    gl.bindTexture(
        gl.TEXTURE_2D,
        texture
    );

    gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        canvas
    );

    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    gl.bindTexture(gl.TEXTURE_2D, previousBinding);

    return texture;
}

// ============================================================
// Bakes every already-decoded raw GIF frame through
// generateGlobeTexture() at the current face count, uploads each as
// its own texture, and replaces animatedGifFrames. Split out from
// applyAnimatedGif() so changing Face Count can call this directly
// without re-decoding the file.
// ============================================================

// ============================================================
// Bakes a list of decoded {canvas, delay} frames through
// generateGlobeTexture() at the given face count and uploads each as
// its own texture. Shared by the user-upload GIF pipeline and the
// Laughing Man preset below - the only difference between them is
// where the result gets stored and what face count they bake at
// (Laughing Man is always 6, uploads follow the Face Count control).
// ============================================================

async function bakeFramesToTextures(sourceFrames, faceCountForBake, onProgress) {

    const angularRadius =
        getAngularRadiusForFaceCount(faceCountForBake);

    const result = [];

    for (let i = 0; i < sourceFrames.length; i++) {

        if (onProgress) {
            onProgress(i, sourceFrames.length);
        }

        const baked =
            generateGlobeTexture(
                sourceFrames[i].canvas,
                angularRadius,
                GIF_BAKE_TEX_WIDTH,
                faceCountForBake
            );

        const texture =
            uploadCanvasAsTexture(p.gl, baked);

        result.push({
            texture,
            delay: sourceFrames[i].delay
        });

        // Yield periodically so the tab stays responsive while baking.
        if (i % 4 === 0) {
            await new Promise(
                (resolve) => requestAnimationFrame(resolve)
            );
        }
    }

    return result;
}

async function rebakeAnimatedGifFrames() {

    if (!rawGifFrames || !p || !p.gl) {
        return;
    }

    isProcessingGif = true;

    loadGeneration++;

    const myGeneration =
        loadGeneration;

    const oldFrames = animatedGifFrames;

    const freshFrames =
        await bakeFramesToTextures(
            rawGifFrames,
            faceCount,
            (i, total) => {

                if (uploadStatus) {
                    uploadStatus.textContent =
                        `Preparing frame ${i + 1}/${total}...`;
                }
            }
        );

    // Always kept up to date, regardless of whether this is still the
    // active selection - if the person switches back to this gif (or
    // changes face count again), it should reflect this bake, not a
    // stale one.
    animatedGifFrames = freshFrames;

    if (myGeneration === loadGeneration) {

        activeAnimatedFrames = animatedGifFrames;
        animatedGifFrameIndex = 0;
        animatedGifElapsedMs = 0;

        bindActiveAnimatedFrame();

    } else {

        console.log(
            "GIF rebake finished but a different texture is now selected - caching without changing the display"
        );
    }

    // Free the previous batch of textures now that they're no longer
    // referenced - GIFs can mean dozens of these.
    if (oldFrames) {
        for (const frame of oldFrames) {
            p.gl.deleteTexture(frame.texture);
        }
    }

    showUploadStatusIdle();

    isProcessingGif = false;
}

// ============================================================
// Entry point for uploading a .gif as the globe's texture.
// ============================================================

async function applyAnimatedGif(arrayBuffer) {

    // A whole-globe animated GIF replaces any shader-composited
    // per-face content wholesale (same rule as every other preset
    // switch below).
    clearAllFaceSlots();

    activeCustomKind = 'image';

    syncTextureSelect('custom');

    debugLog(
        "applyAnimatedGif: whole-globe GIF path (clears face slots)"
    );

    rawCustomImages = {};

    if (uploadStatus) {
        uploadStatus.textContent = 'Decoding GIF...';
    }

    try {

        const decodedFrames = [];

        await decodeGifFramesProgressive(
            arrayBuffer,
            (frame, index, total) => {

                decodedFrames.push(frame);

                if (uploadStatus) {

                    uploadStatus.textContent =
                        `Decoding GIF (${index + 1}/${total})...`;
                }
            }
        );

        let frames = decodedFrames;

        if (frames.length === 0) {
            throw new Error("GIF has no frames");
        }

        if (frames.length > MAX_GIF_FRAMES) {

            const step =
                frames.length / MAX_GIF_FRAMES;

            const sampled = [];

            for (let i = 0; i < MAX_GIF_FRAMES; i++) {
                sampled.push(
                    frames[Math.floor(i * step)]
                );
            }

            console.log(
                `GIF has ${frames.length} frames, subsampled to ${MAX_GIF_FRAMES}`
            );

            frames = sampled;
        }

        rawGifFrames = frames;

        await rebakeAnimatedGifFrames();

        console.log(
            `Animated GIF loaded: ${rawGifFrames.length} frame(s)`
        );

    } catch (error) {

        console.error(
            "Failed to load animated GIF:",
            error
        );

        if (uploadStatus) {
            uploadStatus.textContent =
                'Could not read that GIF - see console.';

            setTimeout(
                () => {
                    if (uploadStatus) uploadStatus.textContent = '';
                },
                4000
            );
        }

        isProcessingGif = false;
    }
}

// ============================================================
// Shows the last-chosen upload filename in the status line, or clears
// it if nothing's been chosen. Used once processing finishes (instead
// of clearing straight to '') so the person can still see which file
// is actually loaded even though the <input> itself has been reset
// back to its native "No file chosen" state (see lastUploadedFileName
// above).
// ============================================================

function showUploadStatusIdle() {

    if (uploadStatus) {

        uploadStatus.textContent =
            lastUploadedFileName ?
                `Loaded: ${lastUploadedFileName}` :
                '';
    }
}

// ============================================================
// Tears down any active USER-UPLOADED GIF state (frees its textures)
// and stops WHATEVER is currently animating (regardless of whether it
// came from a user-uploaded GIF or the cached Laughing Man frames) -
// called whenever a different texture/mode becomes active. Never
// deletes laughingManFrames' own textures, which stay cached
// independently and only ever get re-fetched if needed (they don't,
// once loaded).
// ============================================================

function clearAnimatedGif() {

    // Signals "something newer than any in-flight async texture load
    // has now been requested" - see loadGeneration's own comment.
    loadGeneration++;

    if (animatedGifFrames && p && p.gl) {

        for (const frame of animatedGifFrames) {
            p.gl.deleteTexture(frame.texture);
        }
    }

    // Unconditional: activeAnimatedFrames may currently point at
    // animatedGifFrames (a user-uploaded GIF) OR at laughingManFrames
    // (the cached Laughing Man bake) - either way, we're switching
    // away from it, so animate()'s own cycling logic must stop
    // re-binding frames from it. Previously this only checked the
    // animatedGifFrames case, so switching away from an active
    // Laughing Man animation left it pointed at laughingManFrames,
    // which animate() would then keep re-binding every ~200ms forever,
    // clobbering whatever texture was supposed to replace it.
    activeAnimatedFrames = null;

    rawGifFrames = null;
    animatedGifFrames = null;
    animatedGifFrameIndex = 0;
    animatedGifElapsedMs = 0;

    if (uploadStatus) {
        uploadStatus.textContent = '';
    }
}


// ============================================================
// Independent per-face animation (shader-composited mode)
//
// Each per-face slot can hold its OWN animated GIF - decoded once,
// uploaded as one WebGL texture per frame, and advanced on its own
// timer inside animate(). The fragment shader composites all six
// face textures live (sampleFaceComposite), so no per-frame CPU
// rebake is needed and every face animates independently.
//
// faceSlotContent[i] = {
//   kind: 'gif' | 'image',
//   frames: [{texture, delay}]   - gif: baked frame textures
//   image: <img>                 - image: static source
//   texture: <WebGLTexture>      - image: uploaded texture
//   width, height,               - source dimensions (for logoScale)
//   frameIndex, elapsedMs        - gif playback state
// }
//
// While this mode is active, uUseFaces=1 and the shader does the
// compositing; the CPU-baked uTexture path is untouched for every
// other texture source.
// ============================================================

// Frees one slot's GPU resources and removes it. Does not refresh
// the display on its own - callers follow with a composite update.
function disposeFaceSlot(index) {

    const content =
        faceSlotContent[index];

    if (
        !content ||
        !p ||
        !p.gl
    ) {

        delete faceSlotContent[index];

        return;
    }

    if (content.kind === 'gif') {

        for (const frame of content.frames) {
            p.gl.deleteTexture(frame.texture);
        }

    } else if (content.texture) {

        p.gl.deleteTexture(content.texture);
    }

    delete faceSlotContent[index];
}

// Frees EVERY slot's GPU resources and deactivates the mode. Called
// whenever the globe switches to any non-per-face texture source.
function clearAllFaceSlots() {

    for (let i = 0; i < MAX_FACE_SLOTS; i++) {
        disposeFaceSlot(i);
    }

    deactivateFaceComposite();
}

// Pushes the current per-face state into the shader uniforms and
// switches the globe into or out of shader-composite mode. Safe to
// call any time after createGlobe() has run; no-ops before that.
function updateFaceComposite() {

    if (!p || !p.gl || !instance) {

        debugLog("updateFaceComposite: skipped - globe not ready yet");

        return;
    }
    // CPU-baked texture that was showing before this mode began is
    // still bound, so the globe just falls back to it seamlessly.
    let used = 0;

    for (let i = 0; i < MAX_FACE_SLOTS; i++) {
        if (faceSlotContent[i]) used++;
    }

    if (
        used === 0 ||
        activeCustomKind !== 'image' ||
        faceCount === 1
    ) {

        if (faceCompositeActive || used > 0) {

            const reason =
                used === 0 ?
                    "no slots have content" :
                    activeCustomKind !== 'image' ?
                        `activeCustomKind='${activeCustomKind}' (not image)` :
                        `faceCount=${faceCount}`;

            debugLog(
                `updateFaceComposite: deactivating - ${reason}`
            );
        }

        deactivateFaceComposite();

        return;
    }

    const angularRadiusDeg =
        getAngularRadiusForFaceCount(faceCount);

    const radiusRad =
        angularRadiusDeg * Math.PI / 180;

    const cosRadius =
        Math.cos(radiusRad);

    const halfSize =
        Math.tan(radiusRad);

    const centers =
        getFaceCenters(faceCount);

    // Faces with no content of their own fall back to the first slot
    // that HAS content - the composite-mode equivalent of
    // rawCustomImages[i] || rawCustomImages[0] (which only ever
    // fell back to slot 0 because slot 0 was the only way in).
    let fallbackSlot = -1;

    for (let i = 0; i < faceCount; i++) {

        if (faceSlotContent[i]) {

            fallbackSlot = i;

            break;
        }
    }

    if (fallbackSlot === -1) {

        deactivateFaceComposite();

        return;
    }

    const centerArr = [];
    const eastArr = [];
    const northArr = [];
    const paramArr = [];

    for (let i = 0; i < 6; i++) {

        // Slots beyond the active face count get zeroed centers so
        // the shader's dot() check never selects them.
        if (i >= faceCount) {

            centerArr.push(0, 0, 0);
            eastArr.push(0, 0, 0);
            northArr.push(0, 0, 0);
            paramArr.push(0, 0, 0, 0);

            continue;
        }

        const content =
            faceSlotContent[i] ||
            faceSlotContent[fallbackSlot];

        // Which texture unit this face samples: its own slot when it
        // has an override, otherwise the fallback slot.
        const texSlot =
            faceSlotContent[i] ?
                i :
                fallbackSlot;

        const center =
            centers[i];

        const basis =
            createTangentBasis(center);

        centerArr.push(
            center.x,
            center.y,
            center.z
        );

        eastArr.push(
            basis.east.x,
            basis.east.y,
            basis.east.z
        );

        northArr.push(
            basis.north.x,
            basis.north.y,
            basis.north.z
        );

        // Same logoScale math as generateGlobeTexture(): the image is
        // scaled so its larger dimension spans the full tangent patch.
        const logoRadius =
            Math.max(
                content.width,
                content.height
            ) / 2;

        const logoScale =
            halfSize / logoRadius;

        // x: cosine test for patch membership (same for every face);
        // y/z: tangent -> normalized-image-coord scale factors;
        // w: which slot's texture this face samples.
        paramArr.push(
            cosRadius,
            1 / (logoScale * content.width),
            1 / (logoScale * content.height),
            texSlot
        );
    }

    instance.uniforms.uFaceCenter.value =
        centerArr;

    instance.uniforms.uFaceEast.value =
        eastArr;

    instance.uniforms.uFaceNorth.value =
        northArr;

    instance.uniforms.uFaceParams.value =
        paramArr;

    instance.uniforms.uFaceCountF.value =
        faceCount;

    faceCompositeActive = true;

    instance.uniforms.uUseFaces.value = 1;

    // Taking over the sphere means the classic animation stream must
    // stand down - it keeps binding to TEXTURE0 (which is now
    // uFaceTex0) and would clobber face 1's frames every tick.
    clearAnimatedGif();

    renderFaceSlotThumbnails();
}

function deactivateFaceComposite() {

    faceCompositeActive = false;

    if (instance && instance.uniforms.uUseFaces) {
        instance.uniforms.uUseFaces.value = 0;
    }
}

// Binds each slot's CURRENT frame to its own texture unit. Called
// right after the mode activates and whenever any slot crosses a
// frame boundary during playback. The fallback slot must match what
// updateFaceComposite wrote into uFaceParams[].w.
function getFallbackFaceSlot() {

    for (let i = 0; i < faceCount; i++) {

        if (faceSlotContent[i]) {
            return i;
        }
    }

    return -1;
}

function bindFaceCompositeFrames() {

    if (
        !p ||
        !p.gl ||
        !faceCompositeActive
    ) {
        return;
    }

    const fallbackSlot =
        getFallbackFaceSlot();

    if (fallbackSlot === -1) {
        return;
    }

    for (let i = 0; i < MAX_FACE_SLOTS; i++) {

        p.gl.activeTexture(
            p.gl.TEXTURE0 + i
        );

        // Slot with no content of its own shows the fallback slot's
        // current frame - matching the .w index the shader reads.
        const texture =
            getFaceSlotCurrentTexture(
                faceSlotContent[i] ? i : fallbackSlot
            );

        p.gl.bindTexture(
            p.gl.TEXTURE_2D,
            texture || null
        );
    }

    // The rest of the pipeline (createTexture, uploadCanvasAsTexture,
    // loadTexture...) assumes it runs on texture unit 0 - leaving the
    // active unit on TEXTURE5 here would silently corrupt every later
    // upload/bind.
    p.gl.activeTexture(p.gl.TEXTURE0);
}

function getFaceSlotCurrentTexture(index) {

    const content =
        faceSlotContent[index];

    if (!content) {
        return null;
    }

    if (content.kind === 'gif') {

        return content.frames[
            content.frameIndex
        ].texture;
    }

    return content.texture;
}

// Decodes + bakes an uploaded GIF into one slot of the independent
// per-face animation system. Entry point for GIF files chosen through
// the per-face buttons AND for GIFs chosen via the main choose-file
// picker while the per-face UI is visible (so both paths animate).
async function applyFaceSlotGif(arrayBuffer, index) {

    if (!p || !p.gl) {

        debugLog("applyFaceSlotGif: skipped - globe not ready yet");

        return;
    }

    // ------------------------------------------------------------
    // Composite mode only displays while an uploaded IMAGE is active
    // AND faceCount > 1. From any other state (e.g. Laughing Man),
    // a GIF dropped into a face slot used to decode and bake fully
    // here, only to be discarded by updateFaceComposite - "Per-face
    // GIF loaded" in the console while the screen kept showing the
    // old texture. Route those to the whole-globe animated-GIF
    // pipeline, the only mode that can actually display them.
    // ------------------------------------------------------------
    if (activeCustomKind !== 'image' || faceCount <= 1) {

        debugLog(
            `applyFaceSlotGif: not in multi-face image mode ` +
            `(activeCustomKind='${activeCustomKind}', ` +
            `faceCount=${faceCount}) - routing slot ${index} ` +
            `upload through whole-globe GIF pipeline`
        );

        await applyAnimatedGif(arrayBuffer);

        return;
    }

    loadGeneration++;

    const myGeneration =
        loadGeneration;

    if (uploadStatus) {
        uploadStatus.textContent = 'Decoding GIF...';
    }

    try {

        const decodedFrames = [];

        await decodeGifFramesProgressive(
            arrayBuffer,
            (frame, frameIndex, total) => {

                decodedFrames.push(frame);

                if (uploadStatus) {

                    uploadStatus.textContent =
                        `Decoding GIF (${frameIndex + 1}/${total})...`;
                }
            }
        );

        if (myGeneration !== loadGeneration) {

            console.log(
                "Per-face GIF decode finished but a newer texture was requested in the meantime - discarding"
            );

            return;
        }

        let frames = decodedFrames;

        if (frames.length === 0) {
            throw new Error("GIF has no frames");
        }

        if (frames.length > MAX_GIF_FRAMES) {

            const step =
                frames.length / MAX_GIF_FRAMES;

            const sampled = [];

            for (let i = 0; i < MAX_GIF_FRAMES; i++) {
                sampled.push(frames[Math.floor(i * step)]);
            }

            frames = sampled;
        }

        // Free this slot's previous content BEFORE baking the new
        // frames so two generations don't coexist in GPU memory.
        disposeFaceSlot(index);

        const bakedFrames = [];

        for (let i = 0; i < frames.length; i++) {

            if (
                uploadStatus &&
                i % 8 === 0
            ) {
                uploadStatus.textContent =
                    `Preparing frame ${i + 1}/${frames.length}...`;
            }

            bakedFrames.push({
                texture: uploadCanvasAsTexture(
                    p.gl,
                    frames[i].canvas
                ),
                delay: frames[i].delay
            });

            if (i % 4 === 0) {

                await new Promise(
                    (resolve) =>
                        requestAnimationFrame(resolve)
                );
            }
        }

        if (myGeneration !== loadGeneration) {

            for (const frame of bakedFrames) {
                p.gl.deleteTexture(frame.texture);
            }

            console.log(
                "Per-face GIF bake finished but a newer texture was requested in the meantime - discarding"
            );

            return;
        }

        faceSlotContent[index] = {
            kind: 'gif',
            frames: bakedFrames,
            width: frames[0].canvas.width,
            height: frames[0].canvas.height,
            // Captured once - baked frames keep only their GPU texture,
            // so the thumbnail can't read a canvas later.
            thumbUrl: frames[0].canvas.toDataURL(),
            frameIndex: 0,
            elapsedMs: 0
        };

        updateFaceComposite();

        bindFaceCompositeFrames();

        showUploadStatusIdle();

        renderFaceSlotThumbnails();

        console.log(
            `Per-face GIF loaded on face ${index}: ${bakedFrames.length} frame(s)`
        );

        debugLog(
            `outcome: faceSlotContent[${index}]=gif(${bakedFrames.length}f), ` +
            `uUseFaces=${faceCompositeActive ? 1 : 0}, ` +
            `activeCustomKind='${activeCustomKind}'`
        );

    } catch (error) {

        console.error(
            "Failed to load per-face GIF:",
            error
        );

        if (uploadStatus) {

            uploadStatus.textContent =
                'Could not read that GIF - see console.';

            setTimeout(
                () => {
                    if (uploadStatus) uploadStatus.textContent = '';
                },
                4000
            );
        }
    }
}

// Loads a STATIC image into one slot of the per-face system. Statics
// live here too (rather than in rawCustomImages) so mixing a static
// image on one face with an animated GIF on another works naturally -
// the shader doesn't care which slots move.
async function applyFaceSlotImage(image, index) {

    if (!p || !p.gl) {

        debugLog("applyFaceSlotImage: skipped - globe not ready yet");

        return;
    }

    disposeFaceSlot(index);

    const texture =
        uploadCanvasAsTexture(p.gl, image);

    faceSlotContent[index] = {
        kind: 'image',
        image,
        texture,
        width: image.width,
        height: image.height
    };

    // A NEW primary (slot 0) means "start over" - drop any stale
    // overrides, same rule applyCustomImage applies to
    // rawCustomImages.
    if (index === 0) {

        for (let i = 1; i < MAX_FACE_SLOTS; i++) {
            disposeFaceSlot(i);
        }
    }

    updateFaceComposite();

    bindFaceCompositeFrames();

    renderFaceSlotThumbnails();

    debugLog(
        `outcome: faceSlotContent[${index}]=image ` +
        `(${image.width}x${image.height}), uUseFaces=${faceCompositeActive ? 1 : 0}`
    );
}

// ============================================================
// Set the globe texture from a STATIC image chosen through the main
// Upload picker (single-face / whole-globe bake path).
//
// Per-face overrides no longer route here - they go through
// applyFaceSlotImage/applyFaceSlotGif above. This function now only
// serves the classic CPU-baked pipeline, so it also tears down the
// shader-composite mode (a fresh whole-globe image means the per-face
// content is being replaced wholesale).
// ============================================================

async function applyCustomImage(image, faceIndex = 0) {

    clearAllFaceSlots();

    clearAnimatedGif();

    activeCustomKind = 'image';

    syncTextureSelect('custom');

    debugLog(
        `applyCustomImage: whole-globe static path ` +
        `(${image.width}x${image.height})`
    );

    rawCustomImages = {
        0: image
    };

    await regenerateCustomImageTexture();

    renderFaceSlotThumbnails();
}

// ============================================================
// Rebuilds the globe texture from whatever is currently in
// rawCustomImages + faceCount, resolving any un-set face slots to
// the primary (slot 0) image. Called after a face image changes AND
// whenever Face Count changes while an image is active.
// ============================================================

async function regenerateCustomImageTexture() {

    if (!rawCustomImages[0]) {
        return;
    }

    try {

        const angularRadius =
            getAngularRadiusForFaceCount(faceCount);

        let source;

        if (faceCount === 1) {

            source = rawCustomImages[0];

        } else {

            source = [];

            for (let i = 0; i < faceCount; i++) {

                source.push(
                    rawCustomImages[i] ||
                    rawCustomImages[0]
                );
            }
        }

        const generatedCanvas =
            generateGlobeTexture(
                source,
                angularRadius,
                2048,
                faceCount
            );

        const textureDataUrl =
            generatedCanvas.toDataURL(
                'image/png'
            );

        await loadTexture(textureDataUrl);

        console.log(
            `Custom image texture loaded (${faceCount} face(s))`
        );

    } catch (error) {

        console.error(
            "Error generating custom image texture:",
            error
        );
    }
}

// ============================================================
// Apply user-entered text. Text always uses the full sphere wrap
// (faceCount 1) - it doesn't participate in the multi-face system
// that images use. Called whenever the text box changes.
// ============================================================

async function applyCustomText(text) {

    clearAllFaceSlots();

    activeCustomKind = 'text';
    clearAnimatedGif();

    try {

        const textCanvas =
            createTextTexture(text);

        const generatedCanvas =
            generateGlobeTexture(
                textCanvas,
                28,
                2048,
                1
            );

        const textureDataUrl =
            generatedCanvas.toDataURL(
                'image/png'
            );

        await loadTexture(textureDataUrl);

        console.log(
            "Custom text texture loaded (full wrap)"
        );

    } catch (error) {

        console.error(
            "Error generating custom text texture:",
            error
        );
    }
}

// ============================================================
// Dots on/off - single source of truth is the checkbox. This just
// keeps `useDots` and the checkbox UI in sync; it never touches
// which texture is loaded.
// ============================================================

function setUseDots(on) {

    useDots = on ? 1 : 0;

    debugLog(`setUseDots: ${on ? 'on' : 'off'}`);

    if (useDotsToggle) {
        useDotsToggle.checked = on;
    }
}

// ============================================================
// Create globe
// ============================================================

async function createGlobe() {

    const width =
        window.innerWidth;

    const height =
        window.innerHeight;

    console.log(
        `Creating globe - Canvas: ${width}x${height}`
    );

    try {

        p = new Phenomenon({

            canvas,

            contextType: 'webgl',

            context: {
                alpha: true,
                antialias: true,
                depth: false,
            },

            settings: {

                clearColor: [
                    0,
                    0,
                    0,
                    0
                ],

                devicePixelRatio:
                    window.devicePixelRatio || 1,

                // Phenomenon normally runs its OWN internal
                // requestAnimationFrame loop (rendering with
                // whatever's in p.uniforms) in addition to - and
                // completely uncoordinated with - the animate() loop
                // below. Both loops draw to the same canvas, and
                // during any heavy synchronous work (baking GIF
                // frames, which creates/deletes WebGL textures) they
                // can interleave badly: one loop redraws mid-update,
                // producing a visible flash/"restart" that then
                // settles once the work finishes. animate() already
                // does everything Phenomenon's own loop would, so
                // that second loop is disabled here. (It still runs
                // ONCE, synchronously, at the end of the constructor
                // below - harmless, since no instance exists yet.)
                // See animate() for how uProjectionMatrix/uViewMatrix/
                // uModelMatrix/uResolution - previously kept fresh
                // only via that internal loop picking up window-resize
                // updates - still get propagated without it.
                shouldRender: false,
            }
        });

        if (!p || !p.gl) {

            throw new Error(
                "Failed to create WebGL context"
            );
        }

        console.log(
            "WebGL context created successfully"
        );

        // ----------------------------------------------------
        // Create globe instance FIRST
        // ----------------------------------------------------

        instance = p.add(
            "globe",
            {

                vertex:
                    vertexShader,

                fragment:
                    fragmentShader,

                uniforms: {

                    uResolution: {
                        type: "vec2",
                        // True drawing-buffer size (CSS x dpr),
                        // matching gl_FragCoord's space. Passing CSS
                        // pixels here only worked on dpr=2 displays,
                        // where the 2x error cancelled the shader's
                        // uv*1.0-1.0 mapping.
                        value: [
                            canvas.width,
                            canvas.height
                        ]
                    },

                    uTexture: {
                        type: "sampler2D",
                        value: 0
                    },

                    /*
                     * Per-face shader-composited mode (see
                     * applyFaceSlotFile / updateFaceComposite). Inactive
                     * (0) for every CPU-baked texture path; the face
                     * arrays stay zeroed until a per-face upload
                     * activates the mode. Plain arrays (not typed
                     * arrays) here because Phenomenon's add() JSON
                     * round-trips the uniforms object.
                     */
                    uUseFaces: {
                        type: "float",
                        value: 0
                    },

                    uFaceCountF: {
                        type: "float",
                        value: 6
                    },

                    uFaceCenter: {
                        type: "vec3",
                        value: new Array(18).fill(0)
                    },

                    uFaceEast: {
                        type: "vec3",
                        value: new Array(18).fill(0)
                    },

                    uFaceNorth: {
                        type: "vec3",
                        value: new Array(18).fill(0)
                    },

                    uFaceParams: {
                        type: "vec4",
                        value: new Array(24).fill(0)
                    },

                    uFaceTex0: {
                        type: "sampler2D",
                        value: 0
                    },

                    uFaceTex1: {
                        type: "sampler2D",
                        value: 1
                    },

                    uFaceTex2: {
                        type: "sampler2D",
                        value: 2
                    },

                    uFaceTex3: {
                        type: "sampler2D",
                        value: 3
                    },

                    uFaceTex4: {
                        type: "sampler2D",
                        value: 4
                    },

                    uFaceTex5: {
                        type: "sampler2D",
                        value: 5
                    },

                    /*
                     * 1 = Fibonacci dots
                     * 0 = direct texture
                     */
                    uUseDots: {
                        type: "float",
                        value: 0
                    },

                    phi: {
                        type: "float",
                        value: 0
                    },

                    theta: {
                        type: "float",
                        value: 0
                    },

                    dots: {
                        type: "float",
                        value: 25000
                    },

                    scale: {
                        type: "float",
                        value: 1.0
                    },

                    dotsBrightness: {
                        type: "float",
                        value: 6
                    },

                    diffuse: {
                        type: "float",
                        value: 1.2
                    },

                    dark: {
                        type: "float",
                        value: 1
                    },

                    opacity: {
                        type: "float",
                        value: 1
                    },

                    baseColor: {
                        type: "vec3",
                        value: [
                            0.3,
                            0.6,
                            1.0
                        ]
                    },

                    glowColor: {
                        type: "vec3",
                        value: [
                            0.3,
                            0.8,
                            1.0
                        ]
                    },

                    uIgnoreAlpha: {
                        type: "float",
                        value: 0
                    }

                },

                mode: 4,

                geometry: {

                    vertices: [

                        {
                            x: -1,
                            y: -1,
                            z: 0
                        },

                        {
                            x: 1,
                            y: -1,
                            z: 0
                        },

                        {
                            x: -1,
                            y: 1,
                            z: 0
                        },

                        {
                            x: 1,
                            y: -1,
                            z: 0
                        },

                        {
                            x: 1,
                            y: 1,
                            z: 0
                        },

                        {
                            x: -1,
                            y: 1,
                            z: 0
                        }

                    ]

                }

            }
        );

        if (!instance) {

            throw new Error(
                "Phenomenon failed to create globe instance"
            );
        }

        console.log(
            "Globe created successfully"
        );

        // ----------------------------------------------------
        // Load Laughing Man as the DEFAULT texture
        // ----------------------------------------------------

        await loadLaughingMan();

        // ----------------------------------------------------
        // Start animation
        // ----------------------------------------------------

        startAnimation();

    } catch (error) {

        console.error(
            "Failed to create globe:",
            error
        );
    }
}

// ============================================================
// Start globe
// ============================================================

setTimeout(() => {

    createGlobe();

}, 100);

// ============================================================
// Resize
// ============================================================

window.addEventListener(
    'resize',
    () => {

        resizeCanvas();

        if (p && p.uniforms) {

            p.uniforms.uResolution = {

                type: "vec2",

                value: [
                    p.gl.drawingBufferWidth,
                    p.gl.drawingBufferHeight
                ]

            };
        }

    }
);

// ============================================================
// Animation
// ============================================================

function animate(timestamp) {

    if (!instance) {
        return;
    }

    // While exporting a GIF, the export routine is driving phi/theta
    // and rendering directly - pause the live loop's own updates so
    // the two don't fight over the same uniforms, but keep ticking
    // rAF so playback resumes smoothly once the export finishes.
    if (isExportingGif) {

        requestAnimationFrame(
            animate
        );

        return;
    }

    const deltaMs =
        lastAnimationTimestamp === null ?
            0 :
            timestamp - lastAnimationTimestamp;

    lastAnimationTimestamp = timestamp;

    // Cycle the currently active animated source (an uploaded GIF or
    // the Laughing Man preset - see activeAnimatedFrames) on its own
    // timer, independent of isPaused - a paused sphere can still play
    // its animation, same as a still photo would keep showing
    // regardless of spin state.
    if (
        activeAnimatedFrames &&
        activeAnimatedFrames.length > 0 &&
        p &&
        p.gl
    ) {

        animatedGifElapsedMs += deltaMs;

        const currentFrame =
            activeAnimatedFrames[animatedGifFrameIndex];

        if (animatedGifElapsedMs >= currentFrame.delay) {

            animatedGifElapsedMs -= currentFrame.delay;

            animatedGifFrameIndex =
                (animatedGifFrameIndex + 1) %
                activeAnimatedFrames.length;

            bindActiveAnimatedFrame();
        }
    }

    // Independent per-face animation streams (shader-composited mode).
    // Every slot advances on its own timer against its own frames'
    // delays, and only slots that actually crossed a boundary trigger a
    // rebind - so a 50ms GIF next to a 500ms GIF each play at their own
    // rate, and static-only setups cost nothing at all.
    if (
        faceCompositeActive &&
        p &&
        p.gl
    ) {

        let anyCrossed = false;

        for (let i = 0; i < MAX_FACE_SLOTS; i++) {

            const content =
                faceSlotContent[i];

            if (
                !content ||
                content.kind !== 'gif' ||
                i >= faceCount
            ) {
                continue;
            }

            content.elapsedMs += deltaMs;

            let guard = 0;

            while (
                content.elapsedMs >=
                content.frames[content.frameIndex].delay &&
                guard < content.frames.length
            ) {

                content.elapsedMs -=
                    content.frames[content.frameIndex].delay;

                content.frameIndex =
                    (content.frameIndex + 1) %
                    content.frames.length;

                anyCrossed = true;

                guard++;
            }
        }

        // Only rebind when at least one stream moved - and always
        // restore the active texture unit to 0 afterwards (see
        // bindFaceCompositeFrames) so the rest of the pipeline is
        // unaffected.
        if (anyCrossed) {

            bindFaceCompositeFrames();

            p.gl.activeTexture(p.gl.TEXTURE0);
        }
    }

    // Paused: keep rendering every frame (so the Phi/Theta sliders
    // stay live and responsive), just stop auto-incrementing them.
    if (!isPaused) {

        // Spin speed slider scales both rates; 0 = stationary.
        if (spinType === 'axis') {

            // Clean single-axis spin, like a globe on a stand. Theta
            // is left alone so the manual Theta slider still works
            // as a fixed tilt.
            phi += PHI_RATE * spinSpeedMultiplier;

        } else {

            // Randomized/tumbling dual-axis spin (default/original
            // behavior).
            phi += PHI_RATE * spinSpeedMultiplier;
            theta += THETA_RATE * spinSpeedMultiplier;
        }
    }

    // Drag interaction: direct rotation while dragging (handled by
    // event handlers), plus flick momentum after release. Momentum
    // decays geometrically so a flick throws the globe and it
    // settles back toward its ambient spin.
    if (!dragActive) {

        if (
            Math.abs(dragVelocityPhi) > 0.00001 ||
            Math.abs(dragVelocityTheta) > 0.00001
        ) {

            applyDragDelta(
                dragVelocityPhi / DRAG_SENSITIVITY,
                dragVelocityTheta / DRAG_SENSITIVITY
            );

            dragVelocityPhi *= DRAG_VELOCITY_DECAY;
            dragVelocityTheta *= DRAG_VELOCITY_DECAY;

        } else {

            dragVelocityPhi = 0;
            dragVelocityTheta = 0;
        }
    }

    const uniforms = {

        // p.uniforms carries uProjectionMatrix/uViewMatrix/
        // uModelMatrix (recomputed on window resize by Phenomenon's
        // own, still-active resize listener) and uResolution (kept
        // current by main.js's own resize handler below). Spreading
        // it first, every frame, is what keeps those in sync now that
        // Phenomenon's internal render loop - which used to carry
        // them over on its own - is disabled; the explicit keys below
        // then apply this frame's actual live values on top.
        ...p.uniforms,

        phi: {
            type: "float",
            value: phi
        },

        theta: {
            type: "float",
            value: theta
        },

        dots: {
            type: "float",
            value: dots
        },

        scale: {
            type: "float",
            value: scale
        },

        uUseDots: {
            type: "float",
            value: useDots
        }

    };

    instance.render(
        uniforms
    );

    requestAnimationFrame(
        animate
    );
}

function startAnimation() {

    if (!animationStarted) {

        animationStarted = true;

        console.log(
            "Animation started"
        );

        animate();
    }
}

// ============================================================
// Controls
// ============================================================

const phiControl =
    document.getElementById('phi');

if (phiControl) {

    phiControl.addEventListener(
        'input',
        (e) => {

            const v =
                parseFloat(
                    e.target.value
                );

            // Field mode with a selection: drive that sphere.
            const target = fieldTarget();

            if (target) {
                setSpherePhi(target, v);
                return;
            }

            phi = v;

        }
    );
}

const thetaControl =
    document.getElementById('theta');

if (thetaControl) {

    thetaControl.addEventListener(
        'input',
        (e) => {

            const v =
                parseFloat(
                    e.target.value
                );

            const target = fieldTarget();

            if (target) {
                setSphereTheta(target, v);
                return;
            }

            theta = v;

        }
    );
}

const dotsControl =
    document.getElementById('dots');

if (dotsControl) {

    dotsControl.addEventListener(
        'input',
        (e) => {

            const v =
                parseFloat(
                    e.target.value
                );

            const target = fieldTarget();

            if (target) {
                setSphereDots(target, v);
                return;
            }

            dots = v;

        }
    );
}

const scaleControl =
    document.getElementById('scale');

if (scaleControl) {

    scaleControl.addEventListener(
        'input',
        (e) => {

            const v =
                parseFloat(
                    e.target.value
                );

            const target = fieldTarget();

            if (target) {
                setSphereScale(target, v);
                return;
            }

            scale = v;

        }
    );
}

// ------------------------------------------------------------
// Spin speed - multiplies both rotation rates live. 0 = stationary
// (softer than the Pause checkbox, which also freezes slider edits).
// The GIF exporter reads this too so exports match screen speed.
// ------------------------------------------------------------
const spinSpeedControl =
    document.getElementById('spinSpeed');

if (spinSpeedControl) {

    spinSpeedMultiplier =
        parseFloat(spinSpeedControl.value);

    spinSpeedControl.addEventListener(
        'input',
        (e) => {

            const v =
                parseFloat(e.target.value);

            const target = fieldTarget();

            if (target) {
                setSphereSpinSpeed(target, v);
                return;
            }

            spinSpeedMultiplier = v;

        }
    );
}

// ------------------------------------------------------------
// Glow color - the atmosphere/edge glow tint. Hex -> [r,g,b] in 0..1,
// applied to the glowColor uniform (shared by both shader modes).
// ------------------------------------------------------------
const glowColorControl =
    document.getElementById('glowColor');

if (glowColorControl) {

    function hexToRgb01(hex) {

        const r = parseInt(hex.slice(1, 3), 16) / 255;
        const g = parseInt(hex.slice(3, 5), 16) / 255;
        const b = parseInt(hex.slice(5, 7), 16) / 255;

        return [r, g, b];
    }

    glowColorControl.addEventListener(
        'input',
        (e) => {

            const rgb = hexToRgb01(e.target.value);

            const target = fieldTarget();

            if (target) {
                setSphereGlowColor(target, rgb);
                return;
            }

            if (instance && instance.uniforms.glowColor) {
                instance.uniforms.glowColor.value = rgb;
            }

        }
    );
}

// ------------------------------------------------------------
// Opacity - overall globe transparency, straight through to the
// existing uniform.
// ------------------------------------------------------------
const opacityControl =
    document.getElementById('opacity');

if (opacityControl) {

    opacityControl.addEventListener(
        'input',
        (e) => {

            const v =
                parseFloat(e.target.value);

            const target = fieldTarget();

            if (target) {
                setSphereOpacity(target, v);
                return;
            }

            if (instance && instance.uniforms.opacity) {
                instance.uniforms.opacity.value = v;
            }

        }
    );
}

// ------------------------------------------------------------
// "Solid image" - ignore image transparency so logos/GIFs with alpha
// render as filled discs instead of cutouts. Straight to the shader.
// ------------------------------------------------------------
const ignoreAlphaToggle =
    document.getElementById('ignoreAlphaToggle');

if (ignoreAlphaToggle) {

    if (instance && instance.uniforms.uIgnoreAlpha) {
        instance.uniforms.uIgnoreAlpha.value =
            ignoreAlphaToggle.checked ? 1 : 0;
    }

    ignoreAlphaToggle.addEventListener(
        'change',
        (e) => {

            const target = fieldTarget();

            if (target) {
                setSphereIgnoreAlpha(target, e.target.checked);
                return;
            }

            if (instance && instance.uniforms.uIgnoreAlpha) {
                instance.uniforms.uIgnoreAlpha.value =
                    e.target.checked ? 1 : 0;
            }

        }
    );
}

// ------------------------------------------------------------
// Face size - scales the angular radius of every custom-image face.
// Visible only when the per-face UI is relevant; any change re-derives
// whatever is currently active (CPU bake or shader composite).
// ------------------------------------------------------------
const faceSizeControl =
    document.getElementById('faceSize');
const faceSizeGroup =
    document.getElementById('faceSizeGroup');

if (faceSizeControl) {

    faceSizeMultiplier =
        parseFloat(faceSizeControl.value);

    faceSizeControl.addEventListener(
        'input',
        (e) => {

            faceSizeMultiplier =
                parseFloat(e.target.value);

            // Re-derive the active content at the new patch size -
            // cheap for the composite path (uniforms only), heavier
            // for CPU-baked paths but only while dragging.
            if (faceCompositeActive) {

                updateFaceComposite();

            } else if (
                activeCustomKind === 'image' &&
                rawCustomImages[0]
            ) {

                regenerateCustomImageTexture();

            } else if (rawGifFrames) {

                rebakeAnimatedGifFrames();
            }
        }
    );

    // Show alongside the other image controls whenever an upload /
    // multi-face layout makes sense.
    const syncFaceSizeVisibility = () => {

        if (!faceSizeGroup) {
            return;
        }

        const show =
            activeCustomKind === 'image';

        faceSizeGroup.style.display =
            show ? 'block' : 'none';
    };

    // Hook into texture selection changes by observing the group's
    // own visibility toggles - simplest reliable sync point.
    new MutationObserver(syncFaceSizeVisibility)
        .observe(document.getElementById('faceCountGroup'), {
            attributes: true,
            attributeFilter: ['style']
        });

    syncFaceSizeVisibility();
}

// ============================================================
// Drag-to-spin (mouse + touch)
//
// Dragging on the globe canvas rotates the sphere directly: horizontal
// drag -> phi, vertical drag -> theta. Works whether spinning or
// paused - while paused the drag edits phi/theta like the sliders do;
// while spinning it adds velocity that decays back to the ambient
// spin, so a flick "throws" the globe and it gradually settles back
// into its normal rotation.
// ============================================================

let dragActive = false;
let dragLastX = 0;
let dragLastY = 0;

// Flick momentum, in radians per frame. Decays each tick while the
// user isn't dragging.
let dragVelocityPhi = 0;
let dragVelocityTheta = 0;

const DRAG_SENSITIVITY = 0.008;
const DRAG_VELOCITY_DECAY = 0.95;

function dragStart(x, y) {

    dragActive = true;
    dragLastX = x;
    dragLastY = y;

    // Grabbing kills any in-flight flick so it doesn't fight you.
    dragVelocityPhi = 0;
    dragVelocityTheta = 0;
}

function dragMove(x, y) {

    if (!dragActive) {
        return;
    }

    const dx = x - dragLastX;
    const dy = y - dragLastY;

    dragLastX = x;
    dragLastY = y;

    applyDragDelta(dx, dy);

    // Track recent motion for the flick-on-release effect.
    dragVelocityPhi =
        dx * DRAG_SENSITIVITY;

    dragVelocityTheta =
        dy * DRAG_SENSITIVITY;
}

function dragEnd() {
    dragActive = false;
}

function applyDragDelta(dx, dy) {

    phi += dx * DRAG_SENSITIVITY;
    theta += dy * DRAG_SENSITIVITY;
}

const globeCanvas = document.getElementById('globe');

if (globeCanvas) {

    // Mouse
    globeCanvas.addEventListener(
        'mousedown',
        (e) => {

            dragStart(e.clientX, e.clientY);

            e.preventDefault();
        }
    );

    window.addEventListener(
        'mousemove',
        (e) => {

            if (dragActive) {
                dragMove(e.clientX, e.clientY);
            }
        }
    );

    window.addEventListener(
        'mouseup',
        dragEnd
    );

    // Touch (single finger; passive:false so the page doesn't scroll)
    globeCanvas.addEventListener(
        'touchstart',
        (e) => {

            const touch = e.touches[0];

            dragStart(touch.clientX, touch.clientY);

            e.preventDefault();
        },
        { passive: false }
    );

    globeCanvas.addEventListener(
        'touchmove',
        (e) => {

            const touch = e.touches[0];

            dragMove(touch.clientX, touch.clientY);

            e.preventDefault();
        },
        { passive: false }
    );

    globeCanvas.addEventListener(
        'touchend',
        dragEnd
    );
}

// ============================================================
// Dots on/off toggle
// ============================================================

const useDotsToggle =
    document.getElementById('useDotsToggle');

if (useDotsToggle) {

    useDotsToggle.addEventListener(
        'change',
        (e) => {

            const v =
                e.target.checked ? 1 : 0;

            const target = fieldTarget();

            if (target) {
                setSphereUseDots(target, v);
                return;
            }

            useDots = v;

        }
    );
}

// ============================================================
// Spin type
// ============================================================

const spinTypeControl =
    document.getElementById('spinType');

if (spinTypeControl) {

    spinTypeControl.addEventListener(
        'change',
        (e) => {

            const v = e.target.value;

            const target = fieldTarget();

            if (target) {
                setSphereSpinType(target, v);
                return;
            }

            spinType = v;

            if (spinType === 'axis') {

                /*
                 * Normalize to a clean, non-tilted view: poles
                 * straight up/down, no leftover wobble from
                 * Randomized. Phi is left alone so the spin itself
                 * doesn't jump.
                 */
                theta = 0;

                if (thetaControl) {
                    thetaControl.value = 0;
                }
            }

        }
    );
}

// ============================================================
// Pause spin
// ============================================================

const pauseSpinToggle =
    document.getElementById('pauseSpinToggle');

if (pauseSpinToggle) {

    pauseSpinToggle.addEventListener(
        'change',
        (e) => {

            const target = fieldTarget();

            if (target) {
                setSpherePaused(target, e.target.checked);
                return;
            }

            isPaused =
                e.target.checked;

        }
    );
}

// ============================================================
// Face count
// ============================================================

const faceCountInputs =
    document.querySelectorAll(
        'input[name="faceCount"]'
    );

faceCountInputs.forEach(
    (input) => {

        input.addEventListener(
            'change',
            async (e) => {

                if (!e.target.checked) {
                    return;
                }

                faceCount =
                    parseInt(
                        e.target.value,
                        10
                    );

                console.log(
                    "Face count changed:",
                    faceCount
                );

                renderFaceSlotThumbnails();

                // Per-face shader-composited content: just recompute
                // the face geometry uniforms - no rebake needed, that's
                // the whole point of compositing in the shader.
                if (faceCompositeActive) {

                    updateFaceComposite();

                    bindFaceCompositeFrames();

                    return;
                }

                if (rawGifFrames) {

                    await rebakeAnimatedGifFrames();

                } else if (activeCustomKind === 'image') {

                    await regenerateCustomImageTexture();
                }

            }
        );
    }
);

// ============================================================
// Custom text input ("write your own text")
// ============================================================

const customTextInput =
    document.getElementById('customTextInput');

let textInputDebounce = null;

if (customTextInput) {

    customTextInput.addEventListener(
        'input',
        (e) => {

            if (textInputDebounce) {
                clearTimeout(textInputDebounce);
            }

            const value =
                e.target.value;

            textInputDebounce =
                setTimeout(
                    () => {

                        applyCustomText(value);

                    },
                    250
                );

        }
    );
}

// ============================================================
// Texture selection
// ============================================================

const textureSelect =
    document.getElementById(
        'textureSelect'
    );

const fileUpload =
    document.getElementById(
        'fileUpload'
    );

const uploadStatus =
    document.getElementById('uploadStatus');

const textEntryGroup =
    document.getElementById('textEntryGroup');

const faceCountGroup =
    document.getElementById('faceCountGroup');

const perFaceGroup =
    document.getElementById('perFaceGroup');

const faceSlotsContainer =
    document.getElementById('faceSlots');

function setContextualControlsVisible({
    upload = false,
    text = false,
    faces = false
}) {

    if (fileUpload) {
        fileUpload.style.display =
            upload ? 'block' : 'none';
    }

    if (textEntryGroup) {
        textEntryGroup.style.display =
            text ? 'block' : 'none';
    }

    if (faceCountGroup) {
        faceCountGroup.style.display =
            faces ? 'block' : 'none';
    }

    if (!faces && perFaceGroup) {
        perFaceGroup.style.display = 'none';
    }
}

// ============================================================
// Per-face image upload slots
//
// Generated once (up to MAX_FACE_SLOTS), shown/hidden per current
// faceCount. Slot 0 ("Face 1") is the primary image - setting it
// clears other overrides (see applyCustomImage). Slots 1+ are
// optional per-face overrides that fall back to the primary when
// left unset.
// ============================================================

const faceSlotButtons = [];

if (faceSlotsContainer) {

    for (let i = 0; i < MAX_FACE_SLOTS; i++) {

        const thumb =
            document.createElement('button');

        thumb.type = 'button';
        thumb.className = 'face-slot-thumb';
        thumb.title = `Face ${i + 1}`;

        // A dedicated badge for the face number, kept separate from
        // any thumbnail preview image (see renderFaceSlotThumbnails)
        // so the number stays visible once a face has an image
        // instead of being overwritten by it.
        const numberBadge =
            document.createElement('span');

        numberBadge.className = 'face-slot-number';
        numberBadge.textContent = String(i + 1);

        thumb.appendChild(numberBadge);

        const slotFileInput =
            document.createElement('input');

        slotFileInput.type = 'file';
        slotFileInput.accept = 'image/*';
        slotFileInput.style.display = 'none';

        thumb.addEventListener(
            'click',
            () => slotFileInput.click()
        );

        slotFileInput.addEventListener(
            'change',
            (e) => {

                const file =
                    e.target.files[0];

                if (!file) {
                    return;
                }

                if (
                    !file.type.startsWith('image/')
                ) {

                    alert(
                        "Please select an image file."
                    );

                    e.target.value = '';

                    return;
                }

                // ------------------------------------------------
                // Field mode with a selected sphere: per-face
                // uploads go to THAT sphere as its whole-sphere
                // texture (field spheres don't have faces).
                // ------------------------------------------------
                const fieldSphereTarget = fieldTarget();

                if (fieldSphereTarget) {

                    lastUploadedFileName = file.name;

                    debugLog(
                        `per-face slot ${i} upload routed: field sphere ` +
                        `${fieldSphereTarget.id || '(selected)'} (${file.type})`
                    );

                    loadFileOntoFieldSphere(
                        fieldSphereTarget,
                        file
                    ).then(showUploadStatusIdle);

                    e.target.value = '';

                    return;
                }

                lastUploadedFileName = file.name;

                debugLog(
                    `per-face slot ${i} upload routed: main globe ` +
                    `(${file.type}, activeCustomKind='${activeCustomKind}', faceCount=${faceCount})`
                );

                // ------------------------------------------------
                // Animated GIF -> this face's own independent
                // animation stream (shader-composited, see
                // faceSlotContent). Everything else -> a static
                // texture on just this face. Both live in the
                // per-face system, so a static on one face and a
                // GIF on another mix freely.
                // ------------------------------------------------

                if (file.type === 'image/gif') {

                    const gifReader =
                        new FileReader();

                    gifReader.onload =
                        function(event) {

                            applyFaceSlotGif(
                                event.target.result,
                                i
                            );
                        };

                    gifReader.onerror =
                        function() {

                            console.error(
                                "FileReader failed:",
                                gifReader.error
                            );
                        };

                    gifReader.readAsArrayBuffer(
                        file
                    );

                    e.target.value = '';

                    return;
                }

                const reader =
                    new FileReader();

                reader.onload =
                    (event) => {

                        const img =
                            new Image();

                        img.onload =
                            async () => {

                                await applyFaceSlotImage(
                                    img,
                                    i
                                );

                                showUploadStatusIdle();
                            };

                        img.src =
                            event.target.result;
                    };

                reader.readAsDataURL(file);

                e.target.value = '';
            }
        );

        faceSlotsContainer.appendChild(thumb);
        faceSlotsContainer.appendChild(slotFileInput);

        faceSlotButtons.push({
            thumb,
            fileInput: slotFileInput
        });
    }
}

function renderFaceSlotThumbnails() {

    if (
        !perFaceGroup ||
        faceSlotButtons.length === 0
    ) {
        return;
    }

    const shouldShow =
        activeCustomKind === 'image' &&
        faceCount > 1;

    perFaceGroup.style.display =
        shouldShow ? 'flex' : 'none';

    if (!shouldShow) {
        return;
    }

    faceSlotButtons.forEach(
        (slot, i) => {

            if (i >= faceCount) {

                slot.thumb.style.display = 'none';

                return;
            }

            slot.thumb.style.display = 'flex';

            // Prefer per-face system content (the only place per-face
            // uploads land now), falling back to the legacy
            // rawCustomImages bake for anything still in it.
            const faceContent =
                faceSlotContent[i] ||
                faceSlotContent[0];

            const legacyImg =
                rawCustomImages[i] ||
                rawCustomImages[0];

            let previewSrc = null;

            if (faceContent) {

                // GIFs keep a pre-captured thumbnail URL (their baked
                // frames hold only GPU textures); statics keep the
                // original <img>, which has .src.
                previewSrc =
                    faceContent.thumbUrl ||
                    (faceContent.image && faceContent.image.src) ||
                    null;

            } else if (legacyImg) {

                // Normally an <img> (has .src); a frozen GIF frame is
                // a plain <canvas>, which has no .src.
                previewSrc =
                    legacyImg.src ||
                    (legacyImg.toDataURL &&
                        legacyImg.toDataURL());
            }

            if (previewSrc) {

                slot.thumb.style.backgroundImage =
                    `url(${previewSrc})`;

                slot.thumb.classList.toggle(
                    'is-override',
                    Boolean(faceSlotContent[i]) ||
                        Boolean(rawCustomImages[i])
                );

            } else {

                slot.thumb.style.backgroundImage = '';
                slot.thumb.classList.remove('is-override');
            }
        }
    );
}

if (
    textureSelect &&
    fileUpload
) {

    textureSelect.addEventListener(
        'change',
        async (e) => {

            const selectedTexture =
                e.target.value;

            console.log(
                "Texture selected:",
                selectedTexture
            );

            // ------------------------------------------------
            // Custom uploaded image
            // ------------------------------------------------

            if (
                selectedTexture ===
                'custom'
            ) {

                activeCustomKind = 'image';

                syncTextureSelect('custom');

                debugLog(
                    "textureSelect: custom mode - upload/faces controls shown"
                );

                setContextualControlsVisible({
                    upload: true,
                    faces: true
                });

                renderFaceSlotThumbnails();

                setUseDots(false);

                setTimeout(
                    () => {

                        fileUpload.click();

                    },
                    0
                );

                return;
            }

            // ------------------------------------------------
            // Write your own text
            // ------------------------------------------------

            if (
                selectedTexture ===
                'text'
            ) {

                activeCustomKind = 'text';

                syncTextureSelect('text');

                debugLog(
                    "textureSelect: text mode"
                );

                setContextualControlsVisible({
                    text: true,
                    faces: false
                });

                setUseDots(true);

                await applyCustomText(
                    customTextInput ?
                        (customTextInput.value || 'HELLO WORLD!') :
                        'HELLO WORLD!'
                );

                return;
            }

            // ------------------------------------------------
            // Hide contextual controls for the remaining,
            // non-customizable presets.
            // ------------------------------------------------

            activeCustomKind = null;

            clearAllFaceSlots();

            clearAnimatedGif();

            renderFaceSlotThumbnails();

            setContextualControlsVisible({});

            // ------------------------------------------------
            // Laughing Man
            //
            // This needs special handling because it must
            // be converted into the six-logo globe texture.
            // ------------------------------------------------

            if (
                selectedTexture ===
                'laughingMan'
            ) {

                syncTextureSelect('laughingMan');

                await loadLaughingMan();

                return;
            }

            // ------------------------------------------------
            // Normal predefined texture
            // ------------------------------------------------

            if (
                textures[
                    selectedTexture
                ]
            ) {

                debugLog(
                    `textureSelect: loading preset '${selectedTexture}'`
                );

                setUseDots(true);

                loadTexture(
                    textures[
                        selectedTexture
                    ]
                );

            } else {

                console.warn(
                    "Texture not found:",
                    selectedTexture
                );

            }

        }
    );
}

// ============================================================
// Custom image upload
// ============================================================

if (fileUpload) {

    fileUpload.addEventListener(
        'change',
        (e) => {

            const file =
                e.target.files[0];

            if (!file) {
                return;
            }

            // ------------------------------------------------
            // Field mode with a selected sphere: the image goes
            // to THAT sphere, bypassing the main-globe pipeline
            // entirely.
            // ------------------------------------------------
            const fieldSphereTarget = fieldTarget();

            if (fieldSphereTarget) {

                if (!file.type.startsWith('image/')) {

                    alert(
                        "Please select an image file."
                    );

                    e.target.value = '';

                    return;
                }

                lastUploadedFileName = file.name;

                debugLog(
                    `upload routed: field sphere ${fieldSphereTarget.id || '(selected)'}` +
                    ` (${file.type})`
                );

                loadFileOntoFieldSphere(
                    fieldSphereTarget,
                    file
                ).then(showUploadStatusIdle);

                e.target.value = '';

                return;
            }

            debugLog(
                `upload routed: main globe pipeline (${file.type})`
            );

            console.log(
                "Selected file:",
                file.name,
                file.type,
                `${(
                    file.size /
                    1024 /
                    1024
                ).toFixed(2)} MB`
            );

            if (
                !file.type.startsWith(
                    'image/'
                )
            ) {

                alert(
                    "Please select an image file."
                );

                e.target.value =
                    '';

                return;
            }

            // Remembered for display in uploadStatus once loading
            // finishes (see showUploadStatusIdle) - the <input>'s own
            // "chosen file" text gets reset below, in both branches.
            lastUploadedFileName = file.name;

            // ------------------------------------------------
            // In field mode with a selected sphere, the upload goes
            // to THAT sphere (via its own full-wrap bake), not the
            // main globe.
            // ------------------------------------------------

            const target = fieldTarget();

            if (target) {

                const reader =
                    new FileReader();

                reader.onload =
                    function(event) {

                        loadFileOntoFieldSphere(
                            target,
                            file
                        );

                    };

                reader.readAsArrayBuffer(file);

                e.target.value = '';

                return;
            }

            // ------------------------------------------------
            // Animated GIF - separate pipeline (see
            // applyAnimatedGif). Everything else below this
            // branch is the existing static-image path,
            // unchanged.
            // ------------------------------------------------

            if (file.type === 'image/gif') {

                // ------------------------------------------------
                // With multiple faces selected, the globe is being
                // driven by the per-face (shader-composited) system,
                // so the GIF becomes face 1's own independent
                // animation - identical to picking it through a
                // per-face button. Single-face mode keeps using the
                // classic whole-globe bake pipeline below.
                // ------------------------------------------------

                if (
                    activeCustomKind === 'image' &&
                    faceCount > 1
                ) {

                    const gifReader =
                        new FileReader();

                    gifReader.onload =
                        function(event) {

                            applyFaceSlotGif(
                                event.target.result,
                                0
                            );
                        };

                    gifReader.onerror =
                        function() {

                            console.error(
                                "FileReader failed:",
                                gifReader.error
                            );
                        };

                    gifReader.readAsArrayBuffer(
                        file
                    );

                    e.target.value = '';

                    return;
                }

                const gifReader =
                    new FileReader();

                gifReader.onload =
                    function(event) {

                        applyAnimatedGif(
                            event.target.result
                        );
                    };

                gifReader.onerror =
                    function() {

                        console.error(
                            "FileReader failed:",
                            gifReader.error
                        );
                    };

                gifReader.readAsArrayBuffer(
                    file
                );

                e.target.value = '';

                return;
            }

            const reader =
                new FileReader();

            reader.onload =
                function(event) {

                    const img =
                        new Image();

                    img.onload =
                        async function() {

                            console.log(
                                `Original logo: ${img.width}x${img.height}`
                            );

                            await applyCustomImage(img);

                            showUploadStatusIdle();

                        };

                    img.onerror =
                        function() {

                            console.error(
                                "Failed to load selected image"
                            );

                        };

                    img.src =
                        event.target.result;

                };

            reader.onerror =
                function() {

                    console.error(
                        "FileReader failed:",
                        reader.error
                    );

                };

            reader.readAsDataURL(
                file
            );

            /*
             * Allow selecting the same file again.
             */
            e.target.value = '';

        }
    );
}

// ============================================================
// Export as loopable GIF
//
// Renders frames sampled evenly across exactly one full rotation loop
// (so frame N wraps seamlessly back to frame 0), independent of the
// live animation's frame rate. Axis spin loops phi through a full
// turn; randomized spin loops theta through one turn while phi does
// two (matching the live 2:1 PHI_RATE:THETA_RATE ratio), since that's
// the point where both angles simultaneously return to their starting
// values.
//
// How many frames that takes, and how long each is shown for, is
// derived at export time (see exportLoopableGif) from PHI_RATE/
// THETA_RATE themselves, so the export rotates at roughly the same
// speed the globe actually spins at live rather than a fixed
// duration.
// ============================================================

// Assumed live playback rate, used ONLY to translate PHI_RATE/
// THETA_RATE (radians per rendered frame) into a real-world duration.
// The live animate() loop is itself uncapped/display-rate-driven, but
// 60fps is a reasonable typical baseline for "how fast this looks".
const ASSUMED_LIVE_FPS = 60;

// Target spacing between exported frames - a middle ground between
// smoothness and export time/file size. Actual frame count/delay are
// derived from this and the loop duration above (see
// exportLoopableGif), then clamped to the bounds below.
const EXPORT_TARGET_FRAME_DELAY_MS = 90;
const EXPORT_MIN_FRAMES = 40;
const EXPORT_MAX_FRAMES = 200;

const EXPORT_SIZE = 480;

const exportGifBtn =
    document.getElementById('exportGifBtn');

const exportStatus =
    document.getElementById('exportStatus');

function nextAnimationFrame() {

    return new Promise(
        (resolve) => requestAnimationFrame(resolve)
    );
}

// Reads back only the globe's bounding box (not the full canvas) at
// EXPORT_SIZE resolution, flipping WebGL's bottom-up rows to normal
// top-down image order.
function readGlobeCropAsImageData(gl, canvasWidth, canvasHeight) {

    // Matches the shader: globe diameter in pixels is
    // 0.64 * scale * min(width, height), centered on the canvas.
    const minDim =
        Math.min(canvasWidth, canvasHeight);

    const diameter =
        0.64 * scale * minDim;

    // Add margin for the atmospheric glow outside the sphere edge.
    const cropSize =
        Math.min(
            canvasWidth,
            canvasHeight,
            diameter * 1.35
        );

    const cropX =
        Math.round(canvasWidth / 2 - cropSize / 2);

    const cropYTopDown =
        Math.round(canvasHeight / 2 - cropSize / 2);

    const cropW =
        Math.round(cropSize);

    const cropH =
        Math.round(cropSize);

    const cropYBottomUp =
        canvasHeight - (cropYTopDown + cropH);

    const buffer =
        new Uint8Array(cropW * cropH * 4);

    gl.readPixels(
        cropX,
        cropYBottomUp,
        cropW,
        cropH,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        buffer
    );

    const flipped =
        new Uint8ClampedArray(cropW * cropH * 4);

    for (let row = 0; row < cropH; row++) {

        const srcStart = row * cropW * 4;
        const dstStart = (cropH - 1 - row) * cropW * 4;

        flipped.set(
            buffer.subarray(srcStart, srcStart + cropW * 4),
            dstStart
        );
    }

    return new ImageData(flipped, cropW, cropH);
}

// ============================================================
// GIF transparency is strictly 1-bit (a pixel is either fully opaque
// or fully transparent - no in-between), but the shader's atmospheric
// glow and antialiased edges are smooth alpha gradients. Quantizing
// straight to 1-bit alpha (see exportLoopableGif's oneBitAlpha
// option) snaps that whole gradient to one hard, blocky cutoff line -
// a jagged halo around the globe that isn't there in the live WebGL
// rendering, and stands out most against detailed textures (e.g. the
// Earth map). Applying a small ordered (Bayer 4x4) dither to the
// alpha channel BEFORE quantizing spreads that cutoff into a soft
// stipple instead, which reads as a much closer match to the smooth
// original - the classic way to handle soft edges in a 1-bit-alpha
// format.
// ============================================================

const BAYER_4X4 = [
    [ 0,  8,  2, 10],
    [12,  4, 14,  6],
    [ 3, 11,  1,  9],
    [15,  7, 13,  5]
];

function ditherAlphaChannel(data, width, height) {

    for (let y = 0; y < height; y++) {

        for (let x = 0; x < width; x++) {

            const i =
                (y * width + x) * 4 + 3;

            const a = data[i];

            // Already fully transparent/opaque - nothing to dither.
            if (a === 0 || a === 255) {
                continue;
            }

            const threshold =
                (BAYER_4X4[y % 4][x % 4] + 0.5) / 16 * 255;

            data[i] =
                a > threshold ? 255 : 0;
        }
    }
}

async function exportLoopableGif() {

    if (
        !p ||
        !p.gl ||
        !instance ||
        isExportingGif
    ) {
        return;
    }

    isExportingGif = true;

    if (exportGifBtn) {
        exportGifBtn.disabled = true;
    }

    const startPhi = phi;
    const startTheta = theta;

    // --------------------------------------------------------
    // How long one full rotation loop actually takes live, from the
    // SAME PHI_RATE/THETA_RATE the live spin itself uses - this is
    // what keeps the export's rotation speed matching what's on
    // screen (previously a fixed 72 frames * 45ms = ~3.2s loop,
    // several times faster than the live spin actually runs at).
    // --------------------------------------------------------

    const liveRatePerFrame =
        spinType === 'axis' ?
            PHI_RATE :
            THETA_RATE;

    const loopDurationMs =
        (2 * Math.PI / liveRatePerFrame / ASSUMED_LIVE_FPS) * 1000;

    const rawFrameCount =
        Math.round(loopDurationMs / EXPORT_TARGET_FRAME_DELAY_MS);

    const frameCount =
        Math.min(
            EXPORT_MAX_FRAMES,
            Math.max(EXPORT_MIN_FRAMES, rawFrameCount)
        );

    const frameDelayMs =
        Math.max(
            20,
            Math.round(loopDurationMs / frameCount / 10) * 10
        );

    // --------------------------------------------------------
    // If an animated source (an uploaded GIF or Laughing Man) is
    // active, cycle through ITS frames during export too - on its own
    // timing, independent of the rotation above - instead of freezing
    // on whichever single frame happened to be showing when Export
    // was clicked.
    // --------------------------------------------------------

    const sourceFrames = activeAnimatedFrames;

    const sourceTotalMs =
        sourceFrames && sourceFrames.length > 0 ?
            sourceFrames.reduce((sum, f) => sum + f.delay, 0) :
            0;

    function bindSourceFrameAtElapsed(elapsedMs) {

        if (
            !sourceFrames ||
            sourceFrames.length === 0 ||
            sourceTotalMs <= 0
        ) {
            return;
        }

        let t = elapsedMs % sourceTotalMs;

        for (const frame of sourceFrames) {

            if (t < frame.delay) {

                p.gl.activeTexture(p.gl.TEXTURE0);
                p.gl.bindTexture(p.gl.TEXTURE_2D, frame.texture);

                return;
            }

            t -= frame.delay;
        }

        // Floating-point edge case (t landed exactly on the total) -
        // just show the last frame.
        const last = sourceFrames[sourceFrames.length - 1];

        p.gl.activeTexture(p.gl.TEXTURE0);
        p.gl.bindTexture(p.gl.TEXTURE_2D, last.texture);
    }

    try {

        const gif = GIFEncoder();

        const cropCanvas =
            document.createElement('canvas');

        const exportCanvas =
            document.createElement('canvas');

        exportCanvas.width = EXPORT_SIZE;
        exportCanvas.height = EXPORT_SIZE;

        const exportCtx =
            exportCanvas.getContext('2d', {
                willReadFrequently: true
            });

        // Higher-quality downscaling than the 2D canvas default - the
        // native capture is often several times larger than
        // EXPORT_SIZE (e.g. on a high-DPI display), and the default
        // (fast) resampling visibly aliases fine texture detail like
        // the Earth map's coastlines.
        exportCtx.imageSmoothingEnabled = true;
        exportCtx.imageSmoothingQuality = 'high';

        for (let i = 0; i < frameCount; i++) {

            if (exportStatus) {
                exportStatus.textContent =
                    `Rendering frame ${i + 1}/${frameCount}...`;
            }

            const t =
                (i / frameCount) * Math.PI * 2;

            let framePhi;
            let frameTheta;

            if (spinType === 'axis') {

                framePhi = startPhi + t;
                frameTheta = startTheta;

            } else {

                frameTheta = startTheta + t;
                framePhi = startPhi + t * 2;
            }

            bindSourceFrameAtElapsed(
                (i / frameCount) * loopDurationMs
            );

            instance.render({

                ...p.uniforms,

                phi: { type: "float", value: framePhi },
                theta: { type: "float", value: frameTheta },
                dots: { type: "float", value: dots },
                scale: { type: "float", value: scale },
                uUseDots: { type: "float", value: useDots }

            });

            const imageData =
                readGlobeCropAsImageData(
                    p.gl,
                    canvas.width,
                    canvas.height
                );

            cropCanvas.width = imageData.width;
            cropCanvas.height = imageData.height;

            cropCanvas
                .getContext('2d')
                .putImageData(imageData, 0, 0);

            exportCtx.clearRect(
                0, 0, EXPORT_SIZE, EXPORT_SIZE
            );

            exportCtx.drawImage(
                cropCanvas,
                0, 0, imageData.width, imageData.height,
                0, 0, EXPORT_SIZE, EXPORT_SIZE
            );

            const frameImageData =
                exportCtx.getImageData(
                    0, 0, EXPORT_SIZE, EXPORT_SIZE
                );

            // Soften the upcoming 1-bit alpha cutoff (see
            // ditherAlphaChannel) before quantizing.
            ditherAlphaChannel(
                frameImageData.data,
                EXPORT_SIZE,
                EXPORT_SIZE
            );

            const frameData =
                frameImageData.data;

            const palette =
                quantize(frameData, 256, {
                    format: 'rgba4444',
                    oneBitAlpha: true
                });

            const index =
                applyPalette(frameData, palette, 'rgba4444');

            const transparentIndex =
                palette.findIndex(c => c[3] === 0);

            gif.writeFrame(
                index,
                EXPORT_SIZE,
                EXPORT_SIZE,
                {
                    palette,
                    delay: frameDelayMs,
                    transparent: transparentIndex >= 0,
                    transparentIndex: Math.max(0, transparentIndex),
                    first: i === 0,
                    repeat: 0
                }
            );

            // Yield periodically so the tab stays responsive.
            if (i % 4 === 0) {
                await nextAnimationFrame();
            }
        }

        gif.finish();

        const bytes = gif.bytes();

        const blob =
            new Blob([bytes], { type: 'image/gif' });

        const url =
            URL.createObjectURL(blob);

        const link =
            document.createElement('a');

        link.href = url;
        link.download = 'globe-loop.gif';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        setTimeout(
            () => URL.revokeObjectURL(url),
            10000
        );

        if (exportStatus) {
            exportStatus.textContent =
                `Done! (${(bytes.length / 1024).toFixed(0)} KB)`;

            setTimeout(
                () => {
                    if (exportStatus) {
                        exportStatus.textContent = '';
                    }
                },
                4000
            );
        }

    } catch (error) {

        console.error(
            "GIF export failed:",
            error
        );

        if (exportStatus) {
            exportStatus.textContent =
                'Export failed - see console.';
        }

    } finally {

        // Restore the live rotation to where it was before export,
        // then let the normal loop take back over.
        phi = startPhi;
        theta = startTheta;

        // bindSourceFrameAtElapsed may have left a different source
        // frame bound than the live loop's own animatedGifFrameIndex
        // (which export never touched) - re-sync texture unit 0 to
        // it now.
        bindActiveAnimatedFrame();

        isExportingGif = false;

        if (exportGifBtn) {
            exportGifBtn.disabled = false;
        }
    }
}

if (exportGifBtn) {

    exportGifBtn.addEventListener(
        'click',
        () => {

            exportLoopableGif();

        }
    );
}

// ============================================================
// WebM video export
//
// Same seamless one-rotation loop as the GIF export, but recorded
// through MediaRecorder: full-color (no 256-color quantization), any
// resolution the live canvas offers, and smooth timing - the things a
// GIF structurally can't do. Good for screensavers / video edits.
// VP9 is preferred when the browser offers it, VP8 otherwise.
// ============================================================

const EXPORT_VIDEO_SECONDS = 6;
const EXPORT_VIDEO_SIZE = 1080;

const exportWebmBtn =
    document.getElementById('exportWebmBtn');

// ------------------------------------------------------------
// ------------------------------------------------------------
// Slider value readouts - human-friendly units next to each slider.
// Phi/Theta in degrees (movement angles), dots as plain counts,
// everything else as multipliers/percentages.
// ------------------------------------------------------------

function formatSliderValue(id, v) {

    switch (id) {

        case 'phi':
        case 'theta':
            // 0..6.28 rad -> 0..360 degrees
            return `${Math.round(v * 180 / Math.PI)}\u00B0`;

        case 'dots':
            return `${Math.round(v)}`;

        case 'scale':
            return `${v.toFixed(2)}x`;

        case 'spinSpeed':
            return `${v.toFixed(2)}x`;

        case 'opacity':
            return `${Math.round(v * 100)}%`;

        case 'faceSize':
            return `${v.toFixed(2)}x`;

        default:
            return v.toFixed(2);
    }
}

const SLIDER_LABEL_IDS = [
    'phi',
    'theta',
    'dots',
    'scale',
    'spinSpeed',
    'opacity',
    'faceSize'
];

for (const id of SLIDER_LABEL_IDS) {

    const input =
        document.getElementById(id);

    const label =
        document.getElementById(`${id}Value`);

    if (!input || !label) {
        continue;
    }

    const update = () => {
        label.textContent =
            formatSliderValue(id, parseFloat(input.value));
    };

    input.addEventListener('input', update);

    // Initial paint
    update();
}

// ------------------------------------------------------------
// Collapsible sidebar - the hamburger button slides the control
// panel off-screen so it never covers spheres in field mode.
// ------------------------------------------------------------

const controlsPanel =
    document.querySelector('.controls');

const sidebarToggle =
    document.getElementById('sidebarToggle');

if (controlsPanel && sidebarToggle) {

    sidebarToggle.addEventListener(
        'click',
        () => {
            controlsPanel.classList.toggle('collapsed');
        }
    );
}

// Sphere Field mode - full-screen surface with many independent
// spheres (see sphere-field.js). Clicking a sphere selects it; the
// sidebar's spin/glow/scale/etc controls then drive THAT sphere
// instead of the main globe.
// ------------------------------------------------------------
const sphereFieldBtn =
    document.getElementById('sphereFieldBtn');

const fieldSelectionGroup =
    document.getElementById('fieldSelectionGroup');

const selectedSphereLabel =
    document.getElementById('selectedSphereLabel');

const deleteSphereBtn =
    document.getElementById('deleteSphereBtn');

const backToSingleBtn =
    document.getElementById('backToSingleBtn');

// Move mode toggle button - makes sphere repositioning discoverable
// (the M key still works too).
const moveModeBtn =
    document.getElementById('moveModeBtn');

if (moveModeBtn) {

    moveModeBtn.addEventListener(
        'click',
        () => {

            const on = !isMoveMode();

            setMoveMode(on);

            moveModeBtn.textContent =
                `Move Mode: ${on ? 'ON' : 'OFF'}`;

            moveModeBtn.classList.toggle('move-on', on);

            console.log(
                `move mode turned ${on ? 'ON' : 'OFF'} (drag now ${on ? 'moves' : 'spins'} spheres)`
            );
        }
    );
}

// Keep the button label in sync when Move mode is toggled with the
// keyboard.
window.addEventListener(
    'keydown',
    (e) => {

        if (
            (e.key === 'm' || e.key === 'M') &&
            moveModeBtn &&
            !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)
        ) {

            // The keydown handler in sphere-field.js flips the mode;
            // read the new state after it runs (bubbled listener).
            setTimeout(() => {
                const on = isMoveMode();
                moveModeBtn.textContent =
                    `Move Mode: ${on ? 'ON' : 'OFF'}`;
                moveModeBtn.classList.toggle('move-on', on);
            }, 0);
        }
    }
);

// Counter for the "Spawn a Sphere" button - spreads new spheres
// around instead of stacking them on one spot.
let fieldSpawnOffset = 0;

// True while Sphere Field mode is open AND a sphere is selected -
// routes every sidebar control change into that sphere instead of
// the main globe's uniforms/variables.
function fieldTarget() {

    return (
        document.getElementById('sphereField')
            .classList.contains('active') &&
        getSelectedSphere()
    ) ? getSelectedSphere() : null;
}

if (deleteSphereBtn) {

    deleteSphereBtn.addEventListener(
        'click',
        () => {

            const s = getSelectedSphere();

            if (s) {
                deleteSphere(s);
            }
        }
    );
}

if (backToSingleBtn) {

    backToSingleBtn.addEventListener(
        'click',
        () => {
            closeSphereField();
        }
    );
}

// Selection UI sync - shows/hides the Delete / Back buttons and the
// "Sphere N" label whenever the selection changes.
onSelectionChanged((sphere) => {

    if (fieldSelectionGroup) {

        const show =
            document.getElementById('sphereField')
                .classList.contains('active') &&
            Boolean(sphere);

        fieldSelectionGroup.style.display =
            show ? 'block' : 'none';
    }

    if (selectedSphereLabel) {

        selectedSphereLabel.textContent =
            sphere ?
                `Selected: Sphere ${sphere.id}` :
                'No sphere selected';
    }
});

function hexToRgb01(hex) {

    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;

    return [r, g, b];
}

if (sphereFieldBtn) {

    sphereFieldBtn.addEventListener(
        'click',
        () => {

            // Enters field mode on first use; every later press
            // spawns ANOTHER sphere. Leaving field mode is done via
            // the "Back to Single Sphere" button (or Escape).
            const wasInactive = !document
                .getElementById('sphereField')
                .classList.contains('active');

            if (wasInactive) {
                openSphereField();
            }

            // New spheres appear near the middle, offset so repeated
            // clicks don't stack them exactly on top of each other.
            const w = window.innerWidth;
            const h = window.innerHeight;

            const n = fieldSpawnOffset++;
            const angle = n * 2.4; // golden-angle-ish spread
            const radius = 90 + (n % 4) * 70;

            spawnSphereAt(
                w * 0.42 + Math.cos(angle) * radius,
                h * 0.45 + Math.sin(angle) * radius,
                150
            );
        }
    );
}

async function exportLoopableWebm() {

    if (
        !p ||
        !p.gl ||
        !instance ||
        isExportingGif
    ) {
        return;
    }

    // MediaRecorder + canvas.captureStream are required.
    if (
        typeof MediaRecorder === 'undefined' ||
        !canvas.captureStream
    ) {

        if (exportStatus) {
            exportStatus.textContent =
                'Video export not supported in this browser.';
        }

        return;
    }

    // Pick the best available codec.
    const candidates = [
        { mime: 'video/webm;codecs=vp9', ext: 'vp9' },
        { mime: 'video/webm;codecs=vp8', ext: 'vp8' },
        { mime: 'video/webm', ext: 'default' }
    ];

    const chosen =
        candidates.find(
            c => MediaRecorder.isTypeSupported(c.mime)
        );

    if (!chosen) {

        if (exportStatus) {
            exportStatus.textContent =
                'No WebM codec available in this browser.';
        }

        return;
    }

    isExportingGif = true;

    // Reuse the GIF button guard too - only one export at a time.
    if (exportGifBtn) {
        exportGifBtn.disabled = true;
    }

    if (exportWebmBtn) {
        exportWebmBtn.disabled = true;
    }

    const startPhi = phi;
    const startTheta = theta;

    try {

        if (exportStatus) {
            exportStatus.textContent = 'Preparing video...';
        }

        // ----------------------------------------------------
        // Render the loop into an offscreen canvas at fixed square
        // size (same crop logic as the GIF path), and record THAT -
        // keeps output independent of window size/DPI.
        // ----------------------------------------------------

        const exportCanvas =
            document.createElement('canvas');

        exportCanvas.width = EXPORT_VIDEO_SIZE;
        exportCanvas.height = EXPORT_VIDEO_SIZE;

        const exportCtx =
            exportCanvas.getContext('2d');

        exportCtx.imageSmoothingEnabled = true;
        exportCtx.imageSmoothingQuality = 'high';

        const cropCanvas =
            document.createElement('canvas');

        const stream =
            exportCanvas.captureStream(60);

        const recorder =
            new MediaRecorder(stream, {
                mimeType: chosen.mime,
                videoBitsPerSecond: 12_000_000
            });

        const chunks = [];

        recorder.ondataavailable =
            (e) => {

                if (e.data && e.data.size > 0) {
                    chunks.push(e.data);
                }
            };

        const done = new Promise((resolve) => {
            recorder.onstop = resolve;
        });

        recorder.start();

        const totalMs = EXPORT_VIDEO_SECONDS * 1000;
        const startWallClock = performance.now();

        let frameIndex = 0;

        // Drive frames manually on rAF - deterministic rotation over
        // exactly N seconds, ending where it started (full turns).
        while (performance.now() - startWallClock < totalMs) {

            const elapsed =
                performance.now() - startWallClock;

            const progress =
                elapsed / totalMs;

            if (exportStatus) {
                exportStatus.textContent =
                    `Recording video ${(progress * 100).toFixed(0)}%...`;
            }

            const t =
                progress * Math.PI * 2 *
                (spinSpeedMultiplier || 1);

            let framePhi;
            let frameTheta;

            if (spinType === 'axis') {

                framePhi = startPhi + t;
                frameTheta = startTheta;

            } else {

                frameTheta = startTheta + t;
                framePhi = startPhi + t * 2;
            }

            instance.render({
                ...p.uniforms,
                phi: { type: "float", value: framePhi },
                theta: { type: "float", value: frameTheta },
                dots: { type: "float", value: dots },
                scale: { type: "float", value: scale },
                uUseDots: { type: "float", value: useDots }
            });

            const imageData =
                readGlobeCropAsImageData(
                    p.gl,
                    canvas.width,
                    canvas.height
                );

            cropCanvas.width = imageData.width;
            cropCanvas.height = imageData.height;

            cropCanvas
                .getContext('2d')
                .putImageData(imageData, 0, 0);

            exportCtx.clearRect(
                0, 0, EXPORT_VIDEO_SIZE, EXPORT_VIDEO_SIZE
            );

            // Transparent background -> composite onto black for
            // video (no alpha channel in WebM).
            exportCtx.fillStyle = '#000';
            exportCtx.fillRect(
                0, 0, EXPORT_VIDEO_SIZE, EXPORT_VIDEO_SIZE
            );

            exportCtx.drawImage(
                cropCanvas,
                0, 0, imageData.width, imageData.height,
                0, 0, EXPORT_VIDEO_SIZE, EXPORT_VIDEO_SIZE
            );

            frameIndex++;

            await nextAnimationFrame();
        }

        recorder.stop();

        await done;

        const blob =
            new Blob(chunks, { type: 'video/webm' });

        const url =
            URL.createObjectURL(blob);

        const link =
            document.createElement('a');

        link.href = url;
        link.download = `globe-loop-${EXPORT_VIDEO_SIZE}p.webm`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        setTimeout(
            () => URL.revokeObjectURL(url),
            10000
        );

        if (exportStatus) {
            exportStatus.textContent =
                `Done! ${frameIndex} frames (${(blob.size / 1024 / 1024).toFixed(1)} MB)`;

            setTimeout(
                () => {
                    if (exportStatus) {
                        exportStatus.textContent = '';
                    }
                },
                4000
            );
        }

        console.log(
            `WebM export complete: ${frameIndex} frames, ${(blob.size / 1024 / 1024).toFixed(1)} MB`
        );

    } catch (error) {

        console.error(
            "WebM export failed:",
            error
        );

        if (exportStatus) {
            exportStatus.textContent =
                'Video export failed - see console.';
        }

    } finally {

        phi = startPhi;
        theta = startTheta;

        bindActiveAnimatedFrame();

        isExportingGif = false;

        if (exportGifBtn) {
            exportGifBtn.disabled = false;
        }

        if (exportWebmBtn) {
            exportWebmBtn.disabled = false;
        }
    }
}

if (exportWebmBtn) {

    exportWebmBtn.addEventListener(
        'click',
        () => {

            exportLoopableWebm();

        }
    );
}