ECAD is a Gerber and STEP viewer with a 2D drawing editor. The web and Electron desktop apps share the same React editor, drawing model, and Three.js engine.

| Package | Contents |
| --- | --- |
| [`@ecad/core`](packages/core) | Shared editor and viewers, drawing commands, symbol validation, parsers, workers, and rendering. |
| [`@ecad/web`](packages/web) | TanStack Start app, browser symbol storage, routes, and HTTP services. |
| [`@ecad/desktop`](packages/desktop) | Electron app and directory-backed symbol storage. |

Install dependencies from the repository root with npm. The root `package-lock.json` covers all workspaces.

```bash
npm install
```

## Run the web app

```bash
npm run dev
```

Open `http://localhost:3000/editor` for the drawing editor. The web app can read files selected through **Symbols → Upload symbols** or **Upload library directory**. Uploaded and created symbols are saved in this browser's localStorage. Uploading a directory copies its current symbols; it does not keep access to that directory.

## Run the desktop app

```bash
npm run dev:desktop -- /absolute/symbol-directory
```

The directory argument is optional. Open **Symbols → Open library directory** to choose or change the directory, and use **Refresh library** to reload files after editing them outside ECAD. The desktop app reads matching symbol files in subdirectories. Uploaded and created symbols are written as `<id>.ecadsym` files into the opened directory. Open a directory before saving custom symbols. Built-in symbols remain available in both apps.

The desktop app uses files on disk for its symbol library. The web app's **Upload library directory** imports a snapshot into browser storage.

If Electron exits with a `chrome-sandbox` permissions error on Linux, configure the system sandbox. For local development on that host, the launch command also accepts `--no-sandbox`:

```bash
npm run dev:desktop -- --no-sandbox /absolute/symbol-directory
```

## Build and verify

```bash
npm run build:web
npm run build:desktop
# Build both apps:
npm run build

# Launch the built desktop app:
npm run start:desktop -- /absolute/symbol-directory

npm run typecheck
npm test
npm run test:browser
```

Use `npm run preview` to preview the web build. Biome provides `npm run format`, `npm run lint`, and `npm run check`.

## Working in the packages

Core imports use `#/components/editor/Editor2D.tsx` and other `#/` paths within the package. App packages import shared modules through `@ecad/core`, for example `@ecad/core/components/editor/Editor2D.tsx`.

Web routes live in `packages/web/src/routes`, with the root document in `__root.tsx`. TanStack generates `packages/web/src/routeTree.gen.ts`; run `npm run generate-routes` after changing routes when needed. Server functions and API routes belong to the web package. MCP access to an open drawing is available in the web app; the desktop editor hides that control.

Tailwind styles live in `packages/core/src/styles.css`. The shared Shadcn configuration is `packages/core/components.json`. Web environment validation lives in `packages/web/src/env.ts`. Database commands such as `npm run db:migrate` run in the web workspace and use `DATABASE_URL`.

See the [drawing architecture guide](docs/architecture.md), [Effect integration guide](docs/effect.md), [viewer guide](docs/viewer.md), and [MCP guide](docs/mcp.md). The [symbol format guide](docs/symbol-format.md) explains portable symbol files; the [example directory](packages/web/public/examples/symbols) contains a small library for either app.
