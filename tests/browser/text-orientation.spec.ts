import { expect, test } from "@playwright/test";

test.use({ viewport: { width: 1440, height: 1000 } });

test("rotated schematic text renders upright while stored rotations stay unchanged", async ({ page }) => {
	await page.goto("/tests/browser/editor.html");
	await expect(page.getByRole("button", { name: "Symbols", exact: true })).toBeEnabled();
	await page.evaluate(async () => {
		const fixturePath = "/tests/browser/editor.tsx";
		const symbolsPath = "/packages/core/src/drawing/symbols.ts";
		const { placeRectangle, replaceShapes }: typeof import("./editor") = await import(fixturePath);
		const { createSymbol, symbolDefinitions }: typeof import("#/drawing/symbols.ts") = await import(symbolsPath);
		for (let index = 0; index < 5; index++) placeRectangle({ x: 0, y: 0, width: 10, height: 10, rotation: 0, lineWidth: 0.2 });
		const symbols = [0, 90, 180, 270].map((degrees, index) => {
			const symbol = createSymbol(index + 1, { ...symbolDefinitions[0], id: "orientation-fixture", library: undefined }, { x: -45 + index * 30, y: 10 });
			symbol.rotation = degrees * Math.PI / 180;
			symbol.children.push({
				id: 99, kind: "text", text: "SIGNAL", x: 0, y: -10,
				width: 10, height: 3, fontSize: 2, rotation: Math.PI / 4, lineWidth: 0.2,
			});
			return symbol;
		});
		replaceShapes([...symbols, {
			id: 5, kind: "text", text: "Supply voltage\n3.3 V", x: 0, y: -20,
			width: 30, height: 10, fontSize: 3, rotation: Math.PI, lineWidth: 0.2,
			horizontalAlign: "left", verticalAlign: "top",
		}]);
	});
	const scene = async () => JSON.parse((await page.locator("#editor-scene").textContent())!);
	await expect.poll(async () => (await scene()).symbolStaticTexts.length).toBe(4);
	const rendered = await scene();
	for (const label of rendered.symbolTexts) {
		const [left, right] = label.corners;
		const angle = Math.atan2(right[1] - left[1], right[0] - left[0]);
		expect(angle, label.name).toBeGreaterThan(-Math.PI / 2 - 1e-6);
		expect(angle, label.name).toBeLessThanOrEqual(Math.PI / 2 + 1e-6);
		const stored = JSON.parse((await page.locator("#editor-document").textContent())!).shapes[Number(label.symbol.split(" ")[1]) - 1];
		expect(Math.hypot(right[0] - left[0], right[1] - left[1])).toBeGreaterThan(0);
		expect(stored.rotation).toBeCloseTo((stored.id - 1) * Math.PI / 2);
	}
	for (const [index, text] of rendered.symbolStaticTexts.entries()) {
		expect(text.rotation).toBeCloseTo(index % 2 === 0 ? Math.PI / 4 : -Math.PI / 4);
	}
	expect(rendered.shapes.find((shape: { name: string }) => shape.name === "text 5").rotation).toBeCloseTo(0);
	for (const label of rendered.pinTexts) expect(label.rotation).toBeCloseTo(0);
	const saved = JSON.parse((await page.locator("#editor-document").textContent())!).shapes[4];
	expect(saved.rotation).toBeCloseTo(Math.PI);
	expect(saved.horizontalAlign).toBe("left");
	expect(saved.verticalAlign).toBe("top");
	await page.getByRole("button", { name: "Hide item hierarchy", exact: true }).click();
	for (let index = 0; index < 5; index++) await page.getByRole("button", { name: "Zoom in", exact: true }).click();
	await page.screenshot({ path: "perf-artifacts/upright-schematic-text.png" });
	await expect(page.getByRole("alert")).toHaveCount(0);
});
