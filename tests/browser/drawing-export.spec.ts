import { readFile, mkdir, writeFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

const fixture = JSON.parse(
	await readFile("tests/fixtures/rp2350a-reference/drawing.ecaddraw", "utf8"),
);
const artifacts = "perf-artifacts/exports";

test("RP2350A full-sheet SVG and 9600 by 6400 PNG preserve the complete drawing", async ({
	page,
}) => {
	test.setTimeout(120_000);
	await mkdir(artifacts, { recursive: true });
	await page.goto("/tests/browser/editor.html");
	await page.evaluate(async (shapes) => {
		const editorUrl = "/tests/browser/editor.tsx";
		const editor = (await import(editorUrl)) as typeof import("./editor.tsx");
		const storeUrl = "/packages/core/src/commands/drawing-store.ts";
		const { createDrawingStore } = (await import(
			storeUrl
		)) as typeof import("#/commands/drawing-store.ts");
		editor.drawingStore.transact(() => [
			undefined,
			createDrawingStore(shapes).getSnapshot(),
		]);
	}, fixture.shapes);
	const button = page.getByRole("button", {
		name: "Export drawing",
		exact: true,
	});
	await expect(button).toBeEnabled();
	await button.click();
	const dialog = page.getByRole("dialog", { name: "Export drawing" });
	await expect(dialog).toBeVisible();
	await page.screenshot({ path: `${artifacts}/export-options.png` });
	await dialog
		.getByRole("combobox", { name: "Format", exact: true })
		.selectOption("svg");
	let pending = page.waitForEvent("download");
	await dialog.getByRole("button", { name: "Download", exact: true }).click();
	const svgDownload = await pending;
	await svgDownload.saveAs(`${artifacts}/rp2350a-sheet.svg`);
	const svg = await readFile((await svgDownload.path())!, "utf8");
	expect(svg).not.toMatch(/<image|data:image|selection|editor-wire-preview/);
	const coverage = await page.evaluate((svg) => {
		const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
		return {
			errors: doc.querySelectorAll("parsererror").length,
			names: [...doc.querySelectorAll("[data-name]")].map((e) =>
				e.getAttribute("data-name"),
			),
			texts: [...doc.querySelectorAll("text")].map((e) => e.textContent),
			viewBox: doc.documentElement.getAttribute("viewBox"),
		};
	}, svg);
	expect(coverage.errors).toBe(0);
	for (const shape of fixture.shapes)
		expect(coverage.names).toContain(`${shape.kind} ${shape.id}`);
	expect(coverage.texts).toContain("RP2350A");
	expect(coverage.viewBox).toBe("-210 -148.5 420 297");
	await dialog
		.getByRole("combobox", { name: "Format", exact: true })
		.selectOption("png");
	pending = page.waitForEvent("download");
	await dialog.getByRole("button", { name: "Download", exact: true }).click();
	const png = await pending;
	await png.saveAs(`${artifacts}/rp2350a-sheet-9600x6400.png`);
	const bytes = await readFile((await png.path())!);
	expect(bytes.readUInt32BE(16)).toBe(9600);
	expect(bytes.readUInt32BE(20)).toBe(6400);
	const detail = await page.evaluate(async (base64) => {
		const image = new Image();
		image.src = `data:image/png;base64,${base64}`;
		await image.decode();
		const canvas = document.createElement("canvas");
		canvas.width = 2000;
		canvas.height = 1600;
		canvas
			.getContext("2d")!
			.drawImage(image, 3500, 2600, 2000, 1600, 0, 0, 2000, 1600);
		return canvas.toDataURL("image/png").split(",")[1];
	}, bytes.toString("base64"));
	await writeFile(
		`${artifacts}/rp2350a-detail.png`,
		Buffer.from(detail, "base64"),
	);

	const pixels = await page.evaluate(async (base64) => {
		const image = new Image();
		image.src = `data:image/png;base64,${base64}`;
		await image.decode();
		const canvas = document.createElement("canvas");
		canvas.width = 9600;
		canvas.height = 6400;
		const context = canvas.getContext("2d")!;
		context.drawImage(image, 0, 0);
		const corner = [...context.getImageData(0, 0, 1, 1).data];
		const data = context.getImageData(400, 400, 8800, 5600).data;
		let ink = 0;
		for (let i = 0; i < data.length; i += 4)
			if (data[i] < 200 && data[i + 3] === 255) ink++;
		return { corner, ink };
	}, bytes.toString("base64"));
	expect(pixels.corner).toEqual([255, 255, 255, 255]);
	expect(pixels.ink).toBeGreaterThan(100000);
	await dialog.getByRole("button", { name: "Close", exact: true }).click();
	await page.screenshot({ path: `${artifacts}/rp2350a-editor.png` });
});

test("drawing export supports background, tight fit, invalid size and encoding recovery", async ({
	page,
}) => {
	await page.goto("/tests/browser/editor.html");
	await page
		.getByRole("button", { name: "Export drawing", exact: true })
		.click();
	const dialog = page.getByRole("dialog");
	await dialog.getByLabel("Width in pixels").fill("1600");
	await dialog.getByLabel("Height in pixels").fill("1000");
	await dialog
		.getByRole("combobox", { name: "Output", exact: true })
		.selectOption("drawing");
	for (const background of ["dark", "transparent"]) {
		await dialog
			.getByRole("combobox", { name: "Background", exact: true })
			.selectOption(background);
		const pending = page.waitForEvent("download");
		await dialog.getByRole("button", { name: "Download" }).click();
		const download = await pending;
		const bytes = await readFile((await download.path())!);
		expect(bytes.readUInt32BE(16)).toBe(1600);
		const pixel = await page.evaluate(async (base64) => {
			const image = new Image();
			image.src = `data:image/png;base64,${base64}`;
			await image.decode();
			const canvas = document.createElement("canvas");
			const ctx = canvas.getContext("2d")!;
			ctx.drawImage(image, 0, 0);
			return [...ctx.getImageData(0, 0, 1, 1).data];
		}, bytes.toString("base64"));
		expect(pixel).toEqual(
			background === "dark" ? [17, 19, 24, 255] : [0, 0, 0, 0],
		);
	}
	await dialog.getByLabel("Width in pixels").fill("16000");
	await dialog.getByLabel("Height in pixels").fill("16000");
	await dialog.getByRole("button", { name: "Download" }).click();
	await expect(dialog.getByRole("alert")).toContainText("100 megapixels");
	await dialog.getByLabel("Width in pixels").fill("1600");
	await dialog.getByLabel("Height in pixels").fill("1000");
	await page.evaluate(() => {
		const original = HTMLCanvasElement.prototype.toBlob;
		HTMLCanvasElement.prototype.toBlob = function (callback) {
			HTMLCanvasElement.prototype.toBlob = original;
			callback(null);
		};
	});
	await dialog.getByRole("button", { name: "Download" }).click();
	await expect(dialog.getByRole("alert")).toContainText("encode");
	const pending = page.waitForEvent("download");
	await dialog.getByRole("button", { name: "Download" }).click();
	await pending;
	await expect(dialog.getByRole("alert")).toHaveCount(0);
});
