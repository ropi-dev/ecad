# Performance measurements

Run performance commands from the repository root after `pnpm install --frozen-lockfile` and `pnpm exec playwright install chromium`:

```bash
# Compare up to 3 named scenarios against the merge base (for performance work)
pnpm run perf --grep 'editor-pan|editor-toolbar'

# Compare against another ref (e.g., a stacked PR base branch)
pnpm run perf --grep editor-pan --base origin/my-base-branch

# Batch check on origin/main (clean checkout, idle host)
pnpm run perf:main

# Full absolute-budget suite (4× CPU throttling, 3 repeats per scenario)
pnpm run perf:budgets
```

For parallel worktrees on Linux, use the [sandbox runner](parallel-development.md). Native and sandbox commands share a host benchmark lock; never bypass it with direct Playwright invocations or set `ECAD_PERF_LOCK_HELD` manually. Artifacts live under `/tmp` (linked from `perf-artifacts` for native runs). `pnpm run perf:baseline` is deprecated and runs nothing.

## When to measure

- **Feature and fix threads** do not run timing benchmarks (`perf`, `perf:budgets`, `perf:main`). An ordinary editor change selects 48–66 scenarios, taking 17–42 minutes under the exclusive host lock and risking noise regressions.
- **Performance changes or scenario edits** measure only the relevant scenarios with `--grep` (at most three, keeping runs under ~2 minutes; `editor-frame-rate` takes 3–7 minutes alone).
- **Main checks** run timing comparisons once per batch of merged commits on `origin/main` (`pnpm run perf:main`, followed by `pnpm run perf:budgets`, ~24 minutes).

## Main check

`pnpm run perf:main` compares `origin/main` against the last checked commit recorded in `~/.cache/ecad-perf/main-check.json` (`ECAD_PERF_CACHE_DIR` overrides it):

1. Fetches `origin/main` and reads the last checked commit (records `HEAD` and exits if none exists or no new commits landed).
2. Runs an A/B comparison for scenarios selected by the changed paths since that commit (extra flags like `--all` or `--grep` pass through; `--since <ref>` overrides the base for one run).
3. If the only failures are regression verdicts, reruns those scenarios once—non-reproducing regressions pass as noise.
4. On pass (clean checkout on `origin/main`), records `HEAD`. On failure, leaves the marker unchanged and prints the commit range and `--grep` pattern for bisecting. Run `pnpm run perf:main --accept` to accept an intentional slowdown.

## A/B runs

`pnpm run perf` compares the working tree (`head`) against a base commit (default: `git merge-base origin/main HEAD`, override with `--base` or `ECAD_PERF_BASE`):

1. **Builds** — Builds head in the checkout and exports/builds the base commit via `git archive` into `~/.cache/ecad-perf/<sha>` (retaining 5 most recent builds, pruning after 2 weeks, never pruning active or `<6 h` builds). Both builds finish under shared lock before exclusive measurement begins.
2. **Servers** — Starts head and base preview servers on ports `4175` / `4176` (`ECAD_PERF_PORT`, `ECAD_PERF_BASE_PORT`), failing fast if already occupied.
3. **Rounds** — Runs undecided scenarios unthrottled (`ECAD_PERF_CPU=1`), alternating order (`base→head`, `head→base`) each round.
4. **Decisions** — Compares each metric pair against `limit = base × 1.25 + floor`, where `floor` comes from `regressionFloors` in `tests/performance/budgets.ts` scaled by `throttle / 4` (`0.25×` unthrottled, override via `ECAD_PERF_FLOOR_SCALE`). The score is `median(head / limit)`:
   - Passes early when `score <= 1 − 0.2/√pairs`.
   - Regresses at pair 5 (`ECAD_PERF_MAX_PAIRS`, up to 6 rounds to allow 1 spare pair) when `score > 1`.
   - Also compares `interactionP50Ms` (median of `scenario.interaction`). `eventLoopP95Ms` is reported but excluded from verdicts because its 250 ms timer is bimodal.
5. **Checks & report** — A/B runs do not enforce 4× absolute timing budgets, but still enforce required metrics, DOM node limits, and script byte limits. Base-only failures degrade to head-only warnings. Results write to `perf-artifacts/latest.json` and `perf-artifacts/ab/`.

### A/B sensitivity

Unthrottled A/B runs reliably catch regressions that raise median interaction time by ~75% or more (or triple blocking time). On short interactions (`<150 ms`), regressions around +40% sit near the noise floor (`~1.38×` at 100 ms, `~1.5×` at 50 ms). A regression verdict means "investigate", and a pass is not a guarantee against smaller slowdowns on short interactions. Use `ECAD_PERF_CPU=2` or higher `ECAD_PERF_MAX_PAIRS` for tighter sensitivity.

### Smoke mode and dev profiling

- **Smoke mode** (`ECAD_PERF_SMOKE=1 ECAD_PERF_CPU=1 ECAD_PERF_RUNS=1 pnpm run perf --workers=3`) — Runs every scenario unthrottled, enforcing functional assertions, required metrics, DOM limits, and script limits while skipping `…Ms` timing budgets (retries once on failure and flags flakes).
- **Development profiling** (`pnpm run perf:dev`) — Compares against `perf-artifacts/development-baseline.json` (capture with `pnpm run perf:dev --baseline`; override with `ECAD_PERF_BASELINE_PATH`). Production benchmarks determine shipped performance.
- **Debugging** — Set `ECAD_PERF_TRACE=1` to keep failure traces (`perf-artifacts/results`) and `ECAD_PERF_HTML=1` for an HTML report (`perf-artifacts/html`). Set `ECAD_PERF_ANTIALIAS=1` when comparing against a base commit predating the antialiasing setting.

## Scenario selection

Every spec in `tests/performance` carries at least one tag from `tests/performance/tags.ts`: `@startup`, `@projects`, `@editor`, `@symbols`, `@footprint`, `@circuit`, `@import`, `@storage`, `@cli`, plus `@core` on three cheap broad scenarios (`projects-empty`, `projects-large`, `editor-toolbar`).

`scripts/performance/select.ts` maps changed paths (since merge base + working tree) to area tags. Docs, Markdown, `.github`, licenses, and unit/browser tests select only `@core`; lockfiles, configs, shared shells, `scripts/`, and `packages/core/src/performance` select `--all`. Preview selection without running:

```bash
pnpm exec tsx scripts/performance/select.ts
pnpm exec tsx scripts/performance/select.ts docs/erc.md pnpm-lock.yaml
```

`tests/performance-selection.test.ts` enforces that every spec has valid tags and that Node-only scenarios' imports map to their tags.

## Scenario catalog

Browser scenarios run with 1 worker, empty context, disabled HTTP cache, `1280 × 800` viewport, antialiasing off, and Chromium software WebGL (SwiftShader). Node scenarios (`cli-drawing`, `desktop-storage`, `desktop-untitled`, `linked-schematic-sync`, `named-net-connectivity`) run unthrottled. Explicit budgets live in `tests/performance/budgets.ts`.

| Area | Scenarios |
| --- | --- |
| Startup & projects | `projects-empty`, `projects-large` (10k assets, search/filter/pagination), `project-file-sidebar`, `project-new-drawing`, `project-new-symbol`, `toast-notifications`, `button-shortcuts` |
| Schematic editing | `editor-toolbar`, `editor-box`, `editor-line-styles`, `editor-text-alignment`, `editor-symbol-text`, `editor-symbol-children`, `editor-item-locks`, `editor-pin-wire`, `editor-pin-leads`, `editor-pin-labels`, `editor-pin-visibility`, `editor-pin-heavy`, `editor-no-connect`, `editor-placement-rotate`, `editor-symbol-rotate`, `editor-symbol-duplicate`, `editor-text-duplicate`, `editor-clipboard`, `editor-component-move`, `editor-wire-junction`, `editor-pin-junction`, `editor-wire-crossings`, `editor-named-nets`, `editor-physical-zoom` |
| Pan, zoom & dense drags | `editor-pan` (900 resistors / 1,770 shapes), `editor-frame-rate` (unthrottled interaction FPS drops), `editor-dense-drag` (400 resistors / 780 shapes), `editor-selection-drag` (2,614 shapes), `editor-zoom-firefox`, `editor-zoom-chrome` (headless real-browser WebDriver BiDi / CDP; override binaries with `ECAD_PERF_FIREFOX`, `ECAD_PERF_CHROME`) |
| Symbols | `symbol-libraries` (400 symbols across 20 libraries), `default-symbols`, `microcontroller-symbols`, `editor-symbol-file`, `editor-symbol-attributes`, `symbol-references`, `editor-user-symbol` |
| Circuits, ERC & PCBs | `circuit-graph`, `circuit-example` (RP2350A), `circuit-components`, `circuit-connect`, `circuit-net-editing`, `circuit-auto-names`, `circuit-keyboard-placement`, `circuit-grid-snap`, `circuit-collapse`, `circuit-untangle`, `circuit-merge-names`, `net-symbol-reconcile`, `circuit-erc`, `schematic-erc`, `editor-view-switch`, `pcb-view-switch`, `pcb-linked-documents`, `pcb-board-3d` |
| Imports, viewers & exports | `kicad-import` (RP2350A), `gerber-3d` (2,000 pads/holes), `schematic-export` (SVG/PNG/PDF on RP2350A) |
| Node / CLI / desktop | `cli-drawing` (2,000 shapes via CLI + stdio MCP), `desktop-storage`, `desktop-untitled`, `linked-schematic-sync` (300 components), `named-net-connectivity` (plus standalone `pnpm exec tsx scripts/performance/named-nets.ts` for 5,000-wire connectivity) |

## Live diagnostics and debug stats

- **Development builds** collect automatically (`?perf=0` disables).
- **Production builds** collect only with `?perf=1`, `localStorage.setItem("ecad.performance", "1")` + reload, or while the debug stats window is open.
- **Debug stats window** — Toggle via **Settings → Display → Show debug stats** or `Ctrl+Shift+D`. Shows FPS, renderer FPS, frame time/p95, draw calls, triangles, geometries, textures, shape count, scene update time, long tasks, JS heap, and DOM nodes. Close it before taking manual timings (it runs its own `requestAnimationFrame` loop).
- **Console API** (web & desktop DevTools; initializes before hydration on web and before Solid rendering on desktop):

```js
const perf = window.__ecadPerformance;
perf.snapshot();
perf.export();
perf.download();
perf.reset();
perf.stop();
```

Buffers stay bounded (512 events, 128 metric names, 120 duration samples per metric) and never record project names, file names, paths, or geometry.

## Field data

Opt-in telemetry (**Settings → Usage data → Send performance data**, off by default) is available only in builds compiled with `VITE_POSTHOG_KEY`.

- **Consent storage** — Stored independently of other settings (`localStorage` `ecad.telemetry.v1` on web; `telemetry.json` on desktop) as `{ enabled, revision, since }`. Toggling off/on rotates `revision` and retires all active sessions across tabs/windows.
- **Events** — `packages/core/src/telemetry/telemetry.ts` sends `perf_operation` (discrete ops, max 50 per op per session; numeric/boolean metadata only, strings dropped) every 30 s / 20 events, and `perf_summary` (5-minute/pagehide log-bucketed p50/p95/p99/max windows).
- **Privacy** — Uses a per-session random `distinct_id`, `$process_person_profile: false`, `$geoip_disable: true`, bucketed CPU cores, and coarsened GPU vendor (`nvidia`, `amd`, `intel`, `apple`, etc.). Never sends URLs, referers, project names, file names, or paths. Web posts to `/ingest/batch/` (same-origin proxy to `https://eu.i.posthog.com`); desktop validates batches via `telemetryBatchSchema` in the main process before posting. Enable **Discard client IP data** in PostHog project settings before shipping a build with a key.

## Metrics reference and adding measurements

| Metric | Meaning |
| --- | --- |
| `app.ready` | Navigation start to initial project restore completion. |
| `navigation.ready` | Link click to destination workspace commit. |
| `project.*` | Storage list/load/create/open/save/import/read operations. |
| `import.gerber`, `import.step`, `import.kicad` | Awaited worker parse, conversion, and scene construction. |
| `renderer.initialize`, `renderer.frame` | Viewport init and CPU frame submission time (not GPU completion or FPS). |
| `footprint.board-build` | Building/updating 3D board layers in footprint/PCB editors. |
| `browser.long-task`, `browser.blocking-time` | Main-thread tasks > 50 ms and excess time above 50 ms. |
| `browser.event-loop-delay` | Delay beyond the 250 ms sampling timer. |
| `browser.input-delay`, `browser.event-duration`, `browser.first-contentful-paint`, `browser.lcp` | Individual browser Event Timing / Paint observations. |
| `scenario.interaction` | End-to-end test action through visible assertion. |

Add new measurements with the shared helpers in `packages/core/src/performance/runtime.ts`:

```ts
import { measurePerformanceAsync } from "#/performance/runtime.ts";

const result = await measurePerformanceAsync(
  "feature.operation",
  () => performOperation(),
  { objects: items.length },
);
```

Keep metric names stable, metadata numeric/small, and free of user paths or project contents. Verify new scenarios with `pnpm run perf:budgets --grep <scenario>`.
