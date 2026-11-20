# RP2350A KiCad import fixture

`RPI-RP2350A-MINIMAL_R4-S1.kicad_sch` is Raspberry Pi's RP2350A QFN-60 minimal design (R4, schematic revision S1, 2026-07-03), Copyright 2026 Raspberry Pi Ltd. See `LICENSE.txt` for its MIT license and design disclaimer.

Downloaded unchanged from [Minimal-KiCAD.zip](https://datasheets.raspberrypi.com/rp2350/Minimal-KiCAD.zip) via the [Raspberry Pi RP2350 design files](https://pip.raspberrypi.com/categories/1214-rp2350).

- `pins.json` — Independent inventory of all 272 terminals in Cartesian millimetres (origin at A3 sheet center).
- `source-nets.json` — Independent connectivity oracle (51 named and 5 unnamed pin groups, 231 non-power component terminals).

Import tests verify all 87 instances, 272 terminals, 346 wires, 83 junctions, 94 visible labels, and derived net graphs (excluding `#PWR` terminals) across import, project save/reopen, and SVG/PNG export. `pnpm run example:rp2350a` also imports this file to generate the bundled RP2350A example in `packages/core/src/examples`.
