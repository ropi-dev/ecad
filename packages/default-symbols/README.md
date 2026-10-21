# Default schematic symbols

`@ecad/default-symbols` generates the schematic editor's 45 built-in symbols. It has no runtime dependencies and works offline in web, desktop, and Node builds.

```ts
import { generateDefaultSymbols } from "@ecad/default-symbols";

const symbols = generateDefaultSymbols();
// Each entry has a `category`, portable .ecadsym `file`, and instance `texts`.
```

The picker groups symbols into Passives, Diodes, Transistors, Switches, Power, Connectors, Amplifiers, and Other components. Imported and project symbols appear under Custom symbols. Empty groups stay hidden. Opening the picker focuses its search field, which filters names, descriptions, values, reference prefixes, IDs, and categories. Library upload and configuration controls stay on Projects. Categories are editor metadata and do not change the portable file format.

Every call returns new arrays and objects. The editor converts the portable files to its drawing shapes and uses the reference and value labels for placement. Existing drawings keep their embedded geometry.

The library includes IEC and US resistors, variable resistors, potentiometers, thermistors, photoresistors, capacitors, polarized and variable capacitors, inductors, ferrite beads, transformers, crystals, fuses, rectifier and Schottky diodes, Zener and TVS diodes, LEDs, photodiodes, NPN and PNP transistors, N-channel and P-channel MOSFETs and JFETs, SPST and SPDT switches, push buttons, batteries, ground and supply symbols, connectors with 2, 3, 4 or 8 pins, an operational amplifier, a speaker, a buzzer, and an antenna.

## Export files

From the repository root:

```bash
npm run symbols:generate -- /absolute/path/to/output
```

Without a directory argument, the command writes to `packages/default-symbols/generated`. It writes one JSON `.ecadsym` file per symbol and copies the license and attribution documents. It refuses to overwrite existing files. Use a new directory when regenerating a collection.

Generated files use reserved built-in IDs. To import an edited copy as a custom symbol, change its ID to a unique name such as `custom.diode`. Version 1 `.ecadsym` files preserve geometry and pin names but cannot store the instance labels in `texts`.

## Geometry and source

The checked-in [catalog](src/catalog.ts) contains a subset of the KiCad symbol libraries at a pinned commit. [NOTICE.md](NOTICE.md) lists the sources and adaptations. No KiCad installation or download is needed to generate symbols.

The generator converts 50 mils to 1 mm so terminals land on the editor's 1 mm grid. It rotates two-terminal passive symbols to a horizontal orientation. The original `resistor`, `capacitor`, and `ground` definitions retain their existing order, dimensions, values, and label positions.

The editor's version 1 format has no arcs, filled polygons, pin numbers, or electrical pin types. The generator approximates arcs with line segments spanning at most 15 degrees, draws polygons as outlines, and stores each terminal's KiCad pin name. Unnamed terminals use the source pin number as their name. The operational amplifier uses the LM321 pin layout and adds drawn input polarity marks because the editor does not render pin names.

To extend the collection, add a source entry with a stable ID and grid-aligned terminals to `src/catalog.ts`. Keep its KiCad source in the entry's `source` field and update the attribution. Run `npm test --workspace @ecad/default-symbols`, the repository tests, and the `default-symbols` performance scenario.

The symbol collection uses the KiCad library license, CC BY-SA 4.0 with its electronic-design exception. See [LICENSE.md](LICENSE.md) and [CC-BY-SA-4.0.txt](CC-BY-SA-4.0.txt).
