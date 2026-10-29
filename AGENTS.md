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

## Generated artifacts

- Write generated artifacts, including screenshots, traces, and performance reports, under `/tmp/`. Do not commit or push them to the repository.

## UI changes

- Whenever a UI change is made, capture screenshots of the updated interface and include them in the completion response.

## Performance

- Keep performance validation local. Compare before and after on the same machine; do not use hosted-runner timing budgets as CI gates.
- Before developing a new feature or changing startup, project storage, imports, or rendering, run `pnpm run perf:baseline` to capture the current checkout on this machine. If a comparable baseline already exists, use `pnpm run perf` without overwriting it.
- After the change, run `pnpm run perf` and inspect `perf-artifacts/latest.json`. Include measured before/after results and the test environment in the completion report. Do not claim a performance fix is verified without measurements.
- Add a realistic scenario and explicit budgets in `tests/performance` when a feature adds a new user flow or materially larger workload. Keep startup scenarios free of editor and renderer dependencies.
- Measure expensive operations with the shared helpers in `packages/core/src/performance/runtime.ts`. Keep metric names stable, metadata small, and reports free of project contents, file names, and directory paths. Keep buffers bounded and production collection opt-in.
- Use `pnpm run perf:dev` with a separate baseline path to investigate React render costs. Production benchmarks determine shipped performance. See `docs/performance.md` for commands and metric limitations.
- Investigate a failed budget or baseline comparison before changing thresholds. Explain any intentional budget change and its user impact.
