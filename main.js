// import textureImage from './texture.js';
 
 const debugEl = document.getElementById('debug');
        function debug(msg) {
            console.log(msg);
            debugEl.innerHTML = msg + '<br>' + debugEl.innerHTML;
        }

        function clearDebug() {
            debugEl.innerHTML = '';
        }

        try {
            // Phenomenon library
            var Phenomenon=function(){"use strict";var t=function(){function t(t){Object.assign(this,{uniforms:{},geometry:{vertices:[{x:0,y:0,z:0}]},mode:0,modifiers:{},attributes:[],multiplier:1}),Object.assign(this,t),this.prepareProgram(),this.prepareUniforms(),this.prepareAttributes(),this.prepareBuffers()}return t.prototype.compileShader=function(t,e){var r=this.gl.createShader(t);return this.gl.shaderSource(r,e),this.gl.compileShader(r),this.gl.getShaderParameter(r,this.gl.COMPILE_STATUS)||console.error("Shader Error:",this.gl.getShaderInfoLog(r)),r},t.prototype.prepareProgram=function(){var t=this.gl,e=this.vertex,r=this.fragment,i=t.createProgram();t.attachShader(i,this.compileShader(35633,e)),t.attachShader(i,this.compileShader(35632,r)),t.linkProgram(i),t.getProgramParameter(i,t.LINK_STATUS)||console.error("Program Error:",t.getProgramInfoLog(i)),t.useProgram(i),this.program=i},t.prototype.prepareUniforms=function(){for(var t=Object.keys(this.uniforms),e=0;t.length>e;e+=1){var r=this.gl.getUniformLocation(this.program,t[e]);this.uniforms[t[e]].location=r}},t.prototype.prepareAttributes=function(){var t=this.geometry,e=this.attributes,r=this.multiplier,i=t.vertices,n=t.normal,s=["x","y","z"];void 0!==i&&this.attributes.push({name:"aPosition",size:3}),void 0!==n&&this.attributes.push({name:"aNormal",size:3});for(var o=0;e.length>o;o+=1){for(var a=e[o],h=new Float32Array(r*i.length*a.size),u=0;r>u;u+=1)for(var f=a.data&&a.data(u,r),c=u*i.length*a.size,l=0;i.length>l;l+=1)for(var p=0;a.size>p;p+=1){var d=this.modifiers[a.name];h[c]=void 0!==d?d(f,l,p,this):"aPosition"===a.name?i[l][s[p]]:"aNormal"===a.name?n[l][s[p]]:f[p],c+=1}this.attributes[o].data=h}},t.prototype.prepareBuffers=function(){this.buffers=[];for(var t=0;this.attributes.length>t;t+=1){var e=this.attributes[t],r=e.data,i=e.name,n=e.size,s=this.gl.createBuffer();this.gl.bindBuffer(34962,s),this.gl.bufferData(34962,r,35044);var o=this.gl.getAttribLocation(this.program,i);this.gl.enableVertexAttribArray(o),this.gl.vertexAttribPointer(o,n,5126,!1,!1,0),this.buffers.push({buffer:s,location:o,size:n})}},t.prototype.render=function(t){var e=this,r=this.uniforms,i=this.multiplier,n=this.gl;n.useProgram(this.program);for(var s=0;this.buffers.length>s;s+=1){var o=this.buffers[s],a=o.location,h=o.buffer,u=o.size;n.enableVertexAttribArray(a),n.bindBuffer(34962,h),n.vertexAttribPointer(a,u,5126,!1,!1,0)}Object.keys(t).forEach(function(e){r[e].value=t[e].value}),Object.keys(r).forEach(function(t){var i=r[t];e.uniformMap[i.type](i.location,i.value)}),n.drawArrays(this.mode,0,i*this.geometry.vertices.length),this.onRender&&this.onRender(this)},t.prototype.destroy=function(){for(var t=0;this.buffers.length>t;t+=1)this.gl.deleteBuffer(this.buffers.buffer);this.gl.deleteProgram(this.program),this.gl=null},t}();return function(){function e(){var t=this,e=arguments.length>0&&void 0!==arguments[0]?arguments[0]:{},r=e.canvas,i=void 0===r?document.querySelector("canvas"):r,n=e.context,s=e.contextType,o=e.settings,a=void 0===o?{}:o,h=i.getContext(void 0===s?"experimental-webgl":s,Object.assign({alpha:!1,antialias:!1},void 0===n?{}:n));Object.assign(this,{gl:h,canvas:i,uniforms:{},instances:new Map,shouldRender:!0}),Object.assign(this,{devicePixelRatio:1,clearColor:[0,0,0,1],position:{x:0,y:0,z:2}}),Object.assign(this,a),this.uniformMap={float:function(t,e){return h.uniform1f(t,e)},vec2:function(t,e){return h.uniform2fv(t,e)},vec3:function(t,e){return h.uniform3fv(t,e)},vec4:function(t,e){return h.uniform4fv(t,e)},mat2:function(t,e){return h.uniformMatrix2fv(t,!1,e)},mat3:function(t,e){return h.uniformMatrix3fv(t,!1,e)},mat4:function(t,e){return h.uniformMatrix4fv(t,!1,e)}},h.enable(h.DEPTH_TEST),h.depthFunc(h.LEQUAL),!1===h.getContextAttributes().alpha&&(h.clearColor.apply(h,this.clearColor),h.clearDepth(1)),this.onSetup&&this.onSetup(h),window.addEventListener("resize",function(){return t.resize()}),this.resize(),this.render()}return e.prototype.resize=function(){var t=this.gl,e=this.canvas,r=this.devicePixelRatio,i=this.position;e.width=e.clientWidth*r,e.height=e.clientHeight*r;var n=t.drawingBufferWidth,s=t.drawingBufferHeight,o=n/s;t.viewport(0,0,n,s);var a=.41421356237309503,h=[1,0,0,0,0,1,0,0,0,0,1,0,i.x,i.y,(1>o?1:o)*-i.z,1];this.uniforms.uProjectionMatrix={type:"mat4",value:[.5/a,0,0,0,0,o/a*.5,0,0,0,0,-100.001/99.999,-1,0,0,.001/99.999*-200,0]},this.uniforms.uViewMatrix={type:"mat4",value:[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]},this.uniforms.uModelMatrix={type:"mat4",value:h}},e.prototype.toggle=function(t){t!==this.shouldRender&&(this.shouldRender=void 0!==t?t:!this.shouldRender,this.shouldRender&&this.render())},e.prototype.render=function(){var t=this;this.gl.clear(16640),this.instances.forEach(function(e){e.render(t.uniforms)}),this.onRender&&this.onRender(this),this.shouldRender&&requestAnimationFrame(function(){return t.render()})},e.prototype.add=function(e){var r=arguments.length>1&&void 0!==arguments[1]?arguments[1]:{};r.uniforms=Object.assign(r.uniforms||{},JSON.parse(JSON.stringify(this.uniforms))),Object.assign(r,{gl:this.gl,uniformMap:this.uniformMap});var i=new t(r);return this.instances.set(e,i),i},e.prototype.remove=function(t){var e=this.instances.get(t);void 0!==e&&(e.destroy(),this.instances.delete(t))},e.prototype.destroy=function(){var t=this;this.instances.forEach(function(e,r){e.destroy(),t.instances.delete(r)}),this.toggle(!1)},e}()}();

            debug("Phenomenon loaded");

            // Fragment Shader with Fibonacci Lattice
            const fragmentShader = `
                precision highp float;
                uniform vec2 uResolution;
                uniform float phi;
                uniform float theta;
                uniform float dots;
                uniform float scale;
                uniform vec3 baseColor;
                uniform vec3 glowColor;
                uniform float dotsBrightness;
                uniform float diffuse;
                uniform float dark;
                uniform float opacity;

                const float sqrt5 = 2.23606797749979;
                const float PI = 3.141592653589793;
                const float kTau = 6.283185307179586;
                const float kPhi = 1.618033988749895;
                const float byLogPhiPlusOne = 0.7202100452062783;
                const float twoPiOnPhi = 3.8832220774509327;
                const float phiMinusOne = .618033988749895;
                const float r = .8;

                float byDots = 1.0/dots;

                mat3 rotate(float theta, float phi) {
                    float cx = cos(theta);
                    float cy = cos(phi);
                    float sx = sin(theta);
                    float sy = sin(phi);

                    return mat3(
                        cy, sy * sx, -sy * cx,
                        0., cx, sx,
                        sy, cy * -sx, cy * cx
                    );
                }

                vec3 nearestFibonacciLattice(vec3 p, out float m) {
                    p = p.xzy;

                    float k = max(2., floor(log2(sqrt5 * dots * PI * (1. - p.z * p.z)) * byLogPhiPlusOne));

                    vec2 f = floor(pow(kPhi,k)/sqrt5*vec2(1.,kPhi)+.5);
                    vec2 br1 = fract((f+1.) * phiMinusOne)*kTau - twoPiOnPhi;
                    vec2 br2 = -2.*f;
                    vec2 sp = vec2(atan(p.y, p.x), p.z-1.);
                    vec2 c = floor(vec2(br2.y * sp.x - br1.y * (sp.y * dots + 1.), -br2.x * sp.x + br1.x * (sp.y * dots + 1.)) / (br1.x*br2.y-br2.x*br1.y));
                    
                    float mindist = PI;
                    vec3 minip;
                    for (float s = 0.; s < 4.; s+=1.) {
                        vec2 o = vec2(mod(s, 2.), floor(s*.5));
                        float idx = dot(f, c + o);
                        if (idx > dots) continue;

                        float tidx = idx;
                        float fracV = 0.;

                        // Optimized bit operations for pseudo-random distribution
                        if(tidx >= 524288.) { tidx-=524288.; fracV += 0.8038937048986554; }
                        if(tidx >= 262144.) { tidx-=262144.; fracV += 0.9019468524493277; }
                        if(tidx >= 131072.) { tidx-=131072.; fracV += 0.9509734262246639; }
                        if(tidx >= 65536.) { tidx-=65536.; fracV += 0.4754867131123319; }
                        if(tidx >= 32768.) { tidx-=32768.; fracV += 0.737743356556166; }
                        if(tidx >= 16384.) { tidx-=16384.; fracV += 0.868871678278083; }
                        if(tidx >= 8192.) { tidx-=8192.; fracV += 0.9344358391390415; }
                        if(tidx >= 4096.) { tidx-=4096.; fracV += 0.46721791956952075; }
                        if(tidx >= 2048.) { tidx-=2048.; fracV += 0.7336089597847604; }
                        if(tidx >= 1024.) { tidx-=1024.; fracV += 0.8668044798923802; }
                        if(tidx >= 512.) { tidx-=512.; fracV += 0.4334022399461901; }
                        if(tidx >= 256.) { tidx-=256.; fracV += 0.21670111997309505; }
                        if(tidx >= 128.) { tidx-=128.; fracV += 0.10835055998654752; }
                        if(tidx >= 64.) { tidx-=64.; fracV += 0.5541752799932738; }
                        if(tidx >= 32.) { tidx-=32.; fracV += 0.7770876399966369; }
                        if(tidx >= 16.) { tidx-=16.; fracV += 0.8885438199983184; }
                        if(tidx >= 8.) { tidx-=8.; fracV += 0.9442719099991592; }
                        if(tidx >= 4.) { tidx-=4.; fracV += 0.4721359549995796; }
                        if(tidx >= 2.) { tidx-=2.; fracV += 0.2360679774997898; }
                        if(tidx >= 1.) { tidx-=1.; fracV += 0.6180339887498949; }

                        float theta = fract(fracV) * kTau;

                        float cosphi = 1. - 2. * idx * byDots;
                        float sinphi = sqrt(1. - cosphi * cosphi);
                        vec3 sample = vec3(cos(theta) * sinphi, sin(theta) * sinphi, cosphi);

                        float dist = length(p - sample);

                        if (dist < mindist) {
                            mindist = dist;
                            minip = sample;
                        }
                    }

                    m = mindist;
                    return minip.xzy;
                }

void main() {
    vec2 uv = (gl_FragCoord.xy / uResolution) * 2.0 - 1.0;
    uv.x *= uResolution.x / uResolution.y;
    uv /= scale;

    float l = dot(uv, uv);

    if (l <= r * r) {
        // point on sphere
        vec3 p = normalize(vec3(uv, sqrt(r*r - l)));
        vec3 rP = p * rotate(theta, phi);

        float dis;
        vec3 gP = nearestFibonacciLattice(rP, dis);

        // longitude normalized 0..1
        float nlon = atan(gP.z, gP.x) / (2.0 * PI) + 0.5;

        // latitude normalized 0..1
        float nlat = asin(gP.y) / PI + 0.5;

        // map-accurate color (shows seam)
        vec3 mapColor = vec3(nlon, nlat, 0.0);

        // procedural seamless cosine blend
        float wave = 0.5 + 0.5 * cos(2.0 * PI * nlon);
        vec3 seamlessColor = mix(vec3(0.0, 1.0, 0.0),
                                 vec3(1.0, 0.0, 0.0),
                                 wave);

        // left half shows seam, right half seamless
        if (gl_FragCoord.x < uResolution.x * 0.5) {
            gl_FragColor = vec4(mapColor, 1.0);
        } else {
            gl_FragColor = vec4(seamlessColor, 1.0);
        }
    } else {
        gl_FragColor = vec4(0., 0., 0., 1.0);
    }
}




            `;

            const vertexShader = `
                attribute vec3 aPosition;
                uniform mat4 uProjectionMatrix;
                uniform mat4 uModelMatrix;
                uniform mat4 uViewMatrix;
                
                void main() {
                    gl_Position = uProjectionMatrix * uModelMatrix * uViewMatrix * vec4(aPosition, 1.0);
                }
            `;

            debug("Shaders defined");

            // Canvas setup - fullscreen
            const canvas = document.getElementById('globe');
            const globeContainer = document.querySelector('.globe-container');
            
            // Make canvas fullscreen and responsive
            function resizeCanvas() {
                const width = window.innerWidth;
                const height = window.innerHeight;
                
                canvas.width = width;
                canvas.height = height;
                canvas.style.width = width + 'px';
                canvas.style.height = height + 'px';
            }

            // Initial resize
            resizeCanvas();

            function createGlobe() {
                debug("Canvas: " + canvas.width + "x" + canvas.height);

                const p = new Phenomenon({
                    canvas,
                    contextType: 'webgl',
                    context: {
                        alpha: true,
                        antialias: true,
                        depth: false,
                    },
                    settings: {
                        clearColor: [0, 0, 0, 0],
                        devicePixelRatio: 1,
                    }
                });

                debug("Phenomenon created");

                const instance = p.add("globe", {
                    vertex: vertexShader,
                    fragment: fragmentShader,
                    uniforms: {
                        uResolution: {
                            type: "vec2",
                            value: [window.innerWidth, window.innerHeight],
                        },
                        phi: {
                            type: "float",
                            value: 0,
                        },
                        theta: {
                            type: "float",
                            value: 0,
                        },
                        dots: {
                            type: "float", 
                            value: 20000,
                        },
                        scale: {
                            type: "float",
                            value: 1,
                        },
                        dotsBrightness: {
                            type: "float",
                            value: 6,
                        },
                        diffuse: {
                            type: "float", 
                            value: 1.2,
                        },
                        dark: {
                            type: "float",
                            value: 1,
                        },
                        opacity: {
                            type: "float",
                            value: 1,
                        },
                        baseColor: {
                            type: "vec3",
                            value: [0.3, 0.6, 1.0],
                        },
                        glowColor: {
                            type: "vec3",
                            value: [0.3, 0.8, 1.0],
                        },
                    },
                    mode: 4, // TRIANGLE_STRIP
                    geometry: {
                        vertices: [
                            { x: -100, y: 100, z: 0 },
                            { x: -100, y: -100, z: 0 },
                            { x: 100, y: 100, z: 0 },
                            { x: 100, y: -100, z: 0 },
                            { x: -100, y: -100, z: 0 },
                            { x: 100, y: 100, z: 0 },
                        ],
                    },
                });

                debug("Globe instance created");

                return { p, instance };
            }

            // Initialize
            const { p, instance } = createGlobe();

            // Handle window resize - now that instance exists
            window.addEventListener('resize', () => {
                resizeCanvas();
                // Update the phenomenon's resolution uniform
                p.uniforms.uResolution = {
                    type: "vec2",
                    value: [window.innerWidth, window.innerHeight]
                };
            });

            // Animation variables
            let phi = 0;
            let theta = 0;
            let dots = 20000;
            let scale = 1;

            // Animation loop
            function animate() {
                phi += 0.0;
                
                // Update uniforms
                const uniforms = {
                    phi: { type: "float", value: phi },
                    theta: { type: "float", value: theta },
                    dots: { type: "float", value: dots },
                    scale: { type: "float", value: scale },
                };
                
                instance.render(uniforms);
                requestAnimationFrame(animate);
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
                // Note: No need to update canvas size anymore since it's fullscreen
            });

            debug("Starting animation...");
            animate();

        } catch (error) {
            debug("Error: " + error.message);
            console.error(error);
        }