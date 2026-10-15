import { toolbarButton } from "./toolbar";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { demoFiles } from "../fixtures/demo-gerbers";

async function exportPng(page: Page, filename: string) {
	const pending = page.waitForEvent("download");
	await (await toolbarButton(page, "Export PNG")).click();
	const download = await pending;
	expect(download.suggestedFilename()).toBe(filename);
	const bytes = await readFile((await download.path())!);
	expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
	const dimensions = await page.locator("canvas").evaluate((canvas: HTMLCanvasElement) => ({
		width: canvas.width,
		height: canvas.height,
	}));
	expect(bytes.readUInt32BE(16)).toBe(dimensions.width);
	expect(bytes.readUInt32BE(20)).toBe(dimensions.height);
	// Decode the actual download, checking for geometry rather than a blank WebGL buffer.
	const colors = await page.evaluate(async (base64) => {
		const image = new Image();
		image.src = `data:image/png;base64,${base64}`;
		await image.decode();
		const canvas = document.createElement("canvas");
		canvas.width = image.width;
		canvas.height = image.height;
		const context = canvas.getContext("2d")!;
		context.drawImage(image, 0, 0);
		const pixels = context.getImageData(0, 0, image.width, image.height).data;
		const colors = new Set<number>();
		for (let i = 0; i < pixels.length; i += 4) {
			if (pixels[i + 3] !== 255) throw new Error("Unexpected transparent pixel");
			colors.add((pixels[i] << 16) | (pixels[i + 1] << 8) | pixels[i + 2]);
		}
		return colors.size;
	}, bytes.toString("base64"));
	expect(colors).toBeGreaterThan(1);
	await expect((await toolbarButton(page, "Export PNG"))).toBeEnabled();
	return bytes;
}

test("schematic editor exports edits and the current zoom without changing the drawing", async ({ page }) => {
	await page.goto("/tests/browser/editor.html");
	const filename = "schematic-editor.png";
	const original = await exportPng(page, filename);
	await (await toolbarButton(page, "Rectangle")).click();
	const box = (await page.locator("canvas").boundingBox())!;
	await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.4);
	await page.mouse.down();
	await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.6);
	await page.mouse.up();
	const edited = await exportPng(page, filename);
	expect(edited.equals(original)).toBe(false);
	const state = await page.locator("#editor-scene").textContent();
	expect((await exportPng(page, filename)).equals(edited)).toBe(true);
	expect(await page.locator("#editor-scene").textContent()).toBe(state);
	await (await toolbarButton(page, "Zoom in")).click();
	expect((await exportPng(page, filename)).equals(edited)).toBe(false);
});

test("Gerber exports loaded layers and the current projection", async ({ page }) => {
	await page.goto("/tests/browser/viewer.html");
	const file = demoFiles[0];
	await page.locator("input[type=file]").setInputFiles({
		name: file.name,
		mimeType: "text/plain",
		buffer: Buffer.from(file.source),
	});
	await expect(page.getByRole("complementary", { name: "Layers" })).toBeVisible();
	const original = await exportPng(page, "gerber-drawing.png");
	await (await toolbarButton(page, "Zoom in")).click();
	expect((await exportPng(page, "gerber-drawing.png")).equals(original)).toBe(false);
	await page.getByRole("button", { name: "Orthographic camera" }).click();
	await exportPng(page, "gerber-drawing.png");
});

test("STEP exports camera orientation, wireframe and hidden parts", async ({ page }) => {
	await page.goto("/tests/browser/step.html");
	await page.getByLabel("Open STEP file").setInputFiles(
		resolve("node_modules/occt-import-js/test/testfiles/simple-basic-cube/cube.stp"),
	);
	await expect((await toolbarButton(page, "Export PNG"))).toBeEnabled({ timeout: 30000 });
	const filename = "3d-step-model.png";
	const original = await exportPng(page, filename);
	await page.getByRole("button", { name: "Top", exact: true }).click();
	const top = await exportPng(page, filename);
	expect(top.equals(original)).toBe(false);
	await (await toolbarButton(page, "Wire")).click();
	const wire = await exportPng(page, filename);
	expect(wire.equals(top)).toBe(false);
	await page.getByRole("checkbox").first().uncheck();
	expect((await exportPng(page, filename)).equals(wire)).toBe(false);
});

test("PNG encoding failure reports an error and allows another export", async ({ page }) => {
	await page.goto("/tests/browser/editor.html");
	await expect((await toolbarButton(page, "Export PNG"))).toBeEnabled();
	await page.evaluate(() => {
		const original = HTMLCanvasElement.prototype.toBlob;
		HTMLCanvasElement.prototype.toBlob = function (callback) {
			HTMLCanvasElement.prototype.toBlob = original;
			callback(null);
		};
	});
	await (await toolbarButton(page, "Export PNG")).click();
	await expect(page.getByRole("alert")).toContainText("PNG export failed");
	await exportPng(page, "schematic-editor.png");
	await expect(page.getByRole("alert")).toHaveCount(0);
});
