# Default footprints

`@ecad/default-footprints` generates the 56 built-in footprints that symbols can use. Like `@ecad/default-symbols`, it has no runtime dependencies and works offline.

```ts
import { generateDefaultFootprints } from "@ecad/default-footprints";

const footprints = generateDefaultFootprints();
// Each entry has the KiCad library name as its `category` and a portable .ecadfp `file`.
```

Every call returns new arrays and objects. The files use the [footprint file format](../../docs/footprints.md#file-format), so `footprintFileSchema` in `packages/core/src/footprint/format.ts` accepts them unchanged. A footprint's ID is its KiCad name in lower case, such as `r_0805_2012metric`. The editor loads the collection on demand, the first time the Attributes panel shows a component's footprint.

The collection covers the default footprint of every built-in symbol that has one, plus common alternatives:

- 0402, 0603, 0805 and 1206 chip resistors and capacitors, 0603, 0805 and 1206 inductors, a 1206 fuse, and 0603 and 0805 LEDs
- an axial resistor, radial and disc capacitors, an SMD electrolytic capacitor and a trimmer capacitor
- SOD-123, SOD-323 and SMA diodes, a DO-41 diode, and 3 mm and 5 mm LEDs
- SOT-23, SOT-23-5, SOT-89-3, SOT-223, TO-92 and TO-220 packages
- an HC49 crystal, a 3215 watch crystal, a 3225 four-pin crystal, a SOIC-8 208 mil package, a USB Micro-B receptacle, a trimmer potentiometer, a photoresistor, a buzzer, two coin cell holders, three switches and 2, 3, 4, 8 and 20 pin headers
- QFN-16, QFN-40, QFN-48, QFN-52, QFN-56, QFN-60 and QFN-80 packages with exposed pads

Symbols name their default footprint by ID in `src/catalog.ts`, `src/microcontrollers.ts`, `src/nordic.ts` and `src/legacy.ts` of `@ecad/default-symbols`. Several symbols share one footprint. The diodes all use SOD-123, the battery symbols share a coin cell holder, and the speaker uses the 2-pin header. Pads match pins by number. A pin without a number takes its position among the symbol's pins, counting from 1, as circuit components do, so the diode's K and A pins are pads 1 and 2. `tests/symbol-footprints.test.ts` checks that every default footprint has exactly one pad number for each pin.

The bipolar transistor symbols have pins B, C and E in that order, so they default to SOT-89-3, which has that pinout in parts such as the BCX56. The MOSFET symbols are G, S and D, the order of a SOT-23 MOSFET. The JFET symbols, the transformer, the antenna, the variable resistor, the power and ground symbols and Box have no default, because no standard package fits their pins. The nRF54L15 CSP and the nPM2100 WLCSP have none either. Their ball maps are specific to Nordic, which does not publish land patterns.

The Nordic QFN parts use KiCad's generic footprints for the same body, pitch and pin count: QFN-40 5 x 5 mm with a 3.6 mm exposed pad and QFN-48 6 x 6 mm with a 4.6 mm pad, the sizes KiCad's own nRF52 symbols use, VQFN-52 6 x 6 mm with a 4.7 mm pad, and, for the nPM2100, QFN-16 4 x 4 mm at 0.65 mm pitch with a 2.1 mm pad. Check these against Nordic's package drawings before ordering boards. The Raspberry Pi chips use the footprints KiCad's RP2040, RP2350A and RP2350B symbols name.

## Export files

From the repository root:

```bash
pnpm run footprints:generate /absolute/path/to/output
```

Without a directory argument, the command writes to `packages/default-footprints/generated`. It writes one JSON `.ecadfp` file per footprint and copies the license and attribution documents. It refuses to overwrite existing files.

## Source and conversion

[`src/catalog.ts`](src/catalog.ts) holds the footprints in KiCad's units and axes: millimetres, Y down, angles in degrees. A one-off script turned the `.kicad_mod` files at the commit in [NOTICE.md](NOTICE.md) into these entries, and the generator turns them into editor shapes. It flips the Y axis and converts angles to radians.

The editor has rectangle and circle pads, so rounded rectangle and oval pads become rectangles, or circles when an oval is round. A custom pad, such as the SOT-89 tab or the chamfered corner pads of a QFN, becomes one rectangle per part with the same pad number. Pads have no solder mask openings yet. Surface mount pads keep their paste setting. Where KiCad splits an exposed pad's paste into windows, the pad has no paste and the windows become filled rectangles on F.Paste. Arcs become lines of at most 15 degrees each. Filled pin 1 triangles become triangle shapes, and other polygons become outlines. Text and 3D models are left out.

To add a footprint, convert its `.kicad_mod` file into a catalog entry with the same item kinds, add it to NOTICE.md, and run `pnpm --filter @ecad/default-footprints test` and `tests/symbol-footprints.test.ts`.

The collection uses the KiCad library license, CC BY-SA 4.0 with its electronic-design exception. See [LICENSE.md](LICENSE.md) and [CC-BY-SA-4.0.txt](CC-BY-SA-4.0.txt).
