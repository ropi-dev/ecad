# Performance measurements

Run these commands from the repository root after `pnpm install --frozen-lockfile` and `pnpm exec playwright install chromium`:

```bash
# Performance work in a thread: compare named scenarios against the merge base.
pnpm run perf --grep 'editor-pan|editor-toolbar'
# Compare against another ref, such as the base branch of a stacked pull request:
pnpm run perf --grep editor-pan --base origin/my-base-branch
# Once per batch of merged commits, from a clean checkout of origin/main:
pnpm run perf:main
# After it: every scenario against the absolute budgets, 4× throttled:
pnpm run perf:budgets
```

## When to measure

Feature and fix threads do not run the timing benchmarks. Reports from 48 A/B runs on the shared host between November 5 and 11, 2026 show why:

- Every run that finished within two minutes compared three scenarios or fewer. An ordinary editor change selects 48 to 66, and those runs took 17 to 42 minutes, nearly all of it under exclusive access to the benchmark lock, which other threads' sandbox tests wait on.
- 21 of the 48 runs reported a regression. Most were followed by a narrower rerun that passed, so the thread paid for a second run to clear noise. With about 60 scenarios and several metrics each, one false verdict per run is the expected outcome on a host that other threads load.

Timing is checked on main instead, once per batch of merged commits; see [Main check](#main-check). On pull requests, GitHub's smoke job still runs every scenario and enforces the DOM node and script size budgets.

A thread measures when its task is a performance change, or when it adds or edits a scenario. Pass the scenarios that cover the change with `--grep`, at most three. One scenario takes 20 to 140 seconds and three took 49 to 101 seconds. `editor-frame-rate` is the exception at three to seven minutes on its own. Without `--grep`, `pnpm run perf` still selects every scenario the change affects, as described under [Scenario selection](#scenario-selection); `perf:main` relies on that.

## Main check

`pnpm run perf:main` compares main against the commit it last checked. Run it from a clean checkout of `origin/main`, on an idle host.

1. It fetches `origin/main` and reads the checked commit from `main-check.json` in the base build cache, `~/.cache/ecad-perf` unless `ECAD_PERF_CACHE_DIR` is set. Every checkout on the host shares that file.
2. With no checked commit, it records `HEAD` and runs nothing. With no commits since the checked one, it runs nothing.
3. Otherwise it runs the A/B comparison with the checked commit as the base. The scenarios come from the paths changed between the two commits. Options it does not use itself, such as `--all` and `--grep`, go to the comparison.
4. When the only failures are regression verdicts, it reruns those scenarios once. A regression that does not reproduce is reported as noise and the check passes.
5. A pass records `HEAD` as the checked commit. A failure leaves the checked commit unchanged, so the next run covers the same commits again. After a fix, the next run records the new commit. To keep a slowdown, run `pnpm run perf:main --accept`.

For a confirmed regression the output lists the commits in the range and the `--grep` pattern of the regressed scenarios. To find the commit, check out each one and run `pnpm run perf --base <checked commit> --grep '<pattern>'`.

`--since <ref>` compares against another commit for one run. From a checkout with uncommitted changes, or one that is not on `origin/main`, the comparison runs but records nothing.

Run `pnpm run perf:budgets` after the main check passes. It takes about 24 minutes.

Without `--grep`, `pnpm run perf` selects scenarios from the change; see [Scenario selection](#scenario-selection). It needs no baseline: it builds the merge base itself and measures base and head in one session. See [A/B runs](#ab-runs). `pnpm run perf:budgets` runs the full suite unless you pass `--grep`. `pnpm run perf:baseline` is deprecated: it prints that it is no longer needed and runs nothing.

For parallel threads, use the [container setup](parallel-development.md). Native and sandbox performance commands share a host-wide benchmark lock. Native builds hold shared access to it, so they can overlap other builds and tests but never a benchmark's measurement; measurement holds exclusive access. Artifacts live under `/tmp`, with `perf-artifacts` linking to the native checkout's artifact directory. Sandbox artifacts have a separate location.

Browser scenarios run with one worker, an empty browser context, HTTP cache disabled and a 1280 × 800 viewport. A/B runs measure without CPU throttling. The budget run uses 4× CPU throttling and runs each scenario three times. The large-project test seeds browser storage and reloads; this models opening an existing project. GPU tests use Chromium's software renderer. These numbers describe that test environment, rather than a user's GPU performance.

## A/B runs

`pnpm run perf` compares the working tree (head) against a base commit, by default `git merge-base origin/main HEAD`. `--base <ref>` or `ECAD_PERF_BASE` uses the merge base of another ref instead.

1. **Builds.** The head web app and CLI build in the checkout, as before. The base commit is exported with `git archive`, installed with `pnpm install --frozen-lockfile --prefer-offline` and built once, in `~/.cache/ecad-perf/<sha>` (`ECAD_PERF_CACHE_DIR` overrides it). Later runs against the same base reuse that build. pnpm hard-links dependencies from its store, so a cold base build takes seconds. The cache keeps the five most recently used builds, removes builds unused for two weeks, and never removes one used in the last six hours. Parallel builds of the same commit queue on a per-commit lock, and a build that finds the commit already built after waiting reuses it. A run marks the base build it uses, and pruning skips builds a live run marks. Both builds finish before the run takes exclusive access to the benchmark lock.
2. **Servers.** Head and base preview servers start on ports 4175 and 4176 (`ECAD_PERF_PORT`, `ECAD_PERF_BASE_PORT`). A port that is already in use fails the run before measuring, since another server answering there would be measured instead. Servers left by a killed run of the same checkout are recorded by process ID and start time, and stopped first. Both use the head checkout's scenarios, so a base comparison measures the base app with the same steps.
3. **Rounds.** Each round runs the undecided scenarios once against each variant, alternating the order: base then head, then head then base. Every round adds one pair per scenario. CPU throttling is off (`ECAD_PERF_CPU=1` unless set).
4. **Decisions.** After each round, every metric both variants report is compared pair by pair against the limit the old baseline comparison used: `base × 1.25 + floor`, where the floor is the metric's noise allowance in `regressionFloors` in `tests/performance/budgets.ts`. Those floors are absolute milliseconds calibrated under 4× throttling, so timing floors are multiplied by `throttle / 4`: ×0.25 unthrottled (`ECAD_PERF_FLOOR_SCALE` overrides it). The score is the median across pairs of `head / limit`, so a score above 1 is a regression. A metric passes as soon as its score is at most `1 − 0.2/√pairs`. A regression is only decided at the fifth pair (`ECAD_PERF_MAX_PAIRS`), when every metric gets a verdict: a median score above 1 regresses. A metric needs five pairs of its own to regress, so one reported in a single pair cannot fail a scenario. A round can lose a pair, for example to a base failure, so the run allows one spare round (six in all) for every compared scenario to reach five pairs. A scenario regresses when any metric regresses, passes when all pass, and otherwise runs another round.
   - Besides the scenario's own metrics, A/B runs compare `interactionP50Ms`, the median of the run's timed interactions, taken from the `scenario.interaction` metric in each report. Scenarios time three to six interactions, so `interactionP95Ms` is close to their maximum, often a cold first interaction.
   - `eventLoopP95Ms` is reported but does not decide a verdict. Its 250 ms sampling timer makes it bimodal: identical builds measured 10 ms and 600 ms. Its floor is not scaled.
   - See [A/B sensitivity](#ab-sensitivity) for what these rules catch.
5. **Report.** The console prints how many scenarios were compared, head-only and undecided next to the verdict counts, and lists undecided scenarios separately: they have no verdict. `latest.json` stores the same counts under `counts`. The console then lists each scenario's verdict, its worst metric's median head/base ratio, the ratio at the limit (`1.25 + floor / base`), its score and the number of pairs. `perf-artifacts/latest.json` has every pair, the base commit, the load average and the time spent building, waiting for the lock and measuring. Each round's raw reports are in `perf-artifacts/ab`.

A/B runs do not enforce the absolute timing budgets in `budgets.ts`: they are calibrated for 4× throttling. Head still has to provide every required measurement and stay within its DOM node and script size budgets. A head test that fails, or misses a measurement, fails the run. A base failure, for example a scenario that needs a feature the base lacks, leaves that scenario head-only with a warning.

Node scenarios run unthrottled in every mode. `cli-drawing` runs the base commit's built CLI for the base variant (`ECAD_CLI_EXECUTABLE`). `editor-zoom-firefox` and `editor-zoom-chrome` load each variant's preview server in an installed browser, so they are compared like the browser scenarios. `desktop-storage`, `desktop-untitled`, `linked-schematic-sync` and `named-net-connectivity` import the head checkout's source directly, so they run head-only and keep their timing budgets.

`pnpm sandbox perf` runs the same comparison in the benchmark container. The host exports the base source, and the container builds it into the `ecad-perf-base-cache` volume. In the container, builds run inside the benchmark lock.

The budget run, `pnpm run perf:budgets`, is the previous single-variant run with no baseline: every scenario three times, 4× CPU throttling, and the absolute budgets on the medians. `ECAD_PERF_RUNS` changes the repeats. Run it once per batch of merged commits, after the [main check](#main-check).

## A/B sensitivity

Measured on November 5, 2026 on a shared 12-CPU Linux host, unthrottled, with the 43 `@core`/`@editor` scenarios. The rules above were frozen before the last three runs.

- **Identical code (A == A), twice:** 0 regressions among 42 and 43 compared scenarios. Passing scores peaked at 0.86. One run still failed, because `editor-symbol-children` failed functionally on head (see below).
- **Injected regression:** a temporary busy-wait in the R key handler, 90 ms per rotation of a selection and 25 ms per rotation while placing. It raised `interactionP95Ms` by ×1.47–1.50 in the final run, and the median interaction by ×1.75 and ×2.97. The final run flagged exactly `editor-placement-rotate` and `editor-symbol-rotate`, after 5 pairs each.
- **Limit for short interactions:** unthrottled, the limit is about ×1.31 for a 400 ms interaction, ×1.38 at 100 ms and ×1.5 at 50 ms. In an earlier run, the same injection raised the placement p95 by only ×1.17, because the base's slowest interaction varied from 101 to 194 ms. So a +40% regression on an interaction under about 150 ms is at the limit and is not reliably caught. The runs support catching changes that raise the median interaction by about 75% or more, or that triple blocking time. Smaller regressions on short interactions need 2× throttling (`ECAD_PERF_CPU=2`) or more pairs (`ECAD_PERF_MAX_PAIRS`); neither has been evaluated yet.
- **Flake:** before `dbf6e84` ("Let saves finish between symbol child edits"), `editor-symbol-children` sometimes timed out waiting for its child selection (`symbol-child-selection`): on head in 2 of 8 A/B runs, and on base in 1. These runs predate that fix. A head failure fails the run, as it should.

The scenarios cover startup without a project, restoring 10,000 project assets and interacting with the paginated list, and creating/editing/saving a drawing followed by a 2,000-hole Gerber import and a STEP import. The `symbol-libraries` scenario restores 400 symbols across 10 user and 10 project libraries, disables one user library, opens the picker, searches the combined library, then moves the highlight ten rows with the arrow keys and chooses a symbol with Enter. It requires library loading and resolution below 1.2 seconds, interaction p95 below 2 seconds, fewer than 4,000 DOM nodes, and less than 2.5 MB of decoded scripts in this environment. Add scenarios for new flows and larger representative inputs as features grow.

The `default-symbols` scenario opens the 61-symbol built-in picker repeatedly and places an inductor, LED, NPN transistor, P-channel MOSFET, transformer, and 8-pin connector. The `microcontroller-symbols` scenario separately searches for and places RP2040, RP2350A, and RP2350B with the same budgets. It includes the coil and transformer arc approximations, searches by component name, and measures opening the picker through its first loaded thumbnail. Offscreen items keep skeletons until they approach the scroll viewport. Both symbol scenarios require thumbnail generation p95 below 100 ms. Under the same 4× CPU throttle, it allows interaction p95 below 1.5 seconds, fewer than 2,500 DOM nodes, at most 3 MB of decoded scripts, and frame p95 below 500 ms.

The `editor-box` scenario places a Box, then three times edits its font size, drags a resize handle, changes its line style and line width, and edits multiline text. The style alternates between dashed and dotted, and the widths are 16, 20 and 24 mil (about 0.41, 0.51 and 0.61 mm), because the symbol Attributes panel takes line width in mils. Under the same 4× CPU throttle, interaction p95 must stay below 750 ms, with fewer than 1,500 DOM nodes, at most 3 MB of decoded scripts, and frame p95 below 500 ms.

The large-project scenario also searches for the last of 10,000 files and filters the list by file type. Both interactions must finish within 750 ms. Search and filter results keep pagination, so the page renders at most 50 file rows.

The `editor-symbol-file` scenario measures the first open of a 128-pin symbol file, then opens the symbol and project schematic three times each. Symbol editing uses a borderless grid, and schematic editing restores the worksheet. The test stores timings directly because the bounded diagnostic event log can discard the first file open. Under the same 4× CPU throttle, both the first open and repeated-open interaction p95 have a 1.2-second budget, with fewer than 1,500 DOM nodes, at most 3 MB of decoded scripts, and frame p95 below 500 ms.

The `editor-symbol-attributes` scenario places a 128-pin project symbol and opens its reusable definition through the Attributes popup three times. Opening the definition has an interaction p95 budget of 1.2 seconds, with fewer than 1,500 DOM nodes, at most 3 MB of decoded scripts, and frame p95 below 500 ms under the same test conditions.

The `symbol-references` scenario imports a 16-pin child and a parent with four child references, places the parent, checks that the saved schematic contains no copied geometry, reloads, and opens the nested definition three times. Under the same test conditions, interaction p95 must stay below 1.5 seconds and symbol resolution p95 below 250 ms, with fewer than 1,500 DOM nodes, at most 3 MB of decoded scripts, and frame p95 below 500 ms.

The `editor-user-symbol` scenario opens a 128-pin user-library definition without an open project, adds a shape, waits for autosave, and returns to the schematic three times. Opening and saving have an interaction p95 budget of 2 seconds, with fewer than 1,500 DOM nodes, at most 3 MB of decoded scripts, and frame p95 below 500 ms under the same test conditions.

The `project-new-symbol` scenario creates an empty symbol through the project page, draws and saves its first shape, then reopens the symbol file. Creation through a ready symbol editor must finish within 3 seconds, with fewer than 1,500 DOM nodes, at most 3 MB of decoded scripts, and frame p95 below 500 ms under the same test conditions.

The timed user-symbol and new-symbol interactions check readiness each animation frame. This includes the lazy dialog, file creation, an enabled editor, and the saved shape count and status for autosave. Assertion retry backoff can add hundreds of milliseconds after those conditions are met, so these measurements use browser predicates with a 30-second timeout instead.

The symbol timing limits were set about 30% above the repeated-run medians recorded in [the October 21 CI run](https://github.com/rolaca11/ecad/actions/runs/39650112518). Node 24.14.0 recorded 2,267.6 ms for creation and 1,526.2 ms for user-symbol interaction p95. The creation measurement includes loading the dialog and editor, entering the name, and saving the file. The user-symbol measurement includes choosing a tool, drawing, and the 400 ms autosave debounce. The previous 2-second and 1.5-second limits failed on these existing workflows. These allowances came from hosted-runner measurements. Local A/B comparisons keep their relative regression limits. DOM, script-size, and frame budgets are unchanged.

The `editor-text-alignment` scenario places two reusable connectors with twelve text boxes each, then changes both alignment axes on a resistor reference and a multiline text box through left/top, center/middle, and right/bottom. It checks that the symbol stays fixed. Under the same 4× CPU throttle, interaction p95 must stay below 750 ms, with fewer than 1,500 DOM nodes, at most 3 MB of decoded scripts, and frame p95 below 500 ms.

The `editor-symbol-text` scenario places a resistor and edits its reference and value positions by selecting them on the canvas three times each. It checks that the symbol center stays fixed. The `editor-symbol-children` scenario places a symbol with 128 named pins, a rectangle and static text, then selects and edits each kind of child three times. This fixture explicitly unlocks its rectangle and pins to exercise customization. Both scenarios require interaction p95 below 750 ms, fewer than 1,500 DOM nodes, at most 3 MB of decoded scripts, and frame p95 below 500 ms under the same 4× CPU throttle.

The `editor-item-locks` scenario places a 128-pin symbol with static text and a rectangle, locks it, enables Select locked items, selects it through the canvas, then unlocks it. One repetition changes the Locked attribute in Attributes, and the others use the toolbar action. The fixture starts with a locked child pin. The scenario repeats the flow three times and checks that the toolbar flag can select its parent. Under the same 4× CPU throttle, interaction p95 must stay below 750 ms and frame p95 below 500 ms, with fewer than 1,500 DOM nodes and at most 3 MB of decoded scripts.

The `project-file-sidebar` scenario restores 10,000 project assets and opens a 128-pin symbol and the drawing directly from the global sidebar three times. It checks that the sidebar and search persist through navigation. Hovering the icon rail reveals the sidebar within 750 ms, measured by `hoverRevealMs`. It switches workspaces and reopens the drawing through the revealed sidebar three times, with a 1.2-second budget for `railNavigationMs`. That metric keeps its previous name for baseline comparisons. The rail takes 48 pixels beside the canvas, and the sidebar slides out beside the rail over the canvas. It also reveals and hides the panel on a narrow viewport. Under the same 4× CPU throttle, interaction p95 must stay below 1.2 seconds, with fewer than 1,500 DOM nodes, at most 3 MB of decoded scripts, and frame p95 below 500 ms.

The sidebar scenario also opens the Add file menu and dismisses it with Escape three times in the same 10,000-asset project. Opening the menu has a 750 ms budget under the same test conditions. It checks the drawing, symbol, and circuit creation actions and keyboard focus returning to the plus button.

The `project-new-drawing` scenario creates a named drawing, draws and autosaves its first shape, reloads the project, then opens the new drawing and the primary drawing three times. Creation has a 3-second budget and reopening has a 1.2-second budget under the same 4× CPU throttle, with fewer than 1,500 DOM nodes, at most 3 MB of decoded scripts, and frame p95 below 500 ms.

The `editor-toolbar` scenario opens and switches each tool group, selects Rectangle, closes the group, and returns to Select three times. Under the same 4× CPU throttle, its interaction p95 budget is 750 ms, with fewer than 1,500 DOM nodes and at most 3 MB of decoded scripts.

The `editor-line-styles` scenario opens 100 rectangles, circles, triangles, and lines with patterned strokes, changes their styles together, checks the saved styles, and reloads the drawing. Under the same 4× CPU throttle, its interaction p95 budget is 1.5 seconds and stroke geometry p95 budget is 50 ms per shape, with fewer than 1,500 DOM nodes, at most 3 MB of decoded scripts, and frame p95 below 500 ms.

The `editor-pin-wire` scenario clicks an unconnected pin in Select mode to start a wire, places a segment, ends the chain, and undoes the segment three times. Starting the wire has an interaction p95 budget of 750 ms, with fewer than 1,500 DOM nodes, at most 3 MB of decoded scripts, and frame p95 below 500 ms under the same test conditions.

The `editor-placement-rotate` scenario rotates a pending resistor with R and Shift + R, moves the pointer, and places it three times. It checks that each placement commits a 90-degree angle. Under the same 4× CPU throttle, interaction p95 must stay below 750 ms, with fewer than 1,500 DOM nodes, at most 3 MB of decoded scripts, and frame p95 below 500 ms.

The `editor-symbol-rotate` scenario places a resistor and rotates it counterclockwise and clockwise three times with R and Shift + R, checking the committed angle and waiting for rendering while its center stays fixed. Under the same 4× CPU throttle, interaction p95 must stay below 750 ms, with fewer than 1,500 DOM nodes, at most 3 MB of decoded scripts, and frame p95 below 500 ms.

The `editor-symbol-duplicate` scenario places a resistor and Alt-drags three copies. Each gesture includes the duplicate preview and release through the updated reference in Attributes. Under the same 4× CPU throttle, interaction p95 must stay below 750 ms, with fewer than 1,500 DOM nodes, at most 3 MB of decoded scripts, and frame p95 below 500 ms.

The `editor-component-move` scenario moves a two-pin resistor attached to a wire and another pin in a drawing with 200 background wire segments. It repeats the diagonal drag three times with undo between moves and checks that storage contains the new orthogonal connections. Under the same 4× CPU throttle, interaction p95 must stay below 750 ms and wire normalization p95 below 100 ms, with fewer than 1,500 DOM nodes, at most 3 MB of decoded scripts, and frame p95 below 500 ms.

The `editor-pan` scenario opens a full sheet of 30 × 30 resistors chained pin to pin, 1,770 shapes in all, and pans it with one wheel event per animation frame for 90 frames, once at the fitted zoom and once three zoom steps in. `panFrameP50Ms` and `panFrameP95Ms` are the median and p95 intervals between animation frames during the pans. Under the 4× CPU throttle the median must stay below 34 ms, so a pan that drops to 30 frames per second fails, the p95 below 70 ms, each pan below 4 seconds, renderer frame p95 below 50 ms and DOM nodes below 1,000. When the scenario was added it measured 16.7 ms, 33.4 ms, 1.9 seconds, 19 ms and 476 nodes. Before the pan reused its last frame, the same pan ran at about 12 frames per second without throttling.

The `editor-frame-rate` scenario opens a full sheet of 30 × 30 resistors chained pin to pin, with row 11 left empty, and compares the mean interval between animation frames during each interaction with the interval at rest. `<name>DropPct` is the drop in frame rate during that interaction and `<name>FrameP95Ms` its p95 frame interval. It pans and zooms at the fitted view (`pan-fit`, `zoom-fit`) and three zoom steps in (`pan`, `zoom`), then, three zoom steps in, sweeps the pointer over parts (`hover`), clicks twelve parts in turn (`select`), drags a marquee from the empty row (`marquee`), drags the marquee selection and then one part (`move-group`, `move`), sweeps a resistor placement preview (`place`) and draws a wire preview from a pin (`wire`). The goal is a drop below 10% for every interaction. It is measured unthrottled, so treat it as a local check rather than a budget. Scenarios run with canvas antialiasing off, because the Playwright configuration stores `"antialiasing": "off"` in the `ecad.settings.v1` setting. Set `ECAD_PERF_ANTIALIAS=1` to keep it on. Do that when the base commit predates the setting, since such a base always antialiases and the comparison would otherwise favor head. With antialiasing on, SwiftShader's 4× multisampling raises a zoom frame on the full sheet from about 17 ms to about 22 to 24 ms, because zoom redraws the whole view each frame.

The `editor-zoom-firefox` and `editor-zoom-chrome` scenarios open the empty schematic editor in the Firefox and Google Chrome installed on the machine, headless, in a 1600 × 1000 window with the frame-rate limit lifted. They zoom in and out with one Ctrl + wheel event per frame for 2.5 seconds, then again with Ctrl held so the shortcut hints are shown. `zoomFrameMs` and `zoomHeldFrameMs` are the mean time between frames, `zoomScriptMs` and `zoomHeldScriptMs` the mean time per frame in animation callbacks and their microtasks, and `zoomWrites` the DOM attribute writes per zoom frame. The only budget is `zoomWrites` below 60. It measured 38 when the scenarios were added, and 159 before the rulers stopped laying their ticks out through React. A/B runs compare the timings, with noise floors of 0.5 ms per frame and 0.25 ms of script. Those floors do not scale with the CPU throttle, because the harness cannot throttle these browsers. Against the commit before that ruler change, Chrome was past its limit on all five metrics and Firefox on four.

The scenarios run from Node. `tests/performance/real-browser.ts` speaks WebDriver BiDi to Firefox and the DevTools protocol to Chrome, with throwaway profiles and no extra dependency. A scenario is skipped when its browser is not installed or cannot create a WebGL context. Headless Firefox needs an X display for WebGL, so without `DISPLAY` the scenario starts a private Xvfb when the `xvfb` package is installed. Chrome is tried with `--use-angle=vulkan` first, since headless Chrome otherwise renders in software on some drivers. Each report names the browser version and the WebGL renderer the run used. `ECAD_PERF_FIREFOX` and `ECAD_PERF_CHROME` name another binary to use. A headless browser has no display to pace against, so these scenarios see the script, style, layout and paint work of a frame, not on-screen frame pacing. On a GTX 1660 SUPER a zoom frame took 3.9 ms in Firefox 158 and 1.1 ms in Chrome 157, within about 2% over three runs.

The `editor-dense-drag` scenario opens a block of 20 × 20 resistors chained pin to pin, 780 shapes in all, and drags the middle resistor two and a half columns across and one and a half rows up in ten pointer steps. Each step reroutes both of its wires around the resistors in the way. It repeats the drag three times with undo between drags. Under the same 4× CPU throttle, the whole drag including release must stay below 6 seconds, each pointer step below 600 ms, and the `editor.rubber-band` metric below 100 ms p95, with fewer than 1,500 DOM nodes, at most 3 MB of decoded scripts, and frame p95 below 500 ms. The limits are about twice the values measured when the scenario was added: 3.2 seconds, 252 ms and 46 ms. `editor.rubber-band` covers rerouting the wires of moved or rotated shapes, and `editor.wire-route` covers routing the last leg of a drawn wire to a connection.

The `editor-wire-junction` scenario opens a schematic with 200 wire segments, draws a trunk and a branch, joins the branch to the trunk midpoint three times with undo between joins, and checks that storage contains the split trunk. Under the same 4× CPU throttle, interaction p95 must stay below 750 ms and wire normalization p95 below 100 ms, with fewer than 1,500 DOM nodes, at most 3 MB of decoded scripts, and frame p95 below 500 ms. The `editor.wire-normalize` metric covers merging and splitting in the shared drawing commands.

The `editor-pin-junction` scenario uses the same 200-segment fixture and budgets as `editor-wire-junction`. It places a pin on the trunk midpoint three times with undo between placements, then checks that storage contains both halves of the trunk.

The `editor-wire-crossings` scenario opens 40 wires with 400 unconnected crossings and selects all wires three times. Each crossing has a bridge arch and a gap in the wire beneath it. Under the same 4× CPU throttle, interaction p95 must stay below 750 ms, crossing detection p95 below 100 ms, and frame p95 below 500 ms, with fewer than 1,500 DOM nodes and at most 3 MB of decoded scripts. The `editor.wire-crossings` metric covers crossing detection and bridge layout.

The `editor-pin-leads` scenario places a native pin, names it, and edits its lead length, angle, and terminal position three times. It uses a 750 ms interaction p95 budget, 1,500 DOM nodes, 3 MB of decoded scripts, and 500 ms frame p95 under the same local test conditions.

The `editor-pin-labels` scenario opens a symbol with 128 named and numbered pins, adds a pin, and edits its name and number three times through Attributes. Under the same 4× CPU throttle, interaction p95 must stay below 750 ms, with fewer than 1,500 DOM nodes, at most 3 MB of decoded scripts, and frame p95 below 500 ms.

The `editor-pin-visibility` scenario uses the same 128-pin symbol fixture as `editor-pin-labels`. It toggles Show name and Show number independently three times each and waits for a rendered frame. Its budgets are 750 ms for interaction p95, 500 ms for frame p95, 1,500 DOM nodes, and 3 MB of decoded scripts under the same local test conditions.

The `editor-pin-heavy` scenario restores 2,000 pins and 1,000 wires, then clicks empty canvas five times. Its interaction p95 budget is 750 ms, with fewer than 1,500 DOM nodes and at most 3 MB of decoded scripts. Pin lookup checks connectivity only for terminals within the pointer's hit area, and unchanged selections skip rendering. The `editor.pin-hit-test` metric measures that lookup without including selection or rendering.

The `editor-selection-drag` scenario opens a schematic with 2,614 shapes: 832 resistors, capacitors, and LEDs in a 32 × 26 grid, a lead from every pin to a bus, 27 buses with net labels, and 64 unconnected vertical wires that cross the buses with bridges. It zooms in, window-selects twelve symbols in the middle row, drags them diagonally in ten pointer steps, waits for a frame after each step, and releases. It repeats the drag three times, with undo between drags. Under the same 4× CPU throttle, the whole drag including release (`interactionP95Ms`) must stay below 18 seconds, each pointer step (`dragStepP95Ms`) below 1.5 seconds, and frame p95 below 500 ms, with fewer than 1,500 DOM nodes and at most 3 MB of decoded scripts. The time limits are about 50% above the medians measured when the scenario was added, 11.9 seconds and 868 ms. The previous renderer, which rebuilt every display and mesh on each pointer move, measured 41.2 seconds and 4.3 seconds on the same machine. The report also records `dragStepMedianMs` and the medians of `editor.scene-display`, which builds the document display, and `editor.scene-update`, which applies it to the Three scene. During a drag, shapes that did not move keep their display objects and meshes. Connectivity analysis still covers the whole drawing on each step.

The `desktop-storage` scenario measures native Node filesystem operations without CPU throttling. It saves 2,000 drawing shapes and 50 symbols as visible files, edits and saves the drawing, copies a 10 MiB source file, and reopens the project. It checks that no `.ecad` folder is created and that saved data survives reopening. Its budgets allow 2 seconds each for saving and loading, and 3 seconds for source copying. The source bytes measure storage I/O, not STEP parsing. It also measures saving and loading the home-directory symbol config and reading a 50-file configured directory, with a 1-second budget for each operation. Each report records the Node version and workload sizes.

The `cli-drawing` scenario runs the built CLI under native Node without CPU throttling. It measures help startup before creating a drawing fixture, then places 2,000 rectangles through stdin, reads the saved drawing in a new process, and undoes the edit. It also initializes the standalone stdio server, lists its tools, and places the same batch through an MCP client. The workload includes local drawing writes and persistent undo history. Budgets allow 500 ms for help startup and 3 seconds each for placement, reading, undo, stdio initialization with tool discovery, and stdio placement. Each report records the Node version and shape count. Run it with `pnpm run perf --grep cli-drawing`. The performance runner builds the CLI before running scenarios.

The absolute timing budgets were calibrated with 4× CPU throttling and software rendering, including measurements from [the first CI run](https://github.com/rolaca11/ecad/actions/runs/37324627616) and [the next CI run](https://github.com/rolaca11/ecad/actions/runs/37325490010):

| Scenario and metric | Largest recorded value | Budget |
| --- | --- | --- |
| Empty-project event-loop p95 | 200 ms | 300 ms |
| Large-project event-loop p95 | 321 ms | 500 ms |
| Large-project interaction p95 | 579 ms | 750 ms |
| Import CPU frame submission p95 | 362 ms | 500 ms |
| Import event-loop p95 | 1,007 ms | 1,500 ms |

These limits are reference points for this test environment, not responsiveness targets. Use the import and frame measurements to guide further optimization. Local A/B comparisons keep their tighter relative limits.

For a budget run, `perf-artifacts/latest.json` contains individual reports and per-scenario medians and p95 values across runs. Artifacts are ignored by Git. Explicit budgets live in `tests/performance/budgets.ts`. Every run must provide finite required measurements and stay within DOM limits. Timing budgets apply to the median across repeated runs, so a single timing spike does not fail the comparison. Individual outliers remain in the JSON report. A focused run with one sample still enforces its timing budgets.

Development runs (`pnpm run perf:dev`) still compare against a stored baseline, `perf-artifacts/development-baseline.json`: the reporter fails if a median exceeds the old median by 25% plus the metric's noise allowance. A baseline must match the mode, CPU throttle, platform, and browser version. Recapture it explicitly after an environment change. Baseline capture only succeeds when all executed tests and budgets pass. Production runs no longer read or write `perf-artifacts/baseline.json`; A/B runs replace it.

Event-loop comparisons allow 100 ms of sampling noise. The collector samples every 250 ms, so short scenarios vary with the timer's alignment to import tasks. Repeated local measurements of the same app build produced median event-loop p95 values between 156 and 258 ms while CPU frame submission stayed around 200 ms. Import duration, blocking time, and frame time retain their separate regression checks.

Performance benchmarks run locally, following `AGENTS.md`. Hosted-runner variation made the absolute timing budgets unreliable as CI gates. A run that passed all symbol budgets failed an unrelated empty-project event-loop budget. Compare before and after on the same machine with an A/B run of the scenarios that cover the change, and inspect `perf-artifacts/latest.json` before reporting a performance change.

GitHub Actions runs the scenarios only as a functional smoke test. The `Performance scenarios (smoke)` job in `browser-tests.yml` runs every scenario once, without CPU throttling, on three workers. It sets `ECAD_PERF_SMOKE=1`. In that mode the reporter still fails a scenario that errors or misses a required measurement, and still enforces the DOM node and script size budgets. It skips every `…Ms` timing budget, never reads or writes a baseline, and always runs every scenario rather than the affected selection. The job keeps scenarios working as the UI changes; it says nothing about speed.

Smoke runs retry a failed test once; benchmark runs never retry. A spec that the UI broke fails both attempts and fails the job. A test that fails and then passes is reported as flaky: Playwright lists it in its summary, the reporter prints `[perf] Warning: … is flaky` with the first attempt's error and records it under `warnings` in `latest.json`, and on GitHub Actions it adds a warning annotation on the spec. Most flakes come from the known product bug where a save that lands during a canvas gesture cancels it, so treat a recurring flaky scenario as a bug to fix, not noise. Only passing attempts contribute measurements. Run the same check locally with:

```bash
ECAD_PERF_SMOKE=1 ECAD_PERF_CPU=1 ECAD_PERF_RUNS=1 pnpm run perf --workers=3
```

A failing scenario fails fast. Actions and `waitForFunction` calls time out after 10 seconds, navigations after 15 seconds, assertions after 15 seconds, and a test after 60 seconds. Scenarios that legitimately take longer, such as `editor-selection-drag` and `editor-dense-drag`, raise their own limits with `test.setTimeout` or a per-call `timeout`. Do not raise the shared limits to hide a stale locator.

Playwright traces and the HTML report are off by default because recording a trace adds work to the timed test. Set `ECAD_PERF_TRACE=1` to keep traces of failing tests in `perf-artifacts/results`, and `ECAD_PERF_HTML=1` to write the HTML report to `perf-artifacts/html`. The CI smoke job enables traces, since it does not measure timing. Scenarios marked `test.fixme` are reported as skipped and do not fail a run.

Development profiling uses a separate Vite dependency cache and warms the server's routes and parser workers before measurements, preventing dependency discovery from reloading the app halfway through a scenario. Browser contexts and their HTTP caches still start empty. Development runs require the same measurements, enforce DOM limits, and compare against their development baseline; shipped time and byte budgets apply to production builds.

```bash
# React development profiling uses development-baseline.json:
pnpm run perf:dev --baseline
pnpm run perf:dev

# Compare with 2× throttling, or allow up to 9 pairs:
ECAD_PERF_CPU=2 pnpm run perf
ECAD_PERF_MAX_PAIRS=9 pnpm run perf

# Focus on one scenario during investigation:
pnpm run perf --grep projects-large
pnpm run perf:budgets --grep projects-large
```

Set `ECAD_PERF_BASELINE_PATH` to use another development comparison file.

## Scenario selection

Every test in `tests/performance` has one or more area tags, listed in `tests/performance/tags.ts`: `@startup`, `@projects`, `@editor`, `@symbols`, `@footprint`, `@circuit`, `@import`, `@storage` and `@cli`. Three cheap, broad scenarios also carry `@core`: `projects-empty`, `projects-large` and `editor-toolbar`. The reporter fails a run that contains a test without a known tag, and `tests/performance-selection.test.ts` checks every listed test.

`pnpm run perf` collects the changed paths: `git diff --name-only` between `HEAD` and its merge base with `origin/main`, plus staged, unstaged and untracked files. The table in `scripts/performance/select.ts` maps each path to areas; the first matching row wins. The run then passes `--grep` with `@core` and those areas to Playwright. It prints each path, the areas it selects and the matching row, so the selection can be audited:

```text
[perf] 1 changed path since origin/main (merge base 4bd3609c3210):
[perf]   packages/core/src/components/editor/Editor2D.tsx → @editor (packages/core/src/components/editor/**)
[perf] Running @core @editor. Pass --all for every scenario.
```

- Documentation, Markdown, `.github`, licenses and unit or browser tests select nothing beyond `@core`.
- Performance harness files that do not change the app being measured select only `@core`: `budgets.ts`, the fixture and helpers in `tests/performance`, and the `tests/browser`, `tests/helpers` and `tests/fixtures` files they import. The CI smoke job runs every scenario against them.
- A changed or added performance spec runs its own tests, matched by file name in `--grep`.
- The lockfile, `package.json` files, TypeScript and Vite configuration, the app shell and routes under `packages/web/src`, the project shell and shared toaster (`components/ui`), `scripts/` (including the selector and runner), the reporter, `comparison.ts` and `playwright.config.ts`, shared project session and storage code, `packages/core/src/lib`, `packages/core/src/performance` and any path no row matches run every scenario. The `packages/core/src/performance` collector, recorder and boundaries produce every browser scenario's metrics, and its storage wrapper is on every save.
- `--all` runs every scenario. An explicit `--grep` replaces the selection; `--grep-invert` and other Playwright options still apply to it. `pnpm run perf:budgets` and smoke runs (`ECAD_PERF_SMOKE=1`) always run every scenario unless you pass `--grep`.
- If the changed paths cannot be listed, for example without an `origin/main` ref, the run uses every scenario and says why. `--base <ref>` or `ECAD_PERF_BASE` lists changes against another ref, such as the base branch of a stacked pull request, and makes its merge base the A/B base.
- `pnpm sandbox perf` selects on the host, because the container copy has no `.git`, and passes the result to the container as `--grep` or `--all`.

`tests/performance-selection.test.ts` follows the static and dynamic imports of the Node-only scenarios (`desktop-storage`, `desktop-untitled`, `cli-drawing`, `named-net-connectivity`, `linked-schematic-sync`) through the workspace and fails if a file they reach does not select them. Browser scenarios load the whole app bundle, so their rows are maintained by hand.

Preview a selection without running anything:

```bash
pnpm exec tsx scripts/performance/select.ts                      # the current change
pnpm exec tsx scripts/performance/select.ts docs/erc.md pnpm-lock.yaml   # given paths
```

An A/B run measures only the selected scenarios, in both variants. A selected scenario that fails on the base is listed under `warnings` in `latest.json` and checked against head's non-timing budgets only.

Give every new scenario at least one area tag, `test(name, { tag: ["@editor"] }, fn)`. If it covers an area that no tag describes, add the tag to `tests/performance/tags.ts` and mapping rows for its source paths to `scripts/performance/select.ts`.

## Live diagnostics

Development builds collect automatically. Add `?perf=0` to disable collection for an overhead comparison. Production builds collect only with `?perf=1` or `localStorage.setItem("ecad.performance", "1")` followed by a reload, and while the debug stats window is open. The shared collector works in web and desktop renderers. It initializes before hydration on web and before React rendering on desktop.

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

The debug stats window shows browser FPS, renderer frames per second, frame time and p95, draw calls, triangles, geometries, textures, shape count, scene update time, long tasks, JS heap, and DOM nodes. It is in every build and hidden by default. Turn it on with **Settings → Display → Show debug stats**, or press Ctrl+Shift+D to toggle it; × closes it. The choice is the `debugStats` global setting (see `docs/settings.md`), so it persists like the others. The window floats above the app: drag its header to move it, or focus the header and use the arrow keys (Shift moves further). It first opens at the bottom left of the canvas, stays inside the viewport, and remembers its position in `localStorage` under `ecad.dev-stats-position`. The sidebar button shortcuts skip Shift+D, so the "Drawing" filter takes the next free letter of its label. The window's chunk loads only while the setting is on. Production builds have no recorder by default, so opening the window starts one and closing it stops it again; `?perf=0` keeps it off, and then only FPS and DOM nodes are live. Playwright tests and benchmarks start with fresh storage, so they run without the window unless a test turns it on. While open, the window runs its own `requestAnimationFrame` loop to count FPS, so close it before taking manual timings. Renderer values show the last WebGL frame, so the SVG circuit view keeps the values from the previous canvas.

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

The helpers preserve return values, thrown errors, and cancellation. Collection is guarded for server rendering and disabled production sessions. For React workspaces, use `PerformanceBoundary`; for a new benchmark, record its result in the app scenario, attach the JSON report, and add a budget with a meaningful limit. Check the new scenario against its budgets with `pnpm run perf:budgets --grep <scenario>` before reporting the feature complete.

The `kicad-import` scenario selects the licensed RP2350A schematic through the Files sidebar after first testing malformed-input recovery. It converts 87 component instances and 272 terminals, persists and opens the resulting 663 shapes, downloads the conversion report, and verifies that the drawing survives reload. Under the same 4× Chromium CPU throttle, conversion has a 1.5-second budget and the import-through-render interaction has a 5-second budget. DOM, decoded scripts and frame p95 limits are 2,000 nodes, 3 MB and 500 ms. The frame measurement includes the cold render of the entire reference sheet. Keep this limit when investigating slow runs and avoid concurrent benchmarks on the same machine. The `import.kicad` metric covers the KiCad worker round trip: starting the worker, reading the file, parsing, conversion, schema validation and returning the result to the page. Before conversion moved to a worker, it covered only parsing, conversion and schema validation on the page thread. This new scenario has no pre-feature counterpart. Use `ECAD_PERF_PORT` to select a free local preview port when other worktrees are benchmarking.

The `gerber-3d` scenario adds a 2,000-pad top copper layer, a full inner plane and a 2,000-hole plated drill file to a project, opens all Gerber layers, then leaves the 2D view with its toolbar button, orbits with Shift-drag and returns to the top view. The page asks for reduced motion, so the 280 ms camera turn between the two views is not part of the timings. The interaction p95 covers those three steps: building the hole mask, restyling every layer and the orbit frames. On SwiftShader it measured about 2 seconds against a 5-second budget. The import of all three files measured about 5.3 seconds against 10 seconds, and frame p95 about 530 ms against 1.5 seconds. DOM and decoded script limits are 1,000 nodes and 3 MB.

The `editor-named-nets` scenario opens 346 wires and 94 electrical labels, places a supply label, and renames it three times. Under the same 4× CPU throttle, interaction p95 must remain below 750 ms, with fewer than 1,800 DOM nodes, at most 3 MB of scripts, and frame p95 below 500 ms. `named-net-connectivity` measures ten net graph builds for 346 wires, 94 labels, and 272 pins in Node, with a 150 ms p95 budget. It checks ten disconnected named buses electrically joining their wire sections.

The `linked-schematic-sync` scenario runs PCB circuit and schematic synchronization in Node without CPU throttling. It uses 300 components with 960 pins and 421 nets, including 60-pin `VCC` and `GND` nets. It places the whole circuit into an empty schematic, then measures five unchanged saves, five circuit net renames, and five schematic value edits. Its budgets are 750 ms for placement, 1 second for unchanged-save p95, 750 ms for circuit-edit p95, and 1 second for schematic-edit p95. Each report records the Node version and workload sizes. Run it with `pnpm run perf --grep linked-schematic-sync`.

Parallel worktrees can select separate test ports with `ECAD_PERF_PORT` and `ECAD_BROWSER_PORT`. Run production performance comparisons without competing benchmark runs on the same machine.

Run `pnpm exec tsx scripts/performance/named-nets.ts` for focused 5,000-wire connectivity validation without a browser or production build. It uses three fresh stores and five repeated reads per store, checks that all disconnected wires remain separate, and records first-read and repeated-read p95 in `perf-artifacts/named-nets-5000-after.json`. Local budgets are 250 ms for first reads and 25 ms for cached reads, excluding serialization. `--baseline` records the same workload before a change in `perf-artifacts/named-nets-5000-before.json` without enforcing those budgets.

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

The `circuit-keyboard-placement` scenario starts with 32 components and 64 unconnected pins. It places three resistors and three standalone nets with keyboard controls, choosing each resistor with Enter from the component search, moving previews and undoing each net placement in one step. Its 2.5-second interaction budget includes symbol picker search and both placements, matching the existing symbol placement budget. Graph construction and commands each remain below 100 ms p95, with fewer than 2,200 DOM nodes and at most 3 MB of decoded scripts under 4× CPU throttling.

The `desktop-untitled` scenario creates an in-memory desktop project, saves 2,000 shapes, imports a 10 MiB source file, then exports the project to disk and reopens it. It checks that the project stays in memory before explicit save and that the exported shapes and bytes survive reopening. Native Node runs without CPU throttling. Budgets allow 1 second for creation, 2 seconds for an in-memory save and reopening, and 3 seconds for import and export. Run it with `pnpm run perf --grep desktop-untitled`.

The `pcb-linked-documents` scenario opens a 32-component circuit with 17 nets, places a resistor, waits for the shared schematic file to save, then opens its schematic. Circuit edits update affected schematic connections with net labels. Unchanged nets keep their wires. The scenario allows 3 seconds for an interaction including autosave and 150 ms p95 for `pcb.synchronize`, under the standard Chromium configuration with 4× CPU throttling. The existing `circuit-graph` and `editor-box` scenarios provide before and after comparisons on the same machine.

The `editor-view-switch` scenario opens a 32-component circuit with 17 nets and switches between circuit and schematic views three times through the toolbar. Before measuring, one unmeasured switch moves the legacy circuit fixture into the current project layout and the page reloads; that first switch currently drops back to the circuit view. Under 4× Chromium CPU throttling, switching has a 3-second interaction p95 budget, with fewer than 2,200 DOM nodes and at most 3 MB of scripts. The existing `circuit-graph`, `editor-box`, and `pcb-linked-documents` scenarios compare existing interactions before and after the toolbar addition.

The `circuit-merge-names` scenario opens 32 components and 17 nets, renames a signal net to GND, and undoes the merge three times. It checks the merged node count and waits for autosave in both directions. Under 4× Chromium CPU throttling, the interaction p95 budget is 3 seconds including autosave, synchronization p95 is 150 ms, and limits are 2,200 DOM nodes and 3 MB of scripts. Existing `editor-net-symbols` and `pcb-linked-documents` scenarios provide before and after comparisons.

The `net-symbol-reconcile` scenario restores a schematic with 32 custom symbols marked as net symbols and 32 connected resistors. It starts with stale circuit data containing 32 separate anonymous nets. Opening circuit view must rebuild this as two named nets with 32 component memberships. Under 4× Chromium CPU throttling, opening including reconciliation and save has a 3-second budget, synchronization p95 is 150 ms, and limits are 2,200 DOM nodes and 3 MB of scripts. The existing `editor-net-symbols` and `pcb-linked-documents` scenarios compare normal editing before and after this fix.

The `editor-clipboard` scenario pastes a group of 32 resistors, copies the group with SVG, PNG and save-file representations, and undoes the paste three times through the native clipboard. Under the same 4× Chromium CPU throttle, interaction p95 must stay below 750 ms, clipboard preparation p95 below 100 ms, image clipboard writing p95 below 750 ms, and frame p95 below 500 ms. It allows 1,500 DOM nodes and 3 MB of decoded scripts. The `drawing.clipboard-copy`, `drawing.clipboard-paste`, `drawing.clipboard-images` and `drawing.clipboard-write` runtime metrics record selection size without document contents.

The `editor-text-duplicate` scenario Alt-drags a net label and ordinary text three times each. It keeps the existing 750 ms interaction p95, 500 ms frame p95, 1,500 DOM nodes and 3 MB script limits under the same local 4× Chromium CPU throttle.

The `button-shortcuts` scenario holds Ctrl until button shortcuts appear, which takes 1 s, and opens the Shapes toolbar through its displayed single-key shortcut three times. The timed interaction runs from the key press until the toolbar and its rebuilt hints are visible, so the reveal delay is not counted. Under the standard local Chromium configuration with 4× CPU throttling, that interaction has a 750 ms p95 budget and building hints has a 50 ms p95 budget. Limits are 1,600 DOM nodes, 3 MB of decoded scripts and 500 ms frame p95. The existing `editor-box` scenario compares editing before and after the change.

The `editor-physical-zoom` scenario supplies desktop display data to the renderer at a device pixel ratio of 2. It checks actual-size zoom against the millimeter rulers, zooms in and resets three times, resizes the viewport, changes the reported display density, and removes display data to exercise the fallback. Under the standard local 4× Chromium CPU throttle, actual-size interaction p95 must stay below 750 ms, with fewer than 1,500 DOM nodes, at most 3 MB of decoded scripts, and frame p95 below 500 ms. The bridge uses synthetic display data because a headless browser cannot read a physical monitor. `display.calibration` measures the renderer's asynchronous display query. The existing `editor-box` scenario provides a before and after comparison for normal editing.

Automatic physical zoom reads Core Graphics display dimensions on macOS, WMI monitor dimensions for a single display on Windows, and X11 monitor dimensions or single-display DRM EDID data on Linux. Windows with multiple displays and Linux configurations without an unambiguous monitor match retain fit-relative zoom. Browsers retain fit-relative zoom because their screen APIs do not expose physical monitor dimensions. Reported dimensions determine accuracy. There is no manual calibration setting.

The `editor-no-connect` scenario places an X marker on a pin and undoes placement three times. Under the standard local Chromium configuration with 4× CPU throttling, placement has a 750 ms interaction p95 budget, with fewer than 1,500 DOM nodes, at most 3 MB of decoded scripts, and frame p95 below 500 ms. The `editor-pin-heavy` scenario compares existing pin hit testing before and after adding no-connect markers.

The `toast-notifications` scenario saves the current project and dismisses its success notification three times. Under the standard local Chromium configuration with 4× CPU throttling, saving through notification dismissal has a 1-second interaction p95 budget, with fewer than 1,200 DOM nodes and at most 2.5 MB of decoded scripts. The `projects-empty` scenario compares startup before and after loading the shared toast viewport.
