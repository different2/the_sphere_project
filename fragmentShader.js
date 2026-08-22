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

    /*
     * 1.0 = normal Fibonacci dot globe
     * 0.0 = crisp direct texture
     */
    uniform float uUseDots;

    /*
     * 1.0 = per-face composite mode: each of up to 6 globe "faces"
     * carries its OWN texture (an animated GIF's current frame or a
     * static image), composited live here with the same gnomonic
     * tangent-plane projection generateGlobeTexture() uses when
     * pre-baking the CPU-side composite - except per-face, which is
     * what lets every face animate independently.
     */
    uniform float uUseFaces;

    uniform float uFaceCountF;

    uniform vec3 uFaceCenter[6];

    uniform vec3 uFaceEast[6];

    uniform vec3 uFaceNorth[6];

    /*
     * Per face: x = cos(angular radius), y = 1/(logoScale*width),
     * z = 1/(logoScale*height), w unused. logoScale matches the CPU
     * baker: halfSize / (max(width,height)/2).
     */
    uniform vec4 uFaceParams[6];

    /* Face i is sampled on texture unit i. */
    uniform sampler2D uFaceTex0;

    uniform sampler2D uFaceTex1;

    uniform sampler2D uFaceTex2;

    uniform sampler2D uFaceTex3;

    uniform sampler2D uFaceTex4;

    uniform sampler2D uFaceTex5;


    const float sqrt5 = 2.23606797749979;

    const float PI =
        3.141592653589793;

    const float kTau =
        6.283185307179586;

    const float kPhi =
        1.618033988749895;

    const float byLogPhiPlusOne =
        0.7202100452062783;

    const float twoPiOnPhi =
        3.8832220774509327;

    const float phiMinusOne =
        0.618033988749895;

    const float r = 0.8;


    // ========================================================
    // Rotation
    // ========================================================

    mat3 rotate(
        float theta,
        float phi
    ) {

        float cx =
            cos(theta);

        float cy =
            cos(phi);

        float sx =
            sin(theta);

        float sy =
            sin(phi);


        return mat3(

            cy,
            sy * sx,
            -sy * cx,

            0.,
            cx,
            sx,

            sy,
            cy * -sx,
            cy * cx

        );
    }


    // ========================================================
    // Fibonacci lattice
    // ========================================================

    vec3 nearestFibonacciLattice(
        vec3 p,
        out float m
    ) {

        p = p.xzy;

        float byDots =
            1.0 / dots;


        float k =
            max(
                2.,
                floor(
                    log2(
                        sqrt5 *
                        dots *
                        PI *
                        (1. -
                        p.z *
                        p.z)
                    )
                    *
                    byLogPhiPlusOne
                )
            );


        vec2 f =
            floor(
                pow(kPhi, k)
                /
                sqrt5
                *
                vec2(
                    1.,
                    kPhi
                )
                +
                0.5
            );


        vec2 br1 =
            fract(
                (f + 1.) *
                phiMinusOne
            )
            *
            kTau
            -
            twoPiOnPhi;


        vec2 br2 =
            -2. * f;


        vec2 sp =
            vec2(
                atan(
                    p.y,
                    p.x
                ),
                p.z - 1.
            );


        vec2 c =
            floor(
                vec2(
                    br2.y *
                    sp.x
                    -
                    br1.y *
                    (
                        sp.y *
                        dots
                        +
                        1.
                    ),

                    -br2.x *
                    sp.x
                    +
                    br1.x *
                    (
                        sp.y *
                        dots
                        +
                        1.
                    )
                )
                /
                (
                    br1.x *
                    br2.y
                    -
                    br2.x *
                    br1.y
                )
            );


        float mindist =
            PI;

        vec3 minip;


        for (
            float s = 0.;
            s < 4.;
            s += 1.
        ) {

            vec2 o =
                vec2(
                    mod(s, 2.),
                    floor(
                        s * 0.5
                    )
                );


            float idx =
                dot(
                    f,
                    c + o
                );


            if (
                idx > dots
            ) {
                continue;
            }


            float tidx =
                idx;

            float fracV =
                0.;


            if (
                tidx >= 524288.
            ) {
                tidx -= 524288.;
                fracV +=
                    0.8038937048986554;
            }

            if (
                tidx >= 262144.
            ) {
                tidx -= 262144.;
                fracV +=
                    0.9019468524493277;
            }

            if (
                tidx >= 131072.
            ) {
                tidx -= 131072.;
                fracV +=
                    0.9509734262246639;
            }

            if (
                tidx >= 65536.
            ) {
                tidx -= 65536.;
                fracV +=
                    0.4754867131123319;
            }

            if (
                tidx >= 32768.
            ) {
                tidx -= 32768.;
                fracV +=
                    0.737743356556166;
            }

            if (
                tidx >= 16384.
            ) {
                tidx -= 16384.;
                fracV +=
                    0.868871678278083;
            }

            if (
                tidx >= 8192.
            ) {
                tidx -= 8192.;
                fracV +=
                    0.9344358391390415;
            }

            if (
                tidx >= 4096.
            ) {
                tidx -= 4096.;
                fracV +=
                    0.46721791956952075;
            }

            if (
                tidx >= 2048.
            ) {
                tidx -= 2048.;
                fracV +=
                    0.7336089597847604;
            }

            if (
                tidx >= 1024.
            ) {
                tidx -= 1024.;
                fracV +=
                    0.8668044798923802;
            }

            if (
                tidx >= 512.
            ) {
                tidx -= 512.;
                fracV +=
                    0.4334022399461901;
            }

            if (
                tidx >= 256.
            ) {
                tidx -= 256.;
                fracV +=
                    0.21670111997309505;
            }

            if (
                tidx >= 128.
            ) {
                tidx -= 128.;
                fracV +=
                    0.10835055998654752;
            }

            if (
                tidx >= 64.
            ) {
                tidx -= 64.;
                fracV +=
                    0.5541752799932738;
            }

            if (
                tidx >= 32.
            ) {
                tidx -= 32.;
                fracV +=
                    0.7770876399966369;
            }

            if (
                tidx >= 16.
            ) {
                tidx -= 16.;
                fracV +=
                    0.8885438199983184;
            }

            if (
                tidx >= 8.
            ) {
                tidx -= 8.;
                fracV +=
                    0.9442719099991592;
            }

            if (
                tidx >= 4.
            ) {
                tidx -= 4.;
                fracV +=
                    0.4721359549995796;
            }

            if (
                tidx >= 2.
            ) {
                tidx -= 2.;
                fracV +=
                    0.2360679774997898;
            }

            if (
                tidx >= 1.
            ) {
                tidx -= 1.;
                fracV +=
                    0.6180339887498949;
            }


            float latticeTheta =
                fract(fracV)
                *
                kTau;


            float cosphi =
                1. -
                2. *
                idx *
                byDots;


            float sinphi =
                sqrt(
                    1. -
                    cosphi *
                    cosphi
                );


            vec3 latticeSample =
                vec3(
                    cos(latticeTheta) *
                    sinphi,

                    sin(latticeTheta) *
                    sinphi,

                    cosphi
                );


            float dist =
                length(
                    p - latticeSample
                );


            if (
                dist < mindist
            ) {

                mindist =
                    dist;

                minip =
                    latticeSample;

            }

        }


        m =
            mindist;


        return minip.xzy;
    }


    // ========================================================
    // Per-face gnomonic composite
    // ========================================================

    /*
     * GLSL port of generateGlobeTexture()'s per-pixel loop: for the
     * surface direction rP, find the first face whose angular patch
     * contains it, project onto that face's tangent plane (gnomonic),
     * map to the face image's pixel coordinates, and sample. Faces
     * with no content of their own sample whichever slot the CPU side
     * designated as the fallback (passed in .w) - matching
     * rawCustomImages[i] || rawCustomImages[0] in the CPU bake.
     * Returns transparent black when no face covers this point.
     */
    vec4 sampleFaceComposite(vec3 rP) {

        for (int i = 0; i < 6; i++) {

            if (float(i) >= uFaceCountF) {
                break;
            }

            // .w carries WHICH texture unit this face samples - its
            // own slot when it has an override, otherwise the CPU's
            // designated fallback slot.
            int texSlot =
                int(uFaceParams[i].w + 0.5);

            vec3 center =
                uFaceCenter[i];

            float centerDot =
                dot(rP, center);

            if (centerDot <= 0.0) {
                continue;
            }

            float angleCos =
                clamp(
                    centerDot,
                    0.0,
                    1.0
                );

            // Patch membership via cosine, mirroring
            // acos(angle) > radiusRad on the CPU.
            if (angleCos < uFaceParams[i].x) {
                continue;
            }

            vec3 tangent =
                vec3(
                    dot(rP, uFaceEast[i]),
                    dot(rP, uFaceNorth[i]),
                    centerDot
                )
                / centerDot;

            // logoScale = halfSize / logoRadius, so dividing by
            // logoScale scales the tangent unit circle out to the
            // image's pixel dimensions - see the CPU baker.
            float invScaleX =
                uFaceParams[i].y;

            float invScaleY =
                uFaceParams[i].z;

            float lx =
                tangent.x * invScaleX +
                0.5;

            float ly =
                0.5 -
                tangent.y * invScaleY;

            if (
                lx < 0.0 ||
                ly < 0.0 ||
                lx >= 1.0 ||
                ly >= 1.0
            ) {
                continue;
            }

            vec4 sampled;

            if (texSlot == 0) {

                sampled =
                    texture2D(uFaceTex0, vec2(lx, ly));

            } else if (texSlot == 1) {

                sampled =
                    texture2D(uFaceTex1, vec2(lx, ly));

            } else if (texSlot == 2) {

                sampled =
                    texture2D(uFaceTex2, vec2(lx, ly));

            } else if (texSlot == 3) {

                sampled =
                    texture2D(uFaceTex3, vec2(lx, ly));

            } else if (texSlot == 4) {

                sampled =
                    texture2D(uFaceTex4, vec2(lx, ly));

            } else {

                sampled =
                    texture2D(uFaceTex5, vec2(lx, ly));
            }

            if (sampled.a > 0.0) {
                return sampled;
            }
        }

        return vec4(0.0);
    }

    // ========================================================
    // Main
    // ========================================================

    void main() {

        vec2 uv =
            gl_FragCoord.xy /
            uResolution.xy;


        uv =
            uv * 1.0 -
            1.0;


        float aspect =
            uResolution.x /
            uResolution.y;


        if (
            aspect > 1.0
        ) {

            uv.x *= aspect;

        } else {

            uv.y /= aspect;

        }


        uv /=
            (scale * 0.8);


        float l =
            dot(
                uv,
                uv
            );


        vec4 color =
            vec4(0.);


        float glowFactor =
            0.;


        if (
            l <= r * r
        ) {

            /*
             * Render both sides of the globe.
             */
            for (
                int side = 0;
                side <= 1;
                side++
            ) {

                vec4 layer =
                    vec4(0.);


                float dis =
                    0.;


                vec3 light =
                    vec3(
                        0.,
                        0.,
                        1.
                    );


                vec3 p =
                    normalize(
                        vec3(
                            uv,
                            sqrt(
                                r * r -
                                l
                            )
                        )
                    );


                p.z *=
                    side > 0
                    ? -1.
                    : 1.;


                light.z *=
                    side > 0
                    ? -1.
                    : 1.;


                /*
                 * Rotate globe position.
                 */
                vec3 rP =
                    p *
                    rotate(
                        theta,
                        phi
                    );


                vec4 textureColor;


                // ====================================================
                // CRISP CUSTOM TEXTURE MODE
                // ====================================================

                if (
                    uUseDots < 0.5
                ) {

                    /*
                     * Directly use the actual surface point.
                     *
                     * NO Fibonacci lattice.
                     *
                     * This is what makes the Laughing Man lettering
                     * stay sharp.
                     */

                    float gPhi =
                        asin(
                            clamp(
                                rP.y,
                                -1.0,
                                1.0
                            )
                        );


                    float gTheta =
                        atan(
                            rP.z,
                            rP.x
                        );


                    vec2 texCoord =
                        vec2(

                            (
                                gTheta +
                                PI
                            )
                            /
                            (2.0 * PI),

                            1.0 -
                            (
                                gPhi +
                                PI / 2.0
                            )
                            /
                            PI

                        );

                    if (uUseFaces > 0.5) {

                        textureColor =
                            sampleFaceComposite(rP);

                    } else {

                        textureColor =
                            texture2D(
                                uTexture,
                                texCoord
                            );
                    }


                    /*
                     * Use the actual alpha from the PNG.
                     */
                    float alpha =
                        textureColor.a;


                    /*
                     * Front side gets normal brightness.
                     * Back side gets reduced brightness.
                     */
                    float dotNL =
                        dot(
                            p,
                            light
                        );


                    float lighting =
                        pow(
                            max(
                                dotNL,
                                0.0
                            ),
                            diffuse
                        );


                    if (
                        side == 0
                    ) {

                        layer =
                            vec4(
                                textureColor.rgb *
                                (
                                    0.35 +
                                    0.65 *
                                    lighting
                                ),

                                alpha *
                                opacity
                            );

                    } else {

                        layer =
                            vec4(
                                textureColor.rgb *
                                0.25,

                                alpha *
                                opacity *
                                0.25
                            );

                    }


                    /*
                     * Keep the blue atmospheric glow.
                     */
                    layer.xyz +=
                        pow(
                            1. -
                            max(
                                dotNL,
                                0.0
                            ),
                            4.
                        )
                        *
                        glowColor;


                    color +=
                        layer;


                }


                // ====================================================
                // ORIGINAL FIBONACCI DOT MODE
                // ====================================================

                else {

                    vec3 gP =
                        nearestFibonacciLattice(
                            rP,
                            dis
                        );


                    float gPhi =
                        asin(
                            clamp(
                                gP.y,
                                -1.0,
                                1.0
                            )
                        );


                    float gTheta =
                        atan(
                            gP.z,
                            gP.x
                        );


                    vec2 texCoord =
                        vec2(

                            (
                                gTheta +
                                PI
                            )
                            /
                            (2.0 * PI),

                            1.0 -
                            (
                                gPhi +
                                PI / 2.0
                            )
                            /
                            PI

                        );


                    textureColor =
                        texture2D(
                            uTexture,
                            texCoord
                        );


                    float brightness =
                        (
                            textureColor.r +
                            textureColor.g +
                            textureColor.b
                        )
                        /
                        3.0;


                    float mask =
                        step(
                            0.3,
                            brightness
                        );


                    float v =
                        smoothstep(
                            0.008,
                            0.0,
                            dis
                        );


                    float dotNL =
                        dot(
                            p,
                            light
                        );


                    float lighting =
                        pow(
                            max(
                                dotNL,
                                0.0
                            ),
                            diffuse
                        )
                        *
                        dotsBrightness;


                    float landSample =
                        mask *
                        v *
                        lighting;


                    float oceanSample =
                        (
                            1.0 -
                            mask
                        )
                        *
                        v *
                        lighting
                        *
                        0.3;


                    float totalSample =
                        landSample +
                        oceanSample;


                    float colorFactor =
                        mix(

                            (
                                1. -
                                totalSample
                            )
                            *
                            pow(
                                max(
                                    dotNL,
                                    0.0
                                ),
                                0.4
                            ),

                            totalSample,

                            dark

                        )
                        +
                        0.1;


                    vec3 finalColor =
                        textureColor.rgb;


                    /*
                     * Enhance ocean colors.
                     */
                    if (
                        mask < 0.5
                    ) {

                        finalColor =
                            mix(
                                finalColor,
                                vec3(
                                    0.1,
                                    0.3,
                                    0.8
                                ),
                                0.6
                            );

                    }


                    layer +=
                        vec4(
                            finalColor *
                            colorFactor,
                            0.9
                        );


                    layer.xyz +=
                        pow(
                            1. -
                            max(
                                dotNL,
                                0.0
                            ),
                            4.
                        )
                        *
                        glowColor;


                    color +=
                        layer *
                        (
                            1. +
                            (
                                side > 0
                                ? -opacity * 0.8
                                : opacity
                            )
                        )
                        /
                        2.;

                }

            }


            /*
             * Globe edge glow.
             */
            glowFactor =
                pow(
                    dot(
                        normalize(
                            vec3(
                                -uv,
                                sqrt(
                                    1. -
                                    l
                                )
                            )
                        ),
                        vec3(
                            0.,
                            0.,
                            1.
                        )
                    ),
                    4.
                )
                *
                smoothstep(
                    0.,
                    1.,
                    0.2 /
                    (
                        l -
                        r * r
                    )
                );


        } else {

            float outD =
                sqrt(
                    0.2 /
                    (
                        l -
                        r * r
                    )
                );


            glowFactor =
                smoothstep(
                    0.5,
                    1.,
                    outD /
                    (
                        outD +
                        1.
                    )
                );

        }


        gl_FragColor =
            color +
            vec4(
                glowFactor *
                glowColor,

                glowFactor
            );
    }
`;

export default fragmentShader;