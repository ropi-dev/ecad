# Test ownership

Run `pnpm test` from the repository root. The root suite owns unit tests for `@ecad/core`, `@ecad/drawing-core`, and `@ecad/cli` (`tests/*.test.ts`), and also invokes package-owned test suites (`pnpm -r --if-present run test` for web, desktop, default-symbols, default-footprints, and default-models).

## Layout and import aliases

- Keep shared fakes in `tests/helpers/` and sample documents in `tests/fixtures/`.
- New core, drawing-core, and CLI unit tests belong in `tests/`; package-owned tests live under each package's `tests/` directory.
- Root `package.json` maps `#/` → `packages/core/src/` and `#web/` → `packages/web/src/`. Inside a package (such as desktop), `#/` resolves to that package's own `src/`, while core modules import via `@ecad/core/...`.

## Suites

- **Unit tests (`pnpm test`)** — Fast Node tests covering geometry, serialization, validation, commands, ERC/DRC, formats, storage, and CLI/MCP.
- **Browser tests (`pnpm run test:browser`)** — Playwright user-workflow specs in `tests/browser/`. See [browser/README.md](browser/README.md) and [docs/browser-tests.md](../docs/browser-tests.md).
- **Smoke tests (`pnpm run test:smoke`)** — Verifies production builds against their real hosts in `tests/smoke/`:
  - `web` — Serves the built web app with `vite preview`, creates a circuit, draws and saves a shape, toggles debug stats, and verifies persistence across reload.
  - `desktop` — Launches `packages/desktop/dist` in real Electron (only the native folder picker is stubbed), saves/reloads a project, and tests stdio MCP integration. Requires `pnpm run build:desktop`, the Electron binary (`node install.js` in the electron package), and a display (`xvfb-run -a` on Linux). Skips locally if prerequisites are missing; fails in CI.
- **Performance scenarios (`pnpm run perf`)** — Local benchmark specs in `tests/performance/` using shared helpers in `app-helpers.ts` and `app-fixture.ts`. See [docs/performance.md](../docs/performance.md).
