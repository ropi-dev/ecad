import type { Page } from "@playwright/test";
import { expect, test } from "./seeded-project";
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
	await page.waitForFunction(
		() => !document.querySelector('[aria-busy="true"]'),
	);
	await page
		.getByRole("navigation", { name: "Sidebar shortcuts", exact: true })
		.getByRole("button", { name: "Settings", exact: true })
		.click();
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
