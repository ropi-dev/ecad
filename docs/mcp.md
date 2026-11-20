# MCP and CLI access

`ecad mcp` is a standalone Node stdio MCP server for reading and editing `.ecaddraw` files. Every MCP tool takes an absolute `path`, so a single client configuration works across all drawings. The desktop app does not host an MCP server itself; **Settings → MCP** configures `ecad mcp` for Claude Code and Codex, and the desktop app automatically reloads drawings edited on disk.

## Desktop setup for Claude Code and Codex

Open **Settings → MCP** in the desktop app and click **Add** (or **Update** / **Remove**) beside a client:

| Client | Config file | Entry |
| --- | --- | --- |
| Claude Code | `~/.claude.json` (or `$CLAUDE_CONFIG_DIR/.claude.json`) | `mcpServers.ecad` (user scope) |
| Codex | `~/.codex/config.toml` (or `$CODEX_HOME/config.toml`) | `[mcp_servers.ecad]` |

- The generated command runs ECAD's bundled CLI on Electron's embedded Node runtime (`ELECTRON_RUN_AS_NODE=1`): `cli/ecad.js` in packaged apps, or `packages/cli/src/main.ts` via `tsx` in dev checkouts.
- Config files are updated atomically (preserving unrelated settings and TOML comments) and re-parsed before writing; if another setting would be altered (e.g., an inline TOML table), ECAD asks you to edit the file manually. Restart already-running agent sessions to pick up changes.
- When the desktop app has a project open, drawings modified by `ecad mcp` reload automatically (starting fresh undo history), or enter conflict mode if unsaved local edits exist.

## CLI and manual stdio setup

Run the CLI directly in development or build it once (`pnpm run build:cli`):

```bash
export ECAD_DRAWING="$PWD/drawing.ecaddraw"
pnpm --silent cli tools
pnpm --silent cli getDrawing
pnpm --silent cli placeRectangle '{"x":20,"y":30,"width":40,"height":15,"rotation":0,"lineWidth":0.2}'
pnpm --silent cli rotateShapes '{"ids":[1],"angle":1.5707963267948966}'
printf '%s' '{"ids":[1]}' | pnpm --silent cli removeShapes -
pnpm --silent cli undo

# Built binary:
node packages/cli/bin/ecad.mjs --drawing drawing.ecaddraw getDrawing
```

- `--drawing <path>` overrides `ECAD_DRAWING` (default: `./drawing.ecaddraw`); a `path` inside JSON arguments overrides both.
- All 12 drawing tools are exposed as subcommands (`call <tool> [json|-]` disambiguates collisions; arguments default to `{}`). `--timeout <ms>` sets the file lock wait (default `30000`).
- Successful calls print one MCP JSON result to stdout; errors return exit code `1`.

Manual MCP client config (or `"command": "ecad", "args": ["mcp"]` when installed via `.deb`):

```json
{
  "mcpServers": {
    "ecad": {
      "command": "node",
      "args": ["/absolute/path/to/ecad/packages/cli/bin/ecad.mjs", "mcp"]
    }
  }
}
```

- `ecad mcp` rejects `--drawing` and ignores `ECAD_DRAWING`; every tool call must pass an absolute `path` (relative paths fail with `InvalidDrawingPath`).
- Stdout carries only MCP JSON-RPC messages (malformed lines log to stderr). Messages over 10 MB or I/O errors exit with code `1`. `SIGINT`/`SIGTERM`/`SIGHUP` wait for active commands to release locks before exiting (`130`/`143`/`129`).

## History and file locking

- **History** — An adjacent `<drawing>.history.json` persists undo branches (capped at 100 nodes across branches) and monotonic shape IDs across CLI/MCP invocations. External edits to the drawing reset history.
- **Locking** — Each call locks `<drawing>.lock`, reloads the latest file, verifies no concurrent un-locked edits occurred, syncs temporary files, and atomically renames them into place (preserving file permissions).
- **Stale lock recovery** — Locks record PID and hostname (plus Linux machine ID, boot ID, PID namespace, and process start time). Abandoned locks from exited processes or earlier boots are safely claimed and removed. Locks from other hosts, other PID namespaces, or unreadable legacy locks block until `--timeout`.

## Drawing tools (12)

All coordinates and dimensions are in millimetres (`(x, y)` center, positive Y up, rotation in radians). Commands never consult editor selection, active tools, or grid snapping.

| Tool | Arguments | Behavior |
| --- | --- | --- |
| `getDrawing` | `offset?`, `limit?`, `revision?` | Read committed `shapes`, `pages`, `sheet`, `nets`, `nextShapeId`, `history`, and `revision`. Supports chunked paging. |
| `placeRectangle` | `x`, `y`, `width`, `height`, `rotation`, `lineWidth`, `page?` | Place one rectangle in one undo step. |
| `placeShapes` | `shapes`, `label?` | Batch-place complete shapes (rectangles, circles, triangles, lines, orthogonal wires, pins, text, symbols) with wire normalization. |
| `replaceShapes` | `shapes`, `label?`, `targetIds?` | Replace complete geometry for existing IDs (preserve `page` from `getDrawing`). |
| `rotateShapes` | `ids`, `angle?` | Rotate existing IDs around their own centers (radians CCW, default `π/2`; wires require multiples of `π/2`; single page). |
| `removeShapes` | `ids`, `label?` | Remove existing IDs. |
| `setPages` | `pages`, `label?` | Replace the ordered `{ id, name }` page list (deleting a page removes its shapes). |
| `setSheet` | `sheet`, `label?` | Replace shared paper size and title block settings. |
| `moveShapesToPage` | `ids`, `page`, `label?` | Move shapes (and pinned circuit labels) to another page at the same coordinates. |
| `undo` | `{}` | Step back to the previous history node. |
| `redo` | `{}` | Step forward to the preferred redo branch. |
| `jumpHistory` | `id` | Jump to any retained history node across branches. |

## Replies and paging

Every successful reply returns `{ ok: true, summary: { shapeCount, nextShapeId, historyId }, ... }` in both `structuredContent` and JSON text. Mutation replies stay small by omitting the full drawing (`place*`/`replace*`/`rotate*`/`move*` include `result.ids` and `result.idMap`); call `getDrawing` to inspect geometry and derived `nets`.

To stay within the 10 MiB stdio transport limit, `getDrawing` caps serialized replies at **8 MiB**:

- Without `offset`/`limit`, an oversized drawing fails with `DrawingTooLarge`.
- Pass `{ "offset": 0 }` (and optional `limit`) to page through shapes, then pass `page.nextOffset` and the first chunk's `revision` until `nextOffset` is absent.
- Only offset `0` includes `nets`. A concurrent edit invalidates `revision` and returns `DrawingChanged` (restart from offset `0`); omitting `revision` on later chunks returns `RevisionRequired`.

## Code map

| Location | Responsibility |
| --- | --- |
| `packages/drawing-core/src/mcp/drawing-protocol.ts` | Operation/reply schemas and Effect command execution. |
| `packages/drawing-core/src/mcp/drawing-server.ts` | MCP tool registration, `path` handling, and 8 MiB reply guard. |
| `packages/cli/src/drawing.ts` | File locking, atomic saves, and `.history.json` persistence. |
| `packages/desktop/src/main/mcp-clients.ts` | Claude Code and Codex config management behind **Settings → MCP**. |

`@ecad/cli` also exports `runCli`, `createLocalDrawings`, `createLocalDrawingMcpServer`, and `serveStdioMcp` for programmatic workspace use.
