# Footprint editor

A footprint is a project file that describes what one component needs on a board: pads, silkscreen, courtyard and other layer graphics. Choose **Add file → New footprint** beside the project file list and enter a name. The app saves a `.ecadfp` file and opens it in the footprint editor.

The editor is the symbol editor's canvas with board layers added. Selection, dragging, resize handles, rotation, locks, copy and paste, undo and the history panel work as they do for symbols. Lengths are in millimetres, and the grid and rulers follow. **Fit drawing** (F6) fits the selection. With nothing selected it fits the whole footprint, hidden layers included, or a 4 by 3 mm area around the origin while the footprint is empty. The fitted footprint takes about half the view, which leaves the floating panels clear of it. A footprint opens fitted. The zoom percentage is absolute: 100% is 100 pixels per millimetre in the flat view and the 3D view alike, whatever the footprint held when it was opened. The zoom buttons, the wheel and pinch all range from 1% to 10000%. Edits save automatically with the project.

A click inside a hollow rectangle, circle or triangle picks the item under it, so a courtyard or body outline does not take clicks meant for the pads inside. Click anywhere on the outline's stroke to pick the outline. With nothing else under the pointer, a click inside still picks it, and inside nested outlines it picks the smallest.

A dragged or nudged pad keeps its centre on the grid, as the Pad tool places it. Other graphics keep a corner on the grid, as shapes do in the schematic.

MCP clients cannot edit a footprint yet. The desktop app's MCP endpoint leaves an open footprint out.

A [PCB](pcb.md) places footprints on a board. There is no import or export for other tools' footprint formats.

## Built-in footprints and symbols

The app has a library of 62 built-in footprints adapted from KiCad's, such as 0805 chip resistors, SOT-23, pin headers and the QFN packages of the built-in microcontrollers. See the [default-footprints package](../packages/default-footprints/README.md) for the list and how they were converted. Built-in footprints are read-only.

A symbol placed in a schematic can name the footprint its component is soldered with. Select one placed symbol and choose it under **Footprint** in Attributes. The list has **None**, the project's footprints, and the built-in footprints grouped by their KiCad library. Undo restores the previous footprint. The symbol editor has no Footprint section, because a nested placement inside a symbol is not a component.

A new placement starts with its symbol definition's default footprint. Most built-in symbols have one, and several share it: the diodes all use SOD-123 and both battery symbols use the same coin cell holder. Power symbols, net symbols, Box and symbols without pins have no Footprint section. Placements saved before footprints existed have none until you choose one. Changing a definition's default does not change existing placements.

Pads match pins by number. A pin without a number takes its position among the symbol's pins, counting from 1, so a diode's K and A pins match pads 1 and 2. Below the list, Attributes says whether the pads match all pins, or names the pins without a pad and the numbered pads without a pin. Unnumbered pads, such as a switch's mounting lugs, are left out. A footprint missing from the project or the library shows as "(missing)" and keeps its reference.

For a project footprint, **Open footprint** opens it in the footprint editor. For a built-in one, **Copy to project** saves a copy as a new project footprint, which you can edit, and switches the selected symbol to the copy.

## Layers

The **Layers** panel at the top left lists thirteen layers: copper, silkscreen, solder mask, paste, courtyard and fabrication, each for the front and the back of the board, and the board outline (Edge.Cuts). Colours follow KiCad's defaults in the dark theme. The light theme darkens the ones that would vanish on light paper, such as silkscreen, courtyard and the board outline.

Select a layer's name to make it the active layer. New graphics go on the active layer, and it draws on top of the others. Selecting a layer also focuses it, as in the [Gerber viewer](viewer.md): the flat view draws the other layers in faded colours, and the 3D view shows them as X-ray film without their text and pad numbers. Select the active layer again to end the focus and draw every layer in full colour; it stays the active layer. Select it once more to focus it again. Selected and highlighted items keep their colours while another layer is focused. When routing changes the active layer, the focus moves with it. The other layers draw in board order, with mask and paste under their copper so an opening shows as a rim around its pad. The eye button hides or shows a layer. The two paste layers start hidden each time a footprint opens. Items on a hidden layer are not drawn and cannot be selected, and hiding a layer clears the selection. The active layer cannot be hidden, and making a hidden layer active shows it. The attributes panel marks hidden layers in its Layer field and will not move an item onto one, so an item cannot vanish by changing its layer. Export includes hidden layers and draws every layer in board order, whichever layer is active. The number beside a layer counts its items.

Select an item and change **Layer** in Attributes to move it. A selection of several items moves together.

## Pads

Open **Pads and vias** in the toolbar and choose **Surface mount pad** or **Through-hole pad**, then click to place one. The tool stays active, so each further click places the next pad. Pads number themselves from the highest whole pad number in the footprint. R rotates the pad before it is placed, and Escape returns to Select.

A surface mount pad starts as a 1 by 1.5 mm rectangle on the active copper layer, or on front copper when another layer is active. A through-hole pad starts as a 1.7 mm circle with a 1 mm drill. It has copper on both sides of the board, so it shows while either copper layer is visible and its Layer reads "Both copper layers".

Select a pad to edit its Pad number, Pad type, Pad shape, Corner radius, Solder paste, Hole, Drill, position and size in Attributes. A pad is a rectangle, a circle or an oval. Choosing Oval rounds a rectangle's corners to half its shorter side, so its short ends are half circles, as on connector shield legs. A rectangular pad's **Corner radius** rounds its corners. The pad stores the radius as a share of its shorter side, as KiCad's `roundrect_rratio` does, so resizing the pad scales the corners with it. A radius of half the shorter side or more makes the short ends fully round, and 0 squares the corners again. Copper, paste and mask openings, zone fill clearances, connections, DRC and Gerber export all follow the rounded outline. Changing the pad to a circle drops the rounding. A drill must be smaller than its pad, and the Drill field reverts a value that is not. Shrinking a through-hole pad below its drill shrinks the drill to 60% of the pad. Changing a back-side pad to through-hole and back keeps it on the back.

A through-hole pad's **Hole** is Round or Slot. A slot runs along the pad's width and turns with the pad, so resizing never turns it. Choosing Slot on a pad taller than it is wide first swaps its width and height and turns it a quarter, which leaves the copper where it was and puts the slot along the long side. The new slot is the longer of one with the same copper ring at its ends as at its sides and one reaching halfway from the drill to the edge, so a square or round pad gets the halfway slot. The Drill field then reads **Slot width**, and **Slot length** must be longer than the slot width and shorter than the pad's width. Shrinking the pad until the slot no longer fits refits it the same way. The drill file routes each slot with G85 between the centres of its round ends, using a tool of the slot's width.

A surface mount pad has a **Solder paste** checkbox in Attributes, on for new pads. While it is on, the pad adds an opening of its own size and shape to the paste layer on its copper side: F.Paste for a front pad, B.Paste for a back one. The opening follows the pad when it moves, resizes or changes side. The pad counts toward the paste layer in the Layers panel, stays visible while either its copper or its paste layer is shown, and appears on the paste layer in the 3D view once that layer is shown. The flat view draws it once, in copper colour. Through-hole pads have no paste setting, and changing a through-hole pad to surface mount turns paste on. In the realistic view, each pad opens the solder mask 0.05 mm past its copper. On a board, the Gerber export and the realistic view use the board's mask margin instead.

## Vias

A via is a plated hole that joins front and back copper, such as a thermal via under an exposed pad. Open **Pads and vias** and choose **Via**, then click to place one. Like the pad tools it stays active until Escape. A new via is a 0.6 mm circle with a 0.3 mm drill. It has copper on both sides and no number, and its Layer reads "Both copper layers". Hiding one copper layer leaves vias visible on the other.

Select a via to edit its Drill, position and radius in Attributes. The drill must be smaller than the via, and the Drill field reverts a value that is not. Shrinking a via below its drill shrinks the drill to 60% of the via. A via is always solid and keeps its centre on the grid. In the 3D view its drill is an open barrel through the board, like a through-hole pad's.

Vias are tented: they add no mask opening. Pasted into a schematic or symbol, a via becomes a plain circle.

## Unplated holes

An unplated hole is drilled through the board with no copper, such as a mounting hole. Open **Pads and vias** and choose **Unplated hole**, then click to place one. A new hole is a 3.2 mm circle with a 3.2 mm drill, for an M3 screw. The circle is the hole's solder mask opening on both sides, and its Layer reads "Through the board". Hiding both mask layers hides it.

Select a hole to edit its Drill, position and radius in Attributes. The drill can be smaller than the circle, which leaves a ring of bare laminate around it. A drill larger than the circle widens the circle to match, and shrinking the circle below the drill shrinks the drill with it. On a board, copper keeps the board clearance from the circle. The flat view draws the drill with a mask-coloured edge; the 3D view drills the board without plating.

The built-in MountingHole_2.7mm_M2.5 and MountingHole_3.2mm_M3 footprints are a single hole each, from KiCad's generic mounting holes.

## Wires and graphics

Open **Shapes** for Rectangle, Circle, Triangle, Wire and Text. A wire is a straight stroke on the active layer, at any angle. It forms no net. New graphics have a 0.15 mm stroke and new text is 1 mm tall. Rectangles, circles and triangles have a **Filled** checkbox in Attributes, for copper areas and solid markings.

Text can show values of the component a footprint is placed for. On a board, `${REFERENCE}` reads as the component's reference, such as R1, `${VALUE}` as its value and `${FOOTPRINT_NAME}` as the footprint's name, and they change when the schematic does. The footprint editor shows the variables as typed, and Attributes lists them under the text. Other text in `${...}` stays as written. A footprint with `${REFERENCE}` in its silkscreen text gets no separate reference label when it is placed. One with `${REFERENCE}` only on another layer, such as fabrication, keeps the label.

Pasting from a schematic or symbol accepts rectangles, circles, triangles, lines and text, and puts items without a layer on the active layer. Pins, schematic wires, net labels and symbols are refused. Footprint items pasted into a schematic or symbol become plain shapes there, without their layer, pad or the pad's fill.

## 3D view

The toolbar's **2D** button is pressed in the flat view. Press it to turn the camera into 3D, or use Shift + middle-drag, Shift + two-finger scroll on a trackpad, or Alt + Shift + left-drag in the flat view to orbit straight out of it. As in the Gerber viewer, the orbit starts after 4 px of movement, from the current camera. Shift + left-drag keeps adding to the selection in the flat view, which is why left-drag orbit needs Alt there. Once the board is turned, Shift + drag, Shift + middle-drag, and Shift + two-finger scroll orbit, middle-drag and two-finger scroll pan, and the mouse wheel or pinch zooms toward the pointer. The view shows the footprint in the [Gerber viewer's](viewer.md) layer stack: front copper 0.8 mm above the board centre, back copper below it, mask, paste and silkscreen stacked outward, and through-hole drills as open barrels that cut through the other layers. Courtyard and fabrication drawings have no thickness. They lie flat just outside the stack, front ones above the front silkscreen and back ones below the back silkscreen. Text is drawn on its layer's surface. Pad numbers float over each side's copper, outside the courtyard and fabrication drawings so no line covers them, in the same size and colour as the flat view: on the front for a front pad, on the back for a back pad, and on both sides for a through-hole pad. Back numbers are mirrored, so they read correctly once the board is turned over side to side, and no number shows through the board or a drill. They hide with their copper layer. A board edge is drawn 1 mm outside the footprint, or around a 4 by 3 mm area while the footprint is empty. **Fit drawing** fits the selection, or that edge with nothing selected, so the whole board stays in view at any orbit angle. The Layers panel hides and shows layers here too.

The 3D view starts from the flat view's position and zoom, and the camera turns about the front silkscreen's surface, so a footprint that was in view stays in view. Pressing **2D** again turns the camera back and returns to the flat view at the place the 3D view was looking at. The selection and the active tool carry over both ways, and keyboard focus stays on the **2D** button. If the board cannot be drawn, for example after the graphics context is lost, the view starts again in 2D with a message. If it cannot be built, the flat view stays and the **2D** button is disabled until an edit lets the board build.

### Editing in 3D

Selecting, moving and placing work in 3D as they do in the flat view. Click an item to select it, drag it to move it, and drag its handles to resize it. Drag empty space for a selection rectangle, which picks by what it covers on screen. The pad, shape and text tools place on the active layer, and a pad or text being placed shows as an outline under the pointer. Arrow keys, R, Delete, Alt + drag, copy and paste, undo and the Attributes panel all work. The board follows a drag as it happens. The flat drawing is not rebuilt while the 3D view is open.

The pointer is read on the surface of the layer an item is on, so an item stays under the pointer while it is dragged, whatever its height. A click picks the item on the surface nearest the camera. An item on the far side can be picked where nothing nearer covers it, and a selection rectangle picks items on both sides. Turn the board over or hide the layers in the way to reach a covered one. A through-hole pad is picked and outlined on whichever side is nearer the camera. A selection rectangle leaves out an item that reaches behind the camera. Selected items have an outline in the accent colour, since the board keeps each layer's own colour.

Shift + drag orbits, as in the Gerber viewer, so Shift alone does not add to the selection here. Ctrl or Cmd + click still toggles an item, and Ctrl or Cmd + Shift + click still removes one. Shift pressed after a selection rectangle has started adds to the selection, as in the flat view. On a touchscreen a one-finger drag selects and moves, so choose the Pan tool to orbit with one finger. The X and Y readout sits beside the axis indicator and reads the pointer on the active layer.

In a nearly edge-on view the pointer has no place on the board above the horizon, or within about one degree below it, where a pixel covers a long stretch of board. The readout is empty there, the placement outline hides, and a click with a pad, shape or text tool places nothing. With the Select tool a click there clears the selection, as a click on any empty space does, and a drag that starts there still draws a selection rectangle.

## Realistic board and 3D models

The sparkle button in the Layers panel header shows the board as manufactured, in the flat view and in 3D: green solder mask with openings over the pads, gold copper and white silkscreen. While it is on, the cube button beside it shows or hides the footprint's 3D model, the component's body sitting on its pads. Models start shown. The cube button only appears while the board is realistic.

A footprint links its model under **3D model** in the document bar. The list has **No 3D model** and the built-in models grouped by KiCad library. The choice saves with the project and shows on the board at once. Each built-in footprint links the model of its own package from the [built-in 3D model library](../packages/default-models/README.md), and **Copy to project** keeps the link. Models are read-only, and there is no import for other models yet.

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

`id` is 1 to 64 characters: a lowercase letter or digit first, then lowercase letters, digits, `.`, `_` or `-`. It comes from the name when the footprint is created. `name` is 1 to 100 characters. `model` is optional and links the footprint's 3D model by the model's ID. `builtin` is its only library. Unknown fields are rejected.

`shapes` holds up to 4096 items in the drawing shape format: positions are shape centres in millimetres with positive Y up, and `rotation` is in radians. A footprint accepts the kinds `rectangle`, `circle`, `triangle`, `line` and `text`. Pins, schematic wires, symbols, net labels and pages are rejected. Shape IDs must be unique.

| Field | Meaning |
| --- | --- |
| `layer` | `F.Cu`, `B.Cu`, `F.SilkS`, `B.SilkS`, `F.Mask`, `B.Mask`, `F.Paste`, `B.Paste`, `F.CrtYd`, `B.CrtYd`, `F.Fab`, `B.Fab` or `Edge.Cuts`. An item without one is read as `F.SilkS` and saved with it. |
| `pad` | Makes a rectangle or circle a pad. `number` is up to 16 characters. `type` is `smd` or `through-hole`. A through-hole pad needs `drill`, a hole diameter in millimetres smaller than the pad. A surface mount pad must not have one. `paste: true` on a surface mount pad adds a paste opening the size of the pad on its side's paste layer. A through-hole pad must not have `paste`. `cornerRatio` rounds a rectangular pad's corners: the radius is that share of the pad's shorter side, above 0 and at most 0.5. A circular pad must not have it, and 0.5 makes an oval. `slot` on a through-hole pad makes its hole a slot that many millimetres long along the pad's width (its x axis before rotation), with `drill` as the slot's width. It must be longer than `drill` and shorter than the pad's width. A surface mount pad must not have one. |
| `via` | Makes a circle a via. `drill` is the hole diameter in millimetres, smaller than the circle. A pad cannot also be a via. |
| `hole` | Makes a circle an unplated hole. `drill` is the hole diameter in millimetres, at most the circle. The circle is the mask opening on both sides, its `layer` is `F.Mask` or `B.Mask`, and it has no `net`. A pad or via cannot also be a hole. |
| `filled` | Fills a rectangle, circle or triangle with its layer's colour. A pad is always solid. |

A placed symbol stores its footprint as `footprint`, such as `{ "library": "builtin", "id": "r_0805_2012metric" }`. `library` is `builtin` for the built-in library or `project` for a footprint file in the open project, and `id` is the footprint's `id`. A symbol file's optional `footprint` field has the same shape and sets the default for new placements. See [Symbol files](symbol-format.md).

The project manifest lists footprint paths in `footprints`. Web storage writes them as `footprints/<id>.ecadfp` in each revision, and desktop storage keeps them as visible files under `footprints/`. The desktop app watches them for changes from other programs like its other project files.

## Code

`packages/drawing-core/src/footprint/` holds the layer list, pad, via and unplated hole creation and edits, and `footprintLayerView`, which filters and orders shapes for the editor. Its `reference.ts` has the footprint reference schema and `matchPinsToPads`. Its `text-variables.ts` resolves the text variables. `symbolShapes` and `symbolChildren` apply them to a footprint placed on a board and scale the text box to the new length, so the flat view, the 3D view and hit testing see the same text. An edit to that text, such as a new font size, is saved against the variables, so they keep working. `packages/core/src/footprint/library.ts` loads `@ecad/default-footprints` on demand, and `SymbolFootprintField` in `components/editor/` is the Attributes panel's Footprint section. The optional `layer`, `pad`, `via` and `hole` fields are part of the shared shape schema in `packages/drawing-core/src/drawing/schema.ts`, so the drawing store, commands and history take footprint items unchanged. `packages/core/src/footprint/format.ts` validates the file, and `packages/core/src/footprint/board.ts` turns the shapes into the planar layers the board stack renders. `Editor2D` runs in footprint mode when the project opens a footprint: it adds `FootprintLayerPanel`, the pad and via tools, and `FootprintBoardView`, which hands the board to `GerberViewer`. The flat view and the 3D view are one `GerberViewer` viewport. Its `updateFlatScene` option adds the editor's flat drawing, which shows in place of the board layers until an orbit starts, so the Gerber viewer's orbit gesture, camera turn and return to the top view all apply. `orbitGesture="alt-shift"` makes that gesture need Alt as well as Shift while the view is flat. `pasteSelection` in `packages/core/src/drawing/clipboard.ts` takes a footprint destination. The viewport's `pixelsPerMmAt100` option fixes what 100% zoom means. Layer focus lives in `useFootprintLayers`. `buildStaticDisplay` and `buildBoardStaticDisplay` take the focused layer and mark each display off it as `dimmed`. The drawing renderer keeps a second set of materials for those, in `unfocusedLayerColor`, which is 30% of the layer colour over the desk colour. In the footprint and PCB editors the renderer makes every material transparent, so three.js draws all items from one queue in layer order. Otherwise it would draw every opaque item before any text or rounded shape, and a back-side label could show through front copper. `FootprintBoardView` hands `GerberViewer` the focused layer's board objects as `focusedLayerIds`.

The model reference schema is `modelReferenceSchema` in `packages/drawing-core/src/footprint/model.ts`. `packages/core/src/footprint/models.ts` loads `@ecad/default-models` on demand and turns the open footprint, or a board's placed footprints, into `ModelPlacement`s: a model with a position, rotation and side. `useFootprintModels` in `components/footprint/` loads the three.js side, `packages/core/src/engine/footprint-models.ts`, only once the realistic board shows models. It loads each model's glTF file once with three.js's `GLTFLoader` and gives every placement a copy that shares the file's geometry and materials. A copy sits on the top copper, or turned over about the Y axis under the bottom copper for a flipped footprint, which mirrors it the way flipping mirrors the footprint's items. `GerberViewer` takes the copies as `models` and draws them while the board is realistic. `FootprintModelField` is the document bar's **3D model** list, and the project action `saveFootprintModel` writes the field.

The 3D view runs the same gestures, commands and session as the flat view. Three things differ:

- **Pointer mapping.** While the camera is turned, the viewport's `onChange` snapshot carries `projection`, the camera's world to clip matrix. `viewMapping` in `packages/core/src/engine/view-projection.ts` maps between a canvas pixel and a point on the plane at a given height, with a ray cast by three.js for a turned view and the flat camera otherwise. A ray that meets the plane at a slope under `MIN_GRAZING_SLOPE` (0.02) has no point, and the viewport uses the same constant to decide when a turned camera has no centre on the board. The editor's canvas view wraps it in one `CanvasProjection` (`components/editor/canvasView.ts`), which also answers an item's height, the hit-test order and `inScreenBox`, the selection rectangle test. A selection rectangle is in canvas pixels in both views: the flat view maps it to drawing coordinates, and the 3D view tests it against each item's projected outline. A drag step therefore needs no point on the board for a rectangle, so one can start where the pointer has none. The flat view and the 3D view both provide the projection, so `useCanvasGestures` runs one code path. `Editor2D` gives the canvas view the layer heights from `layerSurfaceZ` in `board.ts` while the 3D view is open. `shapeAt` takes a point per shape, so one click tests each item on its own surface.
- **Board updates.** `planFootprintBoard` lists the board's layers with the shapes each is built from. `createBoardBuilder` in `board.ts` leaves a layer alone while its shapes are unchanged and hands a changed layer its previous build. `createBoardObjects` in `board-objects.ts` compiles each item once (`engine/planar-parts.ts`) and writes it into the layer's vertex buffers at its own position. It does not merge overlapping items into one outline. They share a colour and the board view draws its layers opaque, so the filled surfaces look the same. Each item keeps the side walls of its own outline, which sit under the surface where items overlap. A layer whose items only moved keeps its buffers. The moved items are rewritten in place and only that range is uploaded again, so a drag costs a few vertex writes and the viewport keeps its scene. Text and pad numbers are one mesh per layer and move the same way. A layer whose items were added, removed or resized is built again, and `FootprintBoardView` frees the replaced layer after the commit that shows the board without it, since the viewport draws the old layer until then. `SceneViewport`'s `keepView` swaps a new layer into the running viewport through `setScene` and keeps the camera and the WebGL context. The mask that cuts drill holes through the other layers redraws only the area a moved hole left and entered, then uploads the whole texture: three's partial texture upload assumes four bytes per pixel and the mask has one. The mask reaches at least 1 mm past the drills, and a hole that moves outside it gets a new mask. Board layers carry no pick regions, because the editor does its own hit testing; the viewport's hover and selection stay off for them.
- **Overlay.** `CanvasOverlay` places the handles through the same projection and draws the selection and the placement preview as SVG outlines. The projection's `screenOutline` gives an item's outline in canvas pixels, from `shapeOutline` in `packages/core/src/footprint/outline.ts`, or nothing when part of it is behind the camera. The 3D selection rectangle tests the same outline with `outlineInBox`.
