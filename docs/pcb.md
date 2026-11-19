# PCB editor

A PCB is the board view of a circuit. Open a schematic or a circuit and press the **PCB** side of the view switch in the document bar, next to Schematic and Circuit. The first time, the circuit gets an empty board and the PCB opens. The schematic, its circuit and its board are one `.ecaddraw` file. In the project's file list, a drawing with a board has a **PCB view** row under **Circuit view**.

Once any of the three views is open, the other two load in the background during the first pause in your work and stay loaded, so the switch shows them without rebuilding the board or its 3D view. Each keeps its camera and tool. The switch also carries the selected components: footprints selected on the board are selected as symbols in the schematic, or as the component in the circuit view when there is one, and the other way round.

The editor is the footprint editor's canvas with a board added: the same layers, selection, moves, rotation, locks, undo, history panel and 3D view. Lengths are in millimetres.

## Footprints from the schematic

Each time a PCB opens, and when you press **Update from schematic**, the board catches up with the circuit in one undo step:

- A component without a footprint on the board gets one: the footprint its schematic symbol names under **Footprint** in Attributes. New footprints are laid out in rows to the right of the board outline, or around the origin before there is one.
- A component whose schematic footprint changed gets the new footprint in the same place, rotation and side.
- References and values follow the circuit, and so does footprint text that shows them. See [Wires and graphics](footprints.md#wires-and-graphics).
- Tracks, vias and zones on a net the circuit no longer has, for example after a schematic edit renamed an unlabelled net, take the net of the pads their tracks and vias touch, when those pads agree. Copper whose pads disagree, and a zone with no track or via on its net, keeps the old net. The toast counts it and DRC reports it.
- A footprint whose component left the circuit is removed. A footprint whose component lost its footprint, or whose footprint is missing, stays where it is.
- A second footprint for the same component, such as a copy, stays on the board without a component, so its pads have no nets.

A toast lists what changed and names components without a footprint, or whose footprint is missing from the project and the built-in library.

A placed footprint moves, rotates and locks as one item. Its pads take their nets from the circuit: a pad gets the net of the component pin with the same number. In the flat view, press **F**, or **Flip to the other side** in the toolbar, to move the selected footprints to the back. Locked footprints stay put. In the 3D view F fits the view instead. Flipping mirrors a footprint about its origin and moves each item to the matching back layer. The **Side** field in Attributes does the same.

## Copper layers

A new board has front and back copper. **Copper layers** in Board setup gives it 4, 6 or any even number up to 32. The inner layers go between front and back copper and take KiCad's names, In1.Cu nearest the front, then In2.Cu and so on. The Layers panel lists them between Front copper and Back copper, and choosing one there makes it the active layer for tracks, zones and copper shapes. Board setup won't remove an inner layer that still has items on it. If an undo, a history jump or another edit brings back items on a layer the board no longer has, the board gets enough copper layers for them again. Pasting items onto a board without their layer is refused.

Pads stay on the outer layers, and footprints have no inner copper. Every via and through-hole pad reaches all of the board's copper layers, so a track on an inner layer joins one wherever they touch. There are no blind or buried vias yet. The 3D view draws the inner layers inside the board, evenly spaced between front and back copper.

## Ratsnest

Thin white lines join pads that should be connected and are not yet. Copper on the same net that touches on a shared layer counts as connected: pads, tracks, vias and zone fills. Through-hole pads and vias join every copper layer. Each net's unconnected groups are joined by the shortest lines that reach all of them. The status at the bottom right counts these connections and names the active layer.

Selecting a track, via or zone highlights the rest of its net.

## Tracks

Open **Routing** in the toolbar and choose **Track**. Click a pad, via or track to start; the track takes its net and goes on the active copper layer. Starting on a surface mount pad on the other side switches the active layer. Each click places the track up to the pointer as one straight run and one 45 degree run. Press **/** to put the diagonal run first. Clicking on a pad, via or track of the same net, or with no net, finishes the track there. Escape ends it and returns to Select. Segments placed before the track reaches anything take its net once it does.

Press **V** while routing to place a via at the end of the last placed run and continue on back copper, or on front copper when the track is already on the back or an inner layer. **Page Down** and **Page Up** place the via and continue on the next copper layer towards the back or the front, and choosing a copper layer in the Layers panel places the via and continues on that layer. A track that already reaches every layer at that point, through a via placed there or a through-hole pad it started on, changes layer without another via. A new track starts on copper of the active layer under the pointer before copper of other layers. Outside a track, Page Down and Page Up only change the active copper layer.

New tracks use the board's track width. A track's width is its line width in Attributes, and its **Net** can be changed there.

## Vias

**Routing → Via** places a via with the board's via diameter and drill. It takes the net of the copper under it, or GND when there is none.

## Unplated holes

**Routing → Unplated hole** places a 3.2 mm mounting hole, drilled through the board with no copper and no net. Its circle opens the solder mask on both sides, and its **Drill** in Attributes can be smaller than the circle. Zones keep the board clearance from the circle, the autorouter routes around it, and the design rules check reports copper that comes closer. A footprint can carry holes too, such as the built-in MountingHole footprints. See [Unplated holes](footprints.md#unplated-holes).

## Copper zones

**Routing → Copper zone** draws a rectangle on the active copper layer. **Routing → Polygon copper zone** draws a zone corner by corner: click each corner, then click the first or last corner again, or press Enter, to close it. Escape cancels it. A polygon closes only once its corners enclose an area, and a click on a corner already placed adds nothing. A selected polygon zone has a handle on each corner and a round one in the middle of each edge. Drag a corner to move it, drag an edge's handle to add a corner there (dropped on one of that edge's ends, it adds nothing), and drop a corner within ¾ of a grid step of its neighbour to remove it. The grid step follows the zoom. A zone fills its rectangle or polygon with copper on its net, inside the board outline and the edge clearance, and keeps the clearance from copper on other nets. A fill island that reaches nothing on the zone's net is removed. Pads on the zone's net connect through thermal reliefs: the fill keeps a gap around the pad and joins it with spokes, four along the pad's axes, or at 45 degrees to them for a round pad. When fewer than two of those spokes would reach fill, the spokes turn 45 degrees if that reaches more, and if neither set reaches two the pad keeps the spokes of both, up to eight. Pads that touch share one gap. A spoke may cross the gap of a neighbouring pad on the same net if it keeps the clearance from that pad, or the space the two pads already leave if that is less, and it opens that gap where it crosses. A spoke that would cross copper on another net, an unplated hole, the board edge or an earlier zone's fill, come closer than that to another pad inside its gap, or end inside another pad's gap is left out, and a pad with no spoke left stays unconnected, so the ratsnest and DRC show it. Tracks and vias on the zone's net connect to the fill directly, except that a via inside a pad's gap only connects where a spoke covers it. A spoke that a zone's own edge cuts through is clipped rather than removed, as long as it still finds fill beyond its gap. A pad on the zone's net just outside the zone still has its gap cut from the fill but gets no spokes, so a zone whose only copper on its net is such a pad keeps no fill. **Pad connection** in Attributes switches a zone to solid pad connections, and **Thermal gap** and **Spoke width** override the board's sizes for one zone. A spoke is never wider than the pad. Choose the zone's **Net** in Attributes; a new zone starts with the net under the pointer, or GND. **Zone clearance** raises the clearance for one zone. It never goes below the board clearance. Fills are recomputed after each edit and draw under the other items of their layer. They draw opaque, and at 60% opacity while a layer is focused. Until the board has a closed outline, a zone fills its whole rectangle or polygon, still keeping the edge clearance from any Edge.Cuts lines already drawn. Where zones on different nets overlap, the zone with the higher **Zone priority** keeps the copper and the other keeps its clearance from it. Between zones of equal priority, the one drawn first wins. A zone's priority starts at 0. Nested power islands inside a ground zone need a higher priority than the ground zone. An island of a higher-priority zone that reaches nothing on its net is removed after the lower zones keep clear of it, so it leaves a gap in them, as in KiCad. Overlapping zones on one net connect where their fills touch, and an island that touches another zone's copper on the same net is kept.

Click inside a zone to select it. A drag that starts inside a zone draws a selection box and leaves the zone where it is, so the parts and tracks over a fill can be boxed at any zoom. The same holds for every unfilled shape on the board, such as a rectangular board outline. Drag one by its edge to move it. A box dragged to the left selects an unfilled shape only when the box crosses the shape's edge.

## Board outline

**Routing → Board outline** draws a rectangle on the Edge.Cuts layer. Lines, rectangles and circles on Edge.Cuts make the outline; lines that join end to end form a closed shape. The 3D view draws the board to the outline.

## Realistic board

The sparkle button in the Layers panel header draws the board as manufactured, in the flat view and in 3D, with each placed footprint's 3D model on its pads. A footprint on the back hangs under the board, mirrored. The cube button beside the sparkle button shows or hides the models. A placed footprint takes the model its footprint file links when the board is drawn, so a new model for a project footprint shows at once, unlike new pads. See [Realistic board and 3D models](footprints.md#realistic-board-and-3d-models).

## Design rules

**Board setup** holds the number of copper layers, the clearance between copper on different nets, the width of new tracks, the via diameter and drill, the clearance between copper and the board edge, the solder mask margin, and the thermal gap and spoke width of zone pad connections (0.5 mm each by default). The board saves them with its items.

**Design rules check** runs on demand and lists:

- shorts and clearance violations between copper on different nets on a shared layer, zone fills included. Pads, vias and copper of one footprint are only checked for shorts between pads on different nets. A via inside a footprint takes the net of the pad it touches.
- copper outside the board outline or closer than the edge clearance.
- copper that overlaps an unplated hole or comes closer than the clearance, holes from different footprints or on the board that overlap each other, and holes that cross the board edge or lie outside it. Copper and holes of one footprint are not checked against each other.
- a missing board outline, or one whose ends don't meet.
- a component with no footprint on the board, and a pin on a net whose footprint has no pad with its number.
- copper on a net the circuit no longer has, and a zone with no copper because its fill reaches nothing on its net.
- each unrouted connection.

Select a finding to select the items involved. Results go stale after an edit; run the check again.

## Fabrication files

**Export → Export Gerber and drill files** downloads a ZIP of Gerber X2 files for each copper layer, solder mask, paste, silkscreen and the board outline, and Excellon drill files. Inner layers are named as KiCad names them: `<name>-In1_Cu.g1`, `<name>-In2_Cu.g2` and so on, with the file function `Copper,L2,Inr` for In1.Cu, and back copper is the board's last layer, `Copper,L4,Bot` on a 4-layer board. The drill files are `<name>-PTH.drl` for plated holes and, when the board has any, `<name>-NPTH.drl` for unplated holes. Zone fills on each layer are merged and exported as regions. Each pad and unplated hole opens the solder mask by the board's mask margin past its copper or circle, 0.05 mm unless Board setup says otherwise. It can be anything from -0.5 mm to 0.5 mm. A negative margin makes the opening smaller than the pad or hole circle, and one that shrinks away stays covered. Vias stay covered. A pad with rounded corners is flashed on copper, paste and mask with a RoundRect aperture macro in KiCad's form, so fabrication CAM still finds it as a pad. When its corners meet, it flashes an obround (O) aperture, or an Oval macro when it is turned off the axes. A pad with equal sides and fully round corners flashes a circle. Slotted holes are routed in the drill file with G85 between the centres of their round ends. A negative mask margin shrinks a rounded pad's corners first. Past the corner radius, a pad with straight sides left gets a square-cornered opening, and a stadium or circle shrinks away. Text goes to the Gerber of its layer as filled glyph outlines, placed, sized, rotated and aligned as the editor draws it, including each footprint's reference label. Text on the back reads mirrored from above, as it does in the editor, so it reads correctly on the board's underside. So the silkscreen prints, small text grows until the inner diagonals of M, W and w, its thinnest full strokes, are 0.15 mm wide. That thickens regular text below a font size of about 3.3 mm and bold text below about 2.4 mm. Finer details stay thinner than 0.15 mm: the narrow joins where a curve meets its stem, as in m, n, r, h and 5, and parts of @ and *. At about 1 mm and below, the growth closes the smallest openings, such as those in $ and a, and the dot in 0 can touch its ring. The export uses the editor font's Latin, Latin Extended and Greek letters; other characters, such as emoji or Cyrillic, are left out, and the letters around them can shift because the editor sized the text with a fallback font. Fabrication and courtyard text stays out, and so does text on copper and on the board outline, because zone fills and the design rules check don't keep clearance around copper text yet. The export runs the design rules check and warns when it has findings.

## Autorouting

Two routers in `@ecad/drawing-core/board/` route on a 0.1 mm grid over front and back copper and keep the board's clearances. They don't route on inner layers. Their vias keep clear of other nets' inner copper, inner copper passed to `autoroute` as `rippable` stays where it is, and a connection to copper that is only on inner layers stays unrouted. Neither is in the editor yet; the reference design below uses both.

`negotiatedRoute` (`negotiated-route.ts`) is the main one. It routes every net in turn, letting routes share space with other nets at a price. After each round the price rises and cells that were shared keep a history cost, until no two nets share space. Nets that still overlap after the last round are left unrouted.

`autoroute` (`autoroute.ts`) routes the remaining connections one at a time. When earlier routes block one, it searches again across them at a cost, removes the routes it crosses and routes those again later. Tracks and vias passed as `rippable` count as earlier routes, so it can move them too.

## Reference design

**Add file → Examples → RP2350A reference design**, or **Open an example** on the start page, adds the Raspberry Pi RP2350A minimal design to the project: a schematic, its circuit and a routed two-layer board with ground zones on both sides, joined by a via in each island of copper.

The schematic is Raspberry Pi's RPI-RP2350A-MINIMAL R4-S1 schematic, imported from `tests/fixtures/kicad/RPI-RP2350A-MINIMAL_R4-S1.kicad_sch` with the KiCad importer, so its parts, wires, junctions, labels and notes match the source sheet. Every item then snaps to the 50 mil (1.27 mm) grid. Centring the A3 sheet leaves the source's grid 0.45 mm and 0.09 mm off ours, and one ground symbol in the source sits half a step off it. It has the chip and its switching core regulator, W25Q128JVSIQ flash, a 12 MHz crystal, a Micro-B USB connector with 27 Ω series resistors, an NCP1117 3.3 V regulator, BOOTSEL and RUN buttons, a JST SH debug connector and two 2x18 headers. The mounting holes and the PCB, variant and revision symbols have no pins, so they stay off the board.

Each component gets the built-in footprint for the land pattern the source names. The vendor parts use footprints converted from Raspberry Pi's board, and the 0402 and 0805 passives, the QFN-60, the SOIC-8 and the crystal use KiCad's generic ones. Footprints sit where Raspberry Pi's 52 x 51 mm board puts them, with its 0.15 mm tracks and its ground vias: nine in the chip's exposed pad, as in Raspberry Pi's chip footprint, and its 27 others, most of them beside decoupling capacitors. A via that would come within the clearance of another net's pad is left out. The tracks are ECAD's own routing, not a copy of Raspberry Pi's. After the main routing passes, any connection still open is routed again after ripping up the routes near it.

`pnpm run example:rp2350a` regenerates it from `packages/core/src/examples/rp2350a.ts` in about two minutes and prints its DRC result. `--write` saves the design the app loads, and `ECAD_BOARD_SVG=<file>` writes a top view of the board as SVG.

## File format

A board is the `board` field of its drawing's `.ecaddraw` file, next to the schematic's `shapes` and the `circuit`, which this example leaves out:

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

The board belongs to the file's circuit and takes its name. A drawing without a `board` field has no PCB yet. `board.shapes` holds up to 50,000 items in the drawing shape format, the same as footprint items, plus:

| Field | Meaning |
| --- | --- |
| `layer: "Edge.Cuts"` | An outline item. |
| `layer: "In1.Cu"` to `"In30.Cu"` | A track, zone or copper shape on an inner layer. `rules.copperLayers` must include the layer: a 4-layer board has In1.Cu and In2.Cu. Boards saved without `copperLayers` have 2. |
| `net` | On a copper line (a track), via or zone: the circuit net ID. |
| `zone` | Makes a copper rectangle a zone. `clearance` optionally overrides the board clearance. `priority`, a whole number from 0 to 1000, sets the fill order: higher first, then list order. `outline` makes it a polygon zone: at least three corners `{ "x", "y" }` as fractions of the rectangle's width and height from -0.5 to 0.5 around its center, before rotation. Moving, turning and resizing the rectangle moves, turns and stretches the polygon. `padConnection` is `"thermal"` (the default) or `"solid"`, and `thermalGap` and `thermalSpokeWidth` optionally override the board's thermal sizes. |
| `kind: "symbol"` with `footprint` | A placed footprint. `children` are its items in footprint coordinates, `component` is the circuit component ID, and `flipped` marks a footprint on the back, whose children are already mirrored. |

## Code

`packages/drawing-core/src/board/` holds the headless model: `footprints.ts` places and flips footprints and lists their pads, `netlist.ts` maps pads to circuit nets, `connectivity.ts` groups copper and builds the ratsnest, `drc.ts` checks the rules and reads the outline, `sync.ts` brings a board up to date with its circuit, and `negotiated-route.ts` and `autoroute.ts` route on the grid `routing-grid.ts` builds. `packages/core/src/board/` adds the saved format, zone fills (`fill.ts`, which subtracts copper with Clipper), the flat view's display (`view.ts`), routing helpers, the Gerber writer and the schematic sync for an open document. `components/board/useBoardEditor.ts` connects them to `Editor2D`, which runs in board mode when the project opens a board.

Zone fills, the ratsnest and the design rules check run in a Web Worker (`board/analysis.worker.ts`), so the page stays responsive while they compute. `board/analysis-client.ts` sends the worker the shapes that changed since its last message, keyed by shape ID, and keeps one ratsnest request in the air during a drag, so the result always catches up with the pointer's last position. Fills are computed for the saved board and the ratsnest for the board as dragged. The same worker writes the fabrication files: it fills the zones of the board it already holds, writes the Gerber and drill files and packs the ZIP (`board/fabrication.ts`, loaded by the worker on the first export), then transfers the archive to the page, which only starts the download. Until the first result arrives the status reads **Checking connections**. If the worker cannot start or fails, or cannot load the Gerber writer, the same code runs in the page, which then loads the Gerber writer and the ZIP library on the first export. When the analysis itself fails on a board, the editor shows the error as a message, the status reads **Connections not checked**, and the last fills stay until an edit lets it run again.
