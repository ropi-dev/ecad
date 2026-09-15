# Gerber viewer

Choose one Gerber file. The viewer parses it in a browser worker and fits the drawing to the canvas. WebGPU is the preferred backend; the file bar identifies software adapters and the Canvas fallback.

The Gerber adapter in `src/formats/gerber` targets Ucamco's [2026.05 specification](https://www.ucamco.com/en/guest/downloads/gerber-format), including X3 component attributes. Unsupported commands and malformed input produce diagnostics. Legacy negative images, nonidentity image transforms, and rectangular-aperture arc strokes are rejected.

`src/engine/types.ts` defines the shared geometry in millimetres. Parsers return a `SceneLayer`; the WebGPU and Canvas renderers consume that layer without importing a file parser. To add another format, implement `FormatParser` and register it in `src/formats/registry.ts`. Gerber attributes remain on scene objects. Net grouping lives in the Gerber adapter; the graphics engine accepts a format-independent set of selected object IDs.

Run `npm run dev` for the app and `npm test` for parser and renderer geometry tests. WebGPU requires a compatible browser and HTTPS or localhost.

The floating toolbar provides zoom, directional pan, and a zoom percentage button. The initial fitted view is 100%; clicking the percentage recenters and resets to that view. Zoom is limited to 25–800% through all controls. Drag with a mouse or one finger to pan. Scroll the wheel or pinch a touchpad or touchscreen to zoom around the pointer or gesture midpoint. The drawing also accepts arrow keys, `+`/`-`, and `0` or `F` to reset while focused. Resizing preserves the chosen view.

WebGPU prepares triangles in a separate worker and transfers vertex buffers back to the renderer. Pan and zoom reuse the existing GPU buffers while finer curves are prepared. Obsolete refinement requests are coalesced. The canvas emits `renderinvalidated` when new geometry is ready, so engine consumers should request another frame.

Hovering fills all objects with the same Gerber `.N` net name white, including disconnected pieces. Clear exposures and aperture holes remain transparent. Objects with missing or empty net names, or the reserved `N/C` name, are selected individually; the viewer does not infer connectivity from geometry. Moving within the same net reuses its selection. WebGPU updates selection flags without rebuilding triangle buffers.

## Shared STEP and Gerber code

Both viewers use the hooks and controls in `src/components/viewer`:

- `useFileImport` handles cancellation, loading state, per-file errors, and partial batch success. Format hooks parse files and decide whether to replace a STEP model or append Gerber layers.
- `useViewportSize` observes the viewport without resetting the camera.
- `useRenderFrame` batches redraw requests into one animation frame and cancels pending work during cleanup.
- `ZoomControls` provides zoom and fit buttons with each viewer's labels, limits, and styling.

`src/engine/navigation.ts` shares keyboard shortcuts, wheel delta conversion, zoom increments, and the pixel ratio limit. STEP keeps its perspective camera and orbit controls; Gerber keeps its orthographic camera, layer compositing, and renderer fallbacks. Their public viewer handles remain compatible with existing callers.
