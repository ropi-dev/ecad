# ECAD

ECAD is a Gerber and STEP viewer paired with a 2D/3D schematic, circuit, footprint, and PCB editor. The web and Electron desktop apps share the same Solid 2.0 UI, headless drawing model, and Three.js rendering engine.

> **Experimental software:** Features, file formats, and UI behavior may change. Keep backups of your project files and verify all exports before sending them to fabrication.

## Packages

| Package | Description |
| --- | --- |
| [`@ecad/core`](packages/core) | Shared Solid 2.0 editors and viewers, symbol/footprint/board UI, format parsers, Web Workers, and Three.js renderer. |
| [`@ecad/drawing-core`](packages/drawing-core) | Headless drawing, circuit, footprint, and board models, Effect commands, ERC/DRC, schemas, and MCP tool definitions. |
| [`@ecad/default-symbols`](packages/default-symbols) | Offline generator for 66 built-in schematic symbols (KiCad-derived and Nordic datasheets). |
| [`@ecad/default-footprints`](packages/default-footprints) | Offline generator for 64 built-in footprints used by default symbols and the RP2350A reference design. |
| [`@ecad/default-models`](packages/default-models) | Built-in library of 62 binary glTF 3D component models for the realistic board view. |
| [`@ecad/web`](packages/web) | TanStack Start web app, Origin Private File System (OPFS) projects, browser symbol storage, routes, and HTTP services. |
| [`@ecad/desktop`](packages/desktop) | Electron desktop app, local filesystem projects, file watching, and native symbol directory storage. |
| [`@ecad/cli`](packages/cli) | Standalone Node CLI and stdio MCP server for editing local `.ecaddraw` files. |

## Prerequisites

- **Node.js**: `^24.14.0` or `>=25.4.0` (run `nvm use` if you use nvm; pnpm rejects unsupported versions).
- **pnpm**: `10.34.9` (managed via Corepack).

```bash
corepack enable
pnpm install
```

## Running the apps

### Web app

```bash
pnpm run dev
```

Open `http://localhost:3000/editor` for the editor. The dev server (and `pnpm run preview`) accepts `localhost` and IP addresses by default. To allow additional hostnames (such as a Tailscale hostname), set `ECAD_ALLOWED_HOSTS` in your shell or root `.env.local`:

```bash
ECAD_ALLOWED_HOSTS=devbox.example.ts.net pnpm run dev
```

### Desktop app

```bash
pnpm run dev:desktop /absolute/project-directory
```

The project path argument (a project directory or `.ecadprj` file) is optional; without it, ECAD restores the last opened project.

If Electron exits with a `chrome-sandbox` permissions error on Linux, configure the system sandbox or pass `--no-sandbox` for local development:

```bash
pnpm run dev:desktop --no-sandbox /absolute/project-directory
```

### CLI and MCP server

The CLI edits local `.ecaddraw` files using the same `@ecad/drawing-core` commands as the apps:

```bash
export ECAD_DRAWING="$PWD/drawing.ecaddraw"
pnpm --silent cli tools
pnpm --silent cli getDrawing
pnpm --silent cli placeRectangle '{"x":20,"y":30,"width":40,"height":15,"rotation":0,"lineWidth":0.2}'
pnpm --silent cli undo
pnpm --silent cli mcp
```

- `--drawing <path>` overrides `ECAD_DRAWING` (default: `./drawing.ecaddraw`); a `path` inside tool arguments overrides both.
- All 12 drawing MCP tools are available by name. Arguments accept JSON or `-` for stdin; results use MCP JSON format (`structuredContent` and `isError`), with exit code `1` on failure.
- An adjacent `<drawing>.history.json` file preserves up to 100 undo nodes across CLI calls and MCP restarts. Concurrent access is coordinated with a file lock.
- `ecad mcp` starts the stdio MCP server (every tool call requires an absolute `path`). In the desktop app, **Settings → MCP** configures it automatically for Claude Code and Codex.

See [docs/mcp.md](docs/mcp.md) for the full tool reference, locking details, and client configuration.

## Projects and storage

The **Projects** page manages projects and their files (schematics, circuits, PCBs, footprints, custom symbols, and imported Gerber/STEP assets). Creating a project starts empty; creating one from an unsaved Untitled workspace moves that work into the new project. Edits autosave and undo history survives switching views within a session.

- **Desktop projects** live in a folder with a TOML `.ecadprj` manifest, `<name>.ecaddraw` files, `symbols/`, `footprints/`, and `assets/`. Writes are atomic, external edits are watched and reloaded (or flagged as conflicts when local edits are pending), and user settings live in `~/.config/ecad` (Linux), `~/Library/Application Support/ecad` (macOS), or `%APPDATA%\ecad` (Windows).
- **Web projects** live in the browser's Origin Private File System (OPFS), publishing each save by replacing `.ecadprj`. User symbol libraries live separately in `localStorage`.

Example `.ecadprj` manifest:

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

## Built-in libraries and exports

- **Symbols (66)** — Manage libraries under **Settings → Symbol libraries** (or **Projects → Symbol libraries**). Export standalone `.ecadsym` files with `pnpm run symbols:generate /absolute/path/to/output`. See [packages/default-symbols/README.md](packages/default-symbols/README.md) and [docs/symbol-format.md](docs/symbol-format.md).
- **Footprints (64) & 3D models (62)** — Most built-in symbols reference a default footprint, editable per placement in Attributes. Export standalone `.ecadfp` files with `pnpm run footprints:generate /absolute/path/to/output`, and rebuild models with `pnpm run models:build`. See [packages/default-footprints/README.md](packages/default-footprints/README.md), [packages/default-models/README.md](packages/default-models/README.md), and [docs/footprints.md](docs/footprints.md).
- **Schematic, footprint, and board export** — **Export drawing** (or **Export** in the PCB editor) writes PNG (up to 16,384 px/side and 100 MP; default 9600 × 6400), vector SVG (editable JetBrains Mono text), or 1:1 scale vector PDF (embedded JetBrains Mono glyph outlines; one page per populated board layer with drill knockouts, solder mask openings, and bookmarks). The PCB editor also exports Gerber X2 and Excellon drill ZIP archives. See [docs/pcb.md](docs/pcb.md#fabrication-files).

## Build and verification

```bash
# Build individual packages or everything
pnpm run build:web
pnpm run build:desktop
pnpm run build:cli
pnpm run build

# Preview built web app or launch built desktop app
pnpm run preview
pnpm run start:desktop /absolute/project-directory

# Format, lint, typecheck, and test
pnpm run format
pnpm run lint
pnpm run check
pnpm run typecheck
pnpm test
pnpm run test:browser
```

For Debian `.deb` packaging, APT repositories, GitHub Releases, desktop auto-updates, Vercel deployment, and CI workflows, see [docs/releases.md](docs/releases.md).

## Working in the packages

- Import headless drawing, circuit, footprint, board, ERC, and MCP modules directly from `@ecad/drawing-core/...`.
- Within `@ecad/core`, use `#/...` subpath imports (for example `#/components/editor/Editor2D.tsx`). Other workspace packages import shared code through `@ecad/core/...`.
- Web routes live in `packages/web/src/routes` (root document in `__root.tsx`). Run `pnpm run generate-routes` after changing routes when needed.
- Shared Tailwind styles live in `packages/core/src/styles.css`.

## Documentation

### User and feature guides
- [Glossary](GLOSSARY.md) — Canonical terms for schematics, footprints, and PCBs
- [Viewers and canvas rendering](docs/viewer.md) — Schematic canvas, Gerber and STEP viewers, 2D/3D engine
- [PCB editor](docs/pcb.md) — Multi-layer boards, routing, copper zones, thermal reliefs, DRC, fabrication export
- [Footprint editor](docs/footprints.md) — Pads, slots, vias, unplated holes, 3D editing, realistic view, `.ecadfp` format
- [Symbol files](docs/symbol-format.md) — Libraries, `.ecadsym` format, attributes, pin types, references, locks
- [Named electrical nets](docs/named-nets.md) — Net/supply labels, net symbols, multi-page schematics
- [Electrical rules check (ERC)](docs/erc.md) — Built-in rules, pin conflict matrix, custom rule API
- [Importing KiCad schematics](docs/kicad-import.md) — `.kicad_sch` converter, import reports, limits
- [MCP and CLI access](docs/mcp.md) — Claude Code/Codex setup, CLI commands, stdio MCP protocol, locking
- [Settings](docs/settings.md) — Global and project settings, themes, board units, storage

### Architecture and contributor guides
- [Drawing architecture](docs/architecture.md) — Package boundaries, Effect commands, workers, dialogs, circuits
- [Effect integration](docs/effect.md) — Scoped imports, resource lifetimes, storage errors, HTTP/server services
- [Browser tests](docs/browser-tests.md) and [Test ownership](tests/README.md) — Unit, browser, and smoke suites
- [Performance measurements](docs/performance.md) — A/B runs, main checks, budgets, live diagnostics, field data
- [Parallel development](docs/parallel-development.md) — Rootless Podman sandbox and host benchmark lock
- [Releases, packaging, and CI](docs/releases.md) — Debian packages, APT channels, desktop updates, Vercel, GitHub Actions
- [Publication checklist](docs/publication.md) — Pre-public audit and distribution license verification

## Licensing

Original application code is licensed under the [MIT license](LICENSE). Third-party code and assets retain their own licenses, including KiCad-derived symbols/footprints/models (CC BY-SA 4.0 with electronic-design exception), the Inter and JetBrains Mono fonts, and the LGPL STEP importer (`occt-import-js`).

See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and [docs/publication.md](docs/publication.md). Production web and desktop builds bundle dependency notices and matching STEP importer source archives; the first build downloads roughly 53 MB of source archives (see [licenses/STEP-SOURCE.md](licenses/STEP-SOURCE.md)).
