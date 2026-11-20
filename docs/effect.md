# Effect integration

ECAD uses Effect 3 for drawing commands, file imports, HTTP requests, subscriptions, server operations, and scoped resource cleanup. Solid 2.0 owns transient UI state, TanStack Start owns routing, and geometry/rendering math remains synchronous TypeScript.

See [docs/architecture.md](architecture.md) for drawing command inputs and store boundaries.

## Execution boundaries

Compose async domain workflows with `Effect.gen` and run them at UI event handlers, Solid effects, server functions, or HTTP handlers via `runEffect` (`packages/drawing-core/src/lib/effect.ts`), forwarding any available `AbortSignal`:

```ts
const value = await runEffect(program, signal);
```

- `runEffect` unwraps expected errors instead of exposing Effect's fiber wrapper, and preserves caller abort reasons on interruption.
- Register cleanup inside the Effect so resources release before the returned Promise rejects. If an operation completes just before abort, it returns its value; callers owning resources must dispose superseded results.
- Declare expected domain errors with `Data.TaggedError` and convert them to UI messages or protocol errors at boundaries. Do not call `runPromise` nested inside domain Effects.
- Synchronous drawing commands execute via `Effect.runSync` at event boundaries.

## File imports and resource ownership

- `packages/core/src/formats/import-effects.ts` defines file read errors, scoped worker requests, timeouts, and ownership registration.
- `parseGerberFileEffect`, `parseStepFileEffect`, `parseKiCadFileEffect`, and `expandGerberFileEffect` compose imports (Promise wrappers remain available for non-Effect callers).
- `importFilesEffect` processes files in order, returning accepted inputs alongside per-file error messages so valid files survive an invalid neighbor. Gerber archives preserve physical layer ordering.
- `useFileImport` runs one batch at a time, aborts superseded batches, updates Solid signals, and uses `ImportOwnership` to keep pending and displayed scene objects alive until unmounted or replaced.

### Size limits

Parsers and project asset storage check `file.size` before reading, failing with `InvalidFile` (or `ProjectAssetTooLarge` for project assets) when exceeded (`packages/core/src/formats/import-limits.ts`):

| File type | Constant | Limit |
| --- | --- | --- |
| STEP model | `MAX_STEP_FILE_BYTES` | 256 MiB |
| Gerber layer | `MAX_GERBER_FILE_BYTES` | 64 MiB |
| Gerber ZIP archive | `MAX_GERBER_ARCHIVE_BYTES` | 256 MiB (64 MiB per entry) |
| KiCad schematic | `MAX_KICAD_FILE_BYTES` | 32 MiB |

Project asset restores return valid files and report oversized assets in `problems` without failing the whole workspace. Copying a project skips oversized assets and reports them while leaving the original intact.

### Worker vs. scene lifetimes

- **Workers** belong to the parsing Effect scope and terminate automatically on success, failure, timeout, or interruption (ZIP decompression cancels via its abort hook).
- **Imported scene objects** outlive the import scope. `acquireImported` registers rollback on failure/interruption inside a per-file child scope, then transfers ownership on success to the caller, which must invoke the returned `dispose()` when removing the model or layer.

## Viewer and editor lifecycles

`createLifecycle` bridges Effect scopes to synchronous Solid setup and cleanup. Register every resource immediately via `acquire`, `addFinalizer`, or `listen`, and call `dispose` on init failure or unmount. Finalizers run in reverse order even if an earlier finalizer throws. Frame rendering and pointer-move math stay synchronous and never execute per-frame Effects.

## Browser HTTP client

`HttpClient` (`packages/core/src/lib/http.ts`) is an injectable service. `requestJson` verifies HTTP status and decodes responses with Effect Schema while keeping the request scope open through body read so mid-body aborts cancel the fetch. Use `HttpClientLive` in production and `makeHttpClient` in tests.

## Project storage errors and queuing

Project storage exposes a Promise API whose expected failures are `Data.TaggedError` classes in `packages/core/src/projects/errors.ts`. Match them by tag with `isProjectError(cause, "ProjectConflict")`, never by message text:

- `ProjectConflict` — A project file changed on disk after load. `ProjectProvider` pauses saving while preserving in-memory edits, and `ProjectShell` offers **Reload from disk**.
- `InvalidProjectFile` — Names the offending file with a readable schema reason.
- `InvalidProjectDocument` — Save-time document validation failure.

Because Electron IPC preserves only error messages, the main process encodes tag/field metadata into the message and the renderer reconstructs the tagged error. Storage classes and `ProjectProvider` serialize operations via `createSerialQueue` (`packages/core/src/lib/serial-queue.ts`).

## Server and desktop boundaries

- Web server services live behind TanStack Start server functions and server routes.
- Desktop filesystem operations (including MCP client config edits) live in Electron's main process behind the preload bridge. Never import filesystem modules into browser helpers or renderer components.
- Keep Zod where existing framework/MCP integrations use it; use Effect Schema at new data boundaries.

## Verification

```bash
pnpm run typecheck
pnpm test
pnpm run test:browser
pnpm run build
```
