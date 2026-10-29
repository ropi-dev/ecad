import { captureArtifacts } from "./artifacts";
import { expect, test } from "@playwright/test";
import { stableScreenshot } from "./stable-screenshot";

test.use({ viewport: { width: 1440, height: 1000 } });

test("a loaded circle keeps its fill when saved and rendered", async ({ page }) => {
	await page.goto("/tests/browser/editor.html");
	await expect(page.locator("canvas")).toBeVisible();
	const saved = await page.evaluate(async () => {
		const editorPath = "/tests/browser/editor.tsx";
		const formatPath = "/packages/core/src/components/editor/symbolFormat.ts";
		const shapesPath = "/packages/core/src/drawing/symbol-file.ts";
		const { placeRectangle, replaceShapes }: typeof import("./editor") = await import(editorPath);
		const { parseSymbolFile }: typeof import("#/components/editor/symbolFormat.ts") = await import(formatPath);
		const { symbolFileShapes, symbolFileWithShapes }: typeof import("#/drawing/symbol-file.ts") = await import(shapesPath);
		const file = parseSymbolFile(JSON.stringify({
			format: "ecad-symbol", version: 1, units: "mm", id: "custom.filled-circle", name: "Filled circle", description: "", prefix: "U", value: "",
			shapes: [{ kind: "circle", x: 0, y: 0, radius: 4, filled: true }],
		}));
		placeRectangle({ x: 0, y: 0, width: 1, height: 1, rotation: 0, lineWidth: 0.254 });
		const shapes = symbolFileShapes(file);
		replaceShapes(shapes);
		return symbolFileWithShapes(file, shapes);
	});
	expect(saved.shapes[0]).toMatchObject({ kind: "circle", filled: true });
	await expect.poll(async () => JSON.parse((await page.locator("#editor-document").textContent())!).shapes[0]).toMatchObject({ kind: "circle", filled: true });
	await expect.poll(async () => JSON.parse((await page.locator("#editor-scene").textContent())!).shapes.map((shape: { name: string }) => shape.name)).toContain("circle 1");
	for (let step = 0; step < 6; step++) await page.getByRole("button", { name: "Zoom in", exact: true }).click();
	await page.locator("canvas").focus();
	if (captureArtifacts) await stableScreenshot(() => page.screenshot({ path: test.info().outputPath("loaded-filled-circle.png") }));
});
