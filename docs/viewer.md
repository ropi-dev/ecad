# Gerber viewer

Open Gerber files or ZIP archives to view their planar objects in the shared perspective viewport. Each Gerber file in an archive, including subfolders, becomes a separate layer, just as if it had been selected individually. Archive paths identify the layers; unrelated files and hidden metadata are skipped. Archives and individual files can be selected together and are added to the existing layers. Invalid files produce errors without discarding successful imports. Files are parsed in browser workers. Layer visibility, ordering, removal, and focus remain available; focusing a layer shows the others as cool blue X-ray outlines with faint interiors. Overlapping unfocused layers accumulate light, while clear holes stay transparent. The viewport requires WebGL 2 and reports an error if it cannot initialize.

The Gerber adapter in `src/formats/gerber` targets Ucamco's [2026.05 specification](https://www.ucamco.com/en/guest/downloads/gerber-format), including X3 component attributes. Unsupported commands and malformed input produce diagnostics. Legacy negative images, nonidentity image transforms, and rectangular-aperture arc strokes are rejected.

`src/engine/types.ts` defines the shared geometry in millimetres. The low-level Gerber parser returns vector geometry in `ParseResult.object`, alongside diagnostics, format, and units. The file parser resolves exposures in a worker and constructs the Three.js object before returning. The WebGPU and Canvas renderers consume its vector geometry without importing a file parser. To add another format, implement `FormatParser` and register it in `src/formats/registry.ts`. Gerber attributes remain on scene objects. Net grouping lives in the Gerber adapter; the graphics engine accepts a format-independent set of selected object IDs.

Run `npm run dev` for the app and `npm test` for parser and renderer geometry tests.

Gerber uses `Viewer2D`, a perspective camera locked above the scene looking down the Z axis. Drag or swipe to pan, pinch or Ctrl + scroll to zoom, and use `F6` to fit. Mouse modifiers and touch gestures cannot rotate the camera. Gerber and STEP share the zoom and fit toolbar; STEP additionally exposes isometric, top, and front views. Visibility, focus, and reordering update the displayed objects without rebuilding geometry or resetting the camera. X-ray outlines combine a camera-relative width of 4 CSS pixels with a scene-relative width of 0.05 mm, both extending inward from each edge. The wider contour remains visible without doubling the brightness where the two overlap. Perspective scales the scene-relative contour with edge distance, while the camera-relative contour keeps distant edges visible.

Gerber objects remain flat surfaces, separated by a 0.1 mm display gap along Z. The bottom entry in the layer panel is at Z = 0; higher entries sit progressively higher. Reordering updates these positions, hiding preserves the gaps, and removing a layer closes its gap. This spacing does not represent physical PCB thickness. Camera fitting includes the full stack. Each file is a Three.js object containing triangle meshes and contour geometry. Filled curves are tessellated with a 0.0001 mm tolerance. X-ray contours use cached levels of detail selected before rendering, with simplification limited to 0.25 CSS pixels and 0.005 mm. Zooming in restores the finer contour geometry. Flat fills render in a single pass. There are no texture maps or backing images. Net hover selection is not implemented in the shared perspective viewport.

## Compatible 2D and 3D scene inputs

Both `Viewer2D` and `Viewer3D` accept the same `scene: ViewerScene` prop, defined in `src/engine/scene.ts`. A scene is an ordered array of `ViewerObject` entries. Each entry is either a `PlanarObject` (vector primitives, bounds, and display settings) or a `SpatialObject` (a Three.js `Object3D`). There are no separate layer and model slots; any number of either object type can appear in the array. The same scene can be shown in both viewers at once.

```tsx
const step = await parseStepFile(stepFile);
const gerber = await parseGerberFile(gerberFile);
const scene = [...step.scene, ...gerber.scene];
<Viewer2D scene={scene} />
<Viewer3D scene={scene} />
```

`parseStepFile` constructs one spatial object per part before resolving and returns the scene, part names and triangle counts, and an idempotent `dispose()` method. Raw importer meshes stay inside the parsing implementation. `parseGerberFile` returns a spatial scene object containing the completed mesh group as `result.object` and `result.scene[0]`, with an idempotent `dispose()` method. Clear exposures are subtracted from earlier dark geometry; later dark exposures can add geometry back. Aperture holes stay local to their shapes. Workspaces can combine parsed objects and change their display colors without rebuilding their geometry.

Both viewers use the same perspective camera, scene display, rendering, navigation code, and grid beneath the geometry. `Viewer2D` locks rotation to the top view and keeps pan and zoom available; `Viewer3D` allows orbiting. Both planar and solid inputs become actual Three.js mesh objects; planar data supplied directly is triangulated by the shared scene builder. No separate orthographic or vector viewport is used by `Viewer2D`.

Viewers borrow input geometry and materials. Each viewer owns its display materials, renderer, controls, and grid; parsed geometry remains owned by the caller. Close every viewer using a parsed scene before disposing it. The file hooks release removed or replaced objects and clean up on unmount. `useFileImport` releases disposable results from cancelled imports.

`StepViewer` applies part visibility and wireframe controls to the parsed scene. `GerberViewer` passes mesh scene objects to `Viewer2D` and applies layer visibility, order, and focus. The shared `SceneViewport` owns the zoom and fit toolbar, so standalone `Viewer2D` and `Viewer3D` instances include it too. The toolbar appears when rendering is ready; 3D viewers also include isometric, top, and front presets. Workspaces can append format-specific actions through `extraControls`, which STEP uses for its wireframe toggle. Array order determines planar stacking; clear exposures remain scoped to their own object. Shared viewer and graphics engine modules do not import format adapters.

Both viewers also share viewport sizing, redraw scheduling, zoom buttons, keyboard shortcuts, and wheel delta conversion. The fit button shows the current zoom percentage, with the fitted view at 100%. Buttons, keyboard shortcuts, scrolling, and pinch gestures stay within 25%–800%; zoom buttons disable at their respective limits. `Viewer2DHandle` exposes reset, zoom, and pan; `Viewer3DHandle` exposes fit, zoom, and isometric/top/front views. The 2D `onChange` callback reports camera state and rendering diagnostics.
