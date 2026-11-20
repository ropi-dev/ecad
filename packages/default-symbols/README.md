# `@ecad/default-symbols`

Offline generator for ECAD's **66 built-in schematic symbols**. It has zero runtime dependencies and runs in web, desktop, and Node builds.

```ts
import { generateDefaultSymbols } from "@ecad/default-symbols";

const symbols = generateDefaultSymbols();
// Each entry has `category`, portable `.ecadsym` `file`, instance `texts`, and optional `packaging`.
```

Every call returns fresh arrays and objects. Most entries declare a default footprint from [`@ecad/default-footprints`](../default-footprints/README.md) in `file.footprint`.

## Catalog and packaging

The symbol picker groups built-in symbols into **Passives**, **Diodes**, **Transistors**, **Switches**, **Power**, **Connectors**, **Amplifiers**, **Microcontrollers**, **Other components**, and **Annotations** (custom libraries appear under **Custom symbols**).

- **Catalog highlights** — IEC/US resistors, variable resistors, potentiometers, thermistors, photoresistors, capacitors (standard, polarized, variable), inductors, ferrite beads, transformers, crystals (2-pin and 4-pin), fuses, rectifier/Schottky/Zener/TVS diodes, LEDs, photodiodes, NPN/PNP BJTs, N/P-channel MOSFETs and JFETs, SPST/SPDT/push-button switches, batteries, ground/supply symbols, 2/3/4/8/20-pin connectors, USB Micro-B, W25Q128JVS QSPI flash, AMS1117-3.3 regulator, LM321-style op amp, speaker, buzzer, antenna, RP2040, RP2350A/B, Nordic nRF54L15/nRF54L10/nRF54L05 (all packages), nPM2100 (QFN & WLCSP), and **Box**.
- **Package submenus** — Multi-package chips group into one picker row with a keyboard-navigable submenu (`Enter`/`Right Arrow` to open, `Left Arrow`/`Escape` to close): `nRF54L15` (QDAA, QFAA, QGAA, CAAA), `nRF54L10`/`nRF54L05` (QDAA, QFAA, QGAA), `nPM2100` (QEAA, CAAA), `RP2350` (RP2350A, RP2350B), and `RP2040`.
- **Box annotation** — Unpinned rectangle border + editable multiline text (origin at top-left corner; text anchored at `(1, -1)` mm). Border defines dimensions; dragging the border moves the box while resize handles preserve text offset and font size.

## Attributes

Every non-net component symbol defines four attributes in `file.attributes`: `Manufacturer`, `Part number`, `Datasheet`, and `Distributor part number`. Single-vendor parts (RP2040, RP2350A/B, nRF54L/nPM2100, W25Q128JVS, AMS1117-3.3, Molex USB Micro-B) prefill the first three; generic parts leave them empty. Ground/supply symbols and Box define no extra attributes.

## Exporting `.ecadsym` files

From the repository root:

```bash
pnpm run symbols:generate /absolute/path/to/output
```

Without a path, writes to `packages/default-symbols/generated`. Writes one `.ecadsym` per symbol plus license/attribution files, refusing to overwrite existing files. To import an edited copy as a custom symbol, change its reserved built-in `id` (e.g., `custom.diode`).

## Source, geometry, and extending

- Sources live in `src/catalog.ts`, `src/microcontrollers.ts` (pinned KiCad symbol commits), `src/nordic.ts` (Nordic datasheets), and `src/reference-parts.ts`; see [NOTICE.md](NOTICE.md).
- 50 mils converts to 1 mm so terminals land on the editor grid; two-terminal passives rotate horizontal; arcs tessellate at ≤ 15°. Active-low pins set `activeLow: true` and strip `/`, `_N`, or `n` prefixes.
- To add a symbol: add an entry with grid-aligned terminals and source metadata, update [NOTICE.md](NOTICE.md), and run `pnpm --filter @ecad/default-symbols test` and `pnpm test`.

## License

KiCad-derived symbols are licensed under **CC BY-SA 4.0** with KiCad's electronic-design exception. See [LICENSE.md](LICENSE.md), [CC-BY-SA-4.0.txt](CC-BY-SA-4.0.txt), and [NOTICE.md](NOTICE.md).
