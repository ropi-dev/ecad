# Footprint editor

A footprint is a project file that describes what one component needs on a board: pads, silkscreen, courtyard and other layer graphics. Choose **Add file → New footprint** beside the project file list and enter a name. The app saves a `.ecadfp` file and opens it in the footprint editor.

The editor is the symbol editor's canvas with board layers added. Selection, dragging, resize handles, rotation, locks, copy and paste, undo and the history panel work as they do for symbols. Lengths are in millimetres, and the grid and rulers follow. **Fit drawing** (F6) fits the selection. With nothing selected it fits the whole footprint, hidden layers included, or a 4 by 3 mm area around the origin while the footprint is empty. The fitted footprint takes about half the view, which leaves the floating panels clear of it. A footprint opens fitted. The zoom percentage is absolute: 100% is 100 pixels per millimetre in the flat view and the 3D view alike, whatever the footprint held when it was opened. The zoom buttons, the wheel and pinch all range from 1% to 10000%. Edits save automatically with the project.

A click inside a hollow rectangle, circle or triangle picks the item under it, so a courtyard or body outline does not take clicks meant for the pads inside. Click anywhere on the outline's stroke to pick the outline. With nothing else under the pointer, a click inside still picks it, and inside nested outlines it picks the smallest.

A dragged or nudged pad keeps its centre on the grid, as the Pad tool places it. Other graphics keep a corner on the grid, as shapes do in the schematic.

MCP clients cannot edit a footprint yet. The desktop app's MCP endpoint leaves an open footprint out.

This editor is a first version. Footprints are not yet placed on a board, linked to symbols or checked against design rules, and there is no import or export for other tools' footprint formats.

## Layers

The **Layers** panel at the top left lists twelve layers: copper, silkscreen, solder mask, paste, courtyard and fabrication, each for the front and the back of the board. Colours follow KiCad's defaults.

Select a layer's name to make it the active layer. New graphics go on the active layer, and it draws on top of the others. The other layers draw in board order, with mask and paste under their copper so an opening shows as a rim around its pad. The eye button hides or shows a layer. Items on a hidden layer are not drawn and cannot be selected, and hiding a layer clears the selection. The active layer cannot be hidden, and making a hidden layer active shows it. Export includes hidden layers and draws every layer in board order, whichever layer is active. The number beside a layer counts its items.

Select an item and change **Layer** in Attributes to move it. A selection of several items moves together.

## Pads

Open **Pads** in the toolbar and choose **Surface mount pad** or **Through-hole pad**, then click to place one. The tool stays active, so each further click places the next pad. Pads number themselves from the highest whole pad number in the footprint. R rotates the pad before it is placed, and Escape returns to Select.

A surface mount pad starts as a 1 by 1.5 mm rectangle on the active copper layer, or on front copper when another layer is active. A through-hole pad starts as a 1.7 mm circle with a 1 mm drill. It has copper on both sides of the board, so it shows while either copper layer is visible and its Layer reads "Both copper layers".

Select a pad to edit its Pad number, Pad type, Pad shape, Drill, position and size in Attributes. A pad is a rectangle or a circle. A drill must be smaller than its pad, and the Drill field reverts a value that is not. Shrinking a through-hole pad below its drill shrinks the drill to 60% of the pad. Changing a back-side pad to through-hole and back keeps it on the back.

Pads do not yet add solder mask openings or paste. Draw them on the mask and paste layers where a footprint needs them.

## Wires and graphics

Open **Shapes** for Rectangle, Circle, Triangle, Wire and Text. A wire is a straight stroke on the active layer, at any angle. It forms no net. New graphics have a 0.15 mm stroke and new text is 1 mm tall. Rectangles, circles and triangles have a **Filled** checkbox in Attributes, for copper areas and solid markings.

Pasting from a schematic or symbol accepts rectangles, circles, triangles, lines and text, and puts items without a layer on the active layer. Pins, schematic wires, net labels and symbols are refused. Footprint items pasted into a schematic or symbol become plain shapes there, without their layer, pad or the pad's fill.

## 3D view

The toolbar's **2D** button is pressed in the flat view and disabled while the footprint is empty. If the footprint becomes empty while the 3D view is open, as when another program rewrites its file, the editor returns to the flat view. Press it to turn the camera into 3D. The view shows the footprint in the [Gerber viewer's](viewer.md) layer stack: front copper 0.8 mm above the board centre, back copper below it, mask, paste and silkscreen stacked outward, and through-hole drills as open barrels that cut through the other layers. A board edge is drawn 1 mm outside the footprint. **Fit drawing** fits that edge here, so the whole board stays in view at any orbit angle. Shift + drag orbits, as in the Gerber viewer. The Layers panel hides and shows layers here too.

The 3D view starts from the flat view's position and zoom, and the camera turns about the top of the layer stack, so a footprint that was in view stays in view. Pressing **2D** again turns the camera back and returns to editing where the flat view was. The drawing tools and the editing shortcuts are disabled while the 3D view is open, and hiding or showing a layer there keeps the camera where it is. If the board cannot be built, the view returns to 2D with a message. The courtyard and fabrication layers are drawings for people and are left out of the board, and text is not drawn in 3D yet.

## File format

A `.ecadfp` file is UTF-8 JSON:

```json
{
  "format": "ecad-footprint",
  "version": 1,
  "units": "mm",
  "id": "r-0805",
  "name": "R 0805",
  "description": "",
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
    },
    {
      "id": 2,
      "kind": "line",
      "layer": "F.SilkS",
      "x": 0,
      "y": 0.735,
      "width": 0.454,
      "height": 1,
      "rotation": 0,
      "lineWidth": 0.12
    }
  ]
}
```

`id` is 1 to 64 characters: a lowercase letter or digit first, then lowercase letters, digits, `.`, `_` or `-`. It comes from the name when the footprint is created. `name` is 1 to 100 characters. Unknown fields are rejected.

`shapes` holds up to 4096 items in the drawing shape format: positions are shape centres in millimetres with positive Y up, and `rotation` is in radians. A footprint accepts the kinds `rectangle`, `circle`, `triangle`, `line` and `text`. Pins, schematic wires, symbols, net labels and pages are rejected. Shape IDs must be unique.

| Field | Meaning |
| --- | --- |
| `layer` | `F.Cu`, `B.Cu`, `F.SilkS`, `B.SilkS`, `F.Mask`, `B.Mask`, `F.Paste`, `B.Paste`, `F.CrtYd`, `B.CrtYd`, `F.Fab` or `B.Fab`. An item without one is read as `F.SilkS` and saved with it. |
| `pad` | Makes a rectangle or circle a pad. `number` is up to 16 characters. `type` is `smd` or `through-hole`. A through-hole pad needs `drill`, a hole diameter in millimetres smaller than the pad. A surface mount pad must not have one. |
| `filled` | Fills a rectangle, circle or triangle with its layer's colour. A pad is always solid. |

The project manifest lists footprint paths in `footprints`. Web storage writes them as `footprints/<id>.ecadfp` in each revision, and desktop storage keeps them as visible files under `footprints/`. The desktop app watches them for changes from other programs like its other project files.

## Code

`packages/drawing-core/src/footprint/` holds the layer list, pad creation and edits, and `footprintLayerView`, which filters and orders shapes for the editor. The optional `layer` and `pad` fields are part of the shared shape schema in `packages/drawing-core/src/drawing/schema.ts`, so the drawing store, commands and history take footprint items unchanged. `packages/core/src/footprint/format.ts` validates the file, and `packages/core/src/footprint/board.ts` turns the shapes into the planar layers the board stack renders. `Editor2D` runs in footprint mode when the project opens a footprint: it adds `FootprintLayerPanel`, the pad tools and `FootprintBoardView`, which hands the board to `GerberViewer`. `pasteSelection` in `packages/core/src/drawing/clipboard.ts` takes a footprint destination. The viewport's `pixelsPerMmAt100` option fixes what 100% zoom means.
