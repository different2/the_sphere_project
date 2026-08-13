// Phenomenon library
import Phenomenon from './phenomenon.js';

// Predefined textures
import { textures, createTextTexture } from './textures.js';

// Fragment shader
import fragmentShader from './fragmentShader.js';

// GIF encoder (vendored, see vendor/README.md)
import { GIFEncoder, quantize, applyPalette } from './vendor/gifenc.esm.js';

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

// How many copies of the current custom image/text appear on the globe.
// 1 = single image stretched to wrap the whole sphere once.
// 2/3 = that many circular "logo" copies placed around the sphere.
let faceCount = 1;

// 'randomized' = current/default tumbling dual-axis spin.
// 'axis' = clean single-axis spin, like a globe on a stand.
let spinType = 'randomized';

// Per-frame rotation increments for the live animation. Kept as named
// constants (rather than inline magic numbers) because the GIF exporter
// below needs to know the exact ratio between them to compute a seamless
// loop length.
const PHI_RATE = 0.008;
const THETA_RATE = 0.004;

// Tracks what kind of custom content is currently active, so the Face
// Count control knows what to regenerate from when it changes.
// 'image' | 'text' | null
let activeCustomKind = null;

// Cached source for the currently active custom image, so switching Face
// Count doesn't require re-uploading the file.
let rawCustomImage = null;

let isExportingGif = false;

// ============================================================
// Canvas resizing
// ============================================================

function resizeCanvas() {
    const width = window.innerWidth;
    const height = window.innerHeight;

    canvas.width = width;
    canvas.height = height;

    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';

    if (p && p.gl) {
        p.gl.viewport(0, 0, width, height);

        if (instance) {
            p.uniforms.uResolution = {
                type: "vec2",
                value: [width, height]
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
                        null
                    );

                    gl.deleteTexture(texture);

                    throw new Error(
                        `WebGL texture error: ${error}`
                    );
                }

                gl.bindTexture(
                    gl.TEXTURE_2D,
                    null
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
function getAngularRadiusForFaceCount(faceCount) {

    if (faceCount === 2) return 45;
    if (faceCount === 3) return 36;

    return 28;
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
// faceCount = 2/3/6: places that many circular copies of logoImg
// around the sphere (gnomonic tangent-plane projection per face).
// ============================================================

function generateGlobeTexture(
    logoImg,
    angularRadiusDeg = 28,
    texWidth = 2048,
    faceCount = 6
) {

    if (faceCount === 1) {

        return generateFullWrapTexture(
            logoImg,
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
    // Read original logo
    // --------------------------------------------------------

    const logoCanvas =
        document.createElement('canvas');

    logoCanvas.width =
        logoImg.width;

    logoCanvas.height =
        logoImg.height;

    const logoCtx =
        logoCanvas.getContext('2d', {
            willReadFrequently: true
        });

    logoCtx.drawImage(
        logoImg,
        0,
        0
    );

    const logoPixels =
        logoCtx.getImageData(
            0,
            0,
            logoImg.width,
            logoImg.height
        ).data;

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
    // Logo size
    // --------------------------------------------------------

    const radiusRad =
        angularRadiusDeg *
        Math.PI /
        180;

    const halfSize =
        Math.tan(radiusRad);

    const logoRadius =
        Math.max(
            logoImg.width,
            logoImg.height
        ) / 2;

    const logoScale =
        halfSize / logoRadius;

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
    // Bilinear sample from original logo
    // --------------------------------------------------------

    function sampleLogo(lx, ly) {

        if (
            lx < 0 ||
            ly < 0 ||
            lx >= logoImg.width ||
            ly >= logoImg.height
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
                logoImg.width - 1
            );

        const y1 =
            Math.min(
                y0 + 1,
                logoImg.height - 1
            );

        const fx =
            lx - x0;

        const fy =
            ly - y0;

        function pixel(x, y) {

            const index =
                (y * logoImg.width + x) * 4;

            return [
                logoPixels[index],
                logoPixels[index + 1],
                logoPixels[index + 2],
                logoPixels[index + 3]
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
            // Try each logo
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
                // Convert tangent position to logo pixels
                // --------------------------------------------

                const lx =
                    tangentX / logoScale +
                    logoImg.width / 2;

                const ly =
                    logoImg.height / 2 -
                    tangentY / logoScale;

                const sampled =
                    sampleLogo(
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

    try {

        console.log(
            "Loading new texture..."
        );

        const texture =
            await createTexture(
                p.gl,
                textureData
            );

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

    } catch (error) {

        console.error(
            "Failed to load texture:",
            error
        );
    }
}

// ============================================================
// Load Laughing Man as a globe texture
//
// Always the original fixed 6-face layout - the Face Count control
// only applies to Upload Image / Text Message (see setActiveCustomKind
// calls below).
// ============================================================

async function loadLaughingMan() {

    if (!p || !p.gl) {

        console.warn(
            "WebGL is not ready yet"
        );

        return;
    }

    try {

        console.log(
            "Loading Laughing Man..."
        );

        // Load the actual PNG
        const image =
            await loadImage(
                textures.laughingMan
            );

        console.log(
            `Original Laughing Man: ${image.width}x${image.height}`
        );

        // Generate six-logo globe
        const generatedCanvas =
            generateGlobeTexture(
                image,
                28,
                2048,
                6
            );

        // Convert generated canvas into PNG data
        const textureData =
            generatedCanvas.toDataURL(
                'image/png'
            );

        await loadTexture(textureData);

        setUseDots(false);

        console.log(
            "Laughing Man globe texture loaded successfully"
        );

    } catch (error) {

        console.error(
            "Failed to load Laughing Man:",
            error
        );
    }
}

// ============================================================
// Apply the currently-selected custom image, using whatever face
// count is currently selected. Called on first upload AND whenever
// Face Count changes while an image is active.
// ============================================================

async function applyCustomImage(image) {

    rawCustomImage = image;
    activeCustomKind = 'image';

    try {

        const angularRadius =
            getAngularRadiusForFaceCount(faceCount);

        const generatedCanvas =
            generateGlobeTexture(
                image,
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
// Apply user-entered text, using whatever face count is currently
// selected. Called whenever the text input changes AND whenever
// Face Count changes while text is active.
// ============================================================

async function applyCustomText(text) {

    activeCustomKind = 'text';

    try {

        const textCanvas =
            createTextTexture(text);

        const angularRadius =
            getAngularRadiusForFaceCount(faceCount);

        const generatedCanvas =
            generateGlobeTexture(
                textCanvas,
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
            `Custom text texture loaded (${faceCount} face(s))`
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
                        value: [
                            width,
                            height
                        ]
                    },

                    uTexture: {
                        type: "sampler2D",
                        value: 0
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
                    window.innerWidth,
                    window.innerHeight
                ]

            };
        }

    }
);

// ============================================================
// Animation
// ============================================================

function animate() {

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

    if (spinType === 'axis') {

        // Clean single-axis spin, like a globe on a stand. Theta is
        // left alone so the manual Theta slider still works as a
        // fixed tilt.
        phi += PHI_RATE;

    } else {

        // Randomized/tumbling dual-axis spin (default/original
        // behavior).
        phi += PHI_RATE;
        theta += THETA_RATE;
    }

    const uniforms = {

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

            phi =
                parseFloat(
                    e.target.value
                );

        }
    );
}

const thetaControl =
    document.getElementById('theta');

if (thetaControl) {

    thetaControl.addEventListener(
        'input',
        (e) => {

            theta =
                parseFloat(
                    e.target.value
                );

        }
    );
}

const dotsControl =
    document.getElementById('dots');

if (dotsControl) {

    dotsControl.addEventListener(
        'input',
        (e) => {

            dots =
                parseFloat(
                    e.target.value
                );

        }
    );
}

const scaleControl =
    document.getElementById('scale');

if (scaleControl) {

    scaleControl.addEventListener(
        'input',
        (e) => {

            scale =
                parseFloat(
                    e.target.value
                );

        }
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

            useDots =
                e.target.checked ? 1 : 0;

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

            spinType =
                e.target.value;

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

                if (
                    activeCustomKind === 'image' &&
                    rawCustomImage
                ) {

                    await applyCustomImage(
                        rawCustomImage
                    );

                } else if (
                    activeCustomKind === 'text'
                ) {

                    await applyCustomText(
                        customTextInput ?
                            customTextInput.value :
                            'HELLO WORLD!'
                    );
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

const textEntryGroup =
    document.getElementById('textEntryGroup');

const faceCountGroup =
    document.getElementById('faceCountGroup');

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

                setContextualControlsVisible({
                    upload: true,
                    faces: true
                });

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

                setContextualControlsVisible({
                    text: true,
                    faces: true
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
// Renders a fixed number of frames sampled evenly across exactly one
// full rotation loop (so frame N wraps seamlessly back to frame 0),
// independent of the live animation's frame rate. Axis spin loops
// phi through a full turn; randomized spin loops theta through one
// turn while phi does two (matching the live 2:1 PHI_RATE:THETA_RATE
// ratio), since that's the point where both angles simultaneously
// return to their starting values.
// ============================================================

const EXPORT_FRAME_COUNT = 72;
const EXPORT_FRAME_DELAY_MS = 45;
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

        for (let i = 0; i < EXPORT_FRAME_COUNT; i++) {

            if (exportStatus) {
                exportStatus.textContent =
                    `Rendering frame ${i + 1}/${EXPORT_FRAME_COUNT}...`;
            }

            const t =
                (i / EXPORT_FRAME_COUNT) * Math.PI * 2;

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

            const frameData =
                exportCtx.getImageData(
                    0, 0, EXPORT_SIZE, EXPORT_SIZE
                ).data;

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
                    delay: EXPORT_FRAME_DELAY_MS,
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
