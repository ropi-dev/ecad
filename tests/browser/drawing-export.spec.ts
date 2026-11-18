import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { required } from "../helpers/required.ts";
import { toolbarButton } from "./toolbar";

const fixture = JSON.parse(
	await readFile("tests/fixtures/rp2350a-reference/drawing.ecaddraw", "utf8"),
);

test("exports the RP2350A sheet as SVG, PNG and A3 PDF", async ({ page }) => {
	test.setTimeout(120_000);
	const open = async () => {
		await page.goto("/tests/browser/editor.html");
		await page.evaluate(async (shapes) => {
			const editorUrl = "/tests/browser/editor.tsx";
			const editor = (await import(editorUrl)) as typeof import("./editor.tsx");
			const storeUrl = "/packages/drawing-core/src/commands/drawing-store.ts";
			const { createDrawingStore } = (await import(
				storeUrl
			)) as typeof import("@ecad/drawing-core/commands/drawing-store.ts");
			editor.drawingStore.transact(() => [
				undefined,
				createDrawingStore(shapes).getSnapshot(),
			]);
		}, fixture.shapes);
	};
	await open();
	const button = await toolbarButton(page, "Export drawing");
	await expect(button).toBeEnabled();
	await button.click();
	const dialog = page.getByRole("dialog", { name: "Export drawing" });
	await expect(dialog).toBeVisible();
	await dialog
		.getByRole("combobox", { name: "Format", exact: true })
		.selectOption("svg");
	let pending = page.waitForEvent("download");
	await dialog.getByRole("button", { name: "Download", exact: true }).click();
	const svgDownload = await pending;
	const svg = await readFile(required(await svgDownload.path()), "utf8");
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
	await (await toolbarButton(page, "Export drawing")).click();
	await dialog
		.getByRole("combobox", { name: "Format", exact: true })
		.selectOption("png");
	await dialog.getByLabel("Width in pixels").fill("960");
	await dialog.getByLabel("Height in pixels").fill("640");
	pending = page.waitForEvent("download");
	await dialog.getByRole("button", { name: "Download", exact: true }).click();
	const png = await pending;
	const bytes = await readFile(required(await png.path()));
	expect(bytes.readUInt32BE(16)).toBe(960);
	expect(bytes.readUInt32BE(20)).toBe(640);
	const pixels = await page.evaluate(async (base64) => {
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
		const corner = [...context.getImageData(0, 0, 1, 1).data];
		const data = context.getImageData(40, 40, 880, 560).data;
		let ink = 0;
		for (let i = 0; i < data.length; i += 4)
			if (data[i] < 200 && data[i + 3] === 255) ink++;
		return { corner, ink };
	}, bytes.toString("base64"));
	expect(pixels.corner).toEqual([255, 255, 255, 255]);
	expect(pixels.ink).toBeGreaterThan(100);
	await expect(dialog).not.toBeVisible();

	await (await toolbarButton(page, "Export drawing")).click();
	await dialog
		.getByRole("combobox", { name: "Format", exact: true })
		.selectOption("pdf");
	await expect(
		dialog.getByRole("spinbutton", { name: "Width in pixels" }),
	).toHaveCount(0);
	pending = page.waitForEvent("download");
	await dialog.getByRole("button", { name: "Download", exact: true }).click();
	const pdfDownload = await pending;
	expect(pdfDownload.suggestedFilename()).toBe("schematic-drawing.pdf");
	const pdf = (await readFile(required(await pdfDownload.path()))).toString(
		"latin1",
	);
	expect(pdf.startsWith("%PDF-1.4\n")).toBe(true);
	expect(pdf).toContain("/MediaBox [0 0 1190.5512 841.8898]");
	expect(pdf).toContain("/Subtype /Type3");
	expect(pdf.endsWith("%%EOF\n")).toBe(true);

	await page.addInitScript(() => {
		const Real = window.Worker;
		window.Worker = class extends Real {
			constructor(url: string | URL, options?: WorkerOptions) {
				if (String(url).includes("export.worker"))
					throw new Error("Workers are blocked.");
				super(url, options);
			}
		};
	});
	await open();
	await (await toolbarButton(page, "Export drawing")).click();
	await dialog
		.getByRole("combobox", { name: "Format", exact: true })
		.selectOption("svg");
	pending = page.waitForEvent("download");
	await dialog.getByRole("button", { name: "Download", exact: true }).click();
	const pageSvg = await readFile(
		required(await (await pending).path()),
		"utf8",
	);
	expect(pageSvg === svg).toBe(true);
});
