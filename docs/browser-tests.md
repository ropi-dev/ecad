# Browser tests

`pnpm run test:browser` runs the same scenarios locally and in CI. There is no separate smoke or extended suite. CI divides them across two shards with two workers each.

Each browser test is one workflow a user goes through, such as drawing shapes, wiring pins, routing a track, importing a KiCad schematic or exporting a PDF. One test costs 4 to 15 seconds on CI, so the suite stays at about 80 tests. Geometry, normalization, serialization, validation and command combinations belong in the Node tests under `tests/*.test.ts`, which run in milliseconds.

Before adding a browser test, read "Tests" in `AGENTS.md`. Extend an existing scenario when the new behaviour is a step in a workflow that already has one. Use one representative input instead of repeating an interaction for every shape, symbol, viewport or platform.

Run a feature or scenario directly:

```sh
pnpm run test:browser tests/browser/pcb.spec.ts
pnpm run test:browser --grep 'circuit'
pnpm test
```

Screenshots used by pixel assertions always run. Tests also capture a screenshot automatically on failure. To save review images and attachments:

```sh
ECAD_BROWSER_ARTIFACTS=1 pnpm run test:browser tests/browser/projects-design.spec.ts
```

Images saved with `testInfo.outputPath()` go to Playwright's output directory, `test-results/` by default. Add `--output=/tmp/ecad-browser-results` to keep them under `/tmp`.

Keep workload timing and allocation budgets in the separate local performance suite described in [performance.md](performance.md). `pnpm run perf` retains its single-worker configuration.
