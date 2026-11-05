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

## Generated artifacts

- Write generated artifacts, including screenshots, traces, and performance reports, under `/tmp/`. Do not commit or push them to the repository.

## UI changes

- Whenever a UI change is made, capture screenshots of the updated interface and include them in the completion response.

## Performance

- Keep performance validation local. Compare before and after on the same machine; do not use hosted-runner timing budgets as CI gates.
- Before developing a new feature or changing startup, project storage, imports, or rendering, run `pnpm run perf:baseline` to capture every scenario for the current checkout on this machine. If a comparable baseline already exists, use `pnpm run perf` without overwriting it.
- After the change, run `pnpm run perf` and inspect `perf-artifacts/latest.json`. It benchmarks the scenarios your change affects, as printed at the start of the run; `pnpm run perf --all` runs every scenario. Include measured before/after results and the test environment in the completion report. Do not claim a performance fix is verified without measurements.
- Add a realistic scenario and explicit budgets in `tests/performance` when a feature adds a new user flow or materially larger workload. Keep startup scenarios free of editor and renderer dependencies.
- Tag every new scenario with its area from `tests/performance/tags.ts`. If it covers a new area, add the tag and a mapping row in `scripts/performance/select.ts`.
- Measure expensive operations with the shared helpers in `packages/core/src/performance/runtime.ts`. Keep metric names stable, metadata small, and reports free of project contents, file names, and directory paths. Keep buffers bounded and production collection opt-in.
- Use `pnpm run perf:dev` with a separate baseline path to investigate React render costs. Production benchmarks determine shipped performance. See `docs/performance.md` for commands and metric limitations.
- Investigate a failed budget or baseline comparison before changing thresholds. Explain any intentional budget change and its user impact.

## Parallel development

- Prefer `pnpm sandbox <command>` for dev servers, tests, typechecks, and performance checks when multiple threads share this machine. Run `pnpm sandbox build-image` first if the image is missing.
- Run timing checks through `pnpm sandbox perf`, `pnpm sandbox perf:baseline`, or the native `pnpm perf` scripts. These share a host benchmark lock. Sandbox tests and typechecks share access while benchmarks need exclusive access. Do not bypass the lock with direct Playwright performance invocations or set `ECAD_PERF_LOCK_HELD` yourself.
- Capture baselines and comparisons in the same environment. Native and sandbox baselines are separate.
- See `docs/parallel-development.md` for resource allocations, artifacts, overrides, and cleanup.
