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
        let p, instance;
        let currentTexture;
        
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
                    p.uniforms.uResolution = { type: "vec2", value: [width, height] };
                }
            }
        }

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', resizeCanvas);
        } else {
            resizeCanvas();
        }

        // Create texture from image data
        function createTexture(gl, imageData) {
            return new Promise((resolve, reject) => {
                const image = new Image();
                image.onload = function() {
                    const texture = gl.createTexture();
                    gl.bindTexture(gl.TEXTURE_2D, texture);
                    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
                    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
                    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
                    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
                    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
                    resolve(texture);
                };
                image.onerror = function() {
                    reject(new Error("Failed to load texture"));
                };
                image.src = imageData;
            });
        }

        // Load a new texture
        async function loadTexture(textureData) {
            if (!p || !p.gl) return;
            
            try {
                const texture = await createTexture(p.gl, textureData);
                p.gl.activeTexture(p.gl.TEXTURE0);
                p.gl.bindTexture(p.gl.TEXTURE_2D, texture);
                currentTexture = texture;
                console.log("New texture loaded successfully");
            } catch (error) {
                console.log("Failed to load texture: " + error.message);
            }
        }

        async function createGlobe() {
            
            const width = window.innerWidth;
            const height = window.innerHeight;
            console.log(`Creating globe - Canvas: ${width}x${height}`);

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

            try {
                // Load initial texture (Earth)
                currentTexture = await createTexture(p.gl, textures.earth);
                p.gl.activeTexture(p.gl.TEXTURE0);
                p.gl.bindTexture(p.gl.TEXTURE_2D, currentTexture);

                instance = p.add("globe", {
                    vertex: vertexShader,
                    fragment: fragmentShader,
                    uniforms: {
                        uResolution: { type: "vec2", value: [width, height] },
                        uTexture: { type: "sampler2D", value: 0 },
                        phi: { type: "float", value: 0 },
                        theta: { type: "float", value: 0 },
                        dots: { type: "float", value: 25000 },
                        scale: { type: "float", value: 1.0 },
                        dotsBrightness: { type: "float", value: 6 },
                        diffuse: { type: "float", value: 1.2 },
                        dark: { type: "float", value: 1 },
                        opacity: { type: "float", value: 1 },
                        baseColor: { type: "vec3", value: [0.3, 0.6, 1.0] },
                        glowColor: { type: "vec3", value: [0.3, 0.8, 1.0] },
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

                console.log("Globe created successfully");
                startAnimation();

            } catch (error) {
                console.log("Failed to create globe: " + error.message);
            }
        }

        setTimeout(() => {
            createGlobe();
        }, 100);

        window.addEventListener('resize', () => {
            resizeCanvas();
            if (p && p.uniforms) {
                p.uniforms.uResolution = {
                    type: "vec2",
                    value: [window.innerWidth, window.innerHeight]
                };
            }
        });

        // Animation variables
        let phi = 0;
        let theta = 0;
        let dots = 25000;
        let scale = 1.0;
        let animationStarted = false;

        function animate() {
            if (!instance) return;
            
            phi += 0.00;
            
            const uniforms = {
                phi: { type: "float", value: phi },
                theta: { type: "float", value: theta },
                dots: { type: "float", value: dots },
                scale: { type: "float", value: scale },
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

        // Control handlers
        document.getElementById('phi').addEventListener('input', (e) => {
            phi = parseFloat(e.target.value);
        });

        document.getElementById('theta').addEventListener('input', (e) => {
            theta = parseFloat(e.target.value);
        });

        document.getElementById('dots').addEventListener('input', (e) => {
            dots = parseFloat(e.target.value);
        });

        document.getElementById('scale').addEventListener('input', (e) => {
            scale = parseFloat(e.target.value);
        });

        // Texture selection handler
        document.getElementById('textureSelect').addEventListener('change', (e) => {
            const selectedTexture = e.target.value;
            
            if (selectedTexture === 'custom') {
                document.getElementById('fileUpload').style.display = 'block';
                document.getElementById('fileUpload').click();
            } else {
                document.getElementById('fileUpload').style.display = 'none';
                if (textures[selectedTexture]) {
                    loadTexture(textures[selectedTexture]);
                }
            }
        });

        // File upload handler
        document.getElementById('fileUpload').addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file && file.type.startsWith('image/')) {
                const reader = new FileReader();
                reader.onload = function(event) {
                    loadTexture(event.target.result);
                    console.log("Custom image loaded");
                };
                reader.readAsDataURL(file);
            }
        });
