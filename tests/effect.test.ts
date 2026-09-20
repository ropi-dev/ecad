import assert from "node:assert/strict";
import test from "node:test";
import { Effect } from "effect";
import { runEffect } from "../src/lib/effect";

test("framework boundary preserves values and domain error identity", async () => {
	assert.equal(await runEffect(Effect.succeed(42)), 42);
	const failure = new Error("Invalid file");
	await assert.rejects(runEffect(Effect.fail(failure)), (error) => error === failure);
});

test("pre-aborted requests never acquire resources", async () => {
	const controller = new AbortController();
	const reason = new Error("Replaced request");
	controller.abort(reason);
	let acquired = false;
	await assert.rejects(
		runEffect(Effect.sync(() => { acquired = true; }), controller.signal),
		(error) => error === reason,
	);
	assert.equal(acquired, false);
});

test("cancellation releases resources before rejecting with the original reason", async () => {
	const controller = new AbortController();
	const reason = new Error("Closed viewer");
	let released = false;
	const program = Effect.acquireUseRelease(
		Effect.sync(() => { queueMicrotask(() => controller.abort(reason)); }),
		() => Effect.never,
		() => Effect.sync(() => { released = true; }),
	);
	await assert.rejects(runEffect(program, controller.signal), (error) => error === reason);
	assert.equal(released, true);
});

test("unexpected defects remain distinguishable from expected failures", async () => {
	const defect = new TypeError("Unexpected invariant");
	await assert.rejects(runEffect(Effect.die(defect)), (error) => error === defect);
});
