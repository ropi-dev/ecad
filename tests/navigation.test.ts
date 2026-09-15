import assert from "node:assert/strict";
import { test } from "node:test";
import { handleViewerKeyDown, wheelDelta } from "../src/engine/navigation";

test("viewer shortcuts leave modified keys and camera-specific navigation to their owners", () => {
	const calls: unknown[] = [];
	const actions = {
		fit: () => calls.push("fit"),
		zoom: (factor: number) => calls.push(factor),
	};
	const key = (key: string, modifiers = {}) => ({
		key,
		ctrlKey: false,
		metaKey: false,
		altKey: false,
		shiftKey: false,
		preventDefault: () => calls.push("prevented"),
		...modifiers,
	});
	for (const modifier of ["ctrlKey", "metaKey", "altKey"]) {
		for (const name of ["+", "-", "0", "f", "F6", "ArrowRight"])
			handleViewerKeyDown(key(name, { [modifier]: true }), actions);
	}
	for (const name of ["F6", "ArrowRight", "Escape"])
		handleViewerKeyDown(key(name), actions);
	assert.equal(calls.length, 0);
	handleViewerKeyDown(key("F6"), { ...actions, fitOnF6: true });
	handleViewerKeyDown(key("ArrowRight", { shiftKey: true }), {
		...actions,
		pan: (x, y) => calls.push([x, y]),
	});
	assert.deepEqual(calls, ["fit", "prevented", [240, 0], "prevented"]);
});

test("wheel deltas normalize pixels, lines and viewport pages on each axis", () => {
	const element = { clientWidth: 800, clientHeight: 600 };
	assert.deepEqual(
		wheelDelta({ deltaMode: 0, deltaX: 2, deltaY: -3 }, element),
		{ x: 2, y: -3 },
	);
	assert.deepEqual(
		wheelDelta({ deltaMode: 1, deltaX: 2, deltaY: -3 }, element),
		{ x: 32, y: -48 },
	);
	assert.deepEqual(
		wheelDelta({ deltaMode: 2, deltaX: 2, deltaY: -3 }, element),
		{ x: 1600, y: -1800 },
	);
});
