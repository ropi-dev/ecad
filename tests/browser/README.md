# Browser tests

Run `pnpm run test:browser` from the repository root (CI splits the suite across two Chromium shards with two workers each and no retries).

Reserve browser tests for browser APIs, WebGL/SVG rendering, pointer/keyboard interactions, and editor/project/storage integration. Keep document math and command edge cases in Node unit tests (`tests/*.test.ts`).

## Spec groups

- **Schematic editor**: `editor*.spec.ts`, `schematic-*.spec.ts`
- **Circuit & linked PCB**: `circuit.spec.ts`, `linked-*.spec.ts`, `net-symbol-merging.spec.ts`, `pcb.spec.ts`
- **Footprints**: `footprint*.spec.ts`
- **Projects & symbols**: `projects*.spec.ts`, `project-errors.spec.ts`, `empty-project.spec.ts`, `edit-symbol.spec.ts`, `symbol-import.spec.ts`
- **Imports, viewers & exports**: `kicad-import.spec.ts`, `viewer.spec.ts`, `shared-viewer.spec.ts`, `step.spec.ts`, `drawing-export.spec.ts`, `export-png.spec.ts`
- **App shell**: shortcuts, toolbar, sidebar, theme, debug stats, toasts, telemetry

## Authoring tips

Follow **Tests** in [AGENTS.md](../../AGENTS.md) and [docs/browser-tests.md](../../docs/browser-tests.md):

- Make save races explicit with a held write and wait for save completion before asserting persisted state.
- Use `page.clock` instead of fixed sleeps for toast and timer behavior.
- Scroll lazy symbol thumbnails into view before asserting on their SVG output.
