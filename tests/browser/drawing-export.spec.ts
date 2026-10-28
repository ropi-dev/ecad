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
	const serializerRequests: string[] = [];
	page.on("request", (request) => {
		if (request.url().includes("/drawing/export.ts"))
			serializerRequests.push(request.url());
	});
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
	expect(serializerRequests).toEqual([]);
	await page.screenshot({ path: `${artifacts}/export-options.png` });
	await dialog
		.getByRole("combobox", { name: "Format", exact: true })
		.selectOption("svg");
	let pending = page.waitForEvent("download");
	await dialog.getByRole("button", { name: "Download", exact: true }).click();
	const svgDownload = await pending;
	expect(serializerRequests).toHaveLength(1);
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

test("pin-only symbols and empty strokes export PNG and SVG without losing labels or leads", async ({
	page,
}) => {
	await page.goto("/tests/browser/editor.html");
	const result = await page.evaluate(async () => {
		const exportUrl = "/packages/core/src/drawing/export.ts";
		const captureUrl = "/packages/core/src/engine/capture-png.ts";
		const symbolsUrl = "/packages/core/src/drawing/symbols.ts";
		const { exportDrawingSvg } = (await import(
			exportUrl
		)) as typeof import("#/drawing/export.ts");
		const { captureSvgPng } = (await import(
			captureUrl
		)) as typeof import("#/engine/capture-png.ts");
		const { createSymbolFromShapes } = (await import(
			symbolsUrl
		)) as typeof import("#/drawing/symbols.ts");
		const pin: import("#/drawing/shapes.ts").PinShape = {
			id: 1,
			kind: "pin",
			x: 0,
			y: 0,
			width: 0.508,
			height: 0.508,
			lineWidth: 0.18,
			rotation: 0,
			length: 2,
			name: "Clock signal",
			number: "17",
		};
		const symbol = createSymbolFromShapes(2, [pin]);
		symbol.texts = [{ attribute: "reference", x: 0, y: 3, fontSize: 2 }];
		symbol.rotation = Math.PI / 2;
		const line: import("#/drawing/shapes.ts").EditorShape = {
			id: 3,
			kind: "line",
			x: 20,
			y: 0,
			width: 10,
			height: 0,
			lineWidth: 0,
			rotation: 0,
		};
		const hidden = createSymbolFromShapes(4, [
			{
				...pin,
				x: 12,
				name: "Hidden signal",
				number: "Hidden number",
				showLabels: false,
			},
		]);
		const svg = exportDrawingSvg([symbol, line, hidden], {
			width: 1600,
			height: 1000,
			area: "drawing",
			background: "white",
			sheet: { width: 420, height: 297 },
		});
		const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
		const blob = await captureSvgPng(svg, 1600, 1000, "white");
		const image = await createImageBitmap(blob);
		const canvas = document.createElement("canvas");
		canvas.width = image.width;
		canvas.height = image.height;
		const context = canvas.getContext("2d")!;
		context.drawImage(image, 0, 0);
		image.close();
		const data = context.getImageData(0, 0, 1600, 1000).data;
		let ink = 0;
		for (let i = 0; i < data.length; i += 4) if (data[i] < 200) ink++;
		return {
			texts: [...doc.querySelectorAll("text")].map((node) => node.textContent),
			lead: doc.querySelector('[data-name="pin 2:1"] path')?.getAttribute("d"),
			ink,
			width: canvas.width,
			height: canvas.height,
		};
	});
	expect(result.texts).toContain("Clock signal");
	expect(result.texts).toContain("17");
	expect(result.texts).toContain("U2");
	expect(result.texts).not.toContain("Hidden signal");
	expect(result.texts).not.toContain("Hidden number");
	expect(result.lead).toMatch(/^M/);
	expect(result.ink).toBeGreaterThan(1000);
	expect([result.width, result.height]).toEqual([1600, 1000]);
});

test("rotated multiline text keeps orientation, anchors and every glyph inside the export", async ({
	page,
}) => {
	await page.goto("/tests/browser/editor.html");
	const results = await page.evaluate(async () => {
		const exportUrl = "/packages/core/src/drawing/export.ts";
		const textUrl = "/packages/core/src/drawing/text.ts";
		const alignmentUrl = "/packages/core/src/drawing/text-alignment.ts";
		const measureUrl = "/packages/core/src/engine/drawing/text.ts";
		const { exportDrawingSvg } = (await import(
			exportUrl
		)) as typeof import("#/drawing/export.ts");
		const { textLayout } = (await import(
			textUrl
		)) as typeof import("#/drawing/text.ts");
		const { textCenter } = (await import(
			alignmentUrl
		)) as typeof import("#/drawing/text-alignment.ts");
		const { measureText } = (await import(
			measureUrl
		)) as typeof import("#/engine/drawing/text.ts");
		const shapes = [0, Math.PI / 2, Math.PI, -Math.PI / 2].map(
			(rotation, i): import("#/drawing/shapes.ts").TextShape => ({
				id: i + 1,
				kind: "text",
				x: 300 + i * 30,
				y: 200 - i * 20,
				width: 25,
				height: 10,
				rotation,
				lineWidth: 0,
				fontSize: 3,
				text: `Clock ${i}\ngyp 17`,
				horizontalAlign: i % 2 ? "right" : "left",
				verticalAlign: i % 2 ? "bottom" : "top",
			}),
		);
		const svg = exportDrawingSvg(shapes, {
			width: 1600,
			height: 1000,
			area: "sheet",
			background: "white",
			sheet: { width: 420, height: 297 },
			measureText,
		});
		const root = document.importNode(
			new DOMParser().parseFromString(svg, "image/svg+xml").documentElement,
			true,
		) as unknown as SVGSVGElement;
		document.body.append(root);
		try {
			const view = root.viewBox.baseVal;
			return shapes.map((shape) => {
				const group = root.querySelector(
					`[data-name="text ${shape.id}"] > g`,
				) as SVGGElement;
				const matrix = root.getCTM()!.inverse().multiply(group.getCTM()!);
				const layout = textLayout(shape.text, measureText);
				const center = new DOMPoint(
					layout.width / 2,
					layout.height / 2,
				).matrixTransform(matrix);
				const expectedCenter = textCenter(shape);
				const angle = Math.atan2(matrix.b, matrix.a);
				const corners = [...group.querySelectorAll("text")].flatMap((text) => {
					const box = text.getBBox();
					return [
						new DOMPoint(box.x, box.y),
						new DOMPoint(box.x + box.width, box.y),
						new DOMPoint(box.x, box.y + box.height),
						new DOMPoint(box.x + box.width, box.y + box.height),
					].map((point) => point.matrixTransform(matrix));
				});
				return {
					angle,
					expectedAngle: shape.id % 2 === 0 ? -Math.PI / 2 : 0,
					center: [center.x, center.y],
					expectedCenter: [expectedCenter.x, -expectedCenter.y],
					anchor: group.getAttribute("text-anchor"),
					expectedAnchor: shape.horizontalAlign === "left" ? "start" : "end",
					fits: corners.every(
						(point) =>
							point.x >= view.x &&
							point.x <= view.x + view.width &&
							point.y >= view.y &&
							point.y <= view.y + view.height,
					),
					lines: group.querySelectorAll("text").length,
				};
			});
		} finally {
			root.remove();
		}
	});
	for (const result of results) {
		expect(result.angle).toBeCloseTo(result.expectedAngle, 4);
		expect(result.anchor).toBe(result.expectedAnchor);
		expect(result.center[0]).toBeCloseTo(result.expectedCenter[0], 3);
		expect(result.center[1]).toBeCloseTo(result.expectedCenter[1], 3);
		expect(result.lines).toBe(2);
		expect(result.fits).toBe(true);
	}
});
