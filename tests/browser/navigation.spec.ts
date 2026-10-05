import { expect, test } from "@playwright/test";

test("Three.js controls preserve pixel panning, zoom anchors, limits and reset", async ({
	page,
}) => {
	await page.goto("/tests/browser/renderer.html");
	const result = await page.evaluate(async () => {
		const path = "/packages/core/src/engine/viewport-controls.ts";
		const {
			ViewportControls,
		}: typeof import("#/engine/viewport-controls.ts") = await import(path);
		const cameraPath = "/packages/core/src/engine/camera.ts";
		const { screenToWorld }: typeof import("#/engine/camera.ts") =
			await import(cameraPath);
		const element = document.createElement("div");
		element.style.cssText =
			"position:absolute;left:0;top:0;width:900px;height:600px";
		document.body.append(element);
		let state = { x: 12, y: -3, scale: 8 };
		let changes = 0;
		const home = { ...state };
		const navigation = new ViewportControls(element, (camera) => {
			state = camera;
			changes++;
		});
		navigation.fit(home, 900, 600);
		const failures: string[] = [];
		const check = (condition: boolean, message: string) => {
			if (!condition) failures.push(message);
		};
		const close = (a: number, b: number) => Math.abs(a - b) < 1e-8;
		for (const scale of [0.01, 8, 10000]) {
			navigation.fit({ ...home, scale }, 900, 600);
			element.dispatchEvent(
				new WheelEvent("wheel", { deltaX: 30, deltaY: -70, cancelable: true }),
			);
			check(
				close(state.x, home.x + 30 / scale) &&
					close(state.y, home.y + 70 / scale) &&
					state.scale === scale,
				`pixel pan at ${scale}`,
			);
		}
		navigation.fit(home, 900, 600);
		const anchor = { x: 170, y: 480 };
		const world = screenToWorld(anchor, state, 900, 600);
		for (const deltaY of [-50, 2000, -2000]) {
			element.dispatchEvent(
				new WheelEvent("wheel", {
					clientX: anchor.x,
					clientY: anchor.y,
					deltaY,
					ctrlKey: true,
					cancelable: true,
				}),
			);
			const after = screenToWorld(anchor, state, 900, 600);
			check(
				close(after.x, world.x) && close(after.y, world.y),
				`zoom anchor at ${deltaY}`,
			);
			check(state.scale >= 2 && state.scale <= 64, `zoom bounds at ${deltaY}`);
		}
		navigation.reset();
		check(
			close(state.x, home.x) &&
				close(state.y, home.y) &&
				state.scale === home.scale,
			"reset after cursor zoom",
		);
		navigation.zoom(1.25);
		check(state.scale === 10, "button zoom factor");
		navigation.zoom(1 / 1.25);
		check(state.scale === home.scale, "button zoom round trip");
		for (const factor of [NaN, Infinity, -1, 0]) navigation.zoom(factor);
		check(state.scale === home.scale, "invalid zoom factor");
		navigation.zoom(1e10);
		check(state.scale === 64, "maximum zoom");
		navigation.zoom(1e-10);
		check(state.scale === 2, "minimum zoom");
		navigation.reset();
		element.style.width = "600px";
		element.style.height = "400px";
		navigation.resize(600, 400);
		navigation.pan(80, 40);
		check(
			close(state.x, home.x + 10) && close(state.y, home.y - 5),
			"pan after resize",
		);
		navigation.reset();
		const gestureAnchor = { x: 170, y: 300 };
		const gestureWorld = screenToWorld(gestureAnchor, state, 600, 400);
		element.dispatchEvent(new Event("gesturestart", { cancelable: true }));
		for (const scale of [1.2, 1.5]) {
			element.dispatchEvent(
				Object.assign(new Event("gesturechange", { cancelable: true }), {
					scale,
					clientX: gestureAnchor.x,
					clientY: gestureAnchor.y,
				}),
			);
		}
		element.dispatchEvent(new Event("gestureend", { cancelable: true }));
		const afterGesture = screenToWorld(gestureAnchor, state, 600, 400);
		check(close(state.scale, 12), "Safari cumulative pinch scale");
		check(
			close(afterGesture.x, gestureWorld.x) &&
				close(afterGesture.y, gestureWorld.y),
			"Safari pinch anchor",
		);
		navigation.dispose();
		const before = changes;
		element.dispatchEvent(
			new WheelEvent("wheel", { deltaX: 100, deltaY: 100 }),
		);
		check(changes === before, "dispose removes input listeners");
		return failures;
	});
	expect(result).toEqual([]);
});
