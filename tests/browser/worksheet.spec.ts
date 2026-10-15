import { toolbarButton } from "./toolbar";
import { expect, test } from "@playwright/test";
import type { BufferGeometry, Material, Mesh, MeshBasicMaterial, Texture } from "three";
import type { EditorShape } from "#/drawing/shapes.ts";

test("changing sheet dimensions keeps drawn shapes and updates the worksheet", async ({ page }) => {
	await page.setViewportSize({ width: 1440, height: 1000 });
	await page.goto("/tests/browser/editor.html");
	const scene = async () => JSON.parse((await page.locator("#editor-scene").textContent()) || '{"shapes":[]}');
	await expect.poll(async () => (await scene()).worksheet).toBe("A3, 420 × 297 mm");
	await (await toolbarButton(page, "Rectangle")).click();
	const canvas = page.locator("canvas");
	const bounds = (await canvas.boundingBox())!;
	await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
	await page.mouse.down();
	await page.mouse.move(bounds.x + bounds.width / 2 + 80, bounds.y + bounds.height / 2 + 50, { steps: 5 });
	await page.mouse.up();
	const shapes = async () => (await scene()).shapes;
	const documentState = async () => JSON.parse((await page.locator("#editor-document").textContent()) || '{"shapes":[]}');
	await expect.poll(async () => (await documentState()).shapes.length).toBe(1);
	const originalDocument = await documentState();
	const original = originalDocument.shapes.map(({ id, kind, width, height, rotation, x, y }: EditorShape) => ({
		name: `${kind} ${id}`, width, height, rotation, x, y, selected: true,
	}));
	// A preview already has one mesh. Wait for the committed geometry to render.
	await expect.poll(shapes).toEqual(original);
	for (const size of [
		{ width: 210, height: 297, name: "A4" },
		{ width: 600, height: 180, name: "Custom" },
		{ width: 420, height: 297, name: "A3" },
	]) {
		await page.evaluate((sheet) => {
			window.dispatchEvent(new CustomEvent("editor-sheet-size", { detail: sheet }));
		}, size);
		await expect(page.getByRole("heading", { level: 1 })).toContainText(`${size.width} × ${size.height} mm`);
		await expect.poll(async () => (await scene()).worksheet).toBe(`${size.name}, ${size.width} × ${size.height} mm`);
		await expect((await toolbarButton(page, "Rectangle"))).toBeEnabled();
		await canvas.focus();
		await page.keyboard.press("F6");
		await expect.poll(shapes).toEqual(original);
		expect(await documentState()).toEqual(originalDocument);
		await page.screenshot({ path: test.info().outputPath(`worksheet-${size.name}.png`) });
	}
});

test("worksheet fits portrait, landscape, small and extreme custom sizes", async ({ page }) => {
	await page.goto("/tests/browser/editor.html");
	const results = await page.evaluate(async () => {
		const worksheetPath = "/packages/core/src/components/editor/worksheet.ts";
		const { createWorksheet }: typeof import("#/components/editor/worksheet.ts") = await import(worksheetPath);
		const threePath = "/node_modules/three/build/three.module.js";
		const { Box3 }: typeof import("three") = await import(threePath);
		return [
			{ width: 420, height: 297, name: "A3" },
			{ width: 210, height: 297, name: "A4" },
			{ width: 83, height: 51 },
			{ width: 1, height: 1 },
			{ width: 1000, height: 25 },
			{ width: 25, height: 1000 },
			{ width: 5000, height: 5000 },
		].map((sheet) => {
			const worksheet = createWorksheet(sheet);
			try {
				worksheet.paper.updateMatrixWorld(true);
				const bounds = new Box3().setFromObject(worksheet.paper);
				return {
					sheet,
					min: bounds.min.toArray(),
					max: bounds.max.toArray(),
					labels: worksheet.paper.children.filter((child) => (child as Mesh).isMesh).map((child) => child.name),
				};
			} finally {
				worksheet.dispose();
			}
		});
	});
	for (const { sheet, min, max, labels } of results) {
		expect(min[0]).toBeCloseTo(-sheet.width / 2, 4);
		expect(min[1]).toBeCloseTo(-sheet.height / 2, 4);
		expect(max[0]).toBeCloseTo(sheet.width / 2, 4);
		expect(max[1]).toBeCloseTo(sheet.height / 2, 4);
		expect(labels).toContain(`Worksheet: Size: ${sheet.name || `${sheet.width} × ${sheet.height} mm`}`);
		expect(labels.filter((label) => label === "Worksheet: 1")).toHaveLength(2);
		expect(labels.filter((label) => label === "Worksheet: A")).toHaveLength(2);
	}
	expect(results.at(-1)!.labels).toContain("Worksheet: AA");
});

test("worksheet rejects invalid sizes and releases shared rendering resources once", async ({ page }) => {
	await page.goto("/tests/browser/editor.html");
	const result = await page.evaluate(async () => {
		const worksheetPath = "/packages/core/src/components/editor/worksheet.ts";
		const { createWorksheet }: typeof import("#/components/editor/worksheet.ts") = await import(worksheetPath);
		const invalid = [0, -1, NaN, Infinity].every((value) => {
			return [
				{ width: value, height: 297 },
				{ width: 420, height: value },
			].every((size) => {
				try { createWorksheet(size); return false; }
				catch (error) { return error instanceof RangeError; }
			});
		});
		const worksheet = createWorksheet();
		const resources = new Set<BufferGeometry | Material | Texture>();
		worksheet.paper.traverse((part) => {
			const object = part as Mesh<BufferGeometry, MeshBasicMaterial>;
			if (object.geometry) resources.add(object.geometry);
			if (object.material) {
				resources.add(object.material);
				if (object.material.map) resources.add(object.material.map);
			}
		});
		let disposals = 0;
		for (const resource of resources) resource.addEventListener("dispose", () => disposals++);
		worksheet.dispose();
		worksheet.dispose();
		return { invalid, disposals, resources: resources.size };
	});
	expect(result.invalid).toBe(true);
	expect(result.disposals).toBe(result.resources);
});
