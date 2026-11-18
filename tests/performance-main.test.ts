import assert from "node:assert/strict";
import { test } from "node:test";
import { nextStep } from "../scripts/performance/main.ts";

test("perf:main records a starting point, skips an unchanged main and compares a new one", () => {
	const main = { clean: true, onMain: true, baseIsAncestor: true };
	assert.deepEqual(nextStep({ ...main, head: "b", baseIsAncestor: false }), {
		kind: "seed",
	});
	assert.equal(
		nextStep({ ...main, head: "b", clean: false, baseIsAncestor: false }).kind,
		"error",
	);
	assert.equal(
		nextStep({ ...main, head: "b", onMain: false, baseIsAncestor: false }).kind,
		"error",
	);
	assert.deepEqual(nextStep({ ...main, head: "b", base: "b" }), {
		kind: "current",
	});
	assert.deepEqual(nextStep({ ...main, head: "b", base: "b", clean: false }), {
		kind: "compare",
		base: "b",
	});
	assert.deepEqual(nextStep({ ...main, head: "b", base: "a" }), {
		kind: "compare",
		base: "a",
	});
	const diverged = nextStep({
		...main,
		head: "b",
		base: "a",
		baseIsAncestor: false,
	});
	assert.equal(diverged.kind, "error");
});
