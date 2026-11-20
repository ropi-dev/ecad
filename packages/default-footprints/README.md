# `@ecad/default-footprints`

Offline generator for ECAD's **64 built-in footprints**. It has zero runtime dependencies and loads on demand when the editor inspects or places footprints.

```ts
import { generateDefaultFootprints } from "@ecad/default-footprints";

const footprints = generateDefaultFootprints();
// Each entry has the KiCad library name as `category` and a portable `.ecadfp` `file`.
```

Every call returns fresh arrays and objects conforming to the [footprint file format](../../docs/footprints.md#file-format-ecadfp). Footprint IDs are lowercased KiCad names (for example `r_0805_2012metric`).

## Catalog

Covers default footprints for built-in symbols plus common alternatives and RP2350A reference parts:

- **SMD passives & LEDs** — 0402, 0603, 0805, 1206 resistors/capacitors; 0603/0805/1206 inductors; 1206 fuse; 0603/0805 LEDs.
- **Through-hole & special passives** — Axial resistor, radial/disc/SMD electrolytic/trimmer capacitors, HC49/3215/3225 crystals, trimmer pot, photoresistor, buzzer.
- **Diodes & discrete semiconductors** — SOD-123, SOD-323, SMA, DO-41, 3 mm/5 mm LEDs, SOT-23, SOT-23-5, SOT-89-3, SOT-223, TO-92, TO-220.
- **ICs, connectors & mechanical** — SOIC-8 (208 mil), QFN-16/40/48/52/56/60/80 (with exposed pads), USB Micro-B, coin cell holders, switches, 2/3/4/8/20-pin headers, M2.5/M3 unplated mounting holes, and Raspberry Pi RP2350A vendor parts (Amphenol Micro-B, Samtec 2×18 header, JST SH 3-pin, Würth tactile switch, SOT-223 with tab pad 4, Abracon 2016 inductor).

Pads match symbol pins by number (or 1-based position for unnumbered pins), verified by `tests/symbol-footprints.test.ts`. Nordic QFN packages use generic KiCad footprints matching body/pitch/pin count—verify against Nordic's package drawings before fabrication. JFETs, transformers, antennas, variable resistors, power/net symbols, Box, and Nordic CSP/WLCSP packages have no default footprint.

## Exporting `.ecadfp` files

From the repository root:

```bash
pnpm run footprints:generate /absolute/path/to/output
```

Without a path, writes to `packages/default-footprints/generated` along with license/attribution files, refusing to overwrite existing files.

## Source, conversion, and extending

- `src/catalog.ts` and `src/raspberry-pi-minimal.ts` store footprints in KiCad units (mm, Y down, degrees); the generator flips Y and converts angles to radians.
- Each footprint (except the two mounting holes) links its 3D model from [`@ecad/default-models`](../default-models/README.md) via `src/models.ts`.
- Exposed pad paste windows export as explicit `F.Paste` rectangles; custom pads expand to multi-rectangle pads sharing a pad number; arcs tessellate at ≤ 15°; text is omitted.
- To add a footprint: add a catalog entry, link its model if applicable, update [NOTICE.md](NOTICE.md), and run `pnpm --filter @ecad/default-footprints test` and `pnpm exec tsx --test tests/symbol-footprints.test.ts`.

## License

KiCad-derived footprints use **CC BY-SA 4.0** with KiCad's electronic-design exception; Raspberry Pi footprints (`src/raspberry-pi-minimal.ts`) use Raspberry Pi's **MIT license**. See [LICENSE.md](LICENSE.md), [CC-BY-SA-4.0.txt](CC-BY-SA-4.0.txt), and [NOTICE.md](NOTICE.md).
