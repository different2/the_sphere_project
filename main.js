// Phenomenon library
import Phenomenon from './phenomenon.js';

// Predefined textures
import { textures } from './textures.js';

// Fragment shader
import fragmentShader from './fragmentShader.js';

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
// Generate six-logo globe texture
//
// Layout:
//
//                  NORTH
//
//              ●     ●     ●     ●
//
//                  SOUTH
//
// Two poles + four equatorial positions.
// ============================================================

function generateGlobeTexture(
    logoImg,
    angularRadiusDeg = 28,
    texWidth = 2048
) {

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
    // Six positions
    // --------------------------------------------------------

    const centers = [

        // North pole
        {
            x: 0,
            y: 1,
            z: 0
        },

        // South pole
        {
            x: 0,
            y: -1,
            z: 0
        },

        // Equator
        {
            x: 1,
            y: 0,
            z: 0
        },

        {
            x: 0,
            y: 0,
            z: 1
        },

        {
            x: -1,
            y: 0,
            z: 0
        },

        {
            x: 0,
            y: 0,
            z: -1
        }

    ];

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
        `Generated ${texWidth}x${texHeight} six-logo texture`
    );

    return canvas;
}

// ============================================================
// Load a normal texture
// ============================================================

async function loadTexture(
    textureData,
    customMode = false
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

        /*
         * Custom mode:
         * bypass Fibonacci dots.
         *
         * Normal texture:
         * use Fibonacci dots.
         */
        useDots =
            customMode ? 0 : 1;

        console.log(
            customMode
                ? "Loaded crisp custom texture"
                : "Loaded dotted texture"
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
                2048
            );

        // Convert generated canvas into PNG data
        const textureData =
            generatedCanvas.toDataURL(
                'image/png'
            );

        // Create WebGL texture
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

        // Direct texture mode
        useDots = 0;

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

    phi += 0.008;
    theta += 0.004;

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
            // Custom texture
            // ------------------------------------------------

            if (
                selectedTexture ===
                'custom'
            ) {

                fileUpload.style.display =
                    'block';

                setTimeout(
                    () => {

                        fileUpload.click();

                    },
                    0
                );

                return;
            }

            // ------------------------------------------------
            // Hide file upload
            // ------------------------------------------------

            fileUpload.style.display =
                'none';

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

                loadTexture(
                    textures[
                        selectedTexture
                    ],
                    false
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

                            try {

                                console.log(
                                    `Original logo: ${img.width}x${img.height}`
                                );

                                /*
                                 * Generate the actual globe texture.
                                 *
                                 * 28 degrees gives the logos
                                 * enough room for the lettering.
                                 */
                                const generatedCanvas =
                                    generateGlobeTexture(
                                        img,
                                        28,
                                        2048
                                    );

                                const textureDataUrl =
                                    generatedCanvas.toDataURL(
                                        'image/png'
                                    );

                                /*
                                 * TRUE means crisp texture mode.
                                 */
                                await loadTexture(
                                    textureDataUrl,
                                    true
                                );

                                console.log(
                                    "Six-logo texture loaded successfully"
                                );

                            } catch (error) {

                                console.error(
                                    "Error generating custom globe texture:",
                                    error
                                );

                            }

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