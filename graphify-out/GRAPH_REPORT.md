# Graph Report - the_sphere_project  (2026-09-02)

## Corpus Check
- Large corpus: 34 files · ~852,223 words. Semantic extraction will be expensive (many Claude tokens). Consider running on a subfolder.

## Summary
- 215 nodes · 414 edges · 14 communities (9 shown, 3 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 7 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- UI Controls & Canvas
- Sphere Field Management
- GIF Encoder (vendor)
- Face Slots & Texture Baking
- Phenomenon 3D Library
- Globe Texture Generation
- Globe Load & Animation Setup
- Text Texture Helpers
- GIF/WebM Export
- Animation & Drag Ticks
- Circular Text (temp)
- Sphere Selection Glue

## God Nodes (most connected - your core abstractions)
1. `generateGlobeTexture()` - 16 edges
2. `loadLaughingMan()` - 11 edges
3. `updateFaceComposite()` - 10 edges
4. `applyFaceSlotGif()` - 10 edges
5. `loadFileOntoFieldSphere()` - 10 edges
6. `getAngularRadiusForFaceCount()` - 9 edges
7. `debugLog()` - 9 edges
8. `exportLoopableGif()` - 9 edges
9. `t()` - 9 edges
10. `e()` - 8 edges

## Surprising Connections (you probably didn't know these)
- `n()` --indirect_call--> `e()`  [INFERRED]
  vendor/gifenc.esm.js → phenomenon.js
- `updateFaceComposite()` --calls--> `createTangentBasis()`  [EXTRACTED]
  main.js → face-texture.js
- `updateFaceComposite()` --calls--> `getFaceCenters()`  [EXTRACTED]
  main.js → face-texture.js
- `loadLaughingMan()` --calls--> `getAngularRadiusForFaceCount()`  [EXTRACTED]
  main.js → face-texture.js
- `loadFileOntoFieldSphere()` --calls--> `getAngularRadiusForFaceCount()`  [EXTRACTED]
  sphere-field.js → face-texture.js

## Import Cycles
- None detected.

## Communities (14 total, 3 thin omitted)

### Community 0 - "UI Controls & Canvas"
Cohesion: 0.04
Nodes (41): backToSingleBtn, BAYER_4X4, canvas, controlsPanel, customTextInput, deleteSphereBtn, dotsControl, exportGifBtn (+33 more)

### Community 1 - "Sphere Field Management"
Cohesion: 0.08
Nodes (39): clearFieldSpheres(), closeSphereField(), createFieldSphere(), defaultSphereControls(), deleteSphere(), disposeFieldSphereFrames(), field, fieldSpheres (+31 more)

### Community 2 - "GIF Encoder (vendor)"
Cohesion: 0.10
Nodes (33): at(), bt(), ct(), a(), D(), dt(), et(), F() (+25 more)

### Community 3 - "Face Slots & Texture Baking"
Cohesion: 0.19
Nodes (22): getAngularRadiusForFaceCount(), applyAnimatedGif(), applyCustomImage(), applyCustomText(), applyFaceSlotGif(), applyFaceSlotImage(), bakeFramesToTextures(), clearAllFaceSlots() (+14 more)

### Community 5 - "Globe Texture Generation"
Cohesion: 0.29
Nodes (8): createTangentBasis(), cross3(), dot3(), generateFullWrapTexture(), generateGlobeTexture(), sampleFace(), getFaceCenters(), normalize()

### Community 6 - "Globe Load & Animation Setup"
Cohesion: 0.25
Nodes (7): createGlobe(), hasUsableTransparency(), loadImage(), loadLaughingMan(), loadLaughingManStaticFallback(), setUseDots(), startAnimation()

### Community 7 - "Text Texture Helpers"
Cohesion: 0.32
Nodes (6): createTextTexture(), breakLongWord(), computeAtSize(), wrapAtFontSize(), NOTE: this canvas is NOT pre-flipped. main.js's, textures

### Community 8 - "GIF/WebM Export"
Cohesion: 0.38
Nodes (6): bindActiveAnimatedFrame(), ditherAlphaChannel(), exportLoopableGif(), exportLoopableWebm(), nextAnimationFrame(), readGlobeCropAsImageData()

### Community 9 - "Animation & Drag Ticks"
Cohesion: 0.33
Nodes (6): animate(), applyDragDelta(), bindFaceCompositeFrames(), dragMove(), getFaceSlotCurrentTexture(), getFallbackFaceSlot()

## Knowledge Gaps
- **44 isolated node(s):** `canvas`, `rawCustomImages`, `faceSlotContent`, `phiControl`, `thetaControl` (+39 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 71 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **3 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `e()` connect `Phenomenon 3D Library` to `GIF Encoder (vendor)`?**
  _High betweenness centrality (0.051) - this node is a cross-community bridge._
- **Why does `generateGlobeTexture()` connect `Globe Texture Generation` to `UI Controls & Canvas`, `Sphere Field Management`, `Face Slots & Texture Baking`, `Globe Load & Animation Setup`?**
  _High betweenness centrality (0.037) - this node is a cross-community bridge._
- **What connects `canvas`, `rawCustomImages`, `faceSlotContent` to the rest of the system?**
  _44 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `UI Controls & Canvas` be split into smaller, more focused modules?**
  _Cohesion score 0.041666666666666664 - nodes in this community are weakly interconnected._
- **Should `Sphere Field Management` be split into smaller, more focused modules?**
  _Cohesion score 0.07822410147991543 - nodes in this community are weakly interconnected._
- **Should `GIF Encoder (vendor)` be split into smaller, more focused modules?**
  _Cohesion score 0.10158730158730159 - nodes in this community are weakly interconnected._