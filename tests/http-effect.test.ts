import assert from "node:assert/strict";
import test from "node:test";
import { Effect, Schema, Stream } from "effect";
import { runEffect } from "#/lib/effect.ts";
import { HttpClient, HttpError, makeHttpClient, requestJson } from "#/lib/http.ts";
import { todoUpdates } from "#web/services/todos-client.ts";

const schema = Schema.Struct({ value: Schema.Number });
const request = (fetcher: typeof fetch) => requestJson("/test", schema).pipe(
	Effect.provideService(HttpClient, makeHttpClient(fetcher)),
);

test("HTTP effects validate responses and release the request scope", async () => {
	let signal: AbortSignal | null | undefined;
	const value = await runEffect(request(async (_url, options) => {
		signal = options?.signal;
		return Response.json({ value: 42 });
	}));
	assert.deepEqual(value, { value: 42 });
	assert.equal(signal?.aborted, true);
});

test("HTTP errors distinguish status failures, malformed JSON and invalid data", async () => {
	await assert.rejects(
		runEffect(request(async () => new Response("Not found", { status: 404 }))),
		(error) => error instanceof HttpError && error.status === 404,
	);
	await assert.rejects(
		runEffect(request(async () => new Response("{"))),
		(error) => error instanceof HttpError && error.message.includes("invalid JSON"),
	);
	await assert.rejects(
		runEffect(request(async () => Response.json({ value: "wrong" }))),
		(error) => error instanceof HttpError && error.message.includes("invalid data"),
	);
});

test("HTTP cancellation still aborts the fetch after headers arrive", async () => {
	const controller = new AbortController();
	let aborted = false;
	const program = request(async (_url, options) => new Response(new ReadableStream({
		start(stream) {
			options?.signal?.addEventListener("abort", () => {
				aborted = true;
				stream.error(new Error("Aborted"));
			}, { once: true });
			setTimeout(() => controller.abort(), 10);
		},
	})));
	await assert.rejects(runEffect(program, controller.signal), { name: "AbortError" });
	assert.equal(aborted, true);
});

class TestEventSource extends EventTarget {
	onmessage: ((event: MessageEvent<string>) => void) | null = null;
	onerror: (() => void) | null = null;
	readyState = 1;
	closed = false;
	close() { this.closed = true; }
}

test("todo update streams validate snapshots and close the source after consumption", async () => {
	const source = new TestEventSource();
	const stream = todoUpdates(() => {
		setTimeout(() => source.onmessage?.(new MessageEvent("message", {
			data: JSON.stringify([{ id: 1, title: "Board" }]),
		})), 0);
		return source as unknown as EventSource;
	});
	const result = await runEffect(stream.pipe(Stream.take(1), Stream.runCollect));
	assert.deepEqual(Array.from(result), [[{ id: 1, title: "Board" }]]);
	assert.equal(source.closed, true);
});

test("invalid todo snapshots fail with a typed error and close the source", async () => {
	const source = new TestEventSource();
	const stream = todoUpdates(() => {
		setTimeout(() => source.onmessage?.(new MessageEvent("message", { data: "{}" })), 0);
		return source as unknown as EventSource;
	});
	await assert.rejects(
		runEffect(Stream.runDrain(stream)),
		(error) => error instanceof HttpError && error.message.includes("invalid todo"),
	);
	assert.equal(source.closed, true);
});

test("unmount cancellation closes a pending todo subscription", async () => {
	const source = new TestEventSource();
	const controller = new AbortController();
	const stream = todoUpdates(() => {
		setTimeout(() => controller.abort(), 0);
		return source as unknown as EventSource;
	});
	await assert.rejects(runEffect(Stream.runDrain(stream), controller.signal), { name: "AbortError" });
	assert.equal(source.closed, true);
});
