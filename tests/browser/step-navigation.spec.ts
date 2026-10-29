import { expect, test } from "@playwright/test";
import { Vector3 } from "three";

test("Fusion gestures pan, orbit, zoom toward the cursor and fit with the middle button", async ({
	page,
}) => {
	await page.goto("/tests/browser/renderer.html");
	await page.evaluate(async () => {
		const path = "/packages/core/src/engine/controls3d.ts";
		const { create3DControls }: typeof import("#/engine/controls3d.ts") =
			await import(path);
		const threePath = "/node_modules/three/build/three.module.js";
		const {
			PerspectiveCamera,
			Vector2,
			Vector3,
			Plane,
			Raycaster,
		}: typeof import("three") = await import(threePath);
		document.body.replaceChildren();
		const canvas = document.createElement("div");
		canvas.id = "navigation";
		canvas.tabIndex = 0;
		canvas.style.cssText =
			"position:absolute;inset:0;width:800px;height:600px;touch-action:none";
		const output = document.createElement("output");
		output.id = "camera-state";
		output.hidden = true;
		document.body.append(canvas, output);
		const camera = new PerspectiveCamera(40, 800 / 600, 0.01, 1000);
		camera.up.set(0, 0, 1);
		camera.position.set(8, -10, 8);
		let fits = 0;
		const navigation = create3DControls(camera, canvas, () => {
			fits++;
			camera.position.set(8, -10, 8);
			camera.up.set(0, 0, 1);
			navigation.controls.target.set(0, 0, 0);
			navigation.controls.update();
			publish();
		});
		const { controls } = navigation;
		controls.update();
		camera.updateMatrixWorld();
		const ray = new Raycaster();
		ray.setFromCamera(new Vector2(-0.5, 1 / 3), camera);
		const anchor = ray.ray.intersectPlane(
			new Plane(camera.getWorldDirection(new Vector3()), 0),
			new Vector3(),
		);
		if (!anchor) throw new Error("Missing zoom anchor");
		const publish = () => {
			camera.updateMatrixWorld();
			const projected = anchor.clone().project(camera);
			output.textContent = JSON.stringify({
				position: camera.position.toArray(),
				target: controls.target.toArray(),
				up: new Vector3(0, 1, 0).applyQuaternion(camera.quaternion).toArray(),
				direction: camera.position
					.clone()
					.sub(controls.target)
					.normalize()
					.toArray(),
				distance: camera.position.distanceTo(controls.target),
				anchor: [(projected.x + 1) * 400, (1 - projected.y) * 300],
				fits,
			});
		};
		controls.addEventListener("change", publish);
		publish();
		canvas.addEventListener("dispose-navigation", navigation.dispose);
	});
	const state = async () => {
		const camera = JSON.parse(
			(await page.locator("#camera-state").textContent()) ?? "{}",
		) as {
			position: number[];
			target: number[];
			direction: number[];
			up: number[];
			distance: number;
			anchor: number[];
			fits: number;
		};
		expect(
			new Vector3()
				.fromArray(camera.up)
				.cross(new Vector3().fromArray(camera.direction)).z,
		).toBeCloseTo(0, 8);
		return camera;
	};
	const drag = async (button: "left" | "middle" | "right") => {
		await page.mouse.move(400, 300);
		await page.mouse.down({ button });
		await page.mouse.move(450, 325, { steps: 4 });
		await page.mouse.up({ button });
	};
	const initial = await state();
	const navigation = page.locator("#navigation");
	for (const button of ["left", "middle"] as const) {
		for (const [x, y] of [
			[40, 0],
			[0, 25],
		]) {
			const before = await state();
			await page.mouse.move(400, 300);
			await page.keyboard.down("Shift");
			await page.mouse.down({ button });
			await page.mouse.move(400 + x, 300 + y);
			const after = await state();
			const up = new Vector3().fromArray(before.up);
			const direction = new Vector3().fromArray(before.direction);
			const axis = x ? up : up.clone().cross(direction);
			expect(
				direction.cross(new Vector3().fromArray(after.direction)).dot(axis),
			).toBeLessThan(0);
			await page.mouse.move(400, 300);
			await page.mouse.up({ button });
			await page.keyboard.up("Shift");
		}
	}
	await navigation.dispatchEvent("wheel", { shiftKey: true, deltaX: 30 });
	const horizontalOrbit = await state();
	expect(horizontalOrbit.up[2]).toBeCloseTo(initial.up[2], 8);
	expect(horizontalOrbit.direction[2]).toBeCloseTo(initial.direction[2], 8);
	expect(
		new Vector3(horizontalOrbit.direction[0], horizontalOrbit.direction[1], 0)
			.normalize()
			.dot(
				new Vector3(initial.direction[0], initial.direction[1], 0).normalize(),
			),
	).toBeCloseTo(Math.cos(Math.PI / 10), 8);
	await navigation.dispatchEvent("wheel", { shiftKey: true, deltaX: -30 });
	const reversed = await state();
	reversed.direction.forEach((value, index) =>
		expect(value).toBeCloseTo(initial.direction[index], 8),
	);
	for (const deltaY of [300, 300, -300, -300]) {
		const before = await state();
		await navigation.dispatchEvent("wheel", { shiftKey: true, deltaY });
		const after = await state();
		after.direction.forEach((value, index) =>
			expect(value).toBeCloseTo(-before.direction[index], 8),
		);
		after.up.forEach((value, index) =>
			expect(value).toBeCloseTo(-before.up[index], 8),
		);
		expect(after.distance).toBeCloseTo(initial.distance, 8);
		expect(after.target).toEqual(initial.target);
	}
	const fullOrbit = await state();
	fullOrbit.direction.forEach((value, index) =>
		expect(value).toBeCloseTo(initial.direction[index], 8),
	);
	fullOrbit.up.forEach((value, index) =>
		expect(value).toBeCloseTo(initial.up[index], 8),
	);
	for (let turn = 0; turn < 2; turn++) {
		const before = await state();
		let previous = before;
		let upsideDown = false;
		for (let step = 0; step < 24; step++) {
			await navigation.dispatchEvent("wheel", {
				shiftKey: true,
				deltaY: turn ? -25 : 25,
			});
			const current = await state();
			expect(
				new Vector3()
					.fromArray(current.up)
					.dot(new Vector3().fromArray(previous.up)),
			).toBeCloseTo(Math.cos(Math.PI / 12), 8);
			expect(
				new Vector3()
					.fromArray(current.direction)
					.dot(new Vector3().fromArray(previous.direction)),
			).toBeCloseTo(Math.cos(Math.PI / 12), 8);
			upsideDown ||= current.up[2] < 0;
			previous = current;
		}
		expect(upsideDown).toBe(true);
		const after = await state();
		after.direction.forEach((value, index) =>
			expect(value).toBeCloseTo(before.direction[index], 8),
		);
		after.up.forEach((value, index) =>
			expect(value).toBeCloseTo(before.up[index], 8),
		);
	}
	await navigation.dispatchEvent("wheel", {
		shiftKey: true,
		deltaX: 40,
		deltaY: 65,
	});
	await navigation.dispatchEvent("wheel", {
		shiftKey: true,
		deltaX: -40,
		deltaY: -65,
	});
	const reversedDiagonal = await state();
	reversedDiagonal.direction.forEach((value, index) =>
		expect(value).toBeCloseTo(initial.direction[index], 8),
	);
	reversedDiagonal.up.forEach((value, index) =>
		expect(value).toBeCloseTo(initial.up[index], 8),
	);
	await navigation.dispatchEvent("wheel", { shiftKey: true, deltaY: 300 });
	const inverted = await state();
	expect(inverted.up[2]).toBeLessThan(0);
	await navigation.dispatchEvent("wheel", { deltaX: 40, deltaY: 25 });
	const invertedPan = await state();
	invertedPan.up.forEach((value, index) =>
		expect(value).toBeCloseTo(inverted.up[index], 8),
	);
	invertedPan.direction.forEach((value, index) =>
		expect(value).toBeCloseTo(inverted.direction[index], 8),
	);
	await navigation.dispatchEvent("wheel", { deltaX: -40, deltaY: -25 });
	await navigation.dispatchEvent("wheel", { shiftKey: true, deltaY: -300 });
	await drag("middle");
	const panned = await state();
	expect(panned.target).not.toEqual(initial.target);
	expect(panned.distance).toBeCloseTo(initial.distance, 8);
	panned.direction.forEach((value, index) =>
		expect(value).toBeCloseTo(initial.direction[index], 8),
	);
	await page.keyboard.down("Shift");
	await drag("middle");
	await page.keyboard.up("Shift");
	const orbited = await state();
	expect(orbited.target).toEqual(panned.target);
	expect(orbited.direction).not.toEqual(panned.direction);
	expect(orbited.distance).toBeCloseTo(panned.distance, 8);
	await drag("left");
	await drag("right");
	expect(await state()).toEqual(orbited);
	await page.mouse.move(400, 300);
	await page.keyboard.down("Shift");
	await page.mouse.wheel(45, 0);
	await expect
		.poll(async () => (await state()).direction)
		.not.toEqual(orbited.direction);
	const swipedHorizontally = await state();
	expect(
		new Vector3()
			.fromArray(orbited.direction)
			.cross(new Vector3().fromArray(swipedHorizontally.direction))
			.dot(new Vector3().fromArray(orbited.up)),
	).toBeGreaterThan(0);
	await page.mouse.wheel(0, 30);
	await expect
		.poll(async () => (await state()).direction)
		.not.toEqual(swipedHorizontally.direction);
	await page.keyboard.up("Shift");
	const swiped = await state();
	const right = new Vector3()
		.fromArray(swipedHorizontally.up)
		.cross(new Vector3().fromArray(swipedHorizontally.direction));
	expect(
		new Vector3()
			.fromArray(swipedHorizontally.direction)
			.cross(new Vector3().fromArray(swiped.direction))
			.dot(right),
	).toBeGreaterThan(0);
	expect(swiped.target).toEqual(orbited.target);
	expect(swiped.distance).toBeCloseTo(orbited.distance, 8);
	await page.mouse.click(400, 300, { button: "middle", clickCount: 2 });
	const fitted = await state();
	expect(fitted.fits).toBe(1);
	fitted.position.forEach((value, index) =>
		expect(value).toBeCloseTo([8, -10, 8][index], 8),
	);
	await page.mouse.move(200, 200);
	await page.mouse.wheel(40, 25);
	await expect
		.poll(async () => (await state()).target)
		.not.toEqual(fitted.target);
	const swipePanned = await state();
	expect(swipePanned.distance).toBeCloseTo(fitted.distance, 8);
	swipePanned.direction.forEach((value, index) =>
		expect(value).toBeCloseTo(fitted.direction[index], 8),
	);
	swipePanned.position.forEach((value, index) =>
		expect(value - fitted.position[index]).toBeCloseTo(
			swipePanned.target[index] - fitted.target[index],
			8,
		),
	);
	await page.mouse.wheel(-40, -25);
	await expect
		.poll(async () => (await state()).target)
		.not.toEqual(swipePanned.target);
	const restored = await state();
	restored.target.forEach((value, index) =>
		expect(value).toBeCloseTo(fitted.target[index], 8),
	);
	await page.keyboard.down("Control");
	await page.mouse.wheel(0, -120);
	await expect
		.poll(async () => (await state()).distance)
		.toBeLessThan(fitted.distance);
	await page.keyboard.up("Control");
	const zoomed = await state();
	zoomed.anchor.forEach((value, index) =>
		expect(value).toBeCloseTo(fitted.anchor[index], 5),
	);
	let mixedOrbit = zoomed;
	let invertedDuringMixedOrbit = false;
	for (let step = 0; step < 72; step++) {
		await navigation.dispatchEvent("wheel", {
			shiftKey: true,
			deltaX: step % 2 ? 18 : -12,
			deltaY: 25,
		});
		const current = await state();
		expect(
			new Vector3()
				.fromArray(current.up)
				.dot(new Vector3().fromArray(mixedOrbit.up)),
		).toBeGreaterThan(0.9);
		expect(current.distance).toBeCloseTo(zoomed.distance, 8);
		invertedDuringMixedOrbit ||= current.up[2] < 0;
		mixedOrbit = current;
	}
	expect(invertedDuringMixedOrbit).toBe(true);
	for (const modifier of ["Shift", "Control"]) {
		const before = await state();
		await page.keyboard.down(modifier);
		await drag("left");
		await page.keyboard.up(modifier);
		const after = await state();
		expect(after.distance).toBeCloseTo(before.distance, 8);
		if (modifier === "Shift") {
			expect(after.target).toEqual(before.target);
			expect(after.direction).not.toEqual(before.direction);
		} else {
			expect(after.target).not.toEqual(before.target);
			after.direction.forEach((value, index) =>
				expect(value).toBeCloseTo(before.direction[index], 8),
			);
			after.up.forEach((value, index) =>
				expect(value).toBeCloseTo(before.up[index], 8),
			);
		}
		await expect(navigation).toBeFocused();
		await drag("left");
		expect(await state()).toEqual(after);
		await page.mouse.move(400, 300);
		await page.keyboard.down(modifier);
		await page.mouse.down({ button: "left" });
		await page.mouse.move(850, 350, { steps: 4 });
		expect(await state()).not.toEqual(after);
		await page.mouse.up({ button: "left" });
		await page.keyboard.up(modifier);
		const released = await state();
		await page.mouse.move(400, 300);
		expect(await state()).toEqual(released);
	}
	const finalState = await state();
	await page.locator("#navigation").dispatchEvent("dispose-navigation");
	await page
		.locator("#navigation")
		.dispatchEvent("wheel", { shiftKey: true, deltaX: 50, deltaY: 20 });
	expect(await state()).toEqual(finalState);
	await page.mouse.click(400, 300, { button: "middle", clickCount: 2 });
	expect((await state()).fits).toBe(1);
});
