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
		new Request("http://localhost/api/editor-mcp", { method: "POST" }),
	);
	assert.equal(created.status, 201);
	assert.equal(created.headers.get("cache-control"), "no-store");
	const session = await created.json();
	const url = `http://localhost/api/editor-mcp/${session.sessionId}`;
	assert.equal(
		(await handlers.session(new Request(url), session.sessionId)).status,
		401,
	);
	assert.equal(
		(
			await handlers.session(
				new Request(url, { headers: auth(session.mcpToken) }),
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
			headers: auth(session.editorToken),
			body: "{}",
		}),
		session.sessionId,
	);
	assert.equal(malformed.status, 400);
	assert.equal((await malformed.json()).error.code, "InvalidReply");
	const stream = await handlers.session(
		new Request(url, { headers: auth(session.editorToken) }),
		session.sessionId,
	);
	assert.equal(stream.status, 200);
	assert.equal(
		(
			await handlers.session(
				new Request(url, { headers: auth(session.editorToken) }),
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
		assert.equal((await client.listTools()).tools.length, 8);
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
