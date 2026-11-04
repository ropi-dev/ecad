import { readFile } from "node:fs/promises";
import { expect, type Page, test } from "@playwright/test";
import { demoFiles } from "../fixtures/demo-gerbers";
import { required } from "../helpers/required.ts";
import { toolbarButton } from "./toolbar";

async function exportPng(page: Page, filename: string) {
	const pending = page.waitForEvent("download");
	await (await toolbarButton(page, "Export PNG")).click();
	const download = await pending;
	expect(download.suggestedFilename()).toBe(filename);
	const bytes = await readFile(required(await download.path()));
	expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
	const dimensions = await page
		.locator("canvas")
		.evaluate((canvas: HTMLCanvasElement) => ({
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
		const context =
			canvas.getContext("2d") ??
			(() => {
				throw new Error("Expected a value");
			})();
		context.drawImage(image, 0, 0);
		const pixels = context.getImageData(0, 0, image.width, image.height).data;
		const colors = new Set<number>();
		for (let i = 0; i < pixels.length; i += 4) {
			if (pixels[i + 3] !== 255)
				throw new Error("Unexpected transparent pixel");
			colors.add((pixels[i] << 16) | (pixels[i + 1] << 8) | pixels[i + 2]);
		}
		return colors.size;
	}, bytes.toString("base64"));
	expect(colors).toBeGreaterThan(1);
	await expect(await toolbarButton(page, "Export PNG")).toBeEnabled();
	return bytes;
}

test("Gerber exports loaded layers and the current projection", async ({
	page,
}) => {
	await page.goto("/tests/browser/viewer.html");
	const file = demoFiles[0];
	await page.locator("input[type=file]").setInputFiles({
		name: file.name,
		mimeType: "text/plain",
		buffer: Buffer.from(file.source),
	});
	await expect(
		page.getByRole("complementary", { name: "Layers" }),
	).toBeVisible();
	const original = await exportPng(page, "gerber-drawing.png");
	await (await toolbarButton(page, "Zoom in")).click();
	expect((await exportPng(page, "gerber-drawing.png")).equals(original)).toBe(
		false,
	);
	await page.getByRole("button", { name: "Orthographic camera" }).click();
	await exportPng(page, "gerber-drawing.png");
});
