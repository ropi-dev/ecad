import assert from "node:assert/strict";
import { test } from "node:test";
import { PerspectiveCamera, Vector3 } from "three";
import { create3DControls } from "#/engine/controls3d.ts";
import {
	isMouseWheel,
	mouseWheelSteps,
	wheelDelta,
} from "#/engine/navigation.ts";

class FakeCanvas extends EventTarget {
	clientWidth = 800;
	clientHeight = 600;
	style: Record<string, string> = {};
	ownerDocument = new EventTarget();
	getRootNode() {
		return this.ownerDocument;
	}
	getBoundingClientRect() {
		return {
			left: 0,
			top: 0,
			width: this.clientWidth,
			height: this.clientHeight,
		};
	}
	setPointerCapture() {}
	releasePointerCapture() {}
	focus() {}
}

function dispatchWheel(
	canvas: FakeCanvas,
	init: {
		deltaMode?: number;
		deltaX?: number;
		deltaY?: number;
		wheelDeltaX?: number;
		wheelDeltaY?: number;
		shiftKey?: boolean;
		ctrlKey?: boolean;
		metaKey?: boolean;
		altKey?: boolean;
		clientX?: number;
		clientY?: number;
	},
) {
	const event = new Event("wheel", { bubbles: true, cancelable: true });
	Object.assign(event, {
		deltaMode: 0,
		deltaX: 0,
		deltaY: 0,
		shiftKey: false,
		ctrlKey: false,
		metaKey: false,
		altKey: false,
		clientX: 400,
		clientY: 300,
		...init,
	});
	canvas.dispatchEvent(event);
}

function dispatchPointer(
	canvas: FakeCanvas,
	type: "pointerdown" | "pointermove" | "pointerup",
	init: {
		pointerId?: number;
		pointerType?: string;
		button?: number;
		clientX: number;
		clientY: number;
		shiftKey?: boolean;
		ctrlKey?: boolean;
		metaKey?: boolean;
		altKey?: boolean;
	},
) {
	const event = new Event(type, { bubbles: true, cancelable: true });
	Object.assign(event, {
		pointerId: 1,
		pointerType: "mouse",
		button: 0,
		shiftKey: false,
		ctrlKey: false,
		metaKey: false,
		altKey: false,
		...init,
	});
	canvas.dispatchEvent(event);
}

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
	assert.equal(wheel({ deltaX: 2, deltaY: 100, wheelDeltaY: -120 }), false);
	assert.equal(wheel({ deltaY: 40, wheelDeltaY: -120 }), false);
	assert.equal(wheel({ deltaY: 4, wheelDeltaY: -12 }), false);
	assert.equal(wheel({ deltaX: -7.5, wheelDeltaX: 7 }), false);
	assert.equal(wheel({ deltaY: 6 }), false);
	assert.equal(
		mouseWheelSteps({ deltaMode: 0, deltaY: -4, wheelDeltaY: 120 }),
		-1,
	);
	assert.equal(mouseWheelSteps({ deltaMode: 1, deltaY: 3 }), 1);
});

test("3D controls pan on trackpad scroll, orbit on Shift + scroll or middle-drag, and zoom on mouse wheel", () => {
	const canvas = new FakeCanvas();
	const camera = new PerspectiveCamera(40, 800 / 600, 0.1, 1000);
	camera.up.set(0, 0, 1);
	camera.position.set(10, -20, 15);
	camera.lookAt(0, 0, 0);
	camera.updateMatrixWorld();
	let fits = 0;
	const navigation = create3DControls(
		camera,
		canvas as unknown as HTMLElement,
		() => {
			fits++;
		},
	);
	const { controls } = navigation;
	const initialDirection = camera.getWorldDirection(new Vector3());
	const initialDistance = camera.position.distanceTo(controls.target);

	// Trackpad two-finger scroll pans without turning or zooming.
	const beforePan = controls.target.clone();
	dispatchWheel(canvas, {
		deltaX: 16,
		deltaY: -12,
		wheelDeltaX: -48,
		wheelDeltaY: 36,
	});
	assert.ok(controls.target.distanceTo(beforePan) > 0.01);
	assert.ok(
		camera.getWorldDirection(new Vector3()).distanceTo(initialDirection) < 1e-6,
	);
	assert.ok(
		Math.abs(camera.position.distanceTo(controls.target) - initialDistance) <
			1e-6,
	);

	// Shift + trackpad scroll orbits without changing distance.
	const beforeOrbit = camera.getWorldDirection(new Vector3());
	dispatchWheel(canvas, {
		shiftKey: true,
		deltaX: 20,
		deltaY: 14,
		wheelDeltaX: -60,
		wheelDeltaY: -42,
	});
	assert.ok(
		camera.getWorldDirection(new Vector3()).distanceTo(beforeOrbit) > 0.01,
	);
	assert.ok(
		Math.abs(camera.position.distanceTo(controls.target) - initialDistance) <
			1e-6,
	);

	// Mouse wheel zooms toward the cursor without needing Ctrl.
	const beforeZoom = camera.position.distanceTo(controls.target);
	dispatchWheel(canvas, {
		deltaY: -100,
		wheelDeltaY: 120,
		clientX: 260,
		clientY: 220,
	});
	assert.ok(camera.position.distanceTo(controls.target) < beforeZoom * 0.9);

	// Shift + mouse wheel orbits in 3D without changing distance.
	const afterZoomDistance = camera.position.distanceTo(controls.target);
	const afterZoomDir = camera.getWorldDirection(new Vector3());
	dispatchWheel(canvas, {
		shiftKey: true,
		deltaX: 100,
		wheelDeltaX: -120,
	});
	assert.ok(
		camera.getWorldDirection(new Vector3()).distanceTo(afterZoomDir) > 0.01,
	);
	assert.ok(
		Math.abs(camera.position.distanceTo(controls.target) - afterZoomDistance) <
			1e-6,
	);

	// Middle-drag pans and Shift + middle-drag orbits.
	const beforeMiddlePan = controls.target.clone();
	const beforeMiddlePanDir = camera.getWorldDirection(new Vector3());
	dispatchPointer(canvas, "pointerdown", {
		button: 1,
		clientX: 400,
		clientY: 300,
	});
	dispatchPointer(canvas, "pointermove", {
		button: -1,
		clientX: 460,
		clientY: 340,
	});
	dispatchPointer(canvas, "pointerup", {
		button: 1,
		clientX: 460,
		clientY: 340,
	});
	assert.ok(controls.target.distanceTo(beforeMiddlePan) > 0.01);
	assert.ok(
		camera.getWorldDirection(new Vector3()).distanceTo(beforeMiddlePanDir) <
			1e-6,
	);

	const beforeMiddleOrbit = camera.getWorldDirection(new Vector3());
	dispatchPointer(canvas, "pointerdown", {
		button: 1,
		shiftKey: true,
		clientX: 400,
		clientY: 300,
	});
	dispatchPointer(canvas, "pointermove", {
		button: -1,
		shiftKey: true,
		clientX: 480,
		clientY: 260,
	});
	dispatchPointer(canvas, "pointerup", {
		button: 1,
		shiftKey: true,
		clientX: 480,
		clientY: 260,
	});
	assert.ok(
		camera.getWorldDirection(new Vector3()).distanceTo(beforeMiddleOrbit) >
			0.01,
	);

	// Middle double-click fits.
	const dblMiddle = new Event("auxclick", { bubbles: true, cancelable: true });
	Object.assign(dblMiddle, {
		button: 1,
		detail: 2,
		shiftKey: false,
		ctrlKey: false,
		metaKey: false,
		altKey: false,
	});
	canvas.dispatchEvent(dblMiddle);
	assert.equal(fits, 1);

	navigation.dispose();
});

test("Shift + trackpad scroll and Shift + middle-drag unlock 3D even when left-drag requires Alt", () => {
	const setup = () => {
		const canvas = new FakeCanvas();
		const camera = new PerspectiveCamera(25, 800 / 600, 0.1, 1000);
		camera.position.set(0, 0, 50);
		camera.lookAt(0, 0, 0);
		camera.updateMatrixWorld();
		let unlocked = false;
		const navigation = create3DControls(
			camera,
			canvas as unknown as HTMLElement,
			() => {},
			{
				lockTop: true,
				unlockGesture: "alt-shift",
				unlock: () => {
					unlocked = true;
					navigation.setRotationLocked(false);
					return true;
				},
			},
		);
		return { canvas, navigation, isUnlocked: () => unlocked };
	};

	const swipe = setup();
	// Shift + mouse wheel stays in 2D.
	dispatchWheel(swipe.canvas, {
		shiftKey: true,
		deltaX: 100,
		wheelDeltaX: -120,
	});
	assert.equal(swipe.isUnlocked(), false);
	// Shift + trackpad scroll unlocks 3D after crossing the threshold.
	dispatchWheel(swipe.canvas, {
		shiftKey: true,
		deltaY: 6,
		wheelDeltaY: -18,
	});
	assert.equal(swipe.isUnlocked(), true);
	swipe.navigation.dispose();

	const middle = setup();
	dispatchPointer(middle.canvas, "pointerdown", {
		button: 1,
		shiftKey: true,
		clientX: 400,
		clientY: 300,
	});
	dispatchPointer(middle.canvas, "pointermove", {
		button: -1,
		shiftKey: true,
		clientX: 400,
		clientY: 280,
	});
	dispatchPointer(middle.canvas, "pointerup", {
		button: 1,
		shiftKey: true,
		clientX: 400,
		clientY: 280,
	});
	assert.equal(middle.isUnlocked(), true);
	middle.navigation.dispose();
});
