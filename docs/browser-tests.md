# Browser tests

`pnpm run test:browser` runs the same scenarios locally and in CI. There is no separate smoke or extended suite. CI divides them across two shards with two workers each.

| Browser coverage | Scenarios | Detailed lower-level coverage |
| --- | ---: | --- |
| Schematic drawing, previews, symbol creation, text, and undo | 6 | `tests/editor-shapes.test.ts`, `tests/editor-commands.test.ts`, `tests/editor-history.test.ts`, `tests/editor-display.test.ts` |
| Circuit connectivity, pointer and keyboard input, persistence, and navigation races | 5 | `tests/circuit.test.ts`, `tests/circuit-symbol-components.test.ts`, `tests/circuit-net-labels.test.ts` |
| Project files, independent drawings and symbols, save recovery, search, mobile layout, and menus | 8 | `packages/web/tests/projects.test.ts`, `packages/web/tests/symbol-storage.test.ts`, `packages/desktop/tests/projects.test.ts`, `packages/desktop/tests/storage.test.ts` |
| Symbols, labels, attributes, locks, rotation, thumbnails, and reusable definitions | 13 | `tests/default-symbols.test.ts`, `tests/symbol-library-editing.test.ts`, `tests/symbol-children.test.ts`, `tests/item-locks.test.ts`, `tests/text-alignment.test.ts`, `tests/symbol-text-positions.test.ts`, `tests/pin-label-visibility.test.ts` |
| Footprint pads, layer graphics, hidden layers, and selecting, moving and placing in the 3D board | 1 | `tests/footprint.test.ts` |
| Toolbar keyboard and touch input | 2 | `tests/navigation.test.ts` |
| STEP, Gerber and KiCad import, exports, layers, hover, cameras, and gestures | 14 | `tests/import-effect.test.ts`, `tests/drawing-export.test.ts`, `tests/gerber.test.ts`, `tests/gerber-partial-import.test.ts`, `tests/step.test.ts`, `tests/kicad-import.test.ts`, `tests/scene-hover.test.ts` |

The browser suite samples user workflows. Node tests cover geometry, normalization, serialization, validation, and command combinations. Keep each browser scenario focused on one workflow and use representative inputs rather than repeating the same interaction for every model variant.

Run a feature or scenario directly:

```sh
pnpm run test:browser tests/browser/item-locks.spec.ts
pnpm run test:browser --grep 'circuit'
pnpm test
```

Screenshots used by pixel assertions always run. Tests also capture a screenshot automatically on failure. To save review images and attachments:

```sh
ECAD_BROWSER_ARTIFACTS=1 pnpm run test:browser tests/browser/projects-design.spec.ts
```

Images saved with `testInfo.outputPath()` go to Playwright's output directory, `test-results/` by default. Add `--output=/tmp/ecad-browser-results` to keep them under `/tmp`.

Keep workload timing and allocation budgets in the separate local performance suite described in [performance.md](performance.md). `pnpm run perf` retains its single-worker configuration.
