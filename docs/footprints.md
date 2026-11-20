# Footprint editor

A footprint (`.ecadfp`) describes the pads, holes, silkscreen, courtyard, and other board-layer graphics a component requires on a [PCB](pcb.md). Create one via **Add file → New footprint** in an open project.

The footprint editor extends the symbol canvas with board layers and a live 3D board view. Selection, dragging, resizing, rotation, locks, copy/paste, undo, and autosave work as in schematics. Use the `mm`/`mil` button beside **2D** in the toolbar to toggle display and grid units between millimetres and mils (saved globally; see [settings](settings.md#board-units)). Zoom is absolute (`100%` = 100 px/mm, range `1%–10000%`), and `F6` fits the selection or footprint.

- Clicking inside a hollow rectangle, circle, or triangle picks items underneath (such as pads inside a courtyard); click its stroke to pick the outline.
- Dragged or nudged pads snap their center to the grid; other graphics snap a corner.
- MCP clients do not edit `.ecadfp` files yet, and there is no third-party footprint import/export.

## Built-in footprints and symbol assignment

ECAD bundles **64 read-only built-in footprints** adapted from KiCad and Raspberry Pi's RP2350A reference board (see [packages/default-footprints/README.md](../packages/default-footprints/README.md)).

- Select a placed symbol in a schematic and assign its **Footprint** in Attributes (`None`, project footprints, or built-in footprints grouped by KiCad library). Most built-in symbols supply a default footprint for new placements; power, net, Box, and pinless symbols have none.
- Pads match symbol pins by number (unnumbered pins match by 1-based pin index). Attributes reports matched pins, missing pads, and extra numbered pads (unnumbered mounting pads are ignored).
- Use **Open footprint** for project footprints, or **Copy to project** on a built-in footprint to fork an editable copy and reassign the selected symbol.

## Layers and focus

The **Layers** panel lists 13 layers: front and back copper, silkscreen, solder mask, paste, courtyard, and fabrication, plus `Edge.Cuts`.

- Selecting a layer makes it active and **focuses** it (fading other layers in 2D and showing them as X-ray film in 3D). Click the active layer again to clear focus while keeping it active.
- The eye icon toggles visibility (`F.Paste` and `B.Paste` start hidden). The active layer cannot be hidden, hidden items cannot be selected, and Attributes prevents moving items onto hidden layers. Exports always include hidden layers in physical board order.

## Pads, vias, and unplated holes

Open **Pads and vias** in the toolbar (`R` rotates before placement; `Escape` returns to Select):

- **Surface mount pad** — Starts as a `1 × 1.5 mm` rectangle on the active copper layer (`F.Cu` fallback). Supports `Rectangle`, `Circle`, or `Oval` shape, `Corner radius` (stored as `cornerRatio`, a fraction of the shorter side up to `0.5`), and a **Solder paste** toggle (on by default, generating a matching opening on `F.Paste`/`B.Paste`).
- **Through-hole pad** — Starts as a `1.7 mm` circle with a `1 mm` drill on both copper layers. Supports `Round` or `Slot` holes (slot runs along the pad's local X axis and exports as a `G85` route in Excellon drill files). Drills must stay smaller than the pad; shrinking a pad below its drill resizes the drill to 60% of the pad.
- **Via** — Starts as a `0.6 mm` plated circle with a `0.3 mm` drill joining all copper layers, tented (no mask opening), unnumbered.
- **Unplated hole** — Starts as a `3.2 mm` circle with a `3.2 mm` drill (M3), no copper, opening solder mask on both sides. Drill may be smaller than the mask circle to leave bare laminate.

## Wires, graphics, and text variables

**Shapes** provides Rectangle, Circle, Triangle, Wire (straight stroke at any angle, no net), and Text (`0.15 mm` default stroke, `1 mm` default text height; closed shapes support **Filled**).

Text supports component template variables resolved on a PCB: `${REFERENCE}`, `${VALUE}`, and `${FOOTPRINT_NAME}`. If silkscreen text contains `${REFERENCE}`, no separate automatic reference label is added on the board.

Pasting from schematics/symbols accepts rectangles, circles, triangles, lines, and text (placed onto the active layer) and rejects pins, schematic wires, net labels, and symbols.

## 3D view and realistic mode

Press **2D** in the toolbar or `Alt+Shift+drag` (or `Alt+Shift` + two-finger trackpad swipe) to orbit into 3D; once in 3D, `Shift+drag` orbits and pressing **2D** animates back to the flat view.

- **Editing in 3D** — Selecting, dragging, resizing, placing, arrow nudging, `R`, `Delete`, `Alt+drag`, copy/paste, undo, and Attributes all work directly in 3D. Pointers raycast onto each item's physical layer surface; clicks pick the nearest surface, and marquee boxes test projected screen outlines. Views nearly edge-on (grazing slope `< 0.02`) disable placement and clear the coordinate readout.
- **Realistic view & 3D models** — Click the sparkle button in the Layers header for manufactured appearance (green mask with `0.05 mm` pad openings, gold copper, white silkscreen) and the cube button to show/hide the footprint's linked 3D model. Link a model from the document bar's **3D model** dropdown (62 built-in models from [packages/default-models/README.md](../packages/default-models/README.md); read-only, no external model import yet).

## File format (`.ecadfp`)

UTF-8 JSON with strict schema validation (unknown fields rejected, up to 4,096 shapes, positions in millimetres with positive Y up, rotations in radians):

```json
{
  "format": "ecad-footprint",
  "version": 1,
  "units": "mm",
  "id": "r-0805",
  "name": "R 0805",
  "description": "",
  "model": { "library": "builtin", "id": "r_0805_2012metric" },
  "shapes": [
    {
      "id": 1,
      "kind": "rectangle",
      "layer": "F.Cu",
      "x": -0.9125,
      "y": 0,
      "width": 1.025,
      "height": 1.4,
      "rotation": 0,
      "lineWidth": 0.15,
      "filled": true,
      "pad": { "number": "1", "type": "smd" }
    }
  ]
}
```

- `id`: 1–64 chars (`[a-z0-9][a-z0-9._-]*`). `name`: 1–100 chars. `model`: optional `{ "library": "builtin", "id": "<model-id>" }`.
- Accepted shape kinds: `rectangle`, `circle`, `triangle`, `line`, `text`.

| Shape field | Meaning |
| --- | --- |
| `layer` | `F.Cu`, `B.Cu`, `F.SilkS`, `B.SilkS`, `F.Mask`, `B.Mask`, `F.Paste`, `B.Paste`, `F.CrtYd`, `B.CrtYd`, `F.Fab`, `B.Fab`, or `Edge.Cuts` (defaults to `F.SilkS`). |
| `pad` | `{ number, type: "smd" \| "through-hole", drill?, paste?, cornerRatio?, slot? }`. `drill`/`slot` only on through-hole; `paste` only on SMD; `cornerRatio` (`0 < r <= 0.5`) only on rectangular pads (`0.5` = oval). |
| `via` | `{ drill }` on a circle (`drill < diameter`). |
| `hole` | `{ drill }` on a circle on `F.Mask`/`B.Mask` (`drill <= diameter`, no `net`). |
| `filled` | Fills rectangles, circles, or triangles (pads are always solid). |

Project manifests list footprints in `footprints` (`footprints/<id>.ecadfp`), watched for external edits on desktop.

## Code map

- `packages/drawing-core/src/footprint/` — Layer definitions, pad/via/hole helpers, `footprintLayerView`, `reference.ts` (`matchPinsToPads`), `model.ts`, and `text-variables.ts`.
- `packages/core/src/footprint/` — `.ecadfp` schema (`format.ts`), on-demand built-in library (`library.ts`, `models.ts`), planar board builder (`board.ts`, `board-objects.ts`), and screen outlines (`outline.ts`).
- `packages/core/src/components/footprint/` — `FootprintBoardView`, `FootprintLayerPanel`, `FootprintModelField`, `useFootprintLayers`, `useFootprintModels`.
- `packages/core/src/engine/view-projection.ts` & `packages/core/src/engine/footprint-models.ts` — 3D raycast projection (`MIN_GRAZING_SLOPE = 0.02`) and cached `GLTFLoader` model instances.
