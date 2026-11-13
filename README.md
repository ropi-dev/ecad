ECAD is a Gerber and STEP viewer with a 2D drawing editor. The web and Electron desktop apps share the same React editor, drawing model, and Three.js engine.

ECAD is experimental. Features, file formats, and UI behavior may change. Keep backups of project files and verify exports before using them for fabrication.

Original application code is under the [MIT license](LICENSE). Third-party code and assets retain their own licenses, including the KiCad-derived symbols, Inter and Caveat fonts, and LGPL STEP importer. See [third-party notices](THIRD_PARTY_NOTICES.md) and the [publication checklist](docs/publication.md). Production builds include dependency notices and matching STEP importer source archives. The first web or desktop build downloads about 53 MB of source archives; see [source caching and rebuild instructions](licenses/STEP-SOURCE.md).

| Package | Contents |
| --- | --- |
| [`@ecad/core`](packages/core) | Shared React editor and viewers, symbol validation, parsers, workers, and rendering. |
| [`@ecad/drawing-core`](packages/drawing-core) | Headless drawing model, store, Effect commands, schemas, and MCP tools. |
| [`@ecad/default-symbols`](packages/default-symbols) | Offline generators for 45 KiCad-derived schematic symbols and portable library exports. |
| [`@ecad/web`](packages/web) | TanStack Start app, browser project directories, symbol storage, routes, and HTTP services. |
| [`@ecad/desktop`](packages/desktop) | Electron app, filesystem projects, and symbol storage. |
| [`@ecad/cli`](packages/cli) | Standalone drawing commands, local file persistence, and an MCP stdio server. |

Use Node.js 24.14.0 or newer in the Node 24 line, or Node.js 25.4.0 or newer. Run `nvm use` to select Node 24 if you use nvm. pnpm rejects unsupported Node versions.

Install dependencies from the repository root with pnpm. The root `pnpm-lock.yaml` covers all workspaces.

```bash
corepack enable
pnpm install
```

## Run the web app

```bash
pnpm run dev
```

The dev server answers requests for `localhost` and IP addresses. To reach it under another hostname, such as a Tailscale machine name, list the hostnames in `ECAD_ALLOWED_HOSTS`, separated by commas. Set the variable in your shell or in a `.env.local` file at the repository root. `pnpm run preview` uses the same list.

```bash
ECAD_ALLOWED_HOSTS=devbox.example.ts.net pnpm run dev
```

Open `http://localhost:3000/editor` for the drawing editor. Manage symbol libraries under **Projects → Symbol libraries**, where you can upload files or directories into user or project libraries. User libraries live in project-independent localStorage. Project libraries save with the project. Uploading a directory copies its current symbols; it does not keep access to that directory.

The Symbols picker includes 45 built-in components. Export their standalone `.ecadsym` files with `pnpm run symbols:generate /absolute/path/to/output`. See the [default-symbol package](packages/default-symbols/README.md) for the catalog, source attribution, and generation API.

## Run the desktop app

```bash
pnpm run dev:desktop /absolute/project-directory
```

The project directory argument is optional. Open **Settings** from the gear at the bottom of the sidebar, or **Project → Symbol libraries...**, to manage libraries. **Add library directory** adds a directory source, and **Reload libraries** rereads files after external edits. User settings live in `~/.config/ecad` on Linux, `~/Library/Application Support/ecad` on macOS and `%APPDATA%\ecad` on Windows. Uploaded and created symbols can be saved without opening a directory first. Built-in symbols are enabled by default.

The desktop app reads configured directories from disk. The web app's **Upload library directory** imports a snapshot into browser storage.

If Electron exits with a `chrome-sandbox` permissions error on Linux, configure the system sandbox. For local development on that host, the launch command also accepts `--no-sandbox`:

```bash
pnpm run dev:desktop --no-sandbox /absolute/project-directory
```

## Projects

The separate **Projects** page manages the active project and its files. Reach it using **Projects** from any workspace. Enter a name and choose **Create project** to save the current drawing, custom symbols, and imported files together. Creating another project copies the current work into its own directory. **Open project** in the sidebar switches projects: on desktop it asks for a project directory, and on web it lists the saved projects. Add Gerber, STEP, and symbol files on this page, then use **Open** to view a file in its workspace. File lists and import controls stay on the Projects page. The active project is shared across the app, and drawing undo history survives navigation between pages. Drawings save automatically after edits; **Save project** saves immediately. Reopening a project restores its drawing and symbols and loads its Gerber or STEP source files when you visit that viewer. Undo history starts again when you reopen a project or reload the app.

On desktop, creating a project asks for a parent directory and creates a subdirectory named after the project. Each project has a TOML file named `.ecadprj`. You can pass either the project directory or its `.ecadprj` file when launching the desktop app. Without an argument, the last opened project is restored. User symbol libraries are configured separately in `symbol-libraries.json` in the configuration directory and remain available across projects.

On web, projects use directories in the browser's Origin Private File System, with the project name as the directory name. Assets stay on the device and belong to this browser and site. Browser storage must support local filesystem directories; clearing site data removes saved projects. The active project's name is remembered in localStorage. User symbol libraries remain in project-independent localStorage and are available alongside each project's own libraries.

The project file points to a drawing, portable `.ecadsym` files, and copied source files using relative paths:

```toml
format = "ecad-project"
version = 1
name = "Motor controller"
drawing = "drawing.ecaddraw"
symbols = ["symbols/test-point.ecadsym"]

[[assets]]
path = "assets/board.gbr"
name = "board.gbr"
kind = "gerber"
```

Desktop projects store the drawing directly in the project directory, custom symbols in `symbols`, and imported Gerber files, archives, and STEP models in `assets`. These paths stay the same across saves. Imports retain their filenames and add a numbered suffix when a name already exists. The whole project directory can be moved together.

Desktop writes replace each file atomically and restore earlier files if a later write fails. A process interruption during a save can still leave files from different saves. External changes to `.ecadprj` stop saves until the project is reopened. Desktop also checks the saved drawing and symbol files for external edits before saving or importing. **Reload project** is available after a save error and discards unsaved drawing changes.

Web projects keep revision folders in browser storage and publish each revision by replacing `.ecadprj`.

## Build and verify

```bash
pnpm run build:web
pnpm run build:desktop
# Build all packages:
pnpm run build
pnpm run build:cli

# Launch the built desktop app:
pnpm run start:desktop /absolute/project-directory

pnpm run typecheck
pnpm test
pnpm run test:browser
```

### Debian package

`pnpm run package:deb` builds `dist/deb/ecad_<version>_<arch>.deb` on Linux. It needs `dpkg-deb`. The package installs the desktop app in `/usr/lib/ecad` and adds two commands. `ecad-desktop [project-directory]` starts the app, which also gets a launcher entry. `ecad` runs the CLI. The CLI runs on the Node.js runtime inside the app's Electron binary, so it doesn't need a separate Node.js install. Pass `--arch arm64` or `--arch armv7l` to build for another architecture. Pass `--version` to replace the default version, which is `<package version>+git<commit time>.<commit>`, so each build upgrades the one before it. Set `DEBFULLNAME` and `DEBEMAIL` to change the maintainer.

```bash
pnpm run package:deb
sudo apt install ./dist/deb/ecad_*_amd64.deb
```

The package depends on the libraries Electron links, and lists both names of the libraries that Debian 13 and Ubuntu 24.04 renamed to `t64`. It installs on Debian 12 and Ubuntu 26.04. `chrome-sandbox` is installed setuid root, so Chromium's sandbox also works where unprivileged user namespaces are restricted. CI builds the package, installs it, runs the CLI, and uploads the `.deb` as the `ecad-deb` artifact for seven days. After the CI workflow's checks and package build pass on a push to `main`, CI publishes the package as a GitHub release tagged `desktop-<commit time>-<commit>` and marks it as the latest if that commit is still the head of `main`. It keeps the 20 newest `desktop-` releases and deletes older ones with their tags. The browser test workflow runs separately and does not hold back a release. A newer push never cancels a running build on `main`. Queued builds can be skipped, so releases keep commit order.

#### Updates

The installed desktop app checks GitHub's latest release 10 seconds after it starts and every six hours after that. The update button sits in the sidebar footer next to Settings, and hovering it shows the latest release's changes. Clicking it checks for updates right away. When the release has a newer package for the machine's architecture, the icon turns amber and a click installs it: ECAD downloads the package, checks its size and its SHA-256 digest from GitHub, and runs `pkexec apt-get install --no-remove` on it, so the system asks for an administrator password and apt stops rather than remove other packages. The next click restarts ECAD into the new version. Unsaved changes still ask before the window closes, and choosing **Keep working** cancels the restart. A failed installation turns the icon red, its tooltip shows the error, and a click reads the latest release again before retrying. The digest comes from the same GitHub response as the download, so it catches a damaged download but not a bad release: anyone who can publish releases to the repository can ship code that runs as root after the password prompt.

Only the app installed from the package checks for updates: `pnpm run package:deb` marks the app's `package.json` with `"updates": {"format": "deb"}` and sets its version to the package version. `pnpm run dev:desktop` and `pnpm run start:desktop` never check. Set `ECAD_UPDATE_FEED_URL` to read the release from another URL that answers like GitHub's [latest release API](https://docs.github.com/en/rest/releases/releases#get-the-latest-release). The package URLs it lists must use HTTPS or the feed's own origin.

Use `pnpm run preview` to preview the web build. Biome provides `pnpm run format`, `pnpm run lint`, and `pnpm run check`. It respects `.gitignore`, so generated builds and test reports stay out of lint results.

### Deploy with the Vercel GitHub app

The `ecad` project in the `ropis-projects` Vercel team connects to `ropi-dev/ecad` through the Vercel GitHub app. Pushes to `main` deploy to production at `app.ecad.ropi.dev`, and `ecad.ropi.dev` redirects there. Other branches and pull requests don't deploy, because `git.deploymentEnabled` in `packages/web/vercel.json` turns off every branch except `main`.

Use the TanStack Start framework preset, Node.js 24, and `packages/web` as the project root. Keep the default install, build, and output settings, and allow the build to include files outside the root directory so it can use the shared workspace packages. Vercel sets `VERCEL`, which enables the Nitro adapter in the web Vite config.

Manage the repository connection and automatic deployments in the project's [Git settings](https://vercel.com/ropis-projects/ecad/settings/git). Builds and deployment status appear in Vercel and on GitHub pull requests. Deployment does not use a GitHub Actions workflow or require `VERCEL_TOKEN`, `VERCEL_ORG_ID`, or `VERCEL_PROJECT_ID` in GitHub.

GitHub Actions runs on pull requests, pushes to `main`, merge queues, and manual dispatches. The CI workflow runs lint, type checking, unit tests, the web, desktop, and CLI builds, and the Debian package build as separate checks. The browser workflow splits tests across four Chromium jobs, each with one worker and the existing software rendering settings. It prints per-test progress. Download `chromium-results-1` through `chromium-results-4` from the workflow run for each job's HTML report and failure traces. Reports expire after seven days. Report uploads are optional, so storage quota failures do not change the test result.

Both workflows run on GitHub-hosted Ubuntu 26.04 LTS runners. Both workflows use Node 24 from `.nvmrc`, install the locked dependencies with `pnpm install --frozen-lockfile`, and cache the pnpm store. Browser tests use headless Chromium, with WebGL rendered through the SwiftShader Vulkan driver bundled with Chromium, so the jobs install no system graphics packages. They download only Chromium's headless shell and skip Playwright's `--with-deps` apt step: the runner image already has Chromium's libraries, and that step only added CJK and X fonts. CI skips downloading the Electron binary because these checks build the desktop app without launching it. Action revisions are pinned, and Dependabot checks for action updates weekly. The workflows need no repository secrets. The release job alone gets `contents: write` for the built-in token.

The 2D hover and selection tests check hover counts, selection attributes, and clearing behavior. They omit full-canvas image comparisons because software-renderer captures vary on hosted runners.

Performance budgets stay local. CI excludes `gerber-performance.spec.ts` and does not run `pnpm run perf`. The other browser specs, including rendering and performance diagnostics behavior, still run. CI gates on `pnpm run lint`. Formatting and import organization are available through `pnpm run check`.

Feature threads do not run the timing benchmarks. `pnpm run perf:main` checks main once per batch of merged commits, and `pnpm run perf --grep <scenario>` compares named scenarios against the merge base for performance work. `pnpm run perf:dev` adds React profiling. Live diagnostics are available at `window.__ecadPerformance` in development, or with `?perf=1` in production. See the [performance guide](docs/performance.md) for reports, controls, and measurement limits.

## Working in the packages

The headless drawing model, commands, store, schemas, and MCP tool registration live in `@ecad/drawing-core`. The CLI depends on that package. Existing drawing and command imports through `@ecad/core` remain available as re-exports.

Core imports use `#/components/editor/Editor2D.tsx` and other `#/` paths within the package. App packages import shared modules through `@ecad/core`, for example `@ecad/core/components/editor/Editor2D.tsx`.

Web routes live in `packages/web/src/routes`, with the root document in `__root.tsx`. TanStack generates `packages/web/src/routeTree.gen.ts`; run `pnpm run generate-routes` after changing routes when needed. Server functions and API routes belong to the web package. MCP access to an open drawing is available in the web app; the desktop editor hides that control.

Tailwind styles live in `packages/core/src/styles.css`.

See the [drawing architecture guide](docs/architecture.md), [Effect integration guide](docs/effect.md), [viewer guide](docs/viewer.md), and [MCP guide](docs/mcp.md). The [symbol format guide](docs/symbol-format.md) explains portable symbol files; the [example directory](packages/web/public/examples/symbols) contains a small library for either app.

## Run the CLI

The CLI runs under Node and edits local `.ecaddraw` files. It shares its drawing commands and MCP tools with the web and desktop apps through `@ecad/drawing-core`.

```bash
export ECAD_DRAWING="$PWD/drawing.ecaddraw"
pnpm --silent cli tools
pnpm --silent cli getDrawing
pnpm --silent cli placeRectangle '{"x":20,"y":30,"width":40,"height":15,"rotation":0,"lineWidth":0.2}'
pnpm --silent cli undo
pnpm --silent cli mcp
```

`--drawing <path>` overrides `ECAD_DRAWING`. The default is `drawing.ecaddraw` in the current directory. A missing file starts empty and saves after the first edit. All nine drawing MCP tools are available, including batch placement, replacement, rotation, removal, and history navigation. Arguments accept JSON or `-` for stdin. Results use the MCP JSON format, including `structuredContent` and `isError`; failures return exit code 1.

The drawing stays compatible with app project files. An adjacent `.history.json` file preserves undo branches between CLI calls and MCP restarts. Drawing history keeps at most 100 nodes, including the current state. CLI and MCP operations coordinate through a file lock and reread the drawing on each call.

Build with `pnpm run build:cli`, then run `node packages/cli/bin/ecad.mjs`. The workspace also registers the `ecad` executable. `ecad mcp` starts the standalone stdio server. See the [MCP guide](docs/mcp.md#cli-and-stdio-access) for client configuration and file behavior.

## Schematic export

Choose **Export drawing** in the editor toolbar to download a PNG or SVG without capturing the browser. The default is a 9600 × 6400 PNG on white. Set width and height explicitly, then choose white, dark, or transparent background. Export fits the content into those dimensions without stretching.

**Full sheet and drawing** includes the worksheet and expands to include objects outside the page. **Drawing only** fits the drawing with a 3 mm margin and omits the worksheet. Both modes omit the grid, selection, previews, and editor controls. The existing **View tools > Export PNG** command still captures the current viewport.

SVG uses the shared drawing geometry and editable text, with no embedded screenshot. Its text uses Arial with a sans-serif fallback. Font appearance can vary on systems without Arial. Geometry uses the editor's curve tessellation. PNG draws the SVG at the selected resolution rather than enlarging the viewport capture. Output is limited to 16,384 pixels per side and 100 megapixels. PDF export is not included.
