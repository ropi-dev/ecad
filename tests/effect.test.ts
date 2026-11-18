import assert from "node:assert/strict";
import test from "node:test";
import { runEffect } from "@ecad/drawing-core/lib/effect.ts";
import { Effect } from "effect";

test("framework boundary preserves values and domain error identity", async () => {
	assert.equal(await runEffect(Effect.succeed(42)), 42);
	const failure = new Error("Invalid file");
	await assert.rejects(
		runEffect(Effect.fail(failure)),
		(error) => error === failure,
	);
});
