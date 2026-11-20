# Parallel development sandbox

Use the Linux Podman sandbox when multiple worktrees or threads share one machine. It isolates dependencies, ports, and CPU/memory resources, and coordinates benchmarks through a host-wide lock.

**Requirements:** Linux, rootless Podman, `flock`, `lscpu`, Node 24.22.1+ (TypeScript stripping), and at least 3 physical CPU cores. (Native `pnpm run perf` still works on macOS and Windows without the Linux host queue.)

## Commands

```bash
pnpm sandbox build-image
pnpm sandbox dev
pnpm sandbox check
pnpm sandbox typecheck
pnpm sandbox test
pnpm sandbox test:browser
pnpm sandbox shell
pnpm sandbox perf --grep 'projects-empty|cli-drawing'
pnpm sandbox perf:budgets --grep 'projects-empty|cli-drawing'
```

- Rebuild the image (`pnpm sandbox build-image`) whenever the Containerfile or entrypoint changes (including Playwright browser upgrades).
- `pnpm sandbox perf` runs an A/B comparison against the merge base (see [docs/performance.md](performance.md#ab-runs)), exporting the base with `git archive` into the shared `ecad-perf-base-cache` volume. `pnpm sandbox perf:baseline` is deprecated.
- Stop commands with `Ctrl+C` (containers auto-remove on exit; dependency volumes persist). If a crash leaves a container behind, inspect and stop it with `podman ps --filter name=ecad-`.

## Resource allocation and volumes

- **Dev & test containers** — 2 CPU quota (pinned via `taskset` to cores excluding the last two physical cores), 4 GiB RAM (no extra swap), 1 GiB `/dev/shm` for Chromium, and a unique checkout-derived localhost port (colliding ports fail fast). Override with `ECAD_DEV_CPUS`, `ECAD_SANDBOX_MEMORY`, and `ECAD_DEV_PORT`; pass `ECAD_ALLOWED_HOSTS` for Tailscale Serve hostnames.
- **Benchmark containers** — Pinned to the last two physical cores (and SMT siblings), 8 GiB RAM, no CPU quota (Chromium keeps 4× CPU throttling for budget runs).
- **Volumes & user namespace** — Uses `keep-id` so permission tests run as your host user. Each checkout gets isolated `ecad-<id>-*modules` volumes (dev and perf separate) sharing the `ecad-pnpm-store-node` pnpm store volume. (Remove any legacy root-owned `ecad-pnpm-store` volume with `podman volume rm ecad-pnpm-store`.)
- **Read-only perf copy** — `sandbox perf` copies the checkout (excluding `node_modules`, `.git`, caches, and build outputs) into the container after acquiring the lock so benchmark builds never clobber a running dev server.

## Host benchmark lock and artifacts

- Native `pnpm run perf*` and `pnpm sandbox perf*` share a host `flock` in `/tmp/ecad-locks-<uid>` (override with `ECAD_LOCK_DIR`, which must match across checkouts).
- Sandbox `test`, `check`, `typecheck`, dev-install, and native perf builds take **shared** locks (running concurrently); benchmark measurements, sandbox perf builds, and `build-image` take an **exclusive** lock. Running dev servers do not hold the lock. Never set `ECAD_PERF_LOCK_HELD` manually.
- Forwarded env vars: `ECAD_PERF_CPU`, `ECAD_PERF_RUNS`, `ECAD_PERF_PORT`, `ECAD_PERF_BASE_PORT`, `ECAD_PERF_MAX_PAIRS`, `ECAD_PERF_FLOOR_SCALE`, `ECAD_BROWSER_PORT`, and `ECAD_PERF_BASELINE_PATH` (must be relative to the container artifact dir).
- Artifacts live under `/tmp/ecad/<id>/container-perf/` (`latest.json` and the 20 most recent `run-<timestamp>.json`), separate from native `perf-artifacts` symlinks.
- Stop unrelated heavy host jobs for sensitive measurements, since containers still share host storage bandwidth, caches, and thermals.
