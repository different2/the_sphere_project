// ============================================================
// Face-layout math + composite texture baking.
//
// Extracted from main.js so this logic has exactly one
// implementation, shared by both the main globe (main.js) and
// spawned spheres (sphere-field.js). Previously sphere-field.js had
// no access to this at all, which is why spawned spheres could only
// ever show a single full-sphere-wrap image - uploading a second
// image (e.g. into a per-face slot) just overwrote the first instead
// of landing on its own face. Routing spawned spheres through the
// same generateGlobeTexture() used here fixes that: it already
// accepts one image per face and places each with the correct
// gnomonic tangent-plane projection.
// ============================================================

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

export function createTangentBasis(center) {

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

export function getFaceCenters(faceCount) {

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
// faceSizeMultiplier defaults to 1 (no scaling) so callers that don't
// have a "Face Size" slider of their own (e.g. spawned spheres) can
// omit it entirely.
//
// NOTE for future face counts (5, 7-10, etc.): this is intentionally a
// simple per-count lookup rather than a general N-point sphere-distribution
// algorithm, since only 1/2/3/4/6 are needed today. If more counts are
// added later, getFaceCenters() above is the function to generalize (e.g.
// a Fibonacci-sphere or similar even-distribution formula) - everything
// else (generateGlobeTexture, the per-face image UI, etc.) already just
// asks "how many faces, and what are their centers" and doesn't otherwise
// care what count it is.
export function getAngularRadiusForFaceCount(faceCount, faceSizeMultiplier = 1.0) {

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

export function generateFullWrapTexture(
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

export function generateGlobeTexture(
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