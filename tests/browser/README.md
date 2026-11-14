# Browser coverage

Run `pnpm run test:browser` for the browser cases. CI runs the same suite across two shards, with no retries. Keep browser tests for browser APIs, rendered output, input handling, or interactions between the editor, project provider, and storage. Test document transformations and command edge cases in unit tests.

| Browser cases | Coverage that needs a browser |
| --- | --- |
| Editor, 33 | Canvas pointer coordinates, shape drawing, selection modifiers, orthogonal wire gestures, ruler guides, placement rotation for a symbol and two placement tools, Alt-drag copies, per-document zoom and pan, the zoom label and ruler tick writes during a continuous zoom, batched and panned redraws, antialiasing, history panel rendering |
| Clipboard and messages, 8 | Native clipboard formats and fallbacks, command and clipboard errors, library issue notices |
| Circuit, 9 | Pin drag preview, connection and merge, undo and redo, autosave completing during a gesture or a connection selection, component picker filtering, connection highlights, keyboard redo and input isolation, wide net label fitting, panning during placement, circuit ERC |
| Linked schematic and PCB, 10 | Navigation and selection between circuit and schematic, synchronization in both directions, pending autosaves and schematic undo, generated label dragging, net symbol merging, undo and rebuilds |
| Autosave and projects, 21 | Edits reach storage with timers paused, separate drawing histories and reload, project switching, conflicts on disk, failed library loads, oversized assets |
| Symbols, 3 | File upload, cross-tab library refresh, lazy thumbnails, placement, reusable definition editing |
| Footprints, 1 | Pad placement and wire drawing from pointer coordinates in millimetres, layer hiding against picking, pad edits in Attributes, the swap between the editor canvas and the 3D board |
| KiCad import, 2 | Imported drawing survives browser storage and reopening, skipped symbols are named in the notice and report |
| Gerber and STEP, 4 | ZIP upload and layer creation, layer ordering, visibility, focus and camera, partial layers and their diagnostics, WASM STEP import and view controls |
| Export, 2 | Browser SVG and PNG downloads for schematic and Gerber output |
| Shortcuts, sidebar and toolbar, 21 | Shortcut hints and platform modifiers, hints left alone by a wheel zoom, keyboard layouts, sidebar hover, focus, touch and pinning, keyboard navigation, symbol picker search, mobile touch scrolling |
| Toasts, 6 | Focus, hover pause, keyboard dismissal, lifetimes on a fake clock, import results |

Removed browser checks retain unit coverage in `tests/editor-*.test.ts`, `tests/linked-schematic.test.ts`, `tests/circuit*.test.ts`, `tests/symbol-*.test.ts`, `tests/default-symbols.test.ts`, `tests/item-locks.test.ts`, `tests/pin-label-visibility.test.ts`, `tests/text-alignment.test.ts`, `tests/viewer-lifecycle.test.ts`, and the web and desktop storage suites. Performance workloads remain in `tests/performance`; they run locally.

Browser coverage no longer repeats every style, label, symbol, rotation, cancellation, or malformed-file permutation. Add a browser case only when a failure cannot be caught by those unit tests or an existing browser workflow. Keep save races explicit with a held write, wait for save completion before comparing persisted documents, drive toast and other timer checks with `page.clock` instead of fixed sleeps, and scroll lazy thumbnails into view before checking their SVG output.
