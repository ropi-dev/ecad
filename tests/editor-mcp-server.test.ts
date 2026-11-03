import assert from "node:assert/strict";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Effect } from "effect";
import { createDrawingStore, DrawingStore } from "#/commands/drawing-store.ts";
import { runEffect } from "#/lib/effect.ts";
import {
	type DrawingEnvelope,
	type DrawingReply,
	drawingReplySchema,
	executeDrawingOperation,
} from "#/mcp/drawing-protocol.ts";
import {
	editorClientAddress,
	editorClientKey,
} from "#/services/server/client-address.ts";
import { createEditorMcpHandlers } from "#/services/server/editor-mcp.ts";
import {
	EditorSessionError,
	makeEditorSessionHub,
} from "#/services/server/editor-sessions.ts";

const rectangle = {
	type: "placeRectangle" as const,
	input: { x: 12, y: 24, width: 30, height: 20, rotation: 0, lineWidth: 0.2 },
};
const failure: DrawingReply = {
	ok: false,
	error: { code: "InvalidDrawingCommand", message: "Invalid geometry" },
};
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
/** What the app's own page sends: browsers add `Origin` to POST and DELETE requests. */
const sameOrigin = (token?: string) => ({
	Origin: "http://localhost",
	"Sec-Fetch-Site": "same-origin",
	...(token ? auth(token) : {}),
});
/** A same-origin browser GET carries `Sec-Fetch-Site` but no `Origin`. */
const sameOriginGet = (token?: string) => ({
	"Sec-Fetch-Site": "same-origin",
	...(token ? auth(token) : {}),
});

function captureCommands() {
	const envelopes: DrawingEnvelope[] = [];
	const listeners = new Set<() => void>();
	return {
		envelopes,
		send(envelope: DrawingEnvelope) {
			envelopes.push(envelope);
			for (const listener of listeners) listener();
		},
		waitFor(count: number) {
			return new Promise<void>((resolve) => {
				const check = () => {
					if (envelopes.length < count) return;
					listeners.delete(check);
					resolve();
				};
				listeners.add(check);
				check();
			});
		},
	};
}

test("the relay executes nothing until connected and isolates each live drawing", async () => {
	const hub = makeEditorSessionHub();
	const first = hub.create();
	const second = hub.create();
	const firstStore = createDrawingStore();
	const secondStore = createDrawingStore();
	await assert.rejects(
		runEffect(hub.request(first.sessionId, rectangle)),
		/disconnected/,
	);
	const connect = (credentials: typeof first, store: typeof firstStore) =>
		hub.connect(credentials.sessionId, credentials.editorToken, {
			send: (envelope) =>
				hub.acknowledge(
					credentials.sessionId,
					credentials.editorToken,
					envelope.requestId,
					Effect.runSync(
						executeDrawingOperation(envelope.operation).pipe(
							Effect.provideService(DrawingStore, store),
						),
					),
				),
			close: () => {},
		});
	connect(first, firstStore);
	connect(second, secondStore);
	try {
		const reply = await runEffect(hub.request(first.sessionId, rectangle));
		assert.equal(reply.ok, true);
		assert.equal(firstStore.getSnapshot().shapes.length, 1);
		assert.equal(secondStore.getSnapshot().shapes.length, 0);
		await runEffect(hub.request(first.sessionId, { type: "undo" }));
		assert.equal(firstStore.getSnapshot().shapes.length, 0);
	} finally {
		hub.dispose();
	}
});

test("pending commands are correlated and disconnect fails all waiting callers", async () => {
	const hub = makeEditorSessionHub();
	const session = hub.create();
	const { envelopes, send, waitFor } = captureCommands();
	let closed = 0;
	hub.connect(session.sessionId, session.editorToken, {
		send,
		close: () => {
			closed++;
		},
	});
	const first = runEffect(hub.request(session.sessionId, rectangle));
	const second = runEffect(
		hub.request(session.sessionId, { type: "getDrawing" }),
	);
	await waitFor(2);
	assert.equal(envelopes.length, 2);
	assert.notEqual(envelopes[0].requestId, envelopes[1].requestId);
	hub.acknowledge(
		session.sessionId,
		session.editorToken,
		envelopes[1].requestId,
		failure,
	);
	assert.deepEqual(await second, failure);
	const rejected = assert.rejects(first, /disconnected/);
	hub.disconnect(session.sessionId, session.editorToken);
	await rejected;
	assert.equal(closed, 1);
	assert.throws(
		() => hub.authorize(session.sessionId, session.mcpToken, "mcp"),
		EditorSessionError,
	);
	hub.dispose();
});

test("timeouts and cancellation remove pending commands without replaying them", async () => {
	const hub = makeEditorSessionHub({ timeoutMs: 20, maxPending: 1 });
	const session = hub.create();
	const { envelopes, send, waitFor } = captureCommands();
	hub.connect(session.sessionId, session.editorToken, {
		send,
		close: () => {},
	});
	try {
		const waiting = runEffect(hub.request(session.sessionId, rectangle));
		await waitFor(1);
		await assert.rejects(
			runEffect(hub.request(session.sessionId, rectangle)),
			/Too many commands/,
		);
		await assert.rejects(waiting, /may have completed/);
		assert.throws(
			() =>
				hub.acknowledge(
					session.sessionId,
					session.editorToken,
					envelopes[0].requestId,
					failure,
				),
			/no longer waiting/,
		);
		const abort = new AbortController();
		const cancelled = runEffect(
			hub.request(session.sessionId, rectangle),
			abort.signal,
		);
		await waitFor(2);
		abort.abort(new Error("Cancelled request"));
		await assert.rejects(cancelled, /Cancelled request/);
		assert.throws(
			() =>
				hub.acknowledge(
					session.sessionId,
					session.editorToken,
					envelopes[1].requestId,
					failure,
				),
			/no longer waiting/,
		);
		const last = runEffect(hub.request(session.sessionId, rectangle));
		await waitFor(3);
		hub.acknowledge(
			session.sessionId,
			session.editorToken,
			envelopes[2].requestId,
			failure,
		);
		assert.deepEqual(await last, failure);
		assert.equal(envelopes.length, 3);
	} finally {
		hub.dispose();
	}
});

test("unconnected sessions expire and session tokens have separate roles", () => {
	let now = 0;
	const hub = makeEditorSessionHub({
		maxSessions: 1,
		unconnectedTtlMs: 10,
		now: () => now,
	});
	const session = hub.create();
	assert.throws(
		() => hub.authorize(session.sessionId, session.mcpToken, "editor"),
		/valid editor session token/,
	);
	assert.throws(
		() => hub.authorize(session.sessionId, session.editorToken, "mcp"),
		/valid editor session token/,
	);
	assert.throws(() => hub.create(), /Too many editor connections/);
	now = 10;
	assert.notEqual(hub.create().sessionId, session.sessionId);
	assert.throws(
		() => hub.authorize(session.sessionId, session.mcpToken, "mcp"),
		/valid editor session token/,
	);
	hub.dispose();
});

test("HTTP endpoints reject missing/wrong credentials, cross-origin access, and invalid acknowledgments", async () => {
	const hub = makeEditorSessionHub();
	const handlers = createEditorMcpHandlers(hub);
	const created = await handlers.createSession(
		new Request("http://localhost/api/editor-mcp", {
			method: "POST",
			headers: sameOrigin(),
		}),
	);
	assert.equal(created.status, 201);
	assert.equal(created.headers.get("cache-control"), "no-store");
	const session = await created.json();
	const url = `http://localhost/api/editor-mcp/${session.sessionId}`;
	assert.equal(
		(
			await handlers.session(
				new Request(url, { headers: sameOriginGet() }),
				session.sessionId,
			)
		).status,
		401,
	);
	assert.equal(
		(
			await handlers.session(
				new Request(url, { headers: sameOriginGet(session.mcpToken) }),
				session.sessionId,
			)
		).status,
		401,
	);
	assert.equal(
		(
			await handlers.mcp(
				new Request(url, {
					headers: auth(session.editorToken),
					method: "POST",
				}),
				session.sessionId,
			)
		).status,
		401,
	);
	assert.equal(
		(
			await handlers.createSession(
				new Request(url, {
					method: "POST",
					headers: { Origin: "http://unrelated.example" },
				}),
			)
		).status,
		403,
	);
	const malformed = await handlers.session(
		new Request(url, {
			method: "POST",
			headers: sameOrigin(session.editorToken),
			body: "{}",
		}),
		session.sessionId,
	);
	assert.equal(malformed.status, 400);
	assert.equal((await malformed.json()).error.code, "InvalidReply");
	const stream = await handlers.session(
		new Request(url, { headers: sameOriginGet(session.editorToken) }),
		session.sessionId,
	);
	assert.equal(stream.status, 200);
	assert.equal(
		(
			await handlers.session(
				new Request(url, { headers: sameOriginGet(session.editorToken) }),
				session.sessionId,
			)
		).status,
		409,
	);
	await stream.body?.cancel();
	assert.equal(
		(
			await handlers.mcp(
				new Request(url, { method: "POST", headers: auth(session.mcpToken) }),
				session.sessionId,
			)
		).status,
		401,
	);
	hub.dispose();
});

test("the official Streamable HTTP client initializes, discovers tools, and receives the browser result", async () => {
	const hub = makeEditorSessionHub();
	const handlers = createEditorMcpHandlers(hub);
	const session = hub.create();
	const store = createDrawingStore();
	hub.connect(session.sessionId, session.editorToken, {
		send: (envelope) =>
			hub.acknowledge(
				session.sessionId,
				session.editorToken,
				envelope.requestId,
				Effect.runSync(
					executeDrawingOperation(envelope.operation).pipe(
						Effect.provideService(DrawingStore, store),
					),
				),
			),
		close: () => {},
	});
	const client = new Client({ name: "test-client", version: "1.0.0" });
	const transport = new StreamableHTTPClientTransport(
		new URL(`http://localhost/mcp/editor/${session.sessionId}`),
		{
			requestInit: { headers: auth(session.mcpToken) },
			fetch: (url, init) =>
				handlers.mcp(new Request(url, init), session.sessionId),
		},
	);
	try {
		await client.connect(transport);
		assert.equal((await client.listTools()).tools.length, 9);
		const result = await client.callTool({
			name: "placeRectangle",
			arguments: rectangle.input,
		});
		assert.equal(result.isError, undefined);
		assert.equal(drawingReplySchema.parse(result.structuredContent).ok, true);
		assert.deepEqual(store.getSnapshot().shapes, [
			{ ...rectangle.input, kind: "rectangle", id: 1 },
		]);
		const rejected = await client.callTool({
			name: "removeShapes",
			arguments: { ids: [999] },
		});
		assert.equal(rejected.isError, true);
		assert.equal(
			drawingReplySchema.parse(rejected.structuredContent).ok,
			false,
		);
		assert.equal(store.getSnapshot().history.currentId, 1);
	} finally {
		await client.close();
		hub.dispose();
	}
});

test("connected sessions close when idle and at their maximum lifetime", async () => {
	let now = 0;
	const hub = makeEditorSessionHub({
		idleTimeoutMs: 100,
		maxLifetimeMs: 250,
		sweepIntervalMs: 0,
		now: () => now,
	});
	const connect = () => {
		const session = hub.create();
		const state = { closed: 0 };
		hub.connect(session.sessionId, session.editorToken, {
			send: () => {},
			close: () => {
				state.closed++;
			},
		});
		return { session, state };
	};
	try {
		// Heartbeats keep the stream open, but only MCP use counts as activity.
		const idle = connect();
		const waiting = runEffect(hub.request(idle.session.sessionId, rectangle));
		now = 99;
		hub.sweep();
		assert.equal(idle.state.closed, 0);
		now = 100;
		hub.sweep();
		assert.equal(idle.state.closed, 1);
		await assert.rejects(waiting, /disconnected/);
		assert.throws(
			() => hub.authorize(idle.session.sessionId, idle.session.mcpToken, "mcp"),
			/valid editor session token/,
		);
		const busy = connect();
		for (now = 190; now < 350; now += 80) {
			hub.authorize(busy.session.sessionId, busy.session.mcpToken, "mcp");
			hub.sweep();
			assert.equal(busy.state.closed, 0);
		}
		now = 350;
		// An expired session is closed by any lookup, before its token is accepted.
		assert.throws(
			() => hub.authorize(busy.session.sessionId, busy.session.mcpToken, "mcp"),
			/valid editor session token/,
		);
		assert.equal(busy.state.closed, 1);
	} finally {
		hub.dispose();
	}
});

test("the sweep timer closes idle editor streams without other requests", async () => {
	const hub = makeEditorSessionHub({ idleTimeoutMs: 20, sweepIntervalMs: 5 });
	const handlers = createEditorMcpHandlers(hub);
	try {
		const session = hub.create();
		const response = await handlers.session(
			new Request(`http://localhost/api/editor-mcp/${session.sessionId}`, {
				headers: sameOriginGet(session.editorToken),
			}),
			session.sessionId,
		);
		assert.equal(response.status, 200);
		const reader = response.body?.getReader();
		assert.ok(reader);
		assert.deepEqual(new TextDecoder().decode((await reader.read()).value), "\n");
		assert.equal((await reader.read()).done, true);
		assert.throws(
			() => hub.authorize(session.sessionId, session.mcpToken, "mcp"),
			/valid editor session token/,
		);
	} finally {
		hub.dispose();
	}
});

test("one client cannot hold the whole session pool", async () => {
	const hub = makeEditorSessionHub({ maxSessions: 3, maxSessionsPerClient: 2 });
	const handlers = createEditorMcpHandlers(hub, { trustedProxyHops: 0 });
	const create = (peer: string, forwardedFor?: string) =>
		handlers.createSession(
			new Request("http://localhost/api/editor-mcp", {
				method: "POST",
				headers: {
					...sameOrigin(),
					...(forwardedFor ? { "X-Forwarded-For": forwardedFor } : {}),
				},
			}),
			peer,
		);
	try {
		const first = await create("2001:db8:1:2::10");
		assert.equal(first.status, 201);
		// Addresses in one IPv6 /64 are one client, and forwarding headers are not trusted.
		assert.equal(
			(await create("2001:db8:1:2:aaaa::1", "198.51.100.1")).status,
			201,
		);
		const limited = await create("2001:db8:1:2::ffff", "198.51.100.2");
		assert.equal(limited.status, 429);
		assert.equal((await limited.json()).error.code, "ClientSessionLimit");
		assert.equal((await create("192.0.2.1")).status, 201);
		const full = await create("192.0.2.2");
		assert.equal(full.status, 503);
		assert.equal((await full.json()).error.code, "SessionLimit");
		// Closing a session returns its slot to that client.
		const { sessionId, editorToken } = await first.json();
		hub.disconnect(sessionId, editorToken);
		assert.equal((await create("2001:db8:1:2::10")).status, 201);
	} finally {
		hub.dispose();
	}
});

test("client keys use the peer address unless proxy hops are explicitly trusted", () => {
	const forwarded = new Request("http://localhost/", {
		headers: { "X-Forwarded-For": "203.0.113.9, 198.51.100.7" },
	});
	assert.equal(editorClientAddress(forwarded, "10.0.0.2", 0), "10.0.0.2");
	// The proxy appended 198.51.100.7; the client wrote 203.0.113.9 itself.
	assert.equal(editorClientAddress(forwarded, "10.0.0.2", 1), "198.51.100.7");
	assert.equal(editorClientAddress(forwarded, "10.0.0.2", 2), "203.0.113.9");
	assert.equal(
		editorClientAddress(new Request("http://localhost/"), "10.0.0.2", 1),
		"10.0.0.2",
	);
	// IPv4-mapped IPv6 addresses count as their IPv4 address in every notation.
	for (const mapped of [
		"::ffff:192.0.2.4",
		"::FFFF:c000:204",
		"0:0:0:0:0:ffff:192.0.2.4",
		"0000:0000:0000:0000:0000:ffff:c000:0204",
	])
		assert.equal(editorClientKey(mapped), "192.0.2.4");
	assert.equal(editorClientKey("::ffff:c000:205"), "192.0.2.5");
	assert.equal(editorClientKey("[2001:db8::1%eth0]"), "2001:db8:0:0::/64");
	assert.equal(editorClientKey("2001:db8:0:0:1::1"), "2001:db8:0:0::/64");
	assert.equal(editorClientKey("64:ff9b::192.0.2.4"), "64:ff9b:0:0::/64");
	assert.equal(editorClientKey("not an address"), "unknown");
	assert.equal(editorClientKey(undefined), "unknown");
});

test("editor endpoints require a same-origin browser request; the MCP endpoint does not", async () => {
	const hub = makeEditorSessionHub();
	const handlers = createEditorMcpHandlers(hub);
	const createUrl = "http://localhost/api/editor-mcp";
	const rejected = async (response: Response) => {
		assert.equal(response.status, 403);
		assert.equal((await response.json()).error.code, "ForbiddenOrigin");
	};
	try {
		const crossOrigin: Record<string, string>[] = [
			{},
			{ Origin: "http://unrelated.example" },
			{ Origin: "null" },
			{ "Sec-Fetch-Site": "cross-site" },
			{ "Sec-Fetch-Site": "same-site" },
			{ Origin: "http://localhost", "Sec-Fetch-Site": "cross-site" },
		];
		for (const headers of crossOrigin)
			await rejected(
				await handlers.createSession(
					new Request(createUrl, { method: "POST", headers }),
				),
			);
		const allowed = await handlers.createSession(
			new Request(createUrl, {
				method: "POST",
				headers: { Origin: "http://localhost" },
			}),
		);
		assert.equal(allowed.status, 201);
		const session = await allowed.json();
		const url = `${createUrl}/${session.sessionId}`;
		const editor = auth(session.editorToken);
		await rejected(
			await handlers.session(new Request(url, { headers: editor }), session.sessionId),
		);
		await rejected(
			await handlers.session(
				new Request(url, {
					method: "POST",
					headers: editor,
					body: JSON.stringify({ requestId: crypto.randomUUID(), reply: failure }),
				}),
				session.sessionId,
			),
		);
		await rejected(
			await handlers.session(
				new Request(url, { method: "DELETE", headers: editor }),
				session.sessionId,
			),
		);
		const stream = await handlers.session(
			new Request(url, { headers: sameOriginGet(session.editorToken) }),
			session.sessionId,
		);
		assert.equal(stream.status, 200);
		// MCP clients send no Origin; the MCP token alone authenticates them.
		const initialize = (headers: Record<string, string>) =>
			handlers.mcp(
				new Request(`http://localhost/mcp/editor/${session.sessionId}`, {
					method: "POST",
					headers: {
						...auth(session.mcpToken),
						Accept: "application/json, text/event-stream",
						"Content-Type": "application/json",
						...headers,
					},
					body: JSON.stringify({
						jsonrpc: "2.0",
						id: 1,
						method: "initialize",
						params: {
							protocolVersion: "2025-06-18",
							capabilities: {},
							clientInfo: { name: "test-client", version: "1.0.0" },
						},
					}),
				}),
				session.sessionId,
			);
		const initialized = await initialize({});
		assert.equal(initialized.status, 200);
		assert.equal((await initialized.json()).result.serverInfo.name !== undefined, true);
		await rejected(await initialize({ Origin: "http://unrelated.example" }));
		const disconnected = await handlers.session(
			new Request(url, { method: "DELETE", headers: sameOrigin(session.editorToken) }),
			session.sessionId,
		);
		assert.equal(disconnected.status, 204);
		await stream.body?.cancel();
	} finally {
		hub.dispose();
	}
});

test("oversized request bodies are rejected with 413 before they are buffered", async () => {
	const hub = makeEditorSessionHub();
	const limit = 256;
	const handlers = createEditorMcpHandlers(hub, {
		editorReplyLimit: limit,
		mcpRequestLimit: limit,
	});
	const session = hub.create();
	const commands = captureCommands();
	hub.connect(session.sessionId, session.editorToken, {
		send: commands.send,
		close: () => {},
	});
	const url = `http://localhost/api/editor-mcp/${session.sessionId}`;
	const tooLarge = async (response: Response) => {
		assert.equal(response.status, 413);
		return response.json();
	};
	try {
		const declared = await tooLarge(
			await handlers.session(
				new Request(url, {
					method: "POST",
					headers: {
						...sameOrigin(session.editorToken),
						"Content-Length": String(limit + 1),
					},
					body: "x".repeat(limit + 1),
				}),
				session.sessionId,
			),
		);
		assert.equal(declared.error.code, "PayloadTooLarge");
		// A chunked body with no declared length is cut off once it exceeds the limit.
		let pulled = 0;
		const chunked = new ReadableStream<Uint8Array>({
			pull(controller) {
				pulled++;
				controller.enqueue(new TextEncoder().encode("x".repeat(40)));
				if (pulled === 100) controller.close();
			},
		});
		const streamed = await tooLarge(
			await handlers.session(
				new Request(url, {
					method: "POST",
					headers: sameOrigin(session.editorToken),
					body: chunked,
					duplex: "half",
				} as RequestInit),
				session.sessionId,
			),
		);
		assert.equal(streamed.error.code, "PayloadTooLarge");
		assert.ok(pulled < 100);
		// Requests that carry no body are limited by the bytes read, not the declared length.
		const padding = "x".repeat(2048);
		const chunkedPadding = () =>
			new ReadableStream<Uint8Array>({
				start(controller) {
					controller.enqueue(new TextEncoder().encode(padding));
					controller.close();
				},
			});
		const create = (init: RequestInit) =>
			handlers.createSession(
				new Request("http://localhost/api/editor-mcp", {
					method: "POST",
					...init,
				} as RequestInit),
			);
		await tooLarge(
			await create({
				headers: sameOrigin(),
				body: chunkedPadding(),
				duplex: "half",
			} as RequestInit),
		);
		await tooLarge(
			await create({
				headers: { ...sameOrigin(), "Content-Length": "10" },
				body: padding,
			}),
		);
		await tooLarge(
			await handlers.session(
				new Request(url, {
					method: "DELETE",
					headers: sameOrigin(session.editorToken),
					body: chunkedPadding(),
					duplex: "half",
				} as RequestInit),
				session.sessionId,
			),
		);
		// The refused disconnect left the session connected.
		hub.authorize(session.sessionId, session.mcpToken, "mcp");
		const mcp = await tooLarge(
			await handlers.mcp(
				new Request(`http://localhost/mcp/editor/${session.sessionId}`, {
					method: "POST",
					headers: {
						...auth(session.mcpToken),
						Accept: "application/json, text/event-stream",
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						jsonrpc: "2.0",
						id: 1,
						method: "ping",
						params: { padding: "x".repeat(limit) },
					}),
				}),
				session.sessionId,
			),
		);
		assert.match(mcp.error.message, /Payload Too Large/);
		assert.equal(commands.envelopes.length, 0);
		// Within the limit, the reply still reaches the waiting command.
		const waiting = runEffect(hub.request(session.sessionId, { type: "undo" }));
		await commands.waitFor(1);
		const small = {
			requestId: commands.envelopes[0].requestId,
			reply: { ok: false, error: { code: "E", message: "m" } },
		};
		const accepted = await handlers.session(
			new Request(url, {
				method: "POST",
				headers: sameOrigin(session.editorToken),
				body: JSON.stringify(small),
			}),
			session.sessionId,
		);
		assert.equal(accepted.status, 204);
		assert.deepEqual(await waiting, small.reply);
	} finally {
		hub.dispose();
	}
});
