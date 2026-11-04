# Parallel development

Use the Linux sandbox for resource-heavy work in parallel threads. It requires rootless Podman, `flock`, `lscpu`, Node 24.22.1 or another Node version that supports TypeScript stripping, and at least three physical CPU cores.

```sh
pnpm sandbox build-image
pnpm sandbox dev
pnpm sandbox test
pnpm sandbox test:browser
pnpm sandbox perf:baseline --grep 'projects-empty|cli-drawing'
pnpm sandbox perf --grep 'projects-empty|cli-drawing'
```

Build the image once per Containerfile or entrypoint change. The runner uses the image ID after resolving its content-derived tag. The base Node image has a pinned digest, and pnpm and Playwright have exact versions. Browser upgrades require updating the Containerfile to match the installed Playwright version and rebuilding the image. Package installation uses the frozen project lockfile. OS packages are resolved when the image builds, so independently rebuilt images can differ. Baseline comparisons include the resulting image ID.

Containers use Podman's `keep-id` user namespace so filesystem permission checks run as the developer, including tests for unreadable files. Each checkout gets a path-derived ID. Development containers bind that checkout at its original absolute host path to preserve relative artifact symlinks, publish a checkout-specific localhost port, and keep installed dependencies in separate named volumes. Development package dependency directories also have their own volumes. Benchmark package links are recreated in the disposable source copy. The downloaded pnpm store is shared. Dev and perf dependency volumes are separate. Installation checks a checkout-path and manifest fingerprint under a shared lock before reusing dependencies. To reinstall from scratch, stop that checkout's containers and remove its `ecad-<id>-*modules` volumes with Podman.

Development commands have a two-CPU quota, 4 GiB memory limit, no swap allowance beyond that memory limit, and a 1 GiB shared-memory allocation for Chromium. `ECAD_DEV_CPUS`, `ECAD_SANDBOX_MEMORY`, and `ECAD_DEV_PORT` override those settings. A port collision fails rather than attaching to another checkout's server. Pass `ECAD_ALLOWED_HOSTS` when exposing Vite through a hostname such as a Tailscale Serve address.

The last two physical cores, including all their SMT siblings, run benchmarks. Development container processes inherit affinity to the remaining cores through `taskset`. This works without a delegated cpuset cgroup controller. Benchmarks have an 8 GiB memory limit and no CPU quota. Chromium retains its existing 4x CPU throttle. The runner prints the actual CPU list and limits. These are starting allocations, not measured capacity guarantees.

Existing worktrees must include these runner changes to participate. Older perf scripts and commands started before the update do not acquire the shared lock.

Native perf remains available on macOS and Windows, with a warning that the shared host queue is Linux-only.

All sandbox benchmarks acquire the same host `flock` before starting their container, installation, build, browser, and report generation. Native `pnpm perf`, `pnpm perf:baseline`, and `pnpm perf:dev` use the same lock. Image builds also acquire that slot. Sandbox tests, checks, and typechecks hold shared access to the same lock, so they can run together while benchmarks wait for them to finish. Dev server installation also holds shared access, then releases it before starting Vite. Running dev servers do not hold the benchmark slot. Native tests and builds bypass this shared-access rule. A waiting command prints its queue message. Ctrl+C, SIGTERM, and terminal hangup propagate to the command. Stopping it releases the kernel lock when its processes exit. Before a queued command starts, it verifies the original launcher PID and process start time. A waiter whose launcher was killed exits without starting its job. Do not set `ECAD_PERF_LOCK_HELD` yourself. It is an internal marker for the already-locked container runner.

Sandbox perf copies the checkout into the container after acquiring the slot. It excludes dependency directories, Git metadata, caches, and build outputs. The source mount is read-only, so benchmark builds cannot overwrite a development server's files. Keep edits paused until copying finishes if a run must represent a specific revision. The report records HEAD, but uncommitted changes also enter the copy.

Sandbox commands forward `ECAD_PERF_CPU`, `ECAD_PERF_RUNS`, `ECAD_PERF_PORT`, and `ECAD_BROWSER_PORT`. A sandbox `ECAD_PERF_BASELINE_PATH` is relative to its persistent artifact directory. For example, `ECAD_PERF_BASELINE_PATH=custom/baseline.json` writes `/tmp/ecad/<id>/container-perf/custom/baseline.json` on the host. Absolute paths and paths escaping that directory fail before starting the container. Native baseline-path behavior is unchanged.

Performance artifacts stay under `/tmp`. Native runs use a checkout-specific directory and a local `perf-artifacts` symlink. An existing symlink under `/tmp` is preserved. Move any old real `perf-artifacts` directory under `/tmp` and replace it with a symlink before running checks. Sandbox perf artifacts appear on the host under `/tmp/ecad/<id>/container-perf/`. `latest.json` has the most recent report; `run-<timestamp>.json` preserves the latest 20 reports. Baselines remain checkout-specific and separate for development and production modes. Native and sandbox baselines live separately. Capture each baseline and comparison on the same host, image, and resource allocation.

The host lock directory defaults to `/tmp/ecad-locks-<uid>`. `ECAD_LOCK_DIR` can change it, but every checkout on the host must use the same directory. Containers mount that exact directory. Separate users need an explicitly shared directory and compatible permissions. Shell commands and direct `playwright` invocations bypass the benchmark runner, so run timing checks through the documented perf commands.

`pnpm sandbox shell` opens a shell in the development environment. `check` and `typecheck` are also supported. Dev servers and tests can run together, but two instances of the same command in one checkout queue. Stop a command with Ctrl+C. Containers are removed on exit; dependency volumes remain. If a client crashes, inspect `podman ps --filter name=ecad-` and stop the leftover container before restarting it.

Host processes, native builds, and other projects can still run on the benchmark CPUs. Containers also share storage bandwidth, CPU caches, and thermal limits. Stop unrelated heavy jobs for sensitive measurements. The sandbox does not modify the host's global CPU assignments or stop other threads' processes.

For a private HTTPS preview, expose the printed dev port through an unused Tailscale Serve HTTPS port. Preserve other threads' routes, allow the tailnet hostname through `ECAD_ALLOWED_HOSTS`, and verify the resulting HTTPS URL before sharing it.
