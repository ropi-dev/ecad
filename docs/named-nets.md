# Named electrical nets

A named net is a text shape with `electrical: "net"`. Supply names use `electrical: "supply"`. Both forms have the same electrical behavior. The shape's `text` is the net name, and `x` and `y` are its electrical anchor in drawing coordinates, in millimetres. Text alignment and rotation affect the drawing of the name, not the anchor.

```json
{
  "id": 95,
  "kind": "text",
  "electrical": "supply",
  "text": "+3V3",
  "x": 40,
  "y": 25,
  "width": 8,
  "height": 2,
  "fontSize": 1.5,
  "rotation": 0,
  "lineWidth": 0.2,
  "horizontalAlign": "left",
  "verticalAlign": "bottom"
}
```

Importers can emit this representation without accessing editor state or importing another format's converter. Keep source label anchors at the wire or pin terminal coordinates. Do not use the rendered text's center or bounding box as its anchor. This also applies to source supply symbols that identify a net by name.

Matching names join disconnected sections throughout one drawing. Names ignore surrounding whitespace and are case sensitive, so `GND` and `gnd` are distinct. A label attaches at its anchor to a pin terminal or any point along a wire. A name's text overlapping a wire does not attach it. Wire crossings without a junction remain separate. A physical wire joining two named nets makes both names aliases of the same electrical net.

Ordinary text omits `electrical` and has no electrical effect, even if it says `GND` or `+3V3`. Existing drawings retain that behavior. Importers must opt each source label into electrical naming. A pin's displayed name alone does not declare a drawing-wide net.

`electricalNets(shapes)` in `#/drawing/named-nets.ts` returns nets with `names`, `wires`, `labels`, and `pins`. Wire and label entries are drawing shape IDs. Each pin entry contains a `shapeId` and `pinId`. A standalone pin uses its own ID for both values. A symbol terminal uses the symbol instance ID and the child's pin ID. Separate pins on ordinary components remain separate electrical terminals.

Symbols with `netSymbol: true` name the nets at their pin terminals. The instance Name attribute defines the net name, with surrounding whitespace removed. An empty name does not declare a net. Matching symbol and label names connect across the drawing. Symbol position, rotation, and pin overrides determine the terminal coordinates. Net symbols have one name label and no reference ID. Older saved net-symbol values migrate into Name when loaded.

Ground, signal ground, VCC, VDD, and the voltage supply symbols have this flag in their built-in definitions. Ground defaults to `GND`. Portable symbol files preserve the flag, and new instances copy it from the definition. In Attributes, use the Net symbol checkbox to change an instance's role and the Name field to edit its net name. Existing placements can use the same checkbox. Saving, reloading, and undo preserve the role.

CLI and MCP clients can place or replace these shapes through the existing drawing shape commands. Include `electrical` and the full text geometry in the shape payload. Drawing documents and undo snapshots preserve that field on save and reload.

The `getDrawing` reply includes `drawing.nets` with the same net records as `electricalNets`. CLI and MCP clients can inspect remote named connections through this field. Mutation replies omit `nets`; call `getDrawing` after editing to read the current connectivity. Nets are derived from saved shapes and do not need a separate persistence field.

The editor's Connections group places Net label and Supply label items. Placement snaps the anchor to a nearby pin or wire, including wire interiors. Attributes edits the name and label role. Crosses mark electrical anchors even when the label is unselected. The Wire tool can start or finish at a label anchor. Empty names have no electrical effect.

For the RP2350A reference conversion, restore the source label anchor before setting `electrical`. Its current `build.py` adds 0.5 mm to horizontal label Y coordinates for display. Supply symbols can set `netSymbol: true` on the symbol instance. The KiCad importer uses this flag for power symbols and binds their label to Name. Power flags do not declare a net name. Names currently apply to the whole drawing; hierarchical sheet scopes and ERC are outside this representation.

Net symbols cannot be nested inside reusable symbol definitions. The symbol editor excludes them from placement and role changes. Portable imports, saving, and library resolution reject nested net declarations rather than discarding their electrical meaning. A net-symbol definition can still declare its own role and use ordinary geometry.

Electrical labels are standalone drawing items. The symbol editor does not offer electrical label tools, and grouping rejects electrical labels to preserve their drawing-wide meaning.

Shape schemas, drawing import, symbol-file import and direct drawing commands reject electrical labels inside symbol children. This also applies to CLI and MCP payloads. A symbol's text remains ordinary text.

Connectivity uses a spatial tree of terminal and segment bounds to find endpoint and label contacts. `getDrawing` caches immutable net records by the frozen drawing snapshot. Edits and history navigation create a new snapshot, so the next read rebuilds connectivity. The cache uses weak keys so it does not retain drawings after their snapshots are released.

Long-lived local CLI/MCP drawing services also reuse the read-only store when both drawing and history file contents are unchanged. They validate files under the existing lock, discard cached reads before mutations, and rebuild after an external file change. Separate CLI processes each build their own cache.
