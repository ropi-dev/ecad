# Importing KiCad schematics

Open or create a project. In the Files sidebar, choose Add KiCad schematic files and select a modern `.kicad_sch` file. ECAD creates and opens a separate drawing. Existing drawings remain available. A failed conversion creates no drawing. Repeated imports create separate files.

After import, download the import report before dismissing the notice. It contains component UUIDs, library identifiers, units, original rotations and mirrors, all component properties, embedded symbol definitions, sheet metadata, label anchors and conversion warnings. The report is a separate JSON download. ECAD drawing files cannot store KiCad electrical and simulation metadata. Keep the original schematic and report with the drawing.

The built-in converter lives in `packages/core/src/formats/kicad`. It reads embedded library definitions, selects the placed unit and body style, converts millimetres to Cartesian coordinates centered on the source paper, and bakes instance rotations and mirrors into editable symbol children. Components retain their reference, value, pin names, package numbers and terminal coordinates. Reference and value fields use editable attribute labels with rotation overrides. Other visible properties become text children. Wires retain their endpoints; junctions become filled markers; no-connect markers become crossed lines. Visible local, global and hierarchical labels become text at their source anchors.

Current limits:

- Matching net labels and power names do not connect disconnected wires. Labels remain text, independent of work on native electrical labels.
- Pin names and numbers use separate text children, independent of work on native pin visibility controls. Terminal names and numbers remain on the pins.
- No-connect marks do not suppress electrical checks. Pin electrical types, footprint associations, DNP flags and simulation metadata are available in the report only.
- Nested sheets, buses, bus entries, images and other unsupported sheet constructs produce warnings. The report retains their source expressions. Missing embedded definitions, inherited definitions, malformed coordinates and malformed expressions reject the import.
- Arcs use line segments at intervals of at most ten degrees. Filled polylines use outlines. Font metrics, overbars, text mirroring, colors, line patterns, label outlines and pin decoration shapes are approximations. Rectangle and circle fills use ECAD's fill rendering.
- The worksheet remains ECAD's A3 worksheet. Coordinate conversion honors the KiCad paper dimensions, but ECAD does not yet change its worksheet to match other paper sizes.

The RP2350A fixture includes its original third-party license in `tests/fixtures/kicad`. Tests compare all 272 terminals against the independently generated reference inventory, all wire endpoints against the source, and reference/value pairs against source properties. No ERC, netlist equivalence or PCB validation is claimed.
