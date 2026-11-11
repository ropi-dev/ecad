import { expect, type Page, test } from "@playwright/test";
import { openProjectFiles } from "./project-files";
import { drawingPoint } from "./symbol-items";

const canvasAntialias = (page: Page) =>
	page
		.locator("canvas")
		.first()
		.evaluate(
			(canvas: HTMLCanvasElement) =>
				canvas.getContext("webgl2")?.getContextAttributes()?.antialias,
		);

async function openSettings(page: Page) {
	await page.goto("/tests/browser/projects.html");
	const sidebar = await openProjectFiles(page);
	await sidebar.getByRole("button", { name: "Settings", exact: true }).click();
	return page.getByRole("dialog", { name: "Settings" });
}

test("the antialiasing setting recreates open canvases and is remembered", async ({
	page,
	context,
}) => {
	await page.goto("/tests/browser/editor.html");
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
	const settings = await openSettings(await context.newPage());
	const select = settings.getByLabel("Antialiasing", { exact: true });
	await expect(select).toHaveValue("off");
	await select.selectOption("on");
	await expect.poll(() => canvasAntialias(page)).toBe(true);
	await expect.poll(() => drawingPoint(page, { x: 0, y: 0 })).toEqual(origin);
	await page.reload();
	expect(await canvasAntialias(page)).toBe(true);
	expect(
		await page.evaluate(() =>
			JSON.parse(localStorage.getItem("ecad.settings.v1") ?? "{}"),
		),
	).toEqual({ version: 1, antialiasing: "on" });
});

test("a perspective top view keeps its camera when antialiasing changes", async ({
	page,
	context,
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
	const other = await context.newPage();
	await other.goto("/tests/browser/generic-viewers.html");
	await other.evaluate(() =>
		localStorage.setItem(
			"ecad.settings.v1",
			JSON.stringify({ version: 1, antialiasing: "on" }),
		),
	);
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
		context,
	}) => {
		await page.goto("/tests/browser/editor.html");
		const software = await page.evaluate(() => {
			const context = document.createElement("canvas").getContext("webgl2");
			const info = context?.getExtension("WEBGL_debug_renderer_info");
			return /swiftshader|llvmpipe|softpipe|software|basic render/i.test(
				String(info ? context?.getParameter(info.UNMASKED_RENDERER_WEBGL) : ""),
			);
		});
		expect(await canvasAntialias(page)).toBe(!software);
		const settings = await openSettings(await context.newPage());
		const select = settings.getByLabel("Antialiasing", { exact: true });
		await expect(select).toHaveValue("auto");
		await expect(select.locator("option:checked")).toHaveText(
			`Automatic (${software ? "off" : "on"})`,
		);
	});

	test("an antialiasing choice from an older version carries over", async ({
		page,
	}) => {
		await page.goto("/tests/browser/editor.html");
		await page.evaluate(() => localStorage.setItem("ecad.antialias", "1"));
		await page.reload();
		expect(await canvasAntialias(page)).toBe(true);
		const settings = await openSettings(page);
		await expect(
			settings.getByLabel("Antialiasing", { exact: true }),
		).toHaveValue("on");
	});
});
