import assert from "node:assert/strict";
import { test } from "node:test";
import { createLifecycle } from "#/lib/lifecycle";

test("failed viewport setup releases earlier resources and listeners in reverse order", () => {
	const lifecycle = createLifecycle();
	const released: string[] = [];
	const target = new EventTarget();
	let frames = 0;
	const initializeError = new Error("Invalid scene bounds");
	assert.throws(() => {
		try {
			lifecycle.acquire(() => "renderer", (value) => released.push(value));
			lifecycle.acquire(() => "display", (value) => released.push(value));
			lifecycle.acquire(() => "controls", (value) => released.push(value));
			lifecycle.listen(target, "change", () => frames++);
			target.dispatchEvent(new Event("change"));
			lifecycle.acquire(() => {
				throw initializeError;
			}, () => released.push("not acquired"));
		} finally {
			lifecycle.dispose();
		}
	}, (error) => error === initializeError);
	assert.deepEqual(released, ["controls", "display", "renderer"]);
	target.dispatchEvent(new Event("change"));
	assert.equal(frames, 1);
	lifecycle.dispose();
	assert.deepEqual(released, ["controls", "display", "renderer"]);
});

test("a failed finalizer does not strand the remaining viewport resources", () => {
	const lifecycle = createLifecycle();
	const released: string[] = [];
	lifecycle.acquire(() => "renderer", (value) => released.push(value));
	lifecycle.addFinalizer(() => {
		throw new Error("Control cleanup failed");
	});
	lifecycle.acquire(() => "hover", (value) => released.push(value));
	assert.throws(lifecycle.dispose, /Control cleanup failed/);
	assert.deepEqual(released, ["hover", "renderer"]);
	lifecycle.dispose();
});

test("a closed viewport lifecycle cannot acquire a new resource", () => {
	const lifecycle = createLifecycle();
	lifecycle.dispose();
	let acquired = false;
	assert.throws(() => lifecycle.acquire(() => {
		acquired = true;
	}, () => {}), /already disposed/);
	assert.equal(acquired, false);
});
