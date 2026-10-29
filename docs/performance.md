# Performance measurements

Run these commands from the repository root after `npm ci` and `npx playwright install chromium`:

```bash
npm run perf:baseline
# Make the feature change, then compare against the saved baseline:
npm run perf
```

Both commands build the web app and run Chromium against a fresh preview server on port 4175. Each browser scenario runs three times, with one worker, an empty browser context, HTTP cache disabled, a 1280 × 800 viewport, and 4× CPU throttling. The large-project test seeds browser storage and reloads; this models opening an existing project. GPU tests use Chromium's software renderer. These numbers describe that test environment, rather than a user's GPU performance.

The scenarios cover startup without a project, restoring 10,000 project assets and interacting with the paginated list, and creating/editing/saving a drawing followed by a 2,000-hole Gerber import and a STEP import. The `symbol-libraries` scenario restores 400 symbols across 10 user and 10 project libraries, disables one user library, opens the picker, and searches the combined library. It requires library loading and resolution below 1.2 seconds, interaction p95 below 2 seconds, fewer than 4,000 DOM nodes, and less than 2.5 MB of decoded scripts in this environment. Add scenarios for new flows and larger representative inputs as features grow.

The `default-symbols` scenario opens the 49-symbol built-in picker repeatedly and places an inductor, LED, NPN transistor, P-channel MOSFET, transformer, and 8-pin connector. The `microcontroller-symbols` scenario separately searches for and places RP2040, RP2350A, and RP2350B with the same budgets. It includes the coil and transformer arc approximations, searches by component name, and measures opening the picker through its first loaded thumbnail. Offscreen items keep skeletons until they approach the scroll viewport. Both symbol scenarios require thumbnail generation p95 below 100 ms. Under the same 4× CPU throttle, it allows interaction p95 below 1.5 seconds, fewer than 2,500 DOM nodes, at most 3 MB of decoded scripts, and frame p95 below 500 ms.

The `editor-box` scenario places a Box, edits the symbol dimensions, drags a Box resize handle, changes its line style and width, and edits multiline text three times. Under the same 4× CPU throttle, interaction p95 must stay below 750 ms, with fewer than 1,500 DOM nodes, at most 3 MB of decoded scripts, and frame p95 below 500 ms.

The large-project scenario also searches for the last of 10,000 files and filters the list by file type. Both interactions must finish within 750 ms. Search and filter results keep pagination, so the page renders at most 50 file rows.

The `editor-symbol-file` scenario measures the first open of a 128-pin symbol file, then opens the symbol and project schematic three times each. Symbol editing uses a borderless grid, and schematic editing restores the worksheet. The test stores timings directly because the bounded diagnostic event log can discard the first file open. Under the same 4× CPU throttle, both the first open and repeated-open interaction p95 have a 1.2-second budget, with fewer than 1,500 DOM nodes, at most 3 MB of decoded scripts, and frame p95 below 500 ms.

The `editor-symbol-attributes` scenario places a 128-pin project symbol and opens its reusable definition through the Attributes popup three times. Opening the definition has an interaction p95 budget of 1.2 seconds, with fewer than 1,500 DOM nodes, at most 3 MB of decoded scripts, and frame p95 below 500 ms under the same test conditions.

The `symbol-references` scenario imports a 16-pin child and a parent with four child references, places the parent, checks that the saved schematic contains no copied geometry, reloads, and opens the nested definition three times. Under the same test conditions, interaction p95 must stay below 1.5 seconds and symbol resolution p95 below 250 ms, with fewer than 1,500 DOM nodes, at most 3 MB of decoded scripts, and frame p95 below 500 ms.

The `editor-user-symbol` scenario opens a 128-pin user-library definition without an open project, adds a shape, waits for autosave, and returns to the schematic three times. Opening and saving have an interaction p95 budget of 2 seconds, with fewer than 1,500 DOM nodes, at most 3 MB of decoded scripts, and frame p95 below 500 ms under the same test conditions.

The `project-new-symbol` scenario creates an empty symbol through the project page, draws and saves its first shape, then reopens the symbol file. Creation through a ready symbol editor must finish within 3 seconds, with fewer than 1,500 DOM nodes, at most 3 MB of decoded scripts, and frame p95 below 500 ms under the same test conditions.

The timed user-symbol and new-symbol interactions check readiness each animation frame. This includes the lazy dialog, file creation, an enabled editor, and the saved shape count and status for autosave. Assertion retry backoff can add hundreds of milliseconds after those conditions are met, so these measurements use browser predicates with a 30-second timeout instead.

The symbol timing limits were set about 30% above the repeated-run medians recorded in [the October 21 CI run](https://github.com/rolaca11/ecad/actions/runs/39650112518). Node 24.14.0 recorded 2,267.6 ms for creation and 1,526.2 ms for user-symbol interaction p95. The creation measurement includes loading the dialog and editor, entering the name, and saving the file. The user-symbol measurement includes choosing a tool, drawing, and the 400 ms autosave debounce. The previous 2-second and 1.5-second limits failed on these existing workflows. These allowances came from hosted-runner measurements. Local baseline comparisons retain their existing regression limits. DOM, script-size, and frame budgets are unchanged.

The `editor-text-alignment` scenario places two reusable connectors with twelve text boxes each, then changes both alignment axes on a resistor reference and a multiline text box through left/top, center/middle, and right/bottom. It checks that the symbol stays fixed. Under the same 4× CPU throttle, interaction p95 must stay below 750 ms, with fewer than 1,500 DOM nodes, at most 3 MB of decoded scripts, and frame p95 below 500 ms.

The `editor-symbol-text` scenario places a resistor and edits its reference and value positions by selecting them on the canvas three times each. It checks that the symbol center stays fixed. The `editor-symbol-children` scenario places a symbol with 128 named pins, a rectangle and static text, then selects and edits each kind of child three times. This fixture explicitly unlocks its rectangle and pins to exercise customization. Both scenarios require interaction p95 below 750 ms, fewer than 1,500 DOM nodes, at most 3 MB of decoded scripts, and frame p95 below 500 ms under the same 4× CPU throttle.

The `editor-item-locks` scenario places a 128-pin symbol with static text and a rectangle, locks it, enables Select locked items, selects it through the canvas, then unlocks it. One repetition changes the Locked attribute in Attributes, and the others use the toolbar action. The fixture starts with a locked child pin. The scenario repeats the flow three times and checks that the toolbar flag can select its parent. Under the same 4× CPU throttle, interaction p95 must stay below 750 ms and frame p95 below 500 ms, with fewer than 1,500 DOM nodes and at most 3 MB of decoded scripts.

The `project-file-sidebar` scenario restores 10,000 project assets and opens a 128-pin symbol and the drawing directly from the global sidebar three times. It checks that the sidebar and search persist through navigation. Hovering the invisible left-edge handle reveals the sidebar within 750 ms, measured by `hoverRevealMs`. It switches workspaces and reopens the drawing through the revealed sidebar three times, with a 1.2-second budget for `railNavigationMs`. That metric keeps its previous name for baseline comparisons. The sidebar slides over the canvas, which starts at the left edge even while the panel is open. The scenario also pins and unpins the panel three times, with a 750 ms budget for `pinMs`. Pinning reserves space beside the canvas and keeps the sidebar open after the pointer leaves. Unpinning restores the overlay and the full canvas width. It also reveals and hides the panel on a narrow viewport. Under the same 4× CPU throttle, interaction p95 must stay below 1.2 seconds, with fewer than 1,500 DOM nodes, at most 3 MB of decoded scripts, and frame p95 below 500 ms.

The sidebar scenario also opens the Add file menu and dismisses it with Escape three times in the same 10,000-asset project. Opening the menu has a 750 ms budget under the same test conditions. It checks the drawing, symbol, and circuit creation actions and keyboard focus returning to the plus button.

The `project-new-drawing` scenario creates a named drawing, draws and autosaves its first shape, reloads the project, then opens the new drawing and the primary drawing three times. Creation has a 3-second budget and reopening has a 1.2-second budget under the same 4× CPU throttle, with fewer than 1,500 DOM nodes, at most 3 MB of decoded scripts, and frame p95 below 500 ms.

The `editor-toolbar` scenario opens and switches each tool group, selects Rectangle, closes the group, and returns to Select three times. Under the same 4× CPU throttle, its interaction p95 budget is 750 ms, with fewer than 1,500 DOM nodes and at most 3 MB of decoded scripts.

The `editor-line-styles` scenario opens 100 rectangles, circles, triangles, and lines with patterned strokes, changes their styles together, checks the saved styles, and reloads the drawing. Under the same 4× CPU throttle, its interaction p95 budget is 1.5 seconds and stroke geometry p95 budget is 50 ms per shape, with fewer than 1,500 DOM nodes, at most 3 MB of decoded scripts, and frame p95 below 500 ms.

The `editor-pin-wire` scenario clicks an unconnected pin in Select mode to start a wire, places a segment, ends the chain, and undoes the segment three times. Starting the wire has an interaction p95 budget of 750 ms, with fewer than 1,500 DOM nodes, at most 3 MB of decoded scripts, and frame p95 below 500 ms under the same test conditions.

The `editor-symbol-rotate` scenario places a resistor and rotates it counterclockwise and clockwise three times with R and Shift + R, checking the committed angle and waiting for rendering while its center stays fixed. Under the same 4× CPU throttle, interaction p95 must stay below 750 ms, with fewer than 1,500 DOM nodes, at most 3 MB of decoded scripts, and frame p95 below 500 ms.

The `editor-symbol-duplicate` scenario places a resistor and Alt-drags three copies. Each gesture includes the duplicate preview and release through the updated reference in Attributes. Under the same 4× CPU throttle, interaction p95 must stay below 750 ms, with fewer than 1,500 DOM nodes, at most 3 MB of decoded scripts, and frame p95 below 500 ms.

The `editor-component-move` scenario moves a two-pin resistor attached to a wire and another pin in a drawing with 200 background wire segments. It repeats the diagonal drag three times with undo between moves and checks that storage contains the new orthogonal connections. Under the same 4× CPU throttle, interaction p95 must stay below 750 ms and wire normalization p95 below 100 ms, with fewer than 1,500 DOM nodes, at most 3 MB of decoded scripts, and frame p95 below 500 ms.

The `editor-wire-junction` scenario opens a schematic with 200 wire segments, draws a trunk and a branch, joins the branch to the trunk midpoint three times with undo between joins, and checks that storage contains the split trunk. Under the same 4× CPU throttle, interaction p95 must stay below 750 ms and wire normalization p95 below 100 ms, with fewer than 1,500 DOM nodes, at most 3 MB of decoded scripts, and frame p95 below 500 ms. The `editor.wire-normalize` metric covers merging and splitting in the shared drawing commands.

The `editor-pin-junction` scenario uses the same 200-segment fixture and budgets as `editor-wire-junction`. It places a pin on the trunk midpoint three times with undo between placements, then checks that storage contains both halves of the trunk.

The `editor-wire-crossings` scenario opens 40 wires with 400 unconnected crossings and selects all wires three times. Each crossing has a bridge arch and a gap in the wire beneath it. Under the same 4× CPU throttle, interaction p95 must stay below 750 ms, crossing detection p95 below 100 ms, and frame p95 below 500 ms, with fewer than 1,500 DOM nodes and at most 3 MB of decoded scripts. The `editor.wire-crossings` metric covers crossing detection and bridge layout.

The `editor-pin-leads` scenario places a native pin, names it, and edits its lead length, angle, and terminal position three times. It uses a 750 ms interaction p95 budget, 1,500 DOM nodes, 3 MB of decoded scripts, and 500 ms frame p95 under the same local test conditions.

The `editor-pin-labels` scenario opens a symbol with 128 named and numbered pins, adds a pin, and edits its name and number three times through Attributes. Under the same 4× CPU throttle, interaction p95 must stay below 750 ms, with fewer than 1,500 DOM nodes, at most 3 MB of decoded scripts, and frame p95 below 500 ms.

The `editor-pin-visibility` scenario uses the same 128-pin symbol fixture as `editor-pin-labels`. It toggles Show name and Show number independently three times each and waits for a rendered frame. Its budgets are 750 ms for interaction p95, 500 ms for frame p95, 1,500 DOM nodes, and 3 MB of decoded scripts under the same local test conditions.

The `editor-pin-heavy` scenario restores 2,000 pins and 1,000 wires, then clicks empty canvas five times. Its interaction p95 budget is 750 ms, with fewer than 1,500 DOM nodes and at most 3 MB of decoded scripts. Pin lookup checks connectivity only for terminals within the pointer's hit area, and unchanged selections skip rendering. The `editor.pin-hit-test` metric measures that lookup without including selection or rendering.

The `desktop-storage` scenario measures native Node filesystem operations without CPU throttling. It saves 2,000 drawing shapes and 50 symbols in the legacy layout, migrates them to visible files, edits and saves the drawing, copies a 10 MiB source file, and reopens the project. It checks that migration removes empty `.ecad` folders and that saved data survives reopening. Its budgets allow 2 seconds each for saving and loading, and 3 seconds each for migration and source copying. The source bytes measure storage I/O, not STEP parsing. It also measures saving and loading the home-directory symbol config and reading a 50-file configured directory, with a 1-second budget for each operation. Each report records the Node version and workload sizes.

The `cli-drawing` scenario runs the built CLI under native Node without CPU throttling. It measures help startup before creating a drawing fixture, then places 2,000 rectangles through stdin, reads the saved drawing in a new process, and undoes the edit. It also initializes the standalone stdio server, lists its tools, and places the same batch through an MCP client. The workload includes local drawing writes and persistent undo history. Budgets allow 500 ms for help startup and 3 seconds each for placement, reading, undo, stdio initialization with tool discovery, and stdio placement. Each report records the Node version and shape count. Run it with `npm run perf -- --grep cli-drawing`. The performance runner builds the CLI before running scenarios.

The absolute timing budgets were calibrated with 4× CPU throttling and software rendering, including measurements from [the first CI run](https://github.com/rolaca11/ecad/actions/runs/37324627616) and [the next CI run](https://github.com/rolaca11/ecad/actions/runs/37325490010):

| Scenario and metric | Largest recorded value | Budget |
| --- | --- | --- |
| Empty-project event-loop p95 | 200 ms | 300 ms |
| Large-project event-loop p95 | 321 ms | 500 ms |
| Large-project interaction p95 | 579 ms | 750 ms |
| Import CPU frame submission p95 | 362 ms | 500 ms |
| Import event-loop p95 | 1,007 ms | 1,500 ms |

These limits are reference points for this test environment, not responsiveness targets. Use the import and frame measurements to guide further optimization. Local baseline comparisons retain their tighter relative limits.

`perf-artifacts/latest.json` contains individual reports and per-scenario medians and p95 values across runs. `perf-artifacts/baseline.json` stores the local comparison baseline. Artifacts are ignored by Git. Explicit budgets live in `tests/performance/budgets.ts`. Every run must provide finite required measurements and stay within DOM limits. Timing budgets apply to the median across repeated runs, so a single timing spike does not fail the comparison. Individual outliers remain in the JSON report. A focused run with one sample still enforces its timing budgets.

With a baseline, the reporter also fails if a median exceeds the old median by 25% plus the metric's noise allowance. A baseline must match the mode, CPU throttle, platform, and browser version. Recapture it explicitly after an environment change. Baseline capture only succeeds when all executed tests and budgets pass.

Event-loop baseline comparisons allow 100 ms of sampling noise. The collector samples every 250 ms, so short scenarios vary with the timer's alignment to import tasks. Repeated local measurements of the same app build produced median event-loop p95 values between 156 and 258 ms while CPU frame submission stayed around 200 ms. Import duration, blocking time, and frame time retain their separate regression checks.

Performance benchmarks run locally, following `AGENTS.md`. GitHub Actions does not run them. Hosted-runner variation made the absolute timing budgets unreliable as CI gates. A run that passed all symbol budgets failed an unrelated empty-project event-loop budget. Compare before and after on the same machine with a matching baseline, and inspect `perf-artifacts/latest.json` before reporting a performance change.

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

The `kicad-import` scenario selects the licensed RP2350A schematic through the Files sidebar after first testing malformed-input recovery. It converts 87 component instances and 272 terminals, persists and opens the resulting 663 shapes, downloads the conversion report, and verifies that the drawing survives reload. Under the same 4× Chromium CPU throttle, conversion has a 1.5-second budget and the import-through-render interaction has a 5-second budget. DOM, decoded scripts and frame p95 limits are 2,000 nodes, 3 MB and 500 ms. The frame measurement includes the cold render of the entire reference sheet. Keep this limit when investigating slow runs and avoid concurrent benchmarks on the same machine. The `import.kicad` metric covers parsing, conversion and schema validation. This new scenario has no pre-feature counterpart. Use `ECAD_PERF_PORT` to select a free local preview port when other worktrees are benchmarking.

The `editor-named-nets` scenario opens 346 wires and 94 electrical labels, places a supply label, and renames it three times. Under the same 4× CPU throttle, interaction p95 must remain below 750 ms, with fewer than 1,800 DOM nodes, at most 3 MB of scripts, and frame p95 below 500 ms. `named-net-connectivity` measures ten net graph builds for 346 wires, 94 labels, and 272 pins in Node, with a 150 ms p95 budget. It checks ten disconnected named buses electrically joining their wire sections.

Parallel worktrees can select separate test ports with `ECAD_PERF_PORT` and `ECAD_BROWSER_PORT`. Run production performance comparisons without competing benchmark runs on the same machine.

Run `npx tsx scripts/performance/named-nets.ts` for focused 5,000-wire connectivity validation without a browser or production build. It uses three fresh stores and five repeated reads per store, checks that all disconnected wires remain separate, and records first-read and repeated-read p95 in `artifacts/named-nets-5000-after.json`. Local budgets are 250 ms for first reads and 25 ms for cached reads, excluding serialization. `--baseline` records the same workload before a change without enforcing those budgets.

The `schematic-export` scenario restores the RP2350A reference fixture and downloads full-sheet SVG and 9600 × 6400 PNG output. Under the standard 4× CPU throttle it budgets 5 seconds for SVG generation and 15 seconds for the complete PNG export, with fewer than 1,500 DOM nodes and at most 3 MB of decoded scripts. `drawing.export-svg` measures shared geometry and text serialization. `drawing.export` also includes PNG decoding, rasterization, encoding and download initiation. The new flow has no pre-feature measurement. Use `editor-box` to compare the existing editor against its pre-feature baseline.

## Circuit graph workload

The `circuit-untangle` scenario opens 32 components and 17 nets, overlaps two components with a drag, and untangles the graph three times. It checks that component bodies no longer overlap. Under the standard Chromium configuration with 4× CPU throttling, interaction p95 must stay below 1 second, `circuit.untangle` p95 below 250 ms, and graph construction p95 below 100 ms, with fewer than 2,200 DOM nodes and at most 3 MB of decoded scripts. The layout search compares curve crossings, node overlaps, and wire length. Metadata contains component and net counts only. This new flow has no pre-feature counterpart. Circuit loading now generates view positions locally; layout edits do not save files.

The `circuit-collapse` scenario opens a 128-pin component with two connected pins and two resistors. It collapses and expands the large component three times, checks that all of its pins disappear when collapsed, and verifies all four membership edges remain. Under the standard Chromium configuration with 4× CPU throttling, interaction p95 must stay below 750 ms, graph construction and commands each below 100 ms p95, with fewer than 2,500 DOM nodes and at most 3 MB of decoded scripts. This new flow has no pre-feature measurement. `circuit-graph` and `circuit-components` compare existing editor interactions before and after the controls are added.

The `circuit-grid-snap` scenario uses the 32-component circuit and drags a component through six pointer moves to a snapped position, then undoes the move, three times. Under the standard Chromium configuration with 4× CPU throttling, the drag through its visible result has a 1-second interaction p95 budget, graph construction and commands each have a 100 ms p95 budget, with fewer than 2,200 DOM nodes and at most 3 MB of decoded scripts. This new pointer scenario has no pre-feature measurement. `circuit-graph` compares the existing keyboard movement flow before and after snapping.

The `circuit-net-editing` scenario opens 32 components with 64 unconnected pins, places a standalone GND net, names it inline, drags three pins onto it, and deletes the three individual connections. It checks that GND remains after its last connection is removed and waits for autosave. Under the standard Chromium configuration with 4× CPU throttling, interaction p95 must stay below 1 second, graph construction and commands each below 100 ms p95, with fewer than 2,200 DOM nodes and at most 3 MB of decoded scripts. This new flow has no pre-feature measurement.

The `circuit-graph` scenario opens a saved circuit containing 32 components, 64 pins, and 17 nets, including one 32-pin ground net. It moves a component three times and checks that these view edits leave the saved circuit unchanged. Under the standard Chromium configuration with 4× CPU throttling, opening has a 1.5-second budget, interaction p95 has a 750 ms budget, and headless graph construction and commands each have a 100 ms p95 budget. The DOM limit is 2,200 nodes and the decoded script limit is 3 MB. Circuit graph and command timings use `circuit.graph` and `circuit.edit`, with component and net counts as metadata. No circuit names, pin names, or file paths enter those metrics.

The `circuit-connect` scenario uses the same 32-component circuit. It drags between two pins to merge a signal net into the 32-pin ground net, checks the connection preview and committed net count, waits for autosave, and undoes the connection three times. Under the same 4× CPU throttle, the drag through the visible connection has a 750 ms interaction p95 budget, graph construction and commands each have a 100 ms p95 budget, with fewer than 2,200 DOM nodes and at most 3 MB of decoded scripts. This interaction has no pre-feature counterpart.


The `circuit-components` scenario loads 100 project symbols, opens the component picker, and places two built-in resistors and a project symbol with 128 pins. Each timed placement includes catalog refresh, search, placement, and autosave. Under the standard 4× CPU throttle it allows interaction p95 below 2.5 seconds, library resolution below 1.2 seconds, graph construction and symbol-to-component conversion p95 below 100 ms each, and thumbnail p95 below 100 ms. It allows fewer than 2,500 DOM nodes after placement and at most 3 MB of decoded scripts. `circuit.component-from-symbol` records shape and existing-component counts, without symbol names or project contents.

The `circuit-auto-names` scenario opens 32 components with 64 unconnected pins, connects three pairs, and checks each derived net label before undoing. It uses the standard Chromium configuration with 4× CPU throttling. Interaction p95 must stay below 1 second, graph construction and commands below 100 ms p95, with fewer than 2,200 DOM nodes and at most 3 MB of decoded scripts. Existing graph and net editing scenarios provide before and after comparisons.

The `circuit-keyboard-placement` scenario starts with 32 components and 64 unconnected pins. It places three resistors and three standalone nets with keyboard controls, moving previews and undoing each net placement in one step. Its 2.5-second interaction budget includes symbol picker search and both placements, matching the existing symbol placement budget. Graph construction and commands each remain below 100 ms p95, with fewer than 2,200 DOM nodes and at most 3 MB of decoded scripts under 4× CPU throttling.
