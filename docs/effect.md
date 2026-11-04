# Effect integration

The project uses Effect 3 for drawing commands, file imports, browser requests, subscriptions, server operations, and resource cleanup. React owns transient UI state. Drawing commands own committed drawing data and history. TanStack owns routing. Geometry algorithms and frame rendering remain synchronous TypeScript.

See [drawing architecture](architecture.md) for complete command inputs, the document store, gesture previews, and rendering boundaries. Synchronous drawing commands run at event boundaries after input is resolved, using `Effect.runSync`. React effects bind rendering resources and subscriptions; they do not trigger document edits.

## Running operations

Compose operations with `Effect.gen`, and run them at a React hook, server function, or HTTP handler using `runEffect` from `packages/core/src/lib/effect.ts`. Pass the framework's `AbortSignal` when one is available.

```ts
const value = await runEffect(program, signal);
```

`runEffect` preserves expected error objects instead of exposing Effect's fiber error wrapper to existing callers. Interruption preserves the caller's abort reason. Register cleanup inside the operation so resources are released before its Promise rejects. A successfully completed operation returns its value even if the signal aborts just after completion; the caller must handle a superseded result if it owns resources.

Domain functions return Effects and declare expected errors with `Data.TaggedError`. Handle those errors where recovery is possible. Convert them into UI messages or protocol errors at the boundary. Keep unexpected programming defects distinct from invalid input. Avoid running nested Effects with `runPromise` inside domain operations.

## Imports and ownership

- `packages/core/src/formats/import-effects.ts` contains file read errors, scoped worker requests, timeouts, and import ownership registration.
- `parseGerberFileEffect`, `parseStepFileEffect`, and `expandGerberFileEffect` compose the import operations. The existing Promise functions remain available for callers outside Effect.
- `importFilesEffect` processes files in order and collects per-file failures as messages. Valid files survive a neighboring invalid file. Gerber archives retain their physical layer ordering.
- `useFileImport` runs a batch once, aborts a superseded batch, and updates React state. Its synchronous acceptance callback stages ownership before another request or unmount can intervene. `ImportOwnership` keeps pending and displayed resources alive through React commits, and releases uncommitted results on unmount.

Workers belong to the parsing operation. Their finalizers terminate them on success, failure, timeout, or interruption. CPU-heavy parsing still runs in Web Workers. ZIP cancellation invokes the decompressor's cancellation function. Browser `File.text()` and `File.arrayBuffer()` cannot themselves be interrupted, but cancellation prevents subsequent processing.

Imported scene objects have a different lifetime. `acquireImported` registers rollback on failure or interruption. Each file has a child scope, so a failure after allocation releases that file's geometry while other files can still succeed. A successful import scope transfers ownership to its caller, which must call the returned `dispose()` when the model or layer is removed. Do not treat an import scope as an ordinary scope that disposes successful results. Do not cache disposable scene objects without defining who owns them.

## Viewer and editor resources

`createLifecycle` bridges Effect scopes to synchronous React setup and cleanup. Register each resource immediately after acquisition with `acquire`, `addFinalizer`, or `listen`. Call `dispose` on initialization failure and on unmount. Finalizers run in reverse order, including when another finalizer fails.

Viewport renderers, scene displays, hover overlays, controls, listeners, and editor materials use this lifetime. Calculations inside render and pointer handlers do not execute an Effect for every frame.

## Browser services

`HttpClient` is an injectable service in `packages/core/src/lib/http.ts`. `requestJson` checks HTTP status and decodes the response with Effect Schema. Its request scope remains open while the body is read, so aborting after headers still cancels the fetch. Use `HttpClientLive` in production and `makeHttpClient` with a test implementation in tests.

## Project storage errors

Project storage keeps its Promise API, but its expected failures are `Data.TaggedError` classes from `packages/core/src/projects/errors.ts`. Callers match the tag with `isProjectError(cause, "ProjectConflict")`, never the message text. `ProjectConflict` means a project file changed on disk after it was loaded. `InvalidProjectFile` names the file and gives a readable reason instead of raw Zod issues. Save-time document validation fails with `InvalidProjectDocument`. Electron keeps only an error's message across IPC, so the main process encodes a project error's tag and fields in the message and the renderer storage rebuilds the class.

After a conflict, `ProjectProvider` stops saving and keeps edits in memory. `ProjectShell` shows the conflict with a **Reload from disk** action and warns that reloading discards unsaved changes. Library load failures during a save appear as editor issues. A circuit part from a library that failed to load fails the save instead of becoming a placeholder symbol.

Storage classes and the provider serialize their operations with `createSerialQueue` from `packages/core/src/lib/serial-queue.ts`. A task that throws or rejects fails only its own promise.

## Server services

Web server services stay behind Start server functions and server routes. The editor MCP session handlers in `packages/core/src/services/server/editor-mcp.ts` back the `/api/editor-mcp` and `/mcp/editor/<session-id>` routes; see the [MCP guide](mcp.md). Desktop filesystem operations live in Electron's main process and are called through the preload bridge. Never import filesystem services into browser helpers or renderer components.

Keep Zod where the existing framework integration already uses it. Effect Schema validates new application data boundaries. A process-wide managed runtime is unnecessary for the current services; use one only when shared scoped resources need an explicit application shutdown lifecycle.

## Verification

```sh
pnpm run typecheck
pnpm test
pnpm run test:browser
pnpm run build
```

Tests cover cancellation, worker failures and timeouts, import rollback and ownership, partial success, HTTP decoding and cancellation, and viewer finalizers. Browser tests cover the existing rendering and editor behavior.

Use pnpm for this repository and commit changes to `pnpm-lock.yaml`.
