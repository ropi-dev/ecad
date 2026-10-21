ECAD is a Gerber and STEP viewer with a 2D drawing editor. The web and Electron desktop apps share the same React editor, drawing model, and Three.js engine.

| Package | Contents |
| --- | --- |
| [`@ecad/core`](packages/core) | Shared editor and viewers, drawing commands, symbol validation, parsers, workers, and rendering. |
| [`@ecad/default-symbols`](packages/default-symbols) | Offline generators for 45 KiCad-derived schematic symbols and portable library exports. |
| [`@ecad/web`](packages/web) | TanStack Start app, browser project directories, symbol storage, routes, and HTTP services. |
| [`@ecad/desktop`](packages/desktop) | Electron app, filesystem projects, and symbol storage. |

Use Node.js 24.14.0 or newer in the Node 24 line, or Node.js 25.4.0 or newer. Run `nvm use` to select Node 24 if you use nvm. npm rejects unsupported Node versions.

Install dependencies from the repository root with npm. The root `package-lock.json` covers all workspaces.

```bash
npm install
```

## Run the web app

```bash
npm run dev
```

Open `http://localhost:3000/editor` for the drawing editor. Manage symbol libraries under **Projects → Symbol libraries**, where you can upload files or directories into user or project libraries. User libraries live in project-independent localStorage. Project libraries save with the project. Uploading a directory copies its current symbols; it does not keep access to that directory.

The Symbols picker includes 45 built-in components. Export their standalone `.ecadsym` files with `npm run symbols:generate -- /absolute/path/to/output`. See the [default-symbol package](packages/default-symbols/README.md) for the catalog, source attribution, and generation API.

## Run the desktop app

```bash
npm run dev:desktop -- /absolute/project-directory
```

The project directory argument is optional. Manage libraries under **Projects → Symbol libraries**. **Add library directory** adds a directory source, and **Reload libraries** rereads files after external edits. User settings live at `~/.ecad/config.json`. Uploaded and created symbols can be saved without opening a directory first. Built-in symbols are enabled by default.

The desktop app reads configured directories from disk. The web app's **Upload library directory** imports a snapshot into browser storage.

If Electron exits with a `chrome-sandbox` permissions error on Linux, configure the system sandbox. For local development on that host, the launch command also accepts `--no-sandbox`:

```bash
npm run dev:desktop -- --no-sandbox /absolute/project-directory
```

## Projects

The separate **Projects** page manages the active project and its files. Reach it using **Projects** from any workspace. Enter a name and choose **Create project** to save the current drawing, custom symbols, and imported files together. Creating another project copies the current work into its own directory. **Open project directory** on desktop or the saved-project list on web switches projects. Add Gerber, STEP, and symbol files on this page, then use **Open** to view a file in its workspace. File lists and import controls stay on the Projects page. The active project is shared across the app, and drawing undo history survives navigation between pages. Drawings save automatically after edits; **Save project** saves immediately. Reopening a project restores its drawing and symbols and loads its Gerber or STEP source files when you visit that viewer. Undo history starts again when you reopen a project or reload the app.

On desktop, creating a project asks for a parent directory and creates a subdirectory named after the project. Each project has a TOML file named `.ecadprj`. You can pass either the project directory or its `.ecadprj` file when launching the desktop app. Without an argument, the last opened project is restored. User symbol libraries are configured separately in `~/.ecad/config.json` and remain available across projects.

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

Desktop projects store the drawing directly in the project directory, custom symbols in `symbols`, and imported Gerber files, archives, and STEP models in `assets`. These paths stay the same across saves. Imports retain their filenames and add a numbered suffix when a name already exists. Existing projects with `.ecad` revision folders move their drawing and symbols to visible paths on the next successful save. Migration removes the old referenced files and empty folders, and keeps unrelated files. Existing drawing and symbol paths outside `.ecad` remain unchanged. The whole project directory can be moved together.

Desktop writes replace each file atomically and restore earlier files if a later write fails. A process interruption during a save can still leave files from different saves. External changes to `.ecadprj` stop saves until the project is reopened. Desktop also checks the saved drawing and symbol files for external edits before saving or importing. **Reload project** is available after a save error and discards unsaved drawing changes.

Web projects keep revision folders in browser storage and publish each revision by replacing `.ecadprj`.

## Build and verify

```bash
npm run build:web
npm run build:desktop
# Build both apps:
npm run build

# Launch the built desktop app:
npm run start:desktop -- /absolute/project-directory

npm run typecheck
npm test
npm run test:browser
```

Use `npm run preview` to preview the web build. Biome provides `npm run format`, `npm run lint`, and `npm run check`. It respects `.gitignore`, so generated builds and test reports stay out of lint results.

GitHub Actions runs on pull requests, pushes to `main`, merge queues, and manual dispatches. The CI workflow runs lint, type checking, unit tests, and the web and desktop builds as separate checks. The browser workflow splits tests across four Chromium jobs, each with one worker and the existing software rendering settings. It prints per-test progress. Download `chromium-results-1` through `chromium-results-4` from the workflow run for each job's HTML report and failure traces. Reports expire after seven days. Report uploads are optional, so storage quota failures do not change the test result.

Both workflows run on Blacksmith Ubuntu 24.04 x64 runners with 4 vCPUs and 16 GB RAM. The repository must belong to a GitHub organization with the Blacksmith GitHub App installed and granted access to this repository. See the [Blacksmith setup guide](https://docs.blacksmith.sh/introduction/quickstart). Both workflows use Node 24 from `.nvmrc`, install the locked dependencies with `npm ci`, and cache npm downloads. Browser jobs install the Mesa Vulkan libraries. Interaction tests use headless Chromium. The renderer spec runs in a separate Playwright project under Xvfb to support its software WebGPU swap chain on CI. Both projects use SwiftShader's Vulkan backend for WebGL and WebGPU. CI skips downloading the Electron binary because these checks build the desktop app without launching it. Action revisions are pinned, and Dependabot checks for action updates weekly. The workflows need no repository secrets.

Performance budgets stay local. CI excludes `gerber-performance.spec.ts` and does not run `npm run perf`. The other browser specs, including rendering and performance diagnostics behavior, still run. CI gates on `npm run lint`. Formatting and import organization are available through `npm run check`.

Capture performance before feature work with `npm run perf:baseline`, then run `npm run perf` after changes to check startup, large projects, drawing, and imports against budgets and the local baseline. `npm run perf:dev` adds React profiling. Live diagnostics are available at `window.__ecadPerformance` in development, or with `?perf=1` in production. See the [performance guide](docs/performance.md) for reports, controls, and measurement limits.

## Working in the packages

Core imports use `#/components/editor/Editor2D.tsx` and other `#/` paths within the package. App packages import shared modules through `@ecad/core`, for example `@ecad/core/components/editor/Editor2D.tsx`.

Web routes live in `packages/web/src/routes`, with the root document in `__root.tsx`. TanStack generates `packages/web/src/routeTree.gen.ts`; run `npm run generate-routes` after changing routes when needed. Server functions and API routes belong to the web package. MCP access to an open drawing is available in the web app; the desktop editor hides that control.

Tailwind styles live in `packages/core/src/styles.css`. The shared Shadcn configuration is `packages/core/components.json`. Web environment validation lives in `packages/web/src/env.ts`. Database commands such as `npm run db:migrate` run in the web workspace and use `DATABASE_URL`.

See the [drawing architecture guide](docs/architecture.md), [Effect integration guide](docs/effect.md), [viewer guide](docs/viewer.md), and [MCP guide](docs/mcp.md). The [symbol format guide](docs/symbol-format.md) explains portable symbol files; the [example directory](packages/web/public/examples/symbols) contains a small library for either app.
