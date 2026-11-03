# Browser coverage

Run `pnpm run test:browser` for the 29 browser cases. CI runs the same suite across two shards, with no retries. Keep browser tests for browser APIs, rendered output, input handling, or interactions between the editor, project provider, and storage. Test document transformations and command edge cases in unit tests.

| Browser cases | Coverage that needs a browser |
| --- | --- |
| Editor, 3 | Canvas pointer coordinates, shape placement and deletion, orthogonal wire gestures, electrical label grid snapping and resize controls |
| Circuit, 2 | Pin drag preview, connection and merge, undo and redo, reload, autosave completing during a gesture |
| Autosave, 3 | Schematic and user-library symbol edits reach storage with browser timers paused, opening legacy net labels does not save repeatedly |
| Projects, 3 | Separate drawing histories and reload, failed symbol save and retry, save/discard/cancel when switching projects |
| Linked PCB, 3 | Navigation between circuit and schematic, synchronization in both directions, pending autosaves and schematic undo, label movement and component rotation through autosave and reload |
| Symbols, 2 | File upload, cross-tab library refresh, lazy thumbnails, placement, reusable definition editing |
| KiCad import, 1 | Imported drawing survives browser storage and reopening |
| Gerber, 2 | ZIP upload and layer creation, layer ordering, visibility, focus and camera |
| STEP, 1 | WASM import, rendered model, view controls, visibility and reopening |
| Export, 2 | Browser SVG and PNG downloads for schematic and Gerber output |
| Sidebar and toolbar, 4 | Hover, focus, touch dismissal and pinning, keyboard navigation, mobile touch scrolling |
| MCP, 1 | Browser connection lifecycle and SDK edits of the mounted editor |
| Renderers, 3 | Pixel output and selection on WebGPU, WebGL and Canvas |

Removed browser checks retain unit coverage in `tests/editor-*.test.ts`, `tests/linked-schematic.test.ts`, `tests/circuit*.test.ts`, `tests/symbol-*.test.ts`, `tests/default-symbols.test.ts`, `tests/item-locks.test.ts`, `tests/pin-label-visibility.test.ts`, `tests/text-alignment.test.ts`, `tests/viewer-lifecycle.test.ts`, and the web and desktop storage suites. Performance workloads remain in `tests/performance`; they run locally.

Browser coverage no longer repeats every style, label, symbol, rotation, cancellation, or malformed-file permutation. Add a browser case only when a failure cannot be caught by those unit tests or an existing browser workflow. Keep save races explicit with a held write, wait for save completion before comparing persisted documents, and scroll lazy thumbnails into view before checking their SVG output.
