# PCB editor

A PCB is the board view of a circuit. From a schematic or circuit, click **PCB** in the document bar's view switch (`Schematic | Circuit | PCB`). The first time you open it, ECAD attaches an empty board to the `.ecaddraw` file and adds a **PCB view** row under **Circuit view** in the project file list.

Once any of the three views is open, the other two preload in the background during the first 1-second pause in input so switching views is instant. Each view keeps its own camera and tool, and switching carries component selections across views.

The PCB editor extends the [footprint editor](footprints.md) canvas with board copper layers, placed footprints, tracks, vias, copper zones, ratsnest, design rules, and fabrication export. Use the `mm`/`mil` toolbar button beside **2D** to switch display, grid, rules, and DRC units between millimetres and mils (saved globally in [settings](settings.md#board-units)).

## Syncing footprints from the schematic

When a PCB opens or you click **Update from schematic**, the board synchronizes with its circuit in one undo step:

- Components without a placed footprint receive the footprint assigned under **Footprint** in schematic Attributes, laid out in rows to the right of the board outline (or around the origin before an outline exists).
- Components whose assigned footprint changed swap to the new footprint in the same position, rotation, and side.
- Component references, values, and `${REFERENCE}` / `${VALUE}` / `${FOOTPRINT_NAME}` footprint text update automatically.
- Tracks, vias, and zones referencing a removed/renamed net adopt the net of touching pads when those pads agree; ambiguous copper or unattached zones retain the old net and are flagged by DRC.
- Footprints whose component was deleted from the circuit are removed. Duplicate footprints for the same component remain unlinked with no pad nets.

A toast summarizes changes and flags components with missing or unassigned footprints. Press **F** (in 2D) or **Flip to the other side** (or **Side** in Attributes) to mirror unlocked footprints to the opposite side of the board.

## Copper layers (2 to 32)

New boards start with 2 copper layers (`F.Cu` and `B.Cu`). **Board setup → Copper layers** sets any even count from `2` to `32`, inserting KiCad-named inner layers (`In1.Cu`, `In2.Cu`, …) between front and back copper.

- **Board setup** refuses to remove an inner layer that still contains items (undo/history jumps that restore inner-layer items automatically expand the layer count again).
- Pads sit on outer layers only; through-hole pads and vias connect to all copper layers (blind/buried vias are not yet supported).
- The 3D view spaces inner copper layers evenly between front and back copper.

## Ratsnest, tracks, vias, and holes

- **Ratsnest** — Thin lines connect the closest unconnected copper islands on each net (touching pads, tracks, vias, and zone fills on shared layers). The bottom-right status bar reports unrouted connection count and active layer. Selecting a track, via, or zone highlights its entire net.
- **Tracks (`Routing → Track`)** — Click a pad, via, or track to start on its net (starting on an opposite-side SMD pad switches active layer). Clicks route one straight + one 45° segment (`/` flips which comes first). Press **V** while routing to drop a via and toggle front/back copper, or use **Page Down** / **Page Up** (or click a copper layer) to drop a via and switch layers. Clicking same-net copper finishes the track; `Escape` exits.
- **Vias (`Routing → Via`)** — Places a plated via using Board setup's diameter/drill, inheriting the net under the pointer (or `GND`).
- **Unplated holes (`Routing → Unplated hole`)** — Places a 3.2 mm non-plated mounting hole opening solder mask on both sides with no copper or net. Zones, DRC, and autorouters keep clearance from its mask circle.

## Copper zones and thermal reliefs

- **Creating and editing** — **Routing → Copper zone** draws a rectangular zone; **Routing → Polygon copper zone** draws corner by corner (click start/end corner or press `Enter` to close; `Escape` cancels). Selected polygon zones show corner handles and midpoint handles (drag a midpoint to insert a corner; drop a corner within ¾ grid step of a neighbor to remove it).
- **Selecting vs. marquee** — Clicking inside a zone selects it. Dragging from inside a zone (or any unfilled shape such as the board outline) starts a selection box rather than moving the zone; drag the zone's edge to move it.
- **Fill rules** — Zones fill inside the closed board outline (respecting edge clearance) and keep clearance from other nets' copper. Before a closed outline exists, zones fill their full shape while keeping clearance from any drawn `Edge.Cuts` lines. Unconnected islands are removed. Higher **Zone priority** (`0–1000`, default `0`; ties broken by draw order) claims overlapping copper on different nets.
- **Thermal reliefs** — Pads on the zone's net connect via thermal relief spokes by default (4 spokes along pad axes, or 45° for round pads; rotates 45° or combines up to 8 spokes if fewer than 2 reach fill). Spokes that would violate clearances, unplated holes, or board edges are omitted; pads with no valid spokes remain unconnected for ratsnest/DRC. Tracks and vias connect directly to fill (vias inside a pad's thermal gap connect only where covered by a spoke). Attributes lets you switch **Pad connection** to `Solid` or override **Thermal gap**, **Spoke width**, **Zone clearance**, and **Zone priority** per zone.

## Board outline and realistic 3D view

- **Board outline (`Routing → Board outline`)** — Draws on `Edge.Cuts`. Closed loops of lines, rectangles, or circles define the board shape for zone fills, DRC, and the 3D view.
- **Realistic view** — Click the sparkle button in the Layers panel header for manufactured appearance (green mask, gold copper, white silkscreen) and the adjacent cube button to toggle 3D component models.

## Design rules and DRC

**Board setup** stores per-board rules: copper layer count, copper clearance, default track width, via diameter/drill, edge clearance, solder mask margin, and thermal relief gap/spoke width (default 0.5 mm each).

**Design rules check** runs on demand and reports:

- Shorts and clearance violations between different nets' copper (including zone fills)
- Copper outside the board outline or inside edge clearance
- Copper-to-unplated-hole clearances, overlapping holes, and holes outside the outline
- Missing or unclosed board outlines
- Unplaced components and connected pins missing a matching footprint pad
- Copper on stale nets, empty zones, and every unrouted ratsnest connection

Clicking a finding selects the affected items. Findings mark stale after edits.

## Fabrication files and drawing exports

- **Gerber & drill (`Export → Export Gerber and drill files`)** — Downloads a ZIP of Gerber X2 files for every copper layer (`In1_Cu.g1`, …, with `Copper,L<n>,Inr`/`Bot` file functions), solder mask, paste, silkscreen, board outline, and Excellon drill files (`<name>-PTH.drl`, plus `<name>-NPTH.drl` when unplated holes exist).
  - Zone fills merge into regions; pads and unplated holes open mask by `solderMaskMargin` (`-0.5` to `0.5 mm`, default `0.05 mm`); vias stay tented.
  - Rounded-rectangle pads flash KiCad-compatible `RoundRect` macros (or obround `O` / `Oval` / circle apertures); slotted holes emit `G85` routes.
  - Silkscreen text exports as filled glyph outlines (Latin, Latin Extended, Greek), mirrored on back layers, with minimum 0.15 mm stroke thickening on small text. Fabrication, courtyard, outline, and copper text are omitted.
  - Runs DRC first and warns if findings exist.
- **PNG / SVG / PDF (`Export → Export drawing`)** — Exports layered PNG, vector SVG, or 1:1 scale multi-page vector PDF (one page per populated layer with bookmarks, board outline, solder mask openings, zone fills, and Excellon-accurate drill knockouts).

## Autorouting and RP2350A reference design

Two headless routers live in `@ecad/drawing-core/board/` (0.1 mm grid, front/back copper only, keeping vias clear of inner copper; not yet wired into editor UI):

- `negotiatedRoute` (`negotiated-route.ts`) — Negotiated-congestion router that iteratively raises shared-cell costs until nets separate.
- `autoroute` (`autoroute.ts`) — Rip-up-and-reroute pass for remaining open connections.

**Add file → Examples → RP2350A reference design** (or **Open an example** on the start page) loads Raspberry Pi's RP2350A minimal design (schematic, circuit, and 2-layer routed board with ground zones and vias). Regenerate the bundled example with `pnpm run example:rp2350a --write` (optional `ECAD_BOARD_SVG=<file>`).

## File format

A board is stored in the `board` field of its `.ecaddraw` file (up to 50,000 shapes):

```json
{
  "shapes": [],
  "board": {
    "units": "mm",
    "rules": {
      "clearance": 0.15,
      "trackWidth": 0.2,
      "viaDiameter": 0.6,
      "viaDrill": 0.3,
      "edgeClearance": 0.3,
      "solderMaskMargin": 0.05,
      "thermalGap": 0.5,
      "thermalSpokeWidth": 0.5,
      "copperLayers": 2
    },
    "shapes": []
  }
}
```

| Field | Meaning |
| --- | --- |
| `layer` | Outer/fabrication/mask/paste/courtyard/silkscreen layers, `Edge.Cuts`, or inner copper `In1.Cu`–`In30.Cu` (must fit `rules.copperLayers`). |
| `net` | Circuit net ID on a track, via, or zone. |
| `zone` | Copper zone metadata on a copper rectangle: optional `clearance`, `priority` (`0–1000`), `outline` (normalized `-0.5..0.5` polygon vertices), `padConnection` (`"thermal"` or `"solid"`), `thermalGap`, `thermalSpokeWidth`. |
| `kind: "symbol"` + `footprint` | Placed footprint with `component` (circuit component ID), `children` in footprint coordinates, and optional `flipped: true`. |

## Code map

- `packages/drawing-core/src/board/` — Headless model: `footprints.ts`, `netlist.ts`, `connectivity.ts`, `drc.ts`, `sync.ts`, `routing-grid.ts`, `negotiated-route.ts`, `autoroute.ts`.
- `packages/core/src/board/` — File format, Clipper zone fills (`fill.ts`), flat display (`view.ts`), Gerber/drill ZIP export (`fabrication.ts`), and `analysis.worker.ts` / `analysis-client.ts` (runs zone fills, ratsnest, DRC, and fabrication export off the main thread, falling back to the page if workers are unavailable).
- `packages/core/src/components/board/useBoardEditor.ts` — Connects board state to `Editor2D`.
