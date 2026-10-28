# RP2350A export fixture

`drawing.ecaddraw` is the converted RP2350A minimal reference schematic, copied from the reference recreation checkout. The upstream reference is Raspberry Pi's RPI-RP2350A-MINIMAL_R4-S1 schematic. See LICENSE.txt for its license.

Keep the fixture unchanged when testing exports. It contains embedded symbol geometry, rotated components, wires and text. Export tests check coverage and sheet bounds against this drawing, rather than using editor screenshots as export input.
