# Symbol files (.ecadsym)

Each symbol is a standalone UTF-8 JSON `.ecadsym` file (`.json` is also accepted). A library is simply a directory of these files, with no manifest or combined library file:

```text
my-library/
  test-point.ecadsym
  buffer.ecadsym
```

Open **Symbols → Upload symbols** to select one or several files, or **Upload library directory** to select an entire directory. Directory imports include matching files in subdirectories and ignore other extensions. Use **Download example** for a working symbol, or copy the [example directory](../public/examples/symbols), which contains [test-point.ecadsym](../public/examples/symbols/test-point.ecadsym) and [buffer.ecadsym](../public/examples/symbols/buffer.ecadsym).

Imported symbols appear alongside the built-in symbols. Choose one, then click the drawing to place it. Their attributes, rotation, selection, connections, and undo/redo work like built-in symbols. Symbols are cached locally in this browser; keep their files as your library. If browser storage is unavailable, the menu reports that the import will only last until you leave or reload the editor.

To create a symbol in the editor, select two or more drawing shapes, choose **Create symbol** in Attributes, and enter a name. The selection becomes one symbol and its definition appears in **Symbols**, saved in this browser for reuse. Undo restores the original shapes while keeping the reusable definition in the list.

## File structure

```json
{
  "format": "ecad-symbol",
  "version": 1,
  "units": "mm",
  "id": "custom.connector",
  "name": "Connector",
  "description": "Single connection point",
  "prefix": "J",
  "value": "1 pin",
  "shapes": [
    { "kind": "rectangle", "x": 0, "y": 0, "width": 2, "height": 2 },
    { "kind": "wire", "x1": -2, "y1": 0, "x2": -1, "y2": 0 },
    { "kind": "pin", "x": -2, "y": 0 }
  ]
}
```

All fields above are required. `description` and `value` may be empty strings. Unknown fields are rejected to catch misspellings.

| Symbol field | Meaning |
| --- | --- |
| `id` | Unique stable ID, 1–64 characters: lowercase letter first, then lowercase letters, digits, `.`, `_`, or `-`. Use a namespace such as `custom.connector`. |
| `name` | Display name, 1–100 characters, not all whitespace. |
| `description` | Text shown in the picker, up to 500 characters. |
| `prefix` | Reference prefix, 1–16 characters: ASCII letter first, then letters, digits, or `_`. Instances receive references such as `J1`. |
| `value` | Default editable value, up to 100 characters. |
| `shapes` | Between 1 and 256 primitives, described below. |

## Drawing primitives

Coordinates are relative to the symbol's placement origin `(0, 0)`. Positive X points right; positive Y points up. Dimensions are in millimetres and are preserved on import, without automatic resizing. Strokes default to 0.254 mm. Every primitive accepts an optional positive `lineWidth` in millimetres, up to 1000 mm. Symbols created from selections preserve their shapes' stroke widths; an instance's line width can be edited after placement.

| `kind` | Required geometry fields | Optional fields |
| --- | --- | --- |
| `wire` | `x1`, `y1`, `x2`, `y2`: line endpoints, including diagonal lines | None |
| `line` | `x1`, `y1`, `x2`, `y2`: endpoints at any angle | None |
| `rectangle` | `x`, `y`: centre; `width`, `height` | `rotation`: degrees counterclockwise, default 0 |
| `triangle` | `x`, `y`: bounding-box centre; `width`, `height`. The unrotated triangle points up. | `rotation`: degrees counterclockwise, default 0 |
| `circle` | `x`, `y`: centre; `radius` | None |
| `pin` | `x`, `y`: centre of a filled connection marker | None |

Every pin has a fixed radius of 0.254 mm (diameter 0.508 mm), including standalone pins and pins inside symbols. Pin size stays fixed when a symbol is fitted or its line width changes. Pin files specify only their position; `radius`, `width`, and `height` are not accepted for pins.

Add a `pin` wherever an external wire should connect. A `line` or decorative `wire` primitive alone does not define a terminal. Text, nested symbols, SVG, and images are not part of version 1.

Coordinates must be between -1000 and 1000 mm. Widths, heights, and radii must be between 0.01 and 1000 mm. Lines and wires must be at least 0.01 mm long. Rotation must be between -360 and 360 degrees. Every number must be finite.

## Import rules

- Each file describes exactly one symbol. The filename is for organization; the `id` identifies the symbol.
- Select at most 100 symbol files per import, totaling at most 1 MiB (1,048,576 UTF-8 bytes). The browser cache also holds at most 100 custom symbols and 1 MiB of serialized symbol data.
- IDs must be unique across the selected files and already imported and built-in symbols (`resistor`, `capacitor`, `ground` are reserved).
- Duplicate IDs are rejected, including when reimporting the same file. Give a revised symbol a new ID to import it alongside the original.
- All selected symbol files are validated before any are added. Invalid files are reported by filename or directory path; duplicate conflicts report the symbol ID. Failures leave the existing library unchanged.
- Multi-symbol library files are not accepted. Symbols already saved by the earlier importer remain available from the browser cache.
