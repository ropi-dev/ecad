# PCB editor

A PCB is the board view of a circuit. Open a schematic or a circuit and press the **PCB** side of the view switch in the document bar, next to Schematic and Circuit. The first time, the project gets a board file for that circuit, `<name>.ecadpcb`, and the PCB opens. The board also appears in the project's file list as a PCB file.

The editor is the footprint editor's canvas with a board added: the same layers, selection, moves, rotation, locks, undo, history panel and 3D view. Lengths are in millimetres.

## Footprints from the schematic

Each time a PCB opens, and when you press **Update from schematic**, the board catches up with the circuit in one undo step:

- A component without a footprint on the board gets one: the footprint its schematic symbol names under **Footprint** in Attributes. New footprints are laid out in rows to the right of the board outline, or around the origin before there is one.
- A component whose schematic footprint changed gets the new footprint in the same place, rotation and side.
- References and values follow the circuit.
- A footprint whose component left the circuit is removed.

A toast lists what changed and names components without a footprint, or whose footprint is missing from the project and the built-in library.

A placed footprint moves, rotates and locks as one item. Its pads take their nets from the circuit: a pad gets the net of the component pin with the same number. Press **F**, or **Flip to the other side** in the toolbar, to move the selected footprints to the back. Flipping mirrors a footprint about its origin and moves each item to the matching back layer. The **Side** field in Attributes does the same.

## Ratsnest

Thin white lines join pads that should be connected and are not yet. Copper on the same net that touches on a shared layer counts as connected: pads, tracks, vias and zone fills. Through-hole pads and vias join both copper layers. Each net's unconnected groups are joined by the shortest lines that reach all of them. The status at the bottom right counts these connections and names the active layer.

Selecting a track, via or zone highlights the rest of its net.

## Tracks

Open **Routing** in the toolbar and choose **Track**. Click a pad, via or track to start; the track takes its net and goes on the active copper layer. Starting on a surface mount pad on the other side switches the active layer. Each click places the track up to the pointer as one straight run and one 45 degree run. Press **/** to put the diagonal run first. Clicking on a pad, via or track of the same net, or with no net, finishes the track there. Escape ends it.

Press **V** while routing to place a via at the end of the last placed run and continue on the other copper layer.

New tracks use the board's track width. A track's width is its line width in Attributes, and its **Net** can be changed there.

## Vias

**Routing → Via** places a via with the board's via diameter and drill. It takes the net of the copper under it, or GND when there is none.

## Copper zones

**Routing → Copper zone** draws a rectangle on the active copper layer. A zone fills its rectangle with copper on its net, inside the board outline and the edge clearance, and keeps the clearance from copper on other nets. A fill island that reaches nothing on the zone's net is removed. Pads, tracks and vias on the zone's net inside the fill connect to it directly, without thermal reliefs. Choose the zone's **Net** in Attributes; a new zone starts with the net under the pointer, or GND. **Zone clearance** overrides the board clearance for one zone. Fills are recomputed after each edit and draw under the other items of their layer.

## Board outline

**Routing → Board outline** draws a rectangle on the Edge.Cuts layer. Lines, rectangles and circles on Edge.Cuts make the outline; lines that join end to end form a closed shape. The 3D view draws the board to the outline.

## Design rules

**Board setup** holds the clearance between copper on different nets, the width of new tracks, the via diameter and drill, and the clearance between copper and the board edge. The board file stores them.

**Design rules check** runs on demand and lists:

- shorts and clearance violations between copper on different nets on a shared layer. Pads of one footprint are not checked against each other.
- copper outside the board outline or closer than the edge clearance.
- a missing board outline.
- each unrouted connection.

Select a finding to select the items involved. Results go stale after an edit; run the check again.

## Fabrication files

**Export → Export Gerber and drill files** downloads a ZIP of Gerber X2 files for both copper layers, solder mask, paste, silkscreen and the board outline, and an Excellon drill file for plated holes. Zone fills are exported as regions. Each pad opens the solder mask 0.05 mm past its copper; vias stay covered. Text is not exported yet.

## Autorouting

Two routers in `@ecad/drawing-core/board/` route on a 0.1 mm grid over both copper layers and keep the board's clearances. Neither is in the editor yet; the reference design below uses both.

`negotiatedRoute` (`negotiated-route.ts`) is the main one. It routes every net in turn, letting routes share space with other nets at a price. After each round the price rises and cells that were shared keep a history cost, until no two nets share space. Nets that still overlap after the last round are left unrouted.

`autoroute` (`autoroute.ts`) routes the remaining connections one at a time. When earlier routes block one, it searches again across them at a cost, removes the routes it crosses and routes those again later.

## Reference design

**Add file → Examples → RP2350A reference design**, or **Open an example** on the start page, adds the Raspberry Pi RP2350A minimal design to the project: a schematic, its circuit and a routed two-layer board with ground zones on both sides. It has the chip and its switching core regulator, W25Q128JVS flash, a 12 MHz crystal, a Micro-B USB connector with 27 Ω series resistors, an AMS1117 3.3 V regulator, BOOTSEL and RUN buttons, an SWD header and two 20-pin GPIO headers.

`pnpm run example:rp2350a` regenerates it from `packages/core/src/examples/rp2350a.ts` in about three minutes and prints its DRC result. `--write` saves the design the app loads, and `ECAD_BOARD_SVG=<file>` writes a top view of the board as SVG.

## File format

A `.ecadpcb` file is UTF-8 JSON:

```json
{
  "format": "ecad-board",
  "version": 1,
  "units": "mm",
  "id": "rp2350a",
  "name": "RP2350A",
  "circuitId": "rp2350a",
  "rules": {
    "clearance": 0.15,
    "trackWidth": 0.2,
    "viaDiameter": 0.6,
    "viaDrill": 0.3,
    "edgeClearance": 0.3
  },
  "shapes": []
}
```

`circuitId` names the circuit the board belongs to. `shapes` holds up to 50,000 items in the drawing shape format, the same as footprint items, plus:

| Field | Meaning |
| --- | --- |
| `layer: "Edge.Cuts"` | An outline item. |
| `net` | On a copper line (a track), via or zone: the circuit net ID. |
| `zone` | Makes a copper rectangle a zone. `clearance` optionally overrides the board clearance. |
| `kind: "symbol"` with `footprint` | A placed footprint. `children` are its items in footprint coordinates, `component` is the circuit component ID, and `flipped` marks a footprint on the back, whose children are already mirrored. |

The project manifest lists board paths in `boards`. Desktop projects keep them next to the project file, and web projects write them as `boards/<id>.ecadpcb` in each revision.

## Code

`packages/drawing-core/src/board/` holds the headless model: `footprints.ts` places and flips footprints and lists their pads, `netlist.ts` maps pads to circuit nets, `connectivity.ts` groups copper and builds the ratsnest, `drc.ts` checks the rules and reads the outline, `sync.ts` brings a board up to date with its circuit, and `autoroute.ts` routes. `packages/core/src/board/` adds the file format, zone fills (`fill.ts`, with the polygon operations the Gerber viewer uses), the flat view's display (`view.ts`), routing helpers, the Gerber writer and the schematic sync for an open document. `components/board/useBoardEditor.ts` connects them to `Editor2D`, which runs in board mode when the project opens a board.
