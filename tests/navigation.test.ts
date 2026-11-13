import assert from "node:assert/strict";
import { test } from "node:test";
import {
	handleViewerKeyDown,
	isMouseWheel,
	wheelDelta,
} from "#/engine/navigation.ts";

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

test("wheel notches count as a mouse wheel and pixel swipes as a trackpad", () => {
	const wheel = (event: Partial<Parameters<typeof isMouseWheel>[0]>) =>
		isMouseWheel({ deltaMode: 0, deltaX: 0, deltaY: 0, ...event });
	assert.equal(wheel({ deltaMode: 1, deltaY: 3 }), true);
	assert.equal(wheel({ deltaY: 100, wheelDeltaY: -120 }), true);
	assert.equal(wheel({ deltaX: 100, wheelDeltaX: -120 }), true);
	assert.equal(wheel({ deltaY: 40, wheelDeltaY: -120 }), false);
	assert.equal(wheel({ deltaY: 4, wheelDeltaY: -12 }), false);
	assert.equal(wheel({ deltaX: -7.5, wheelDeltaX: 7 }), false);
	assert.equal(wheel({ deltaY: 6 }), false);
});
