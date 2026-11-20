# Viewers and canvas rendering

ECAD shares one Three.js WebGL 2 viewport engine across the schematic editor, symbol editor, footprint editor, PCB editor, Gerber viewer, and STEP viewer.

## Schematic canvas

Open `/editor` or switch to **Schematic** from any workspace. The schematic editor renders on `Viewer2D` with a locked top-down view and a landscape A3 worksheet (`420 × 297 mm`, KiCad-style double border, numbered columns, lettered rows, and bottom-right title block). Outside the sheet edge, grid dots render at 30% opacity.

- **Sheet configuration** — `<Editor2D sheet={{ width, height, name }} />` or **Sheet settings** changes the paper size and title block shared across all schematic pages without moving existing shapes.
- **Toolbar** — Main row holds **Select**, **Pan**, **Symbols**, and **Delete**, plus expandable groups: **Shapes** (Rectangle, Circle, Triangle, Line, Text), **Connections** (Wire, Pin, Net label, Supply label, No-connect), **History tools** (Undo, Redo, History), and **View tools** (Zoom, Fit, Export).
- **Drawing and selection** — Click or drag to draw; drag shapes to move; drag empty space for a selection marquee. `Shift` adds to selection, `Ctrl`/`Cmd` toggles, and `Ctrl`/`Cmd+Shift` removes. Arrow keys nudge by 1 grid step (`Shift+Arrow` by 10; ordinary text by 0.1). `R` / `Shift+R` rotates by 90°, `Alt+drag` duplicates, `Delete`/`Backspace` removes, `F6` fits the view, `Ctrl+scroll` or pinch zooms, and middle-drag or **Pan** pans.
- **Wiring** — Wires start at pins, label anchors, or open wire endpoints, draw orthogonal segments, snap exactly to terminals even off-grid, and insert right-angle bends automatically.
- **Grid and snapping** — 10 × 10 minor cells per major square; snapping is always active and tracks zoom resolution.

## Gerber viewer

Import individual Gerber files or ZIP archives to inspect planar board layers in 2D and 3D:

- **Archive handling** — Each Gerber file in a ZIP (including subfolders) loads as its own layer while unrelated/hidden files are skipped. Valid files survive neighboring invalid files. Size limits: 64 MiB per Gerber file, 256 MiB per ZIP (64 MiB per entry).
- **Specification & diagnostics** — `packages/core/src/formats/gerber` targets Ucamco's [2026.05 Gerber specification](https://www.ucamco.com/en/guest/downloads/gerber-format) including X3 attributes. Diagnostics report warnings (repaired legacy syntax, missing `M02`), errors (skipped commands), and fatal errors (rejected layers). Recoverable files still render with an issue count in the layer panel.
- **Layer stack & 3D orbit** — Layers sit at physical board heights (front copper `+0.8 mm`, back copper `-0.8 mm`, inner copper evenly distributed between, mask/paste/silkscreen stacked outward). Drill layers draw as open barrels and cut holes through other layers. Every non-outline/non-drill layer tints the board outline by 15% of its color.
- **Focus & X-ray mode** — Focusing a layer renders other layers as X-ray outlines (combining a 4 CSS px camera-relative stroke with a 0.05 mm scene-relative stroke and cached LODs) with faint interiors.
- **2D/3D navigation** — Press the toolbar's **2D** button, `Shift+drag`, or `Shift` + two-finger trackpad scroll to orbit into 3D; press **2D** again to animate back to top view in 280 ms (instant with reduced motion). In 3D views (including STEP models), mouse wheel zooms toward the pointer, two-finger trackpad scroll and middle-drag pan, and `Shift` + two-finger scroll, `Shift` + mouse wheel, or `Shift+middle-drag` orbits around the point under the cursor. In 2D, mouse wheel pans (`Shift+wheel` scrolls sideways).

## Shared 2D and 3D scene model

Both `Viewer2D` and `Viewer3D` accept the same `scene: ViewerScene` prop (`packages/core/src/engine/scene.ts`): an ordered array of `PlanarObject` (vector primitives, bounds, display settings) and `SpatialObject` (Three.js `Object3D`) entries.

```tsx
const step = await parseStepFile(stepFile);
const gerber = await parseGerberFile(gerberFile);
const scene = [...step.scene, ...gerber.scene];

<Viewer2D scene={scene} />
<Viewer3D scene={scene} />
```

- `parseStepFile` (limit: 256 MiB) produces one `SpatialObject` per part plus part metadata and an idempotent `dispose()`.
- `parseGerberFile` resolves dark/clear exposures in a Web Worker (0.0001 mm curve tessellation tolerance) and returns `result.object`, `result.scene[0]`, diagnostics, and `dispose()`.
- Viewers borrow input geometry and own their display materials, renderer, controls, and grid; callers dispose parsed scenes after closing viewers.
- To add a new format, implement `FormatParser` and register it in `packages/core/src/formats/registry.ts`. Shared engine modules never import format adapters.

## Rendering performance and controls

- **Grid & rulers** — Grid dots render in WebGL beneath the scene. Rulers pre-lay ticks 512 px past each edge and translate them during pans to avoid DOM churn; during zoom, rulers update SVG transforms directly outside Solid reactive bindings.
- **Incremental pan & partial redraws** — Orthographic pans (including the flat PCB and footprint views while their Gerber layers stay hidden) shift the previous framebuffer by whole device pixels and draw only newly exposed strips. Selection, drag, and preview edits redraw only dirty screen boxes (+4 px margin), falling back to a full redraw when dirty area exceeds half the viewport.
- **Draw batching** — The schematic, footprint, and flat PCB editors retain per-shape meshes for export/tests while rendering merged draw batches (`packages/core/src/engine/draw-batch.ts`, max 64 mm spans), shared 32-texel-aligned label texture atlases, and distance-shaded single-quad round-capped strokes. On the RP2350A board, flat zoom redraws take 12 draw calls (down from ~2,000) and cached pans take 3; in 3D, visible Gerber layers draw unbatched.
- **Antialiasing** — Controlled globally via **Settings → Display → Antialiasing** (`Automatic`, `On`, `Off`). `Automatic` disables WebGL multisampling on software renderers (SwiftShader, llvmpipe) to avoid 4× MSAA overhead; labels, pins, and round-capped strokes compute analytical edge coverage regardless.
- **Viewport controls** — `SceneViewport` provides shared zoom/fit controls (`25%–1600%` in Gerber/STEP; `1%–10000%` in footprints/boards). `Viewer3D` adds isometric, top, and front presets, and `StepViewer` adds a wireframe toggle via `extraControls`. `Viewer2D` `onChange` reports camera state, rendering diagnostics, and (while tilted in 3D) the camera's world-to-clip `projection` matrix.
