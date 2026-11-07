import { expect, test } from "@playwright/test";
import { drawingPoint } from "./symbol-items";

const canvasAntialias = (page: import("@playwright/test").Page) =>
	page
		.locator("canvas")
		.first()
		.evaluate(
			(canvas: HTMLCanvasElement) =>
				canvas.getContext("webgl2")?.getContextAttributes()?.antialias,
		);

test("the antialiasing toggle recreates the canvas and is remembered", async ({
	page,
}) => {
	await page.goto("/tests/browser/editor.html");
	const toggle = page.getByRole("button", {
		name: "Antialiasing",
		exact: true,
	});
	await expect(toggle).toHaveAttribute("aria-pressed", "false");
	expect(await canvasAntialias(page)).toBe(false);
	await page.getByRole("button", { name: "Zoom in", exact: true }).click();
	let origin = await drawingPoint(page, { x: 0, y: 0 });
	await expect
		.poll(async () => {
			const previous = origin;
			origin = await drawingPoint(page, { x: 0, y: 0 });
			return previous.x === origin.x && previous.y === origin.y;
		})
		.toBe(true);
	await toggle.click();
	await expect(toggle).toHaveAttribute("aria-pressed", "true");
	await expect.poll(() => canvasAntialias(page)).toBe(true);
	await expect.poll(() => drawingPoint(page, { x: 0, y: 0 })).toEqual(origin);
	await page.reload();
	await expect(
		page.getByRole("button", { name: "Antialiasing", exact: true }),
	).toHaveAttribute("aria-pressed", "true");
	expect(await canvasAntialias(page)).toBe(true);
});

test("a perspective top view keeps its camera when antialiasing changes", async ({
	page,
}) => {
	await page.goto("/tests/browser/generic-viewers.html");
	const camera = async () =>
		JSON.parse((await page.locator("#snapshot").textContent()) ?? "{}")
			.camera as { x: number; y: number; scale: number } | undefined;
	await page.getByRole("button", { name: "Pan", exact: true }).click();
	await expect.poll(async () => (await camera())?.x).not.toBe(0);
	const before = await camera();
	expect(await canvasAntialias(page)).toBe(false);
	await page
		.locator("#snapshot")
		.evaluate((output) => output.replaceChildren());
	await page.getByRole("button", { name: "Antialiasing", exact: true }).click();
	await expect.poll(() => canvasAntialias(page)).toBe(true);
	await expect
		.poll(async () => {
			const after = await camera();
			return (
				!!before &&
				!!after &&
				Math.abs(after.x - before.x) < 1e-6 &&
				Math.abs(after.y - before.y) < 1e-6 &&
				Math.abs(after.scale / before.scale - 1) < 1e-6
			);
		})
		.toBe(true);
});

test.describe("without a stored choice", () => {
	test.use({ storageState: { cookies: [], origins: [] } });

	test("antialiasing starts off only on a software renderer", async ({
		page,
	}) => {
		await page.goto("/tests/browser/editor.html");
		const software = await page.evaluate(() => {
			const context = document.createElement("canvas").getContext("webgl2");
			const info = context?.getExtension("WEBGL_debug_renderer_info");
			return /swiftshader|llvmpipe|softpipe|software|basic render/i.test(
				String(info ? context?.getParameter(info.UNMASKED_RENDERER_WEBGL) : ""),
			);
		});
		await expect(
			page.getByRole("button", { name: "Antialiasing", exact: true }),
		).toHaveAttribute("aria-pressed", String(!software));
		expect(await canvasAntialias(page)).toBe(!software);
	});
});
