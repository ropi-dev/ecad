# Performance measurements

Run these commands from the repository root after `npm ci` and `npx playwright install chromium`:

```bash
npm run perf:baseline
# Make the feature change, then compare against the saved baseline:
npm run perf
```

Both commands build the web app and run Chromium against a fresh preview server on port 4175. Each scenario runs three times, with one worker, an empty browser context, HTTP cache disabled, a 1280 × 800 viewport, and 4× CPU throttling. The large-project test seeds browser storage and reloads; this models opening an existing project. GPU tests use Chromium's software renderer so they also run in CI. These numbers describe that test environment, rather than a user's GPU performance.

The scenarios cover startup without a project, restoring 10,000 project assets and interacting with the paginated list, and creating/editing/saving a drawing followed by a 2,000-hole Gerber import and a STEP import. Add scenarios for new flows and larger representative inputs as features grow.

The absolute timing budgets include the existing workload on GitHub's Ubuntu runners with 4× CPU throttling and software rendering. The limits allow for hosted-runner variation observed in [the first CI run](https://github.com/rolaca11/ecad/actions/runs/37324627616) and [the next CI run](https://github.com/rolaca11/ecad/actions/runs/37325490010):

| Scenario and metric | Largest recorded value | Budget |
| --- | --- | --- |
| Empty-project event-loop p95 | 200 ms | 300 ms |
| Large-project event-loop p95 | 321 ms | 500 ms |
| Large-project interaction p95 | 579 ms | 750 ms |
| Import CPU frame submission p95 | 362 ms | 500 ms |
| Import event-loop p95 | 1,007 ms | 1,500 ms |

These limits guard against regressions in this test environment; they are not responsiveness targets. Use the import and frame measurements to guide further optimization. Local baseline comparisons retain their tighter relative limits.

`perf-artifacts/latest.json` contains individual reports and per-scenario medians and p95 values across runs. `perf-artifacts/baseline.json` stores the local comparison baseline. Artifacts are ignored by Git. Explicit budgets live in `tests/performance/budgets.ts`. Every run must provide finite required measurements and stay within DOM limits. Timing budgets apply to the median across repeated runs, so a single hosted-runner spike does not fail the job. Individual outliers remain in the JSON report. A focused run with one sample still enforces its timing budgets.

With a baseline, the reporter also fails if a median exceeds the old median by 25% plus the metric's noise allowance. A baseline must match the mode, CPU throttle, platform, and browser version. Recapture it explicitly after an environment change. Baseline capture only succeeds when all executed tests and budgets pass.

Event-loop baseline comparisons allow 100 ms of sampling noise. The collector samples every 250 ms, so short scenarios vary with the timer's alignment to import tasks. Repeated local measurements of the same app build produced median event-loop p95 values between 156 and 258 ms while CPU frame submission stayed around 200 ms. Import duration, blocking time, and frame time retain their separate regression checks.

The GitHub Actions performance job runs the production scenarios and uploads JSON, HTML, build logs, and failure traces. CI enforces the checked-in absolute budgets; local before/after checks use the baseline. It does not silently bless new results as a baseline.

Development profiling uses a separate Vite dependency cache and warms the server's routes and parser workers before measurements, preventing dependency discovery from reloading the app halfway through a scenario. Browser contexts and their HTTP caches still start empty. Development runs require the same measurements, enforce DOM limits, and compare against their development baseline; shipped time and byte budgets apply to production builds.

```bash
# React development profiling uses development-baseline.json:
npm run perf:dev -- --baseline
npm run perf:dev

# Change the environment deliberately, using the same values for both runs:
ECAD_PERF_CPU=4 ECAD_PERF_RUNS=5 npm run perf:baseline
ECAD_PERF_CPU=4 ECAD_PERF_RUNS=5 npm run perf

# Focus on one scenario during investigation:
npm run perf -- --grep projects-large
```

Set `ECAD_PERF_BASELINE_PATH` to use another comparison file. Development and production have separate default baselines.

## Live diagnostics

Development builds collect automatically. Add `?perf=0` to disable collection for an overhead comparison. Production builds collect only with `?perf=1` or `localStorage.setItem("ecad.performance", "1")` followed by a reload. The shared collector works in web and desktop renderers. It initializes before hydration on web and before React rendering on desktop.

Use the browser or Electron DevTools console:

```js
const perf = window.__ecadPerformance
perf.snapshot()
perf.export()
perf.download()
perf.reset()
// After reproducing the problem:
perf.download()
perf.stop()
```

Reports stay on the device; no telemetry endpoint receives them. They contain timings, operation counts, browser details, DOM/heap sizes when available, and static script resource paths. Measurements exclude project names, source files, directory paths, and geometry. `stop()` disconnects browser observers and the sampling timer; explicit operation measurements can still be recorded.

The collector keeps at most 512 events, 128 metric names, and 120 duration samples per metric. Count, error count, total, and maximum cover the session since reset; p50/p95 use the most recent 120 samples. Sorting and resource/DOM inspection happen when requesting a report. Event-loop sampling runs every 250 ms while the document is visible. Rendering records into bounded buffers without logging or creating User Timing entries every frame.

## What the metrics mean

| Metric | Measurement |
| --- | --- |
| `app.ready` | Time from navigation start to the root project provider finishing its initial restore. This does not include completion of all GPU work. |
| `navigation.ready` | Link click to the destination workspace committing. Import and renderer times are measured separately. |
| `project.*` | Storage load/list/create/open/save/import/read and adoption of the drawing into app state. |
| `import.gerber`, `import.step` | Awaited parsing and scene construction, including worker work and queueing. |
| `renderer.initialize` | Synchronous viewport setup. |
| `renderer.frame` | CPU time spent submitting a rendered frame, with draw calls, triangles, geometries, and textures. It is not GPU completion time or FPS. |
| `react.*` | React commit render durations in development builds. The regular production React build does not provide Profiler callbacks. |
| `browser.long-task`, `browser.blocking-time` | Main-thread tasks over 50 ms, and their duration above 50 ms. |
| `browser.event-loop-delay` | Timer delay beyond the intended 250 ms interval; captures main-thread stalls. |
| `browser.input-delay`, `browser.event-duration` | Supported Event Timing observations. These are individual events, not a calculated Core Web Vitals INP score. |
| `browser.first-contentful-paint`, `browser.lcp` | Browser paint observations when supported. LCP can update until interaction. |
| `scenario.interaction` | Test action through its visible assertion; includes Playwright coordination overhead. |

Unsupported browser capabilities are identified in `environment.supportedEntryTypes`; missing heap measurements are `null`. A missing metric must not be interpreted as zero. Script bytes use decoded resource sizes and include dynamically loaded scripts up to capture time.

## Adding measurements

Use stable names at operation boundaries:

```ts
import { measurePerformanceAsync } from "#/performance/runtime.ts";

const result = await measurePerformanceAsync(
  "feature.operation",
  () => performOperation(),
  { objects: items.length },
);
```

The helpers preserve return values, thrown errors, and cancellation. Collection is guarded for server rendering and disabled production sessions. For React workspaces, use `PerformanceBoundary`; for a new benchmark, record its result in the app scenario, attach the JSON report, and add a budget with a meaningful limit. Run the production comparison before reporting the feature complete. `AGENTS.md` makes this part of the development workflow.
