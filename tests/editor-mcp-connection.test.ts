import assert from "node:assert/strict";
import { test } from "node:test";
import { createDrawingStore } from "#/commands/drawing-store.ts";
import type { DrawingEnvelope, DrawingReply } from "#/mcp/drawing-protocol.ts";
import {
	connectEditorMcp,
	type EditorMcpState,
} from "#/mcp/editor-connection.ts";

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

async function until(check: () => boolean) {
	for (let attempt = 0; attempt < 100; attempt++) {
		if (check()) return;
		await new Promise<void>((resolve) => setImmediate(resolve));
	}
	assert.fail("The expected connection event did not occur.");
}

const credentials = {
	sessionId: "session-1",
	mcpToken: "client-secret",
	editorToken: "owner-secret",
};
const rectangle: DrawingEnvelope["operation"] = {
	type: "placeRectangle",
	input: { x: 10, y: 20, width: 30, height: 40, rotation: 0, lineWidth: 0.2 },
};
function envelope(requestId: string, expiresAt = 1000): DrawingEnvelope {
	return { requestId, expiresAt, operation: rectangle };
}

function bridge({
	acknowledge,
	create,
	acknowledgementLimit,
}: {
	acknowledge?: (requestId: string, signal: AbortSignal) => Promise<Response>;
	create?: () => Promise<Response>;
	acknowledgementLimit?: number;
} = {}) {
	const store = createDrawingStore();
	const states: EditorMcpState[] = [];
	const replies: { requestId: string; reply: DrawingReply }[] = [];
	const calls: { url: string; options: RequestInit }[] = [];
	let controller!: ReadableStreamDefaultController<Uint8Array>;
	let streamCancelled = false;
	const stream = new ReadableStream<Uint8Array>({
		start(value) {
			controller = value;
		},
		cancel() {
			streamCancelled = true;
		},
	});
	const request: typeof fetch = async (url, options = {}) => {
		const target = String(url);
		calls.push({ url: target, options });
		if (target.endsWith("/api/editor-mcp"))
			return create ? create() : Response.json(credentials);
		assert.equal(
			new Headers(options.headers).get("Authorization"),
			"Bearer owner-secret",
		);
		if (options.method === "DELETE") return new Response(null, { status: 204 });
		if (options.method === "POST") {
			const value = JSON.parse(String(options.body));
			replies.push(value);
			return acknowledge
				? acknowledge(value.requestId, options.signal as AbortSignal)
				: new Response(null, { status: 204 });
		}
		return new Response(stream);
	};
	let time = 100;
	const connection = connectEditorMcp({
		store,
		baseUrl: "https://ecad.example",
		fetch: request,
		now: () => time,
		onState: (state) => states.push(state),
		acknowledgementLimit,
	});
	return {
		store,
		states,
		replies,
		calls,
		connection,
		setTime: (value: number) => {
			time = value;
		},
		send: (value: string) =>
			controller.enqueue(new TextEncoder().encode(value)),
		close: () => controller.close(),
		cancelled: () => streamCancelled,
	};
}

test("the connection executes in the supplied drawing and awaits each acknowledgement", async () => {
	const firstAck = deferred<Response>();
	const live = bridge({
		acknowledge: (id) =>
			id === "first"
				? firstAck.promise
				: Promise.resolve(new Response(null, { status: 204 })),
	});
	try {
		await until(() => live.states.at(-1)?.status === "connected");
		assert.deepEqual(live.states.at(-1), {
			status: "connected",
			url: "https://ecad.example/mcp/editor/session-1",
			token: "client-secret",
		});
		// Heartbeats and chunk boundaries may occur between and inside messages.
		const frames = `\n${JSON.stringify(envelope("first"))}\n\n${JSON.stringify(envelope("second"))}\n`;
		live.send(frames.slice(0, 20));
		live.send(frames.slice(20));
		await until(() => live.replies.length === 1);
		assert.equal(live.store.getSnapshot().shapes.length, 1);
		assert.equal(live.replies[0].reply.ok, true);
		firstAck.resolve(new Response(null, { status: 204 }));
		await until(() => live.replies.length === 2);
		assert.deepEqual(
			live.store.getSnapshot().shapes.map((shape) => shape.id),
			[1, 2],
		);
	} finally {
		live.connection.disconnect();
		await live.connection.done;
	}
	assert.equal(live.cancelled(), true);
	assert.equal(
		live.calls.filter((call) => call.options.method === "DELETE").length,
		1,
	);
	assert.equal(live.calls.at(-1)?.options.keepalive, true);
	assert.equal(live.states.at(-1)?.status, "disconnected");
});

test("queued commands expire while waiting for an earlier acknowledgement", async () => {
	const firstAck = deferred<Response>();
	const live = bridge({
		acknowledge: (id) =>
			id === "first"
				? firstAck.promise
				: Promise.resolve(new Response(null, { status: 204 })),
	});
	try {
		await until(() => live.states.at(-1)?.status === "connected");
		live.send(
			`${JSON.stringify(envelope("first"))}\n${JSON.stringify(envelope("expired", 200))}\n`,
		);
		await until(() => live.replies.length === 1);
		live.setTime(300);
		firstAck.resolve(new Response(null, { status: 204 }));
		await until(() => live.replies.length === 2);
		assert.equal(live.store.getSnapshot().shapes.length, 1);
		assert.deepEqual(live.replies[1].reply, {
			ok: false,
			error: {
				code: "CommandExpired",
				message: "The drawing command expired before execution.",
			},
		});
	} finally {
		live.connection.disconnect();
		await live.connection.done;
	}
});

test("a reply over the acknowledgement limit is reported instead of ending the stream", async () => {
	const live = bridge({ acknowledgementLimit: 300 });
	try {
		await until(() => live.states.at(-1)?.status === "connected");
		const read = (requestId: string): DrawingEnvelope => ({
			requestId,
			expiresAt: 1000,
			operation: { type: "getDrawing" },
		});
		live.send(
			`${JSON.stringify(read("small"))}\n${JSON.stringify(envelope("edit"))}\n${JSON.stringify(read("large"))}\n`,
		);
		await until(() => live.replies.length === 3);
		assert.equal(live.replies[0].reply.ok, true);
		// The edit's reply has no drawing, so it fits whatever the drawing's size.
		assert.equal(live.replies[1].reply.ok, true);
		assert.deepEqual(live.replies[2], {
			requestId: "large",
			reply: {
				ok: false,
				error: {
					code: "ReplyTooLarge",
					message:
						"The command ran, but its reply was too large to return. Read the drawing with getDrawing before retrying.",
				},
			},
		});
		assert.equal(live.store.getSnapshot().shapes.length, 1);
		assert.equal(live.states.at(-1)?.status, "connected");
	} finally {
		live.connection.disconnect();
		await live.connection.done;
	}
});

test("a repeated request stops the stream without replaying its mutation", async () => {
	const live = bridge();
	await until(() => live.states.at(-1)?.status === "connected");
	const line = `${JSON.stringify(envelope("same"))}\n`;
	live.send(line + line);
	await live.connection.done;
	assert.equal(live.store.getSnapshot().shapes.length, 1);
	assert.equal(live.replies.length, 1);
	assert.deepEqual(live.states.at(-1), {
		status: "error",
		message: "The MCP server repeated a command.",
	});
	assert.equal(live.cancelled(), true);
	assert.equal(
		live.calls.filter((call) => call.url.endsWith("/api/editor-mcp")).length,
		1,
	);
});

test("an acknowledgement failure preserves one committed mutation and never retries", async () => {
	const live = bridge({
		acknowledge: async () =>
			Response.json(
				{ error: { code: "Offline", message: "Editor disconnected." } },
				{ status: 410 },
			),
	});
	await until(() => live.states.at(-1)?.status === "connected");
	live.send(
		`${JSON.stringify(envelope("first"))}\n${JSON.stringify(envelope("second"))}\n`,
	);
	await live.connection.done;
	assert.equal(live.store.getSnapshot().shapes.length, 1);
	assert.equal(live.replies.length, 1);
	assert.deepEqual(live.states.at(-1), {
		status: "error",
		message: "Editor disconnected.",
	});
	assert.equal(live.cancelled(), true);
});

test("disconnect interrupts an acknowledgement and prevents later queued mutations", async () => {
	const live = bridge({
		acknowledge: (_, signal) =>
			new Promise((_, reject) => {
				signal.addEventListener(
					"abort",
					() => reject(new DOMException("Aborted", "AbortError")),
					{ once: true },
				);
			}),
	});
	await until(() => live.states.at(-1)?.status === "connected");
	live.send(
		`${JSON.stringify(envelope("first"))}\n${JSON.stringify(envelope("second"))}\n`,
	);
	await until(() => live.replies.length === 1);
	live.connection.disconnect();
	live.connection.disconnect();
	await live.connection.done;
	assert.equal(live.store.getSnapshot().shapes.length, 1);
	assert.equal(live.replies.length, 1);
	assert.equal(live.cancelled(), true);
	assert.equal(
		live.calls.filter((call) => call.options.method === "DELETE").length,
		1,
	);
});

test("disconnect during session creation deletes late credentials without opening a stream", async () => {
	const creation = deferred<Response>();
	const live = bridge({ create: () => creation.promise });
	await until(() => live.calls.length === 1);
	live.connection.disconnect();
	creation.resolve(Response.json(credentials));
	await live.connection.done;
	assert.deepEqual(
		live.calls.map((call) => call.options.method),
		["POST", "DELETE"],
	);
	assert.equal(live.states.at(-1)?.status, "disconnected");
	assert.equal(live.store.getSnapshot().shapes.length, 0);
});

test("invalid envelopes and disconnected streams stop without creating a replacement session", async () => {
	for (const invalid of [true, false]) {
		const live = bridge();
		await until(() => live.states.at(-1)?.status === "connected");
		if (invalid)
			live.send(
				'{"requestId":"invalid","operation":{"type":"placeRectangle"}}\n',
			);
		else live.close();
		await live.connection.done;
		assert.equal(live.store.getSnapshot().shapes.length, 0);
		assert.equal(live.replies.length, 0);
		assert.equal(live.states.at(-1)?.status, "error");
		assert.equal(
			live.calls.filter((call) => call.url.endsWith("/api/editor-mcp")).length,
			1,
		);
		assert.equal(
			live.calls.filter((call) => call.options.method === "DELETE").length,
			1,
		);
	}
});

test("a refused session reports the server's limit and opens no stream", async () => {
	const message =
		"Too many editor connections from this network. Disable MCP in another drawing and try again.";
	const live = bridge({
		create: async () =>
			Response.json(
				{ error: { code: "ClientSessionLimit", message } },
				{ status: 429 },
			),
	});
	await live.connection.done;
	assert.deepEqual(live.states.at(-1), { status: "error", message });
	assert.deepEqual(
		live.calls.map((call) => call.options.method),
		["POST"],
	);
});
