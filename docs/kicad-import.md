# Importing KiCad schematics

In an open project, choose **Add KiCad schematic files** in the Files sidebar and select a modern `.kicad_sch` file. ECAD converts it into a new drawing in the project while keeping existing drawings intact.

## Limits and import report

- **File size & timeout** — Files up to **32 MiB** (`MAX_KICAD_FILE_BYTES`) are accepted (checked before reading). Parsing and conversion run in a Web Worker (`packages/core/src/formats/kicad/parse.worker.ts`) with a **60-second** timeout.
- **Partial recovery** — Unconvertible symbols, wires, junctions, labels, or markers are skipped and listed in the import notice while the rest of the schematic imports. Unreadable files or files where every item is skipped create no drawing.
- **Import report** — Download the JSON import report from the post-import notice before dismissing it. It preserves KiCad metadata that `.ecaddraw` does not store: component UUIDs, library IDs, unit info, original rotations/mirrors, all properties, footprint associations, DNP flags, simulation metadata, embedded symbol definitions, sheet metadata, conversion warnings, and skipped items.

## How conversion works

`parseKiCadFile` (`packages/core/src/formats/parseKiCadFile.ts`) invokes `importKiCadSchematic` in `packages/core/src/formats/kicad/`:

- Reads embedded library definitions, selects the placed unit and body style, converts millimetres to Cartesian coordinates centered on the source paper, and bakes instance rotations/mirrors into editable symbol children.
- Preserves references, values, visible properties, pin names, package numbers, terminal coordinates, wire endpoints, junctions, and no-connect markers.
- Maps KiCad pin electrical types (e.g., `power_in` → `power-in`) and active-low styles (`inverted`, `inverted_clock`, `input_low`, `clock_low`, `output_low`, or `~{…}` in pin names) to native `electricalType` and `activeLow` fields.
- Converts local, global, and hierarchical labels to native electrical net labels at their exact source anchors. Power symbols become `netSymbol: true` symbols with standalone supply labels at their transformed terminals; power flags stay electrically inert.

## Known limits

- All label names are drawing-wide; KiCad hierarchical sheet scopes and local supply scopes are not modeled.
- Nested sheets, buses, bus entries, images, and other unsupported constructs produce warnings and keep their source S-expressions in the report.
- Arcs tessellate to line segments (≤ 10°); filled polylines import as outlines; font metrics, colors, line patterns, and pin decorations are approximate.
- Imported drawings currently keep ECAD's default A3 worksheet regardless of source paper size.

## Reference fixture

The licensed Raspberry Pi RP2350A minimal schematic (`tests/fixtures/kicad/RPI-RP2350A-MINIMAL_R4-S1.kicad_sch`) is used by import tests to verify all 87 instances, 272 terminals, 346 wires, 83 junctions, 94 visible labels, and derived net groups against independent reference inventories.
