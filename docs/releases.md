# Releases, packaging, and CI

This guide covers building Debian packages, cutting GitHub releases, maintaining the APT channels, desktop auto-updates, web deployment, and CI workflows.

## Debian package

On Linux (with `dpkg-deb` installed), build a `.deb` package with:

```bash
pnpm run package:deb
sudo apt install ./dist/deb/ecad_*_amd64.deb
```

Outputs in `dist/deb/`:

- `ecad_<version>_<arch>.deb` — Installs the desktop app in `/usr/lib/ecad`, registers a launcher entry, and adds `ecad-desktop [project-directory]` and `ecad` (CLI, running on the Electron binary's Node runtime so no separate Node.js install is required).
- `.files.zst` — Per-file zstd frames used by incremental desktop updates.
- `.files.json` — Manifest listing each file's mode, size, SHA-256 digest, byte range in `.files.zst`, directories, symlinks, and control files.

Options and environment variables:

- `--arch arm64` or `--arch armv7l` — Cross-package for another architecture.
- `--version <ver>` — Override the default version (`<package version>+git<commit time>.<commit>`).
- `DEBFULLNAME` / `DEBEMAIL` — Override package maintainer metadata.

The package lists both pre-t64 and `t64` shared library names so it installs on Debian 12, Debian 13, Ubuntu 24.04, and Ubuntu 26.04. `chrome-sandbox` is installed setuid root so Chromium's sandbox works when unprivileged user namespaces are restricted.

## GitHub Releases

Run the **Release** workflow manually from the Actions tab on `main`. It accepts a channel and an optional version:

- `stable` — Publishes `vMAJOR.MINOR.PATCH` as the latest release. Without an explicit version, it bumps the patch version of the newest stable tag (`v0.1.0` → `v0.1.1`; initial release `v0.1.0`).
- `nightly` — Publishes a pre-release named `v<next-stable>-nightly.<YYYYMMDD>` (UTC). Re-running on the same day replaces that day's nightly. The workflow retains the 14 newest nightlies and deletes older ones along with their tags.

Constraints and protections:

- Any explicit version (`0.2.0` or `v0.2.0`) must be newer than the latest stable release.
- Runs from branches other than `main` fail before building. The publish job targets the `release` environment, whose branch policy restricts deployments to `main`.
- Two tag rulesets (with no bypass, even for admins) protect release tags: **Release tags: never move** blocks moving any `v*` tag, and **Stable release tags: never delete** blocks deleting any `v*` tag except `v*-nightly.*`. Tag creation stays open so the workflow's `GITHUB_TOKEN` can create tags.

The workflow runs all CI checks, builds the `.deb` with the release version stamped into its control file, desktop app, and `ecad --version`, installs it, and smoke-tests the CLI before publishing. Nightly Debian versions use `~` (for example `0.1.1~nightly.20261116`) so `dpkg` sorts them before `0.1.1`; GitHub asset filenames use `-` instead (`ecad_0.1.1-nightly.20261116_amd64.deb`). Release notes list pull requests since the previous stable release (or since the previous release of any kind for nightlies). The `ecad-deb` artifact is retained for 7 days.

## APT repository

Each release channel is published as a flat APT repository stored as assets on a persistent pre-release: `apt-stable` (3 newest stable releases) and `apt-nightly` (3 newest nightlies plus the newest stable release).

Install from the stable channel:

```bash
sudo curl -fsSLo /usr/share/keyrings/ecad-archive-keyring.gpg \
  https://github.com/ropi-dev/ecad/releases/download/apt-stable/ecad-archive-keyring.gpg
sudo tee /etc/apt/sources.list.d/ecad.sources <<'EOF'
Types: deb
URIs: https://github.com/ropi-dev/ecad/releases/download/apt-stable/
Suites: ./
Signed-By: /usr/share/keyrings/ecad-archive-keyring.gpg
EOF
sudo apt update && sudo apt install ecad
```

Replace `apt-stable` with `apt-nightly` in `URIs` to track nightlies. Signing key fingerprint:

```text
F39E 7F46 0B26 1123 3681  DEFF C723 FF59 1786 C814
```

### Rebuilding and key rotation

The Release workflow triggers the **Apt repository** workflow automatically; you can also run it manually on `main`. `scripts/release/apt.ts` downloads channel packages, generates `Packages`, `Packages.gz`, and `Release` (with SHA-256 digests), signs `InRelease` and `Release.gpg`, uploads new or changed packages and indexes, and removes pruned packages. (Because GitHub replaces assets by deleting first, an `apt update` during those few seconds may fail and succeed on retry.)

Build both channels locally without publishing:

```bash
node scripts/release/apt.ts --no-publish --directory <dir>
```

Pass `--key <fingerprint>` if your GnuPG keyring contains more than one secret key.

In CI, signing uses the `APT_SIGNING_KEY` secret in the `release` environment (an ASCII-armored Ed25519 secret key with no passphrase and no expiry). To rotate it: generate a new key, export with `gpg --armor --export-secret-keys <fingerprint>`, save via `gh secret set APT_SIGNING_KEY --env release`, run the Apt repository workflow, and update the fingerprint above. Existing users must re-download the keyring.

## Desktop auto-updates

Only the `.deb`-installed desktop app checks for updates (`package:deb` writes `"updates": {"format": "deb"}` into the packaged `package.json`). `dev:desktop` and `start:desktop` never check.

- **Schedule and UI** — Checks GitHub's releases 10 seconds after launch and every 6 hours thereafter. The update icon sits beside **Settings** in the sidebar footer: hover to read release notes, click to check immediately, click when amber to install, and click again after install to restart (unsaved changes still prompt). Failures turn the icon red with the error in its tooltip.
- **Incremental download** — ECAD fetches `.files.json`, verifies its SHA-256 against GitHub's digest, reuses unchanged installed files, fetches only changed frames from `.files.zst` via HTTP range requests, verifies every file digest, and assembles the `.deb` locally with `dpkg-deb`. Typical app-only updates download a few hundred kilobytes instead of the full ~148 MB package. If delta files are missing, range requests are ignored, digests fail, or deltas exceed the full package size, ECAD falls back to downloading the full `.deb`.
- **Installation** — Runs `pkexec apt-get install --no-remove` so the OS prompts for an administrator password and refuses to remove other packages.
- **Channels and overrides** — **Settings → Updates → Release channel** switches between `Stable` (default, skips pre-releases) and `Nightly` (includes `vX.Y.Z-nightly.YYYYMMDD`, ignores `apt-*`). ECAD never downgrades. Set `ECAD_UPDATE_FEED_URL` to point at a custom endpoint compatible with GitHub's [list releases API](https://docs.github.com/en/rest/releases/releases#list-releases); package URLs must use HTTPS or the feed's origin.

## Web deployment (Vercel)

The `ecad` project in the `ropis-projects` Vercel team connects to `ropi-dev/ecad` via the Vercel GitHub app. Pushes to `main` deploy to `app.ecad.ropi.dev` (with `ecad.ropi.dev` redirecting there). Other branches and PRs do not deploy (`git.deploymentEnabled` in `packages/web/vercel.json` enables only `main`).

Project settings: TanStack Start preset, Node.js 24, root directory `packages/web`, default install/build/output settings, and workspace files outside the root directory allowed. Vercel sets `VERCEL`, enabling the Nitro adapter in Vite. No GitHub Actions workflow or Vercel secrets are used in GitHub.

## GitHub Actions CI

Workflows run on pull requests, pushes to `main`, merge queues, and manual dispatches on GitHub-hosted Ubuntu 26.04 LTS runners using Node 24 from `.nvmrc` and `pnpm install --frozen-lockfile`:

- **`ci.yml`** — Runs six parallel matrix jobs: `lint` (`pnpm run lint`), `typecheck`, `test`, `build:web`, `build:desktop`, and `build:cli`. Sets `ELECTRON_SKIP_BINARY_DOWNLOAD=1` because desktop builds do not launch Electron.
- **`browser-tests.yml`** — Splits `pnpm run test:browser` across two Chromium shards (`--workers=2`, headless shell only with bundled SwiftShader Vulkan, skipping `--with-deps`). Uploads `chromium-results-1` and `chromium-results-2` (HTML reports and failure traces, 7-day retention, `continue-on-error: true`). A `performance-smoke` job is also defined in this workflow (currently disabled with `if: false`); see [docs/performance.md](performance.md) for local benchmark rules.

Action revisions are pinned by commit SHA and updated weekly by Dependabot. Workflows require no repository secrets; only the release publish job receives `contents: write`.
