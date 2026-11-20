# Glossary

Canonical terms used across ECAD's UI, code, and documentation.

## Schematics and circuits

**Component**
An instance of an electrical part that owns its pins.

**Symbol definition**
A reusable description of a component's graphical representation, pins, default attributes, and optional default footprint.

**Symbol attribute**
A named text value on a component, such as its reference, value, manufacturer, or datasheet link. Every component has a name, reference, and value; a symbol definition can add custom attributes with default values, and each placement keeps its own copy.
_Avoid_: Field, property

**Pin**
An electrical connection point owned by a component, identified by its name and package number.

**Electrical type**
A pin's electrical role (`input`, `output`, `bidirectional`, `tri-state`, `passive`, `free`, `unspecified`, `power-in`, `power-out`, `open-collector`, `open-emitter`, or `no-connect`), matching KiCad's pin types. ERC uses it to determine which pins drive a net and detect conflicts.

**Active level**
Whether a pin's signal is asserted high or low. Pins are active high by default; active-low pins draw an overbar over the pin name and an inversion bubble where the lead meets the body.

**Terminal**
The exposed end of a pin where a wire connects.

**Lead**
The visible segment running from a pin's terminal toward the component body.

**Net**
An electrical connection shared by a set of pins. A net can be named before any pins are assigned, and individual pin-to-pin edges within the set have no separate electrical meaning.

**Connections graph**
A representation of electrical connectivity with pins as nodes and net memberships as edges. Only net membership has electrical meaning, so different edge arrangements can describe the same circuit.

**Schematic**
An editable document presenting a circuit through component symbols, wires, labels, and annotations.

**Page**
One named sheet of a schematic. Wires and pins connect only within a page; net labels, supply labels, and net symbols with the same name connect across pages.

**Sheet settings**
The paper size and title block text shared by every page of a schematic: title, date, revision, company, and comment lines. The title block also displays the file name, page name, and page number automatically.

## Footprints

**Footprint**
The copper, markings, holes, and outlines one component needs on a board, drawn on board layers.
_Avoid_: Package, land pattern

**Layer**
One sheet of the board stack that a footprint or board item sits on, such as front copper (`F.Cu`) or front silkscreen (`F.SilkS`).

**Pad**
A copper area of a footprint that one component lead solders to, identified by its pad number. A surface mount pad sits on one outer copper layer; a through-hole pad has a drilled hole and copper on every copper layer.
_Avoid_: Pin, land

**Via**
A plated hole in a footprint or on a board that joins every copper layer. Nothing solders to it, so it has no number.
_Avoid_: Through-hole pad, hole

**Footprint wire**
A straight stroke on one layer of a footprint. Unlike a schematic wire, it forms no net.
_Avoid_: Track, trace

**Assigned footprint**
The footprint a placed symbol names for its component. Pads match symbol pins by number (unnumbered pins match by 1-based position).
_Avoid_: Footprint link, footprint property

**Default footprint**
The footprint a symbol definition gives each new placement. Multiple definitions may share one.

**3D model**
The solid body of a component drawn on its footprint's pads in the realistic board view. A footprint links at most one model from the built-in 3D model library.
_Avoid_: Package model, STEP model

**Built-in footprint**
A read-only footprint bundled with ECAD. Copying one to a project creates an independent project footprint.

## Boards (PCBs)

**PCB**
The board view of a circuit: its components' footprints placed on a board and joined by copper. Each circuit has at most one PCB.
_Avoid_: Layout, board file

**Placed footprint**
A footprint on a PCB representing one circuit component. Its pads inherit the nets of the component's matching pins.

**Inner copper layer**
A copper layer between front and back copper on boards with 4 to 32 copper layers, named from front to back (`In1.Cu`, `In2.Cu`, …). Vias and through-hole pads connect to all copper layers; surface mount pads and footprints have no inner copper.
_Avoid_: Plane, internal layer

**Track**
A straight copper line on one copper layer of a PCB, assigned to a net.
_Avoid_: Trace, footprint wire

**Zone**
A rectangular or polygonal copper area on one copper layer and net that fills inside the board outline while keeping clear of other nets' copper. When zones on different nets overlap, the higher priority keeps the copper.
_Avoid_: Pour, polygon

**Thermal relief**
A pad-to-zone connection using a gap around the pad bridged by narrow spokes so the pad heats evenly during soldering. Zones can alternatively use solid pad connections.
_Avoid_: Thermal pad (that refers to a footprint's exposed pad)

**Spoke**
One of the narrow copper bridges in a thermal relief connecting a pad to its surrounding zone fill.
_Avoid_: Bridge, tie

**Ratsnest**
Straight guide lines joining unconnected copper groups that belong to the same net.

**Board outline**
The physical perimeter of the board, drawn on the `Edge.Cuts` layer.

**Design rules**
A PCB's clearances, default track width, via dimensions, solder mask margin, thermal relief sizes, and copper layer count. Design rules check (DRC) flags copper that breaks these rules as well as unrouted connections.
