# Schematic editing

These terms describe electrical connections in a schematic.

## Language

**Component**:
An instance of an electrical part that owns its pins.

**Symbol definition**:
A reusable description of a component's graphical representation and pins.

**Pin**:
An electrical connection point owned by a component, identified by its name and package number.

**Electrical type**:
A pin's electrical role, such as input, output, passive or power input, using KiCad's pin types. The electrical rules check uses it to decide which pins drive a net.

**Terminal**:
The exposed end of a pin where a wire connects.

**Lead**:
The visible segment from a pin's terminal toward the component body.

**Net**:
An electrical connection shared by a set of pins. A net can be named before any pins are assigned, and individual pin-to-pin connections within the set have no separate electrical meaning.

**Connections graph**:
A representation of electrical connectivity with pins as nodes and connections between pins as edges. Only net membership has electrical meaning, so different edge arrangements can describe the same circuit.

**Schematic**:
An editable document that presents a circuit through component symbols, wires, labels, and annotations.

**Page**:
One named sheet of a schematic. Wires and pins connect only within a page; net labels with the same name connect across pages.

### Footprints

**Footprint**:
The copper, markings and outlines one component needs on a board, drawn on board layers.
_Avoid_: Package, land pattern

**Layer**:
One sheet of the board stack that a footprint item sits on, such as front copper or front silkscreen.

**Pad**:
A copper area of a footprint that one component lead solders to, identified by its number. A surface mount pad is on one side of the board. A through-hole pad has a drilled hole and copper on both sides.
_Avoid_: Pin, land

**Via**:
A plated hole in a footprint that joins front and back copper. Nothing solders to it, so it has no number.
_Avoid_: Through-hole pad, hole

**Footprint wire**:
A straight stroke on one layer of a footprint. It forms no net, unlike a wire in a schematic.
_Avoid_: Track, trace

**Assigned footprint**:
The footprint a placed symbol names for its component. Its pads match the symbol's pins by number, and a pin without a number counts by its position.
_Avoid_: Footprint link, footprint property

**Default footprint**:
The footprint a symbol definition gives each new placement. Several definitions may share one.

**Built-in footprint**:
A read-only footprint that ships with the app. A project footprint copied from one does not follow it.
