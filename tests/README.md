# Test ownership

Run `pnpm test` at the workspace root. The root owns the core, drawing-core and CLI unit tests in `tests/*.test.ts`, including the engine tests. Those packages intentionally have no separate `test` script. The root command also runs the package-owned suites in web, desktop and default-symbols through `pnpm -r --if-present run test`.

Keep shared fakes in `tests/helpers` and sample documents in `tests/fixtures`. New core, drawing-core and CLI unit tests belong in `tests`, rather than beside production modules. Package-owned tests use their package's `tests` directory.

The root package's `imports` maps `#/` to `packages/core/src/` and `#web/` to `packages/web/src/`. A root test importing `#/engine/camera` therefore loads core code, regardless of which package the test describes. Package-local `#/` aliases resolve relative to that package's `package.json`, so desktop tests use `#/main/ipc.ts` for desktop code and `@ecad/core/...` for core code. Shared root helpers should use the root aliases or workspace package imports.

Browser coverage and commands are in [browser/README.md](browser/README.md). Local performance scenarios each have a spec in `tests/performance`, with parameterized variants kept together. Shared browser metrics and workload builders live in `app-helpers.ts`; `app-fixture.ts` registers cache, CPU throttling and development warmup hooks. Run one scenario with `ECAD_BROWSER_PORT=5480 ECAD_PERF_PORT=5481 pnpm exec playwright test --config tests/performance/playwright.config.ts --grep editor-component-move --workers=2` after building the web app. See [performance.md](../docs/performance.md) for measurement and baseline rules.
