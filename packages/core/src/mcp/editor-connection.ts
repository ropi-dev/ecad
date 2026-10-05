import { Effect } from "effect";
import { z } from "zod";
import {
	type createDrawingStore,
	DrawingStore,
} from "#/commands/drawing-store.ts";
import {
	type DrawingReply,
	drawingEnvelopeSchema,
	executeDrawingOperation,
} from "#/mcp/drawing-protocol.ts";

export type EditorMcpState =
	| { status: "connecting" }
	| { status: "connected"; url: string; token: string }
	| { status: "disconnected" }
	| { status: "error"; message: string };

export interface EditorMcpConnectionOptions {
	store: ReturnType<typeof createDrawingStore>;
	onState: (state: EditorMcpState) => void;
	baseUrl?: string;
	fetch?: typeof globalThis.fetch;
	now?: () => number;
}

const sessionSchema = z.object({
	sessionId: z.string().min(1).max(200),
	mcpToken: z.string().min(1).max(4096),
	editorToken: z.string().min(1).max(4096),
});

function connectionError(error: unknown): Error {
	return error instanceof Error
		? error
		: new Error("The MCP connection failed.");
}

/** One explicit connection to the supplied drawing. Failed streams are never replayed. */
export function connectEditorMcp({
	store,
	onState,
	baseUrl = window.location.origin,
	fetch: request = globalThis.fetch.bind(globalThis),
	now = Date.now,
}: EditorMcpConnectionOptions) {
	const abort = new AbortController();
	const interrupt = new AbortController();
	let disconnected = false;
	let failure: string | undefined;
	const endpoint = new URL("/api/editor-mcp", baseUrl).href;
	const requestEffect = (url: string, options: RequestInit) =>
		Effect.tryPromise({
			try: async () => {
				const response = await request(url, {
					...options,
					signal: abort.signal,
				});
				if (!response.ok) {
					let message = `MCP connection request failed (${response.status}).`;
					try {
						const body = await response.json();
						if (typeof body?.error?.message === "string")
							message = body.error.message;
					} catch {
						// An HTTP error may have no JSON response body.
					}
					throw new Error(message);
				}
				return response;
			},
			catch: connectionError,
		});
	const readJson = (response: Response) =>
		Effect.tryPromise({
			try: () => response.json(),
			catch: connectionError,
		});
	const program = Effect.scoped(
		Effect.gen(function* () {
			yield* Effect.addFinalizer(() => Effect.sync(() => abort.abort()));
			const session = yield* Effect.acquireRelease(
				Effect.gen(function* () {
					const response = yield* requestEffect(endpoint, { method: "POST" });
					const value = yield* readJson(response);
					return yield* Effect.try({
						try: () => sessionSchema.parse(value),
						catch: () =>
							new Error("The MCP server returned an invalid session."),
					});
				}),
				(session) =>
					Effect.promise(async () => {
						try {
							await request(
								`${endpoint}/${encodeURIComponent(session.sessionId)}`,
								{
									method: "DELETE",
									headers: { Authorization: `Bearer ${session.editorToken}` },
									keepalive: true,
									signal: AbortSignal.timeout(5000),
								},
							);
						} catch {
							// Closing the stream also disconnects the server-side session.
						}
					}),
			);
			const ownerUrl = `${endpoint}/${encodeURIComponent(session.sessionId)}`;
			const headers = { Authorization: `Bearer ${session.editorToken}` };
			const response = yield* requestEffect(ownerUrl, { headers });
			if (!response.body)
				return yield* Effect.fail(
					new Error("The MCP command stream is unavailable."),
				);
			const body = response.body;
			const reader = yield* Effect.acquireRelease(
				Effect.sync(() => body.getReader()),
				(reader) => Effect.promise(() => reader.cancel().catch(() => {})),
			);
			yield* Effect.sync(() =>
				onState({
					status: "connected",
					url: new URL(
						`/mcp/editor/${encodeURIComponent(session.sessionId)}`,
						baseUrl,
					).href,
					token: session.mcpToken,
				}),
			);
			const decoder = new TextDecoder();
			const seen = new Set<string>();
			let pending = "";
			while (true) {
				const chunk = yield* Effect.tryPromise({
					try: () => reader.read(),
					catch: connectionError,
				});
				if (chunk.done)
					return yield* Effect.fail(
						new Error(
							"The MCP connection closed. Enable MCP again to reconnect.",
						),
					);
				pending += decoder.decode(chunk.value, { stream: true });
				if (pending.length > 2 * 1024 * 1024)
					return yield* Effect.fail(
						new Error("The MCP command exceeded the size limit."),
					);
				let newline = pending.indexOf("\n");
				while (newline !== -1) {
					const line = pending.slice(0, newline).trim();
					pending = pending.slice(newline + 1);
					if (line) {
						const envelope = yield* Effect.try({
							try: () => drawingEnvelopeSchema.parse(JSON.parse(line)),
							catch: () => new Error("The MCP server sent an invalid command."),
						});
						if (seen.has(envelope.requestId))
							return yield* Effect.fail(
								new Error("The MCP server repeated a command."),
							);
						seen.add(envelope.requestId);
						if (abort.signal.aborted) return;
						const reply: DrawingReply =
							envelope.expiresAt <= now()
								? {
										ok: false,
										error: {
											code: "CommandExpired",
											message: "The drawing command expired before execution.",
										},
									}
								: yield* executeDrawingOperation(envelope.operation).pipe(
										Effect.provideService(DrawingStore, store),
									);
						// A failed acknowledgement stops processing; the mutation is never retried.
						yield* requestEffect(ownerUrl, {
							method: "POST",
							headers: { ...headers, "Content-Type": "application/json" },
							body: JSON.stringify({ requestId: envelope.requestId, reply }),
						});
					}
					newline = pending.indexOf("\n");
				}
			}
		}),
	).pipe(
		Effect.catchAll((error) =>
			Effect.sync(() => {
				failure = error.message;
			}),
		),
	);
	onState({ status: "connecting" });
	const done = Effect.runPromise(program, { signal: interrupt.signal })
		.catch(() => {
			failure = "The MCP connection failed. Enable MCP again to reconnect.";
		})
		.then(() => {
			onState(
				disconnected
					? { status: "disconnected" }
					: {
							status: "error",
							message: failure ?? "The MCP connection closed.",
						},
			);
		});
	return {
		done,
		disconnect: () => {
			if (disconnected) return;
			disconnected = true;
			abort.abort();
			interrupt.abort();
		},
	};
}
