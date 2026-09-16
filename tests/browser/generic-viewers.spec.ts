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
		await page.locator(".drawing-area").evaluate((element) => {
			element.parentElement!.style.width = "600px";
		});
		await expect.poll(async () => (await state()).viewport.width).toBe(600);
		expect((await state()).camera.scale).toBeCloseTo(
			beforeResize.camera.scale,
			8,
		);
		await page.locator(".drawing-area").evaluate((element) => {
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
		let image: Buffer = Buffer.alloc(0);
		await expect(async () => {
			image = await canvas.screenshot();
		}).toPass();
		return image;
	};
	const original = await capture();
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
