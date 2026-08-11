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

// Canvas setup
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
// Create WebGL texture from image data
// ============================================================

function createTexture(gl, imageData) {
    return new Promise((resolve, reject) => {
        const image = new Image();

        image.onload = function() {
            try {
                console.log(
                    `Loading image: ${image.width}x${image.height}`
                );

                const texture = gl.createTexture();

                if (!texture) {
                    throw new Error("WebGL could not create the texture");
                }

                gl.bindTexture(gl.TEXTURE_2D, texture);

                // Upload image to GPU
                gl.texImage2D(
                    gl.TEXTURE_2D,
                    0,
                    gl.RGBA,
                    gl.RGBA,
                    gl.UNSIGNED_BYTE,
                    image
                );

                /*
                 * IMPORTANT:
                 *
                 * Uploaded images can have arbitrary dimensions.
                 * WebGL 1 does not allow REPEAT wrapping on
                 * non-power-of-two textures.
                 *
                 * CLAMP_TO_EDGE works with both power-of-two
                 * and non-power-of-two images.
                 */
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

                // Check for WebGL errors
                const error = gl.getError();

                if (error !== gl.NO_ERROR) {
                    console.error(
                        "WebGL error while creating texture:",
                        error
                    );

                    gl.bindTexture(gl.TEXTURE_2D, null);
                    gl.deleteTexture(texture);

                    throw new Error(
                        `WebGL texture error: ${error}`
                    );
                }

                // Unbind after creating the texture
                gl.bindTexture(gl.TEXTURE_2D, null);

                console.log(
                    `Texture created successfully: ${image.width}x${image.height}`
                );

                resolve(texture);

            } catch (error) {
                reject(error);
            }
        };

        image.onerror = function() {
            reject(new Error("Failed to load image"));
        };

        /*
         * Data URLs from FileReader work here.
         * Normal imported texture paths also work here.
         */
        image.src = imageData;
    });
}


// ============================================================
// Load a new texture
// ============================================================

async function loadTexture(textureData) {
    if (!p || !p.gl) {
        console.warn("WebGL is not ready yet");
        return;
    }

    try {
        console.log("Loading new texture...");

        const texture = await createTexture(p.gl, textureData);

        /*
         * Put the texture on texture unit 0.
         * The shader's uTexture uniform uses texture unit 0.
         */
        p.gl.activeTexture(p.gl.TEXTURE0);
        p.gl.bindTexture(p.gl.TEXTURE_2D, texture);

        currentTexture = texture;

        console.log("New texture loaded successfully");

        // Check for errors after binding
        const error = p.gl.getError();

        if (error !== p.gl.NO_ERROR) {
            console.error(
                "WebGL error after binding texture:",
                error
            );
        }

    } catch (error) {
        console.error(
            "Failed to load texture:",
            error
        );
    }
}


// ============================================================
// Create globe
// ============================================================

async function createGlobe() {

    const width = window.innerWidth;
    const height = window.innerHeight;

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
                clearColor: [0, 0, 0, 0],
                devicePixelRatio: window.devicePixelRatio || 1,
            }
        });

        if (!p || !p.gl) {
            throw new Error(
                "Failed to create WebGL context"
            );
        }

        console.log("WebGL context created successfully");

        // ----------------------------------------------------
        // Load initial Earth texture
        // ----------------------------------------------------

        currentTexture = await createTexture(
            p.gl,
            textures.earth
        );

        p.gl.activeTexture(p.gl.TEXTURE0);
        p.gl.bindTexture(
            p.gl.TEXTURE_2D,
            currentTexture
        );

        console.log("Earth texture loaded");


        // ----------------------------------------------------
        // Create globe
        // ----------------------------------------------------

        instance = p.add("globe", {

            vertex: vertexShader,

            fragment: fragmentShader,

            uniforms: {

                uResolution: {
                    type: "vec2",
                    value: [width, height]
                },

                /*
                 * Texture unit 0
                 */
                uTexture: {
                    type: "sampler2D",
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
                    value: [0.3, 0.6, 1.0]
                },

                glowColor: {
                    type: "vec3",
                    value: [0.3, 0.8, 1.0]
                },
            },

            mode: 4,

            geometry: {

                vertices: [
                    { x: -1, y: -1, z: 0 },
                    { x: 1, y: -1, z: 0 },
                    { x: -1, y: 1, z: 0 },

                    { x: 1, y: -1, z: 0 },
                    { x: 1, y: 1, z: 0 },
                    { x: -1, y: 1, z: 0 },
                ],

            },

        });

        if (!instance) {
            throw new Error(
                "Phenomenon failed to create the globe instance"
            );
        }

        console.log("Globe created successfully");

        startAnimation();

    } catch (error) {

        console.error(
            "Failed to create globe:",
            error
        );

    }
}


// ============================================================
// Start globe after page initialization
// ============================================================

setTimeout(() => {
    createGlobe();
}, 100);


// ============================================================
// Window resize
// ============================================================

window.addEventListener('resize', () => {

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

});


// ============================================================
// Animation
// ============================================================

function animate() {

    if (!instance) {
        return;
    }

    phi += 0.01;

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

    };

    instance.render(uniforms);

    requestAnimationFrame(animate);
}


function startAnimation() {

    if (!animationStarted) {

        animationStarted = true;

        console.log("Animation started");

        animate();

    }

}


// ============================================================
// Control handlers
// ============================================================

const phiControl = document.getElementById('phi');

if (phiControl) {
    phiControl.addEventListener('input', (e) => {
        phi = parseFloat(e.target.value);
    });
}


const thetaControl = document.getElementById('theta');

if (thetaControl) {
    thetaControl.addEventListener('input', (e) => {
        theta = parseFloat(e.target.value);
    });
}


const dotsControl = document.getElementById('dots');

if (dotsControl) {
    dotsControl.addEventListener('input', (e) => {
        dots = parseFloat(e.target.value);
    });
}


const scaleControl = document.getElementById('scale');

if (scaleControl) {
    scaleControl.addEventListener('input', (e) => {
        scale = parseFloat(e.target.value);
    });
}


// ============================================================
// Texture selection
// ============================================================

const textureSelect = document.getElementById('textureSelect');
const fileUpload = document.getElementById('fileUpload');

if (textureSelect && fileUpload) {

    textureSelect.addEventListener('change', (e) => {

        const selectedTexture = e.target.value;

        console.log(
            "Texture selected:",
            selectedTexture
        );


        // ----------------------------------------------------
        // Custom texture
        // ----------------------------------------------------

        if (selectedTexture === 'custom') {

            fileUpload.style.display = 'block';

            /*
             * Give the browser a moment to process the display
             * change before opening the file picker.
             */
            setTimeout(() => {
                fileUpload.click();
            }, 0);

        }


        // ----------------------------------------------------
        // Predefined texture
        // ----------------------------------------------------

        else {

            fileUpload.style.display = 'none';

            if (textures[selectedTexture]) {

                loadTexture(
                    textures[selectedTexture]
                );

            } else {

                console.warn(
                    "Texture not found:",
                    selectedTexture
                );

            }

        }

    });

}


// ============================================================
// File upload
// ============================================================

if (fileUpload) {

    fileUpload.addEventListener('change', (e) => {

        const file = e.target.files[0];

        if (!file) {
            return;
        }

        console.log(
            "Selected file:",
            file.name,
            file.type,
            `${(file.size / 1024 / 1024).toFixed(2)} MB`
        );


        // ----------------------------------------------------
        // Make sure it is actually an image
        // ----------------------------------------------------

        if (!file.type.startsWith('image/')) {

            console.error(
                "Selected file is not an image:",
                file.type
            );

            alert(
                "Please select an image file."
            );

            e.target.value = '';

            return;
        }


        // ----------------------------------------------------
        // Read image
        // ----------------------------------------------------

        const reader = new FileReader();


        reader.onload = async function(event) {

            try {

                console.log(
                    "Image file read successfully"
                );

                await loadTexture(
                    event.target.result
                );

                console.log(
                    "Custom image loaded successfully"
                );

            } catch (error) {

                console.error(
                    "Error loading custom image:",
                    error
                );

            }

        };


        reader.onerror = function() {

            console.error(
                "FileReader failed:",
                reader.error
            );

        };


        reader.readAsDataURL(file);


        /*
         * Clear the input so selecting the exact same file
         * again will still trigger the change event.
         */
        e.target.value = '';

    });

}
