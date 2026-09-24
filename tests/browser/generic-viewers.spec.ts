import { expect, test } from "@playwright/test";
import type { Viewer2DSnapshot } from "../../src/components/viewer/types/Viewer2DSnapshot";

for (const projection of ["perspective", "orthographic"] as const) {
	test(`2D viewer uses a ${projection} camera locked to top through pan, zoom and gestures`, async ({
		page,
	}) => {
		const requests: string[] = [];
		page.on("request", (request) => requests.push(request.url()));
		await page.goto("/tests/browser/generic-viewers.html");
		const state = async (): Promise<Viewer2DSnapshot> =>
			JSON.parse((await page.locator("#snapshot").textContent()) || "{}");
		const camera = async () =>
			JSON.parse((await page.locator("#camera").textContent()) || "{}");
		await expect
			.poll(async () => (await state()).diagnostics?.triangles ?? 0)
			.toBeGreaterThan(0);
		if (projection === "orthographic") {
			await page.getByRole("button", { name: "Orthographic camera" }).click();
			await expect
				.poll(async () => (await camera()).type)
				.toBe("OrthographicCamera");
		}
		const locked = async () => {
			const value = await camera();
			expect(value.type).toBe(
				projection === "orthographic"
					? "OrthographicCamera"
					: "PerspectiveCamera",
			);
			for (const [index, expected] of [0, 0, -1].entries())
				expect(value.direction[index]).toBeCloseTo(expected, 10);
			for (const [index, expected] of [0, 1, 0].entries())
				expect(value.up[index]).toBeCloseTo(expected, 10);
		};
		await locked();
		const canvas = page.locator("canvas");
		await expect(
			page.getByRole("toolbar", { name: "View controls", exact: true }),
		).toHaveCount(1);
		await expect(
			page
				.getByRole("toolbar")
				.getByRole("button", { name: "Orthographic camera" }),
		).toHaveCount(1);
		await page.getByRole("button", { name: "Zoom in", exact: true }).click();
		await expect.poll(async () => (await state()).zoom).toBeCloseTo(1.25);
		await page.getByRole("button", { name: "Zoom out", exact: true }).click();
		await expect.poll(async () => (await state()).zoom).toBeCloseTo(1);
		await page.getByRole("button", { name: "Zoom in", exact: true }).click();
		await page
			.getByRole("button", { name: "Fit drawing", exact: true })
			.click();
		await expect.poll(async () => (await state()).zoom).toBeCloseTo(1);
		const original = await state();
		await page.getByRole("button", { name: "Pan", exact: true }).click();
		await expect
			.poll(async () => (await state()).camera.x)
			.not.toBe(original.camera.x);
		await locked();
		await page.getByRole("button", { name: "Reset", exact: true }).click();
		await expect
			.poll(async () => (await state()).camera.x)
			.toBeCloseTo(original.camera.x);
		await canvas.focus();
		await page.keyboard.press("+");
		await expect.poll(async () => (await state()).zoom).toBeCloseTo(1.25);
		await locked();
		await page.getByRole("button", { name: "Pan", exact: true }).click();
		await expect
			.poll(async () => (await state()).camera.x)
			.not.toBe(original.camera.x);
		const beforeSwitch = await state();
		const toggle = page.getByRole("button", { name: "Orthographic camera" });
		await toggle.click();
		await expect(toggle).toHaveAttribute(
			"aria-pressed",
			String(projection !== "orthographic"),
		);
		await expect
			.poll(async () => (await camera()).type)
			.toBe(
				projection === "orthographic"
					? "PerspectiveCamera"
					: "OrthographicCamera",
			);
		for (const property of ["x", "y", "scale"] as const) {
			expect((await state()).camera[property]).toBeCloseTo(
				beforeSwitch.camera[property],
				8,
			);
		}
		expect((await state()).zoom).toBeCloseTo(beforeSwitch.zoom, 8);
		await toggle.click();
		await expect
			.poll(async () => (await camera()).type)
			.toBe(
				projection === "orthographic"
					? "OrthographicCamera"
					: "PerspectiveCamera",
			);
		await locked();
		for (const modifier of [undefined, "Shift", "Control"] as const) {
			await page.mouse.move(400, 300);
			if (modifier) await page.keyboard.down(modifier);
			await page.mouse.down();
			await page.mouse.move(460, 350, { steps: 4 });
			await page.mouse.up();
			await page.mouse.wheel(20, 40);
			if (modifier) await page.keyboard.up(modifier);
			await locked();
		}
		const cdp = await page.context().newCDPSession(page);
		await cdp.send("Input.dispatchTouchEvent", {
			type: "touchStart",
			touchPoints: [{ x: 300, y: 300 }],
		});
		await cdp.send("Input.dispatchTouchEvent", {
			type: "touchMove",
			touchPoints: [{ x: 380, y: 340 }],
		});
		await cdp.send("Input.dispatchTouchEvent", {
			type: "touchEnd",
			touchPoints: [],
		});
		await locked();
		await cdp.detach();
		await canvas.focus();
		await page.keyboard.press("F6");
		await expect.poll(async () => (await state()).zoom).toBeCloseTo(1);
		const beforeResize = await state();
		await page.getByRole("application").evaluate((element) => {
			element.parentElement!.style.width = "600px";
		});
		await expect.poll(async () => (await state()).viewport.width).toBe(600);
		expect((await state()).camera.scale).toBeCloseTo(
			beforeResize.camera.scale,
			8,
		);
		await page.getByRole("application").evaluate((element) => {
			element.parentElement!.style.width = "800px";
		});
		await expect.poll(async () => (await state()).viewport.width).toBe(800);
		const initialViewport = page.viewportSize()!;
		await page.setViewportSize({ width: 1000, height: 700 });
		await locked();
		await page.setViewportSize(initialViewport);
		await locked();
		expect(requests.filter((url) => url.includes("/formats/"))).toEqual([]);
	});
}

test("3D viewer borrows a synthetic mesh while its owner manages resources", async ({
	page,
}) => {
	const requests: string[] = [];
	const errors: string[] = [];
	page.on("request", (request) => requests.push(request.url()));
	page.on("pageerror", (error) => errors.push(error.message));
	await page.goto("/tests/browser/generic-viewers.html?3d");
	const state = async () =>
		JSON.parse((await page.locator("#lifetime").textContent()) || "{}");
	await expect(
		page.getByRole("button", { name: "Zoom", exact: true }),
	).toBeEnabled();
	const initial = await state();
	expect(initial.created - initial.disposed).toBe(1);
	const canvas = page.locator("canvas");
	const capture = async () => {
		await page.mouse.move(0, 0);
		let image: Buffer = Buffer.alloc(0);
		await expect(async () => {
			image = await canvas.screenshot();
		}).toPass();
		return image;
	};
	const original = await capture();
	await expect(
		page.getByRole("toolbar", { name: "3D view controls", exact: true }),
	).toHaveCount(1);
	await page.getByRole("button", { name: "Zoom in", exact: true }).click();
	expect((await capture()).equals(original)).toBe(false);
	await page.getByRole("button", { name: "Fit model", exact: true }).click();
	await expect.poll(async () => (await capture()).equals(original)).toBe(true);
	await page.getByRole("button", { name: "Visibility" }).click();
	expect((await capture()).equals(original)).toBe(false);
	await page.getByRole("button", { name: "Replace scene" }).click();
	await expect
		.poll(async () => (await state()).created)
		.toBe(initial.created + 1);
	const hiddenReplacement = await capture();
	await page.getByRole("button", { name: "Visibility" }).click();
	expect((await capture()).equals(hiddenReplacement)).toBe(false);
	expect((await state()).created).toBe(initial.created + 1);
	await page.getByRole("button", { name: "Empty scene" }).click();
	await expect(page.getByRole("alert")).toContainText("no finite geometry");
	await expect(canvas).toHaveCount(0);
	const failed = await state();
	expect(failed.created).toBe(initial.created + 2);
	expect(failed.disposed).toBe(failed.created - 1);
	await page.getByRole("button", { name: "Empty scene" }).click();
	await expect(
		page.getByRole("button", { name: "Zoom", exact: true }),
	).toBeEnabled();
	await expect(canvas).toHaveCount(1);
	await page.getByRole("button", { name: "Mount", exact: true }).click();
	await expect(canvas).toHaveCount(0);
	const disposed = await state();
	expect(disposed.disposed).toBe(disposed.created - 1);
	expect(disposed.geometriesDisposed).toBe(disposed.created - 1);
	expect(disposed.materialsDisposed).toBe(disposed.created - 1);
	expect(errors).toEqual([]);
	expect(requests.filter((url) => url.includes("/formats/"))).toEqual([]);
});

for (const mode of [
	"perspective",
	"orthographic",
	"3d",
	"3d-orthographic",
] as const) {
	test(`${mode} zoom percentage and camera stay within 25% to 800%`, async ({
		page,
	}) => {
		const orbit = mode.startsWith("3d");
		const orthographic = mode.endsWith("orthographic");
		await page.goto(`/tests/browser/generic-viewers.html${orbit ? "?3d" : ""}`);
		const canvas = page.locator("canvas");
		const fit = page.getByRole("button", {
			name: orbit ? "Fit model" : "Fit drawing",
			exact: true,
		});
		const zoomIn = page.getByRole("button", { name: "Zoom in", exact: true });
		const zoomOut = page.getByRole("button", { name: "Zoom out", exact: true });
		await expect(fit).toHaveText("100%");
		if (orthographic)
			await page.getByRole("button", { name: "Orthographic camera" }).click();
		const camera = async () =>
			JSON.parse((await page.locator("#camera").textContent()) || "{}");
		await expect
			.poll(async () => (await camera()).type)
			.toBe(orthographic ? "OrthographicCamera" : "PerspectiveCamera");
		const initial = await camera();
		const viewDistance = (value: { position: number[]; target: number[] }) =>
			Math.hypot(
				...value.position.map(
					(position, index) => position - value.target[index],
				),
			);
		const actualZoom = async () => {
			const current = await camera();
			return orthographic
				? current.projectionY / initial.projectionY
				: viewDistance(initial) / viewDistance(current);
		};
		const checkLimit = async (level: number) => {
			await expect(fit).toHaveText(`${level * 100}%`);
			await expect.poll(actualZoom).toBeCloseTo(level, 8);
			await expect(level === 8 ? zoomIn : zoomOut).toBeDisabled();
			await expect(level === 8 ? zoomOut : zoomIn).toBeEnabled();
		};
		await zoomIn.click();
		await expect(fit).toHaveText("125%");
		for (let index = 0; index < 9; index++) await zoomIn.click();
		await checkLimit(8);
		await canvas.focus();
		await page.keyboard.press("+");
		await checkLimit(8);
		for (let index = 0; index < 16; index++) await zoomOut.click();
		await checkLimit(0.25);
		await canvas.focus();
		await page.keyboard.press("-");
		await checkLimit(0.25);
		await fit.click();
		await expect(fit).toHaveText("100%");
		for (const deltaY of [-2000, 2000]) {
			await canvas.evaluate((element, deltaY) => {
				const bounds = element.getBoundingClientRect();
				element.dispatchEvent(
					new WheelEvent("wheel", {
						ctrlKey: true,
						deltaY,
						clientX: bounds.x + bounds.width / 2,
						clientY: bounds.y + bounds.height / 2,
						bubbles: true,
						cancelable: true,
					}),
				);
			}, deltaY);
			await checkLimit(deltaY < 0 ? 8 : 0.25);
		}
		await fit.click();
		const bounds = (await canvas.boundingBox())!;
		const cdp = await page.context().newCDPSession(page);
		for (const [start, end, level] of [
			[5, bounds.width * 0.4, 8],
			[bounds.width * 0.4, 1, 0.25],
		]) {
			const points = (distance: number) =>
				[-1, 1].map((direction, id) => ({
					id,
					x: bounds.x + bounds.width / 2 + direction * distance,
					y: bounds.y + bounds.height / 2,
				}));
			await cdp.send("Input.dispatchTouchEvent", {
				type: "touchStart",
				touchPoints: points(start),
			});
			await cdp.send("Input.dispatchTouchEvent", {
				type: "touchMove",
				touchPoints: points(end),
			});
			await cdp.send("Input.dispatchTouchEvent", {
				type: "touchEnd",
				touchPoints: [],
			});
			await checkLimit(level);
		}
		await cdp.detach();
		if (mode !== "3d") {
			await page.getByRole("button", { name: "Orthographic camera" }).click();
			await expect(fit).toHaveText("25%");
			await expect(zoomOut).toBeDisabled();
			await canvas.focus();
			await page.keyboard.press("-");
			await expect(fit).toHaveText("25%");
		}
		await fit.click();
		await expect(fit).toHaveText("100%");
		await expect(zoomIn).toBeEnabled();
		await expect(zoomOut).toBeEnabled();
	});
}
