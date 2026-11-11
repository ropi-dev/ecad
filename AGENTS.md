<!-- intent-skills:start -->
## Skill Loading

Before editing files for a substantial task:
- Run `pnpm dlx @tanstack/intent@latest list` from the workspace root to see available local skills.
- If a listed skill matches the task, run `pnpm dlx @tanstack/intent@latest load <package>#<skill>` before changing files.
- Use the loaded `SKILL.md` guidance while making the change.
- Monorepos: when working across packages, run the skill check from the workspace root and prefer the local skill for the package being changed.
- Multiple matches: prefer the most specific local skill for the package or concern you are changing; load additional skills only when the task spans multiple packages or concerns.
<!-- intent-skills:end -->

Use the `#/components/editor/Editor2D.tsx` import format, instead of `../../src/components/editor/worksheet` wherever possible

## Pull request approvals

- If the authenticated account belongs to a group authorized to bypass pull request approval requirements, you may always use that bypass without asking for additional confirmation.

## CI failures

- If a test fails on CI and seems unnecessary, you may remove it instead of fixing it. Say which test you removed and why in the pull request.

## Generated artifacts

- Write generated artifacts, including screenshots, traces, and performance reports, under `/tmp/`. Do not commit or push them to the repository.

## UI changes

- Whenever a UI change is made, capture screenshots of the updated interface and include them in the completion response.

## Performance

- Do not run the timing benchmarks in a feature or fix thread: `pnpm run perf`, `pnpm run perf:budgets`, `pnpm run perf:main` and their sandbox forms. An ordinary editor change selects about 60 scenarios. That takes 17 to 40 minutes and holds the host benchmark lock, which other threads' sandbox tests wait on. On every pull request, the `Performance scenarios (smoke)` job on GitHub checks that each scenario still runs and stays within its DOM node and script size budgets.
- Timing is checked on main, once per batch of merged commits. `pnpm run perf:main` runs from a clean checkout of `origin/main`. It compares main against the commit it last checked, reruns regressions to confirm them, and records the new commit when it passes. `pnpm run perf:budgets` follows it. Only the thread that owns the main check runs these two. See "Main check" in `docs/performance.md`.
- A thread measures only when its task is a performance change, or when it adds or edits a scenario. Name the scenarios that cover the change, at most three, so the run stays under two minutes: `pnpm run perf --grep '<scenario>|<scenario>'`. Pass `--base <ref>` for a stacked branch. Check a new scenario against its budgets with `pnpm run perf:budgets --grep <scenario>`. Report each scenario's verdict, head/base ratio and pair count from `perf-artifacts/latest.json`, and the test environment. Do not claim a performance fix is verified without measurements.
- Keep performance validation local. Compare before and after on the same machine; do not use hosted-runner timing budgets as CI gates.
- A regression verdict means "investigate", not proof. A pass is not assurance against slowdowns below about 75% on short interactions (under about 150 ms), which unthrottled A/B runs do not reliably catch; see "A/B sensitivity" in `docs/performance.md`.
- Add a realistic scenario and explicit budgets in `tests/performance` when a feature adds a new user flow or materially larger workload. Keep startup scenarios free of editor and renderer dependencies.
- Tag every new scenario with its area from `tests/performance/tags.ts`. If it covers a new area, add the tag and a mapping row in `scripts/performance/select.ts`.
- Measure expensive operations with the shared helpers in `packages/core/src/performance/runtime.ts`. Keep metric names stable, metadata small, and reports free of project contents, file names, and directory paths. Keep buffers bounded and production collection opt-in.
- Use `pnpm run perf:dev` with a separate baseline path to investigate React render costs. Production benchmarks determine shipped performance. See `docs/performance.md` for commands and metric limitations.
- Investigate a failed budget or baseline comparison before changing thresholds. Explain any intentional budget change and its user impact.

## Parallel development

- Prefer `pnpm sandbox <command>` for dev servers, tests, typechecks, and performance checks when multiple threads share this machine. Run `pnpm sandbox build-image` first if the image is missing.
- Run timing checks through `pnpm sandbox perf`, `pnpm sandbox perf:budgets`, or the native `pnpm perf` scripts. These share a host benchmark lock. Sandbox tests and typechecks share access while benchmarks need exclusive access. Do not bypass the lock with direct Playwright performance invocations or set `ECAD_PERF_LOCK_HELD` yourself.
- An A/B run measures base and head in the same environment by itself. Don't compare a native run's numbers with a sandbox run's.
- See `docs/parallel-development.md` for resource allocations, artifacts, overrides, and cleanup.
