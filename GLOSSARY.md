# Schematic editing

These terms describe electrical connections in a schematic.

## Language

**Component**:
An instance of an electrical part that owns its pins.

**Symbol definition**:
A reusable description of a component's graphical representation and pins.

**Symbol attribute**:
A named text value on a component, such as its reference, value, manufacturer or datasheet link. Every component has a name, reference and value. A symbol definition adds its own attributes with default values, and each placement keeps its own copy.
_Avoid_: Field, property

**Pin**:
An electrical connection point owned by a component, identified by its name and package number.

**Electrical type**:
A pin's electrical role, such as input, output, passive or power input, using KiCad's pin types. The electrical rules check uses it to decide which pins drive a net.

**Active level**:
Whether a pin's signal is asserted high or low. Pins are active high unless marked active low, which draws a line over the pin name and an inversion bubble where the lead meets the body.

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

**Sheet settings**:
The paper size and title block text of a schematic: title, date, revision, company and comment lines. Every page of the schematic uses them. The title block also shows the file name, the page name and the page number, which come from the schematic itself.

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

**3D model**:
The solid body of a component, drawn on its footprint's pads in the realistic board view. A footprint links at most one, from the built-in 3D model library.
_Avoid_: Package model, STEP model

**Built-in footprint**:
A read-only footprint that ships with the app. A project footprint copied from one does not follow it.

### Boards

**PCB**:
The board view of a circuit: its components' footprints placed on a board and joined by copper. A project has at most one PCB per circuit.
_Avoid_: Layout, board file

**Placed footprint**:
A footprint on a PCB that stands for one circuit component. Its pads take the nets of the component's pins with the same numbers.

**Track**:
A straight copper line on one copper layer of a PCB, on a net.
_Avoid_: Trace, footprint wire

**Zone**:
A copper area on a PCB that fills a rectangle on one net, keeping clear of other nets' copper.
_Avoid_: Pour, polygon

**Ratsnest**:
The lines that join copper on one net that is not yet connected.

**Board outline**:
The shape of the board, drawn on the Edge.Cuts layer.

**Design rules**:
A PCB's clearances, new track width and via size. The design rules check reports copper that breaks them and connections not yet routed.
