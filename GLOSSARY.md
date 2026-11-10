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
