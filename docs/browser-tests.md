# Browser tests

`npm run test:browser` runs 16 smoke tests for drawing, wires, undo and redo, project persistence, symbol creation and import, search, keyboard navigation, STEP and Gerber viewing, drawing export, and MCP commands. Use this command for routine local checks.

`npm run test:browser:full` runs every browser regression, including renderer backends. CI runs this suite across four shards with two workers per shard. Renderer backend tests run one at a time. A passing smoke run does not replace the full checks before merge.

To test a particular feature without the smoke filter:

```sh
npm run test:browser:full -- tests/browser/item-locks.spec.ts
npm run test:browser:full -- --grep 'worksheet'
```

Mark a test with `{ tag: "@smoke" }` only when it covers a core workflow that the smoke suite does not already exercise. New regressions belong in the full suite by default. Keep tests isolated so each can run on its own.

Check geometry, validation, and command combinations in Node tests. Use browser tests for pointer and keyboard interaction, browser storage, downloads, and rendered output. The default-symbol tests validate every catalog definition and placement in Node; the browser suite places a resistor, transformer, and 81-pin microcontroller to exercise the shared picker and renderer.

Keep timing budgets in the local performance suite described in [performance.md](performance.md). Browser test counts and durations help assess test maintenance; they are not application performance measurements.

Screenshots used by pixel assertions always run. Tests capture a screenshot automatically on failure. To also save screenshots for visual review:

```sh
ECAD_BROWSER_ARTIFACTS=1 npm run test:browser:full -- tests/browser/editor-toolbar.spec.ts
```

Routine runs omit these review images and their attachment uploads. They do not check a reference image and add GPU readbacks and file writes to passing tests.

Local full runs keep one worker because they also include Gerber timing checks. Focused functional tests can use `--fully-parallel --workers=2`. The performance suite keeps its separate single-worker configuration.
