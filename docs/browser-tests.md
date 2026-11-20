# Browser tests

`pnpm run test:browser` runs the full Playwright browser suite locally and in CI (CI splits it across two shards with two workers each and no retries).

Each browser test covers one user-facing workflow—such as drawing shapes, wiring pins, routing a track, importing a KiCad schematic, or exporting a PDF. Because each browser test takes 4–15 seconds on CI, keep geometry, normalization, serialization, validation, and command edge cases in Node unit tests (`tests/*.test.ts`).

## Guidelines

- Follow the **Tests** rules in [AGENTS.md](../AGENTS.md) before adding a test.
- Extend an existing scenario when new behavior fits an existing workflow, and use one representative input rather than repeating across every shape or viewport.
- For PCB tests that do not need routed copper, use `openEmptyBoard` in `tests/browser/pcb.spec.ts` instead of loading the RP2350A reference design (~8 seconds per test).

## Running tests and artifacts

```bash
pnpm run test:browser
pnpm run test:browser tests/browser/pcb.spec.ts
pnpm run test:browser --grep 'circuit'
pnpm test
```

Playwright automatically saves failure screenshots. To also save review screenshots and attachments (output defaults to `test-results/`; pass `--output=/tmp/ecad-browser-results` to keep them in `/tmp`):

```bash
ECAD_BROWSER_ARTIFACTS=1 pnpm run test:browser tests/browser/projects-design.spec.ts --output=/tmp/ecad-browser-results
```

Workload timing and allocation budgets live in the separate local performance suite; see [docs/performance.md](performance.md).
