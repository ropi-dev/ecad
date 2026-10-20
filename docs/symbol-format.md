# Symbol files (.ecadsym)

Each symbol is a standalone UTF-8 JSON `.ecadsym` file (`.json` is also accepted). A library is simply a directory of these files, with no manifest or combined library file:

```text
my-library/
  test-point.ecadsym
  buffer.ecadsym
```

Use **Download example** for a working symbol, or copy the [example directory](../packages/web/public/examples/symbols), which contains [test-point.ecadsym](../packages/web/public/examples/symbols/test-point.ecadsym) and [buffer.ecadsym](../packages/web/public/examples/symbols/buffer.ecadsym).

Manage libraries under **Projects → Symbol libraries**. Choose **User libraries** or **Project libraries** in **Add library to**, then enter a name and upload files or a directory. Without a project provider, these controls appear in the editor's **Symbols** menu. File uploads default to "Imported symbols" for the user scope and "Project symbols" for a project. Directory uploads default to the directory name. Uploading to an embedded library with the same name adds symbols to that library.

Each library has an enable checkbox. Custom named libraries also have a remove button. Built-in symbols are an enabled user library by default and can be disabled. Choose a symbol, then click the drawing to place it. Disabling or removing a library affects the picker. Placed symbols keep their geometry and attributes.

To start an empty symbol, choose **New symbol** beside the project file list and enter a name. The app saves a new `.ecadsym` file and opens it in the borderless symbol editor. Repeated names create separate files. Empty symbols stay unavailable for placement until you add shapes.

To create a symbol from an existing drawing, select two or more drawing shapes, choose **Create symbol** in Attributes, and enter a name. The selection becomes one symbol and its definition appears in **Symbols**. The app saves it to the project's default symbol library when a project is open, or to the user library otherwise. Undo restores the original shapes while keeping the reusable definition.

## User and project configuration

User libraries apply to every project. Opening or creating a project keeps them available without copying their definitions into the project. The picker loads enabled user libraries in configuration order, then enabled project libraries. Later definitions replace earlier definitions with the same symbol ID, so project definitions take precedence. Built-in symbol IDs remain reserved. An unreadable directory library reports an error without hiding other libraries.

On the web, user configuration lives in localStorage under `ecad.user-config.v1`, independently of project data in the Origin Private File System. Uploaded libraries contain validated copies of their symbol files. The editor migrates the earlier `ecad.symbol-library.v1` cache into an "Imported symbols" user library. Once the new configuration has been saved, removed libraries do not return from the old cache. Other open browser editors receive changes to user configuration. Uploading a directory copies its current contents; import changed files into a new library or remove the old library before reimporting.

On desktop, user configuration lives at `~/.ecad/config.json`. **Add library directory** opens the native directory picker and adds a directory source to the selected scope. **Reload libraries** rereads configuration and directory files. Uploaded or created symbols can also be stored as embedded definitions in the user config, without opening a directory first. Filesystem access stays in Electron's main process through the existing preload bridge.

Project configuration lives in the drawing file's `symbolLibraries` field and survives saves, reopening, and source-file imports. Existing standalone project symbols remain in the manifest's `symbols` list and appear as the default "Project symbols" library. Project library settings stay outside drawing undo history. Desktop project directory sources may use absolute paths or paths relative to the project directory. Relative user directory sources resolve against the home directory. Both scopes accept paths beginning with `~/`.

The user configuration has this shape:

```json
{
  "version": 1,
  "symbolLibraries": [
    {
      "id": "builtin",
      "name": "Built-in symbols",
      "enabled": true,
      "source": { "kind": "builtin" }
    },
    {
      "id": "my-parts",
      "name": "My parts",
      "enabled": true,
      "source": { "kind": "directory", "path": "~/symbols/my-parts" }
    }
  ]
}
```

An uploaded library uses `source: { kind: "embedded", symbols: [...] }`, where every array entry is a complete symbol file. A project stores the `symbolLibraries` array with its drawing data. Configuration supports at most 32 libraries per scope and 10 MiB of serialized data. Library IDs must be unique within their scope.

If browser storage is unavailable, imports remain usable in the open editor and the picker reports their temporary lifetime. Desktop config and project saves report write failures and keep the previous configuration.

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
    { "kind": "pin", "name": "IN", "x": -2, "y": 0 }
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
| `shapes` | Up to 256 primitives, described below. An empty array represents a symbol with no shapes yet. |

## Drawing primitives

Coordinates are relative to the symbol's placement origin `(0, 0)`. Positive X points right; positive Y points up. Dimensions are in millimetres and are preserved on import, without automatic resizing. Strokes default to 0.254 mm. Every primitive accepts an optional positive `lineWidth` in millimetres, up to 1000 mm. Symbols created from selections preserve their shapes' stroke widths; an instance's line width can be edited after placement.

| `kind` | Required geometry fields | Optional fields |
| --- | --- | --- |
| `wire` | `x1`, `y1`, `x2`, `y2`: line endpoints, including diagonal lines | None |
| `line` | `x1`, `y1`, `x2`, `y2`: endpoints at any angle | None |
| `rectangle` | `x`, `y`: centre; `width`, `height` | `rotation`: degrees counterclockwise, default 0 |
| `triangle` | `x`, `y`: bounding-box centre; `width`, `height`. The unrotated triangle points up. | `rotation`: degrees counterclockwise, default 0 |
| `circle` | `x`, `y`: centre; `radius` | None |
| `pin` | `x`, `y`: centre of a filled connection marker | `name`: string, defaults to empty |

Every pin has a fixed radius of 0.254 mm (diameter 0.508 mm), including standalone pins and pins inside symbols. Pin size stays fixed when a symbol is fitted or its line width changes. Pin files specify their position and optional name; `radius`, `width`, and `height` are not accepted for pins. Select a standalone pin to edit its Name in Attributes. Pin names are preserved when creating and saving a symbol. Older files without pin names remain supported.

Add a `pin` wherever an external wire should connect. A `line` or decorative `wire` primitive alone does not define a terminal. Text, nested symbols, SVG, and images are not part of version 1.

Coordinates must be between -1000 and 1000 mm. Widths, heights, and radii must be between 0.01 and 1000 mm. Lines and wires must be at least 0.01 mm long. Rotation must be between -360 and 360 degrees. Every number must be finite.

## Import rules

- Each file describes exactly one symbol. The filename is for organization; the `id` identifies the symbol.
- Select at most 100 symbol files per import, totaling at most 1 MiB (1,048,576 UTF-8 bytes). The browser cache and an opened desktop directory each hold at most 100 custom symbols and 1 MiB of serialized symbol data.
- IDs must be unique within each library and cannot match built-in symbols (`resistor`, `capacitor`, `ground` are reserved).
- Duplicate IDs within one library are rejected, including when reimporting the same file. Different libraries may define the same ID. The last enabled definition wins, with project libraries loaded after user libraries.
- All selected symbol files are validated before any are added. Invalid files are reported by filename or directory path; duplicate conflicts report the symbol ID. Failed imports or directory reads leave the existing symbol list unchanged.
- Desktop saves refuse to replace existing files. If files change after loading, refresh the library before saving additional symbols.
- Multi-symbol library files are not accepted. Symbols already saved by the earlier importer remain available from the browser cache.
