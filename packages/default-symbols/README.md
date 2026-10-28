# Default schematic symbols

`@ecad/default-symbols` generates the schematic editor's 49 built-in symbols. It has no runtime dependencies and works offline in web, desktop, and Node builds.

```ts
import { generateDefaultSymbols } from "@ecad/default-symbols";

const symbols = generateDefaultSymbols();
// Each entry has a `category`, portable .ecadsym `file`, and instance `texts`.
```

The picker groups symbols into Passives, Diodes, Transistors, Switches, Power, Connectors, Amplifiers, Microcontrollers, Other components, and Annotations. Imported and project symbols appear under Custom symbols. Empty groups stay hidden. Opening the picker focuses its search field, which filters names, descriptions, values, reference prefixes, IDs, and categories. Library upload and configuration controls stay on Projects. Categories are editor metadata and do not change the portable file format.

Every call returns new arrays and objects. The editor converts the portable files to its drawing shapes and uses the reference and value labels for placement. Existing drawings keep their embedded geometry.

The library includes IEC and US resistors, variable resistors, potentiometers, thermistors, photoresistors, capacitors, polarized and variable capacitors, inductors, ferrite beads, transformers, crystals, fuses, rectifier and Schottky diodes, Zener and TVS diodes, LEDs, photodiodes, NPN and PNP transistors, N-channel and P-channel MOSFETs and JFETs, SPST and SPDT switches, push buttons, batteries, ground and supply symbols, connectors with 2, 3, 4 or 8 pins, an operational amplifier, a speaker, a buzzer, an antenna, and RP2040, RP2350A, and RP2350B microcontrollers.

Box is an annotation with a rectangle border and editable text. Its origin is the rectangle's top-left corner. The rectangle defines the symbol's dimensions and stays unselectable, including when Select locked items is on.

Select Box to change its dimensions, line style, or line width. Dragging the border moves the whole Box. Resize handles keep the text's local offset and font size. Moving the top or left edge carries the text with that corner; moving the bottom-right handle leaves the corner and text fixed.

Text starts 1 mm inside the top-left corner, at local X = 1 and Y = -1, with left and top alignment. Select the text block to edit its content, position, size, or alignment. Box has no pins or visible reference and value labels. Each placement saves its own edits.

## Export files

From the repository root:

```bash
npm run symbols:generate -- /absolute/path/to/output
```

Without a directory argument, the command writes to `packages/default-symbols/generated`. It writes one JSON `.ecadsym` file per symbol and copies the license and attribution documents. It refuses to overwrite existing files. Use a new directory when regenerating a collection.

Generated files use reserved built-in IDs. To import an edited copy as a custom symbol, change its ID to a unique name such as `custom.diode`. Version 1 `.ecadsym` files preserve geometry and pin names but cannot store the instance labels in `texts`.

## Geometry and source

The checked-in [catalog](src/catalog.ts) and [microcontrollers](src/microcontrollers.ts) contain a subset of the KiCad symbol libraries at pinned commits. [NOTICE.md](NOTICE.md) lists the sources and adaptations. No KiCad installation or download is needed to generate symbols.

The generator converts 50 mils to 1 mm so terminals land on the editor's 1 mm grid. It rotates two-terminal passive symbols to a horizontal orientation. Picker thumbnails load near the visible part of the scroll list and show a fixed-size skeleton while waiting. The SVG renderer loads on demand. Thumbnails omit pin markers and text smaller than one pixel. Placed symbols keep their complete geometry and labels. The original `resistor`, `capacitor`, and `ground` definitions retain their existing order, dimensions, values, and label positions.

The editor's version 1 format has no arcs, filled polygons, or electrical pin types. The generator approximates arcs with line segments spanning at most 15 degrees, draws polygons as outlines, and stores each terminal's KiCad pin name. Unnamed terminals use the source pin number as their name. Microcontrollers preserve package pin numbers, including the exposed ground pad. Chip bodies have an opaque dark blue-grey fill behind their teal outlines and labels. Each chip pin owns its exposed terminal, 2 mm lead, name, and package number. The chips contain one body rectangle and one pin item per package pin, with 2 mm between rows. The editor centers each 1.27 mm name label on its pin inside the body and places the 1 mm package number above the lead outside the body. The operational amplifier uses the LM321 pin layout and adds drawn input polarity marks beside its pin labels.

To extend the collection, add a source entry with a stable ID and grid-aligned terminals to `src/catalog.ts`. Keep its KiCad source in the entry's `source` field and update the attribution. Run `npm test --workspace @ecad/default-symbols`, the repository tests, and the `default-symbols` performance scenario.

The symbol collection uses the KiCad library license, CC BY-SA 4.0 with its electronic-design exception. See [LICENSE.md](LICENSE.md) and [CC-BY-SA-4.0.txt](CC-BY-SA-4.0.txt).
