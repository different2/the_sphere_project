            
        const fragmentShader = /*glsl*/`
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
            uniform sampler2D uTexture;

            const float sqrt5 = 2.23606797749979;
            const float PI = 3.141592653589793;
            const float kTau = 6.283185307179586;
            const float kPhi = 1.618033988749895;
            const float byLogPhiPlusOne = 0.7202100452062783;
            const float twoPiOnPhi = 3.8832220774509327;
            const float phiMinusOne = 0.618033988749895;
            const float r = 0.8;

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

            vec3 fibonacciSphere(float idx, float dots) {
                float goldenAngle = 2.399963229728653; // ~2π / φ
                float y = 1.0 - (idx / (dots - 1.0)) * 2.0; // y goes from 1 to -1
                float radius = sqrt(1.0 - y * y);
                float theta = goldenAngle * idx;
                float x = cos(theta) * radius;
                float z = sin(theta) * radius;
                return vec3(x, y, z);
                }

            void main() {
                vec2 uv = gl_FragCoord.xy / uResolution.xy;
                uv = uv * 1.0 - 1.0;
                
                float aspect = uResolution.x / uResolution.y;
                if (aspect > 1.0) {
                    uv.x *= aspect;
                } else {
                    uv.y /= aspect;
                }
                
                uv /= (scale * 0.8);

                float l = dot(uv, uv);
                vec4 color = vec4(0.);
                float glowFactor = 0.;

                if (l <= r * r) {
                    for (int side = 0; side <= 1; side++) {
                        vec4 layer = vec4(0.);
                        float dis;

                        vec3 light = vec3(0.,0.,1.);
                        vec3 p = normalize(vec3(uv, sqrt(r*r - l)));

                        p.z *= side > 0 ? -1. : 1.;
                        light.z *= side > 0 ? -1. : 1.;

                        vec3 rP = p * rotate(theta, phi);

                        // Find the nearest dot on the sphere
                        float minDist = 1000.0;
                        vec3 gP = vec3(0.0);
                        for (int i = 0; i < 100000; i++) { // 100000 is the max dots you support
                            if (float(i) >= dots) break;
                            vec3 dotPos = fibonacciSphere(float(i), dots);
                            float dist = length(rP - dotPos);
                            if (dist < minDist) {
                                minDist = dist;
                                gP = dotPos;
                            }
                        }
                        float dis = minDist;

                        float gPhi = asin(clamp(gP.y, -1.0, 1.0));
                        float gTheta = atan(gP.z, gP.x);
                        
                        vec2 texCoord = vec2(
                            (gTheta + PI) / (2.0 * PI),
                            1.0 - (gPhi + PI/2.0) / PI
                        );
                        
                        vec4 textureColor = texture2D(uTexture, texCoord);
                        
                        float brightness = (textureColor.r + textureColor.g + textureColor.b) / 3.0;
                        float mask = step(0.3, brightness);
                        
                        float v = smoothstep(0.008, 0.0, dis);
                        
                        float dotNL = dot(p, light);
                        float lighting = pow(max(dotNL, 0.0), diffuse) * dotsBrightness;
                        
                        // Show dots for both land and ocean, but with different intensities
                        float landSample = mask * v * lighting;
                        float oceanSample = (1.0 - mask) * v * lighting * 0.3; // Ocean dots are dimmer
                        float totalSample = landSample + oceanSample;
                        
                        float colorFactor = mix((1. - totalSample) * pow(max(dotNL, 0.0), 0.4), totalSample, dark) + 0.1;
                        
                        vec3 finalColor = textureColor.rgb;

                        // Enhance ocean colors to be more blue
                        if (mask < 0.5) {
                            finalColor = mix(finalColor, vec3(0.1, 0.3, 0.8), 0.6);
                        }                        
                        
                        layer += vec4(finalColor * colorFactor, 0.9);
                        layer.xyz += pow(1. - max(dotNL, 0.0), 4.) * glowColor;
                        
                        color += layer * (1. + (side > 0 ? -opacity * 0.8 : opacity)) / 2.;
                    }

                    glowFactor = pow(dot(normalize(vec3(-uv, sqrt(1.- l))), vec3(0.,0.,1.)), 4.) * smoothstep(0.,1.,0.2/(l-r*r));
                } else {
                    float outD = sqrt(0.2/(l - r * r));
                    glowFactor = smoothstep(0.5,1., outD / (outD + 1.));
                }

                gl_FragColor = color + vec4(glowFactor * glowColor, glowFactor);
            }
        `;
        export default fragmentShader;