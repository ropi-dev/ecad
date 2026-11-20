# Named electrical nets and pages

## Named nets and supply labels

A named net is a `text` shape with `electrical: "net"`, and a supply label uses `electrical: "supply"`. Both behave identically electrically: `text` is the net name, and `(x, y)` is the electrical anchor in millimetres (independent of text alignment or rotation).

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

### Connectivity rules

- **Attachment** — A label connects when its anchor `(x, y)` touches a pin terminal or any point along a wire (overlapping rendered text alone does not connect). Crossing wires without a junction stay separate.
- **Matching** — Names are trimmed and case-sensitive (`GND` ≠ `gnd`). Matching names join disconnected wire groups across the entire drawing, including across schematic pages. A wire joining two different net names merges them as aliases of one net.
- **Ordinary text** — Text without `electrical` is electrically inert, even if it reads `GND` or `+3V3`.
- **Standalone only** — Electrical labels cannot be placed inside symbol definitions or grouped into symbols (rejected by schemas, importers, CLI, and MCP).

In the editor, **Connections → Net label** and **Supply label** snap their anchor to nearby pins or wires, mark anchors with crosses, and allow wires to start/end on anchors.

## Net symbols

Symbols with `netSymbol: true` (such as built-in Ground, Signal ground, VCC, VDD, and voltage rails) name the net at their pin terminals using their **Name** attribute (trimmed; empty names declare no net). Net symbols have no reference designator and cannot be nested inside reusable symbol definitions. Toggle **Net symbol** in Attributes to convert an instance's role.

## Programmatic inspection and caching

- `electricalNets(shapes)` (`@ecad/drawing-core/drawing/named-nets.ts`) returns derived nets with `{ names, wires, labels, pins }`, using a spatial index of terminal and segment bounds.
- MCP/CLI `getDrawing` exposes the same records in `drawing.nets` (weakly cached per frozen drawing snapshot; long-lived CLI/MCP services also reuse read-only stores while file contents stay unchanged). Mutation replies omit `nets`.
- Importers should always set `(x, y)` to the true wire/terminal anchor (for example, KiCad power symbols emit `netSymbol: true` and supply labels at the transformed terminal; power flags stay electrically inert).

## Multi-page schematics

Schematics support multiple named pages stored in `drawing.pages` as ordered `{ id, name }` entries:

- Each shape stores its page ID in `page`. Shapes on the first page omit `page` (and drawings without `pages` default to a single `"Page 1"`). Reordering pages moves the omitted default to the new first page.
- Wires, pins, junctions, label anchors, wire normalization, and symbol wire cuts operate **within a single page**. Only matching net labels, supply labels, and net symbols connect across pages.
- Use the top-center page bar to switch, rename (double-click), add (`+`), reorder, or delete pages (deleting a page removes its shapes in one undo step). Moving a symbol to another page carries its pinned circuit net labels with it.
- Headless/CLI/MCP callers use `setPagesEffect` / `setPages` and `moveShapesToPageEffect` / `moveShapesToPage`.
