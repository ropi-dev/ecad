# RP2350A import fixture

`RPI-RP2350A-MINIMAL_R4-S1.kicad_sch` is Raspberry Pi's RP2350A QFN-60 minimal design, R4, schematic revision S1, dated 2026-07-03. Copyright 2026 Raspberry Pi Ltd. The supplied MIT license and design disclaimer are in `LICENSE.txt`.

The originating reference downloaded [Minimal-KiCAD.zip](https://datasheets.raspberrypi.com/rp2350/Minimal-KiCAD.zip) on 2026-10-28, through the [Raspberry Pi RP2350 design files](https://pip.raspberrypi.com/categories/1214-rp2350). This fixture copies the original schematic unchanged. `pins.json` is the originating reference converter's independent inventory of 272 terminals in Cartesian millimetres, with the A3 page center as origin.

The tests compare every imported terminal name, package number and position, plus source component values and wire endpoints. They also check the 87 instances, 346 wires, 83 junctions and 94 visible labels. The performance scenario uses this same source through the app's file picker.

`source-nets.json` is the coordinating reference task's independently derived source connectivity oracle. It contains 51 named and five unnamed pin groups, with 231 non-power component terminals. Import tests exclude `#PWR` terminals before comparing the native net graph. The tests repeat that comparison after project save/reopen and then export the reopened drawing as SVG and PNG.
