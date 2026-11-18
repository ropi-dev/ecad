import type { EditorShape } from "@ecad/drawing-core/drawing/shapes.ts";
import { expect, type Page, test } from "@playwright/test";
import { required } from "../helpers/required.ts";
import { drawingGridStep, drawingPoint } from "./symbol-items";

test.use({ viewport: { width: 1440, height: 900 } });
const documentState = async (page: Page): Promise<{ shapes: EditorShape[] }> =>
	JSON.parse(required(await page.locator("#editor-document").textContent()));

async function shapePoint(page: Page, id: number) {
	const center = await page.evaluate(async (id) => {
		const fixturePath = "/tests/browser/editor.tsx";
		const shapesPath = "/packages/drawing-core/src/drawing/shapes.ts";
		const { drawingStore } = await import(fixturePath);
		const { shapeBounds } = await import(shapesPath);
		const bounds = shapeBounds(
			drawingStore
				.getSnapshot()
				.shapes.find((shape: { id: number }) => shape.id === id),
		);
		return {
			x: (bounds.minX + bounds.maxX) / 2,
			y: (bounds.minY + bounds.maxY) / 2,
		};
	}, id);
	return { center, screen: await drawingPoint(page, center) };
}

async function altDrag(page: Page, id: number) {
	const { center, screen } = await shapePoint(page, id);
	const target = await drawingPoint(page, {
		x: center.x + 20,
		y: center.y - 20,
	});
	await page.keyboard.down("Alt");
	await page.mouse.move(screen.x, screen.y);
	await page.mouse.down();
	await page.mouse.move(target.x, target.y, { steps: 5 });
	await page.mouse.up();
	await page.keyboard.up("Alt");
}

test.beforeEach(async ({ page }) => {
	await page.goto("/tests/browser/editor.html");
	await expect(
		page.getByRole("button", { name: "Select", exact: true }),
	).toBeEnabled();
	await page.evaluate(async () => {
		const fixturePath = "/tests/browser/editor.tsx";
		const storePath = "/packages/drawing-core/src/commands/drawing-store.ts";
		const textPath = "/packages/core/src/components/editor/text.ts";
		const shapesPath = "/packages/drawing-core/src/drawing/shapes.ts";
		const { drawingStore } = await import(fixturePath);
		const { createDrawingStore } = await import(storePath);
		const { createTextShape, updateText } = await import(textPath);
		const { drawShape } = await import(shapesPath);
		const label = updateText(
			{
				...createTextShape(1, { x: -90, y: 30 }),
				electrical: "net",
				fontSize: 4,
				horizontalAlign: "left",
				verticalAlign: "bottom",
			},
			"SIGNAL",
		);
		const text = updateText(
			{ ...createTextShape(2, { x: -20, y: 30 }), fontSize: 4 },
			"Board notes",
		);
		const shapes = [
			label,
			text,
			drawShape(3, "wire", { x: -110, y: 30 }, { x: -90, y: 30 }),
		];
		drawingStore.transact(() => [
			undefined,
			createDrawingStore(shapes).getSnapshot(),
		]);
	});
});

test("Alt-drag copies net labels and text without moving originals or attached wires", async ({
	page,
}) => {
	for (const id of [1, 2]) {
		const before = await documentState(page);
		await altDrag(page, id);
		await expect
			.poll(async () => (await documentState(page)).shapes.length)
			.toBe(before.shapes.length + 1);
		const after = await documentState(page);
		expect(after.shapes.slice(0, -1)).toEqual(before.shapes);
		const source = required(before.shapes.find((shape) => shape.id === id));
		const copy = required(after.shapes.at(-1));
		expect(copy).toEqual({
			...source,
			id: before.shapes.length + 1,
			x: copy.x,
			y: copy.y,
		});
		const step = await drawingGridStep(page);
		expect(Math.abs(copy.x - (source.x + 20))).toBeLessThanOrEqual(step);
		expect(Math.abs(copy.y - (source.y - 20))).toBeLessThanOrEqual(step);
		if (id === 1)
			for (const coordinate of [copy.x, copy.y])
				expect(
					Math.abs(coordinate / step - Math.round(coordinate / step)),
				).toBeLessThan(1e-6);
	}
	const placed = await documentState(page);
	await page.keyboard.press("Control+z");
	await expect
		.poll(async () => (await documentState(page)).shapes)
		.toEqual(placed.shapes.slice(0, -1));
	await page.keyboard.press("Control+Shift+z");
	await expect
		.poll(async () => (await documentState(page)).shapes)
		.toEqual(placed.shapes);
});

test("Alt-drag on a selected item duplicates the whole selection with its layout", async ({
	page,
}) => {
	const canvas = page.locator("canvas");
	const bounds = required(await canvas.boundingBox());
	for (const [id, modifiers] of [
		[1, []],
		[3, ["Shift"]],
	] as const) {
		const { screen } = await shapePoint(page, id);
		await canvas.click({
			position: { x: screen.x - bounds.x, y: screen.y - bounds.y },
			modifiers: [...modifiers],
		});
	}
	const before = await documentState(page);
	await altDrag(page, 1);
	await expect
		.poll(async () => (await documentState(page)).shapes.length)
		.toBe(before.shapes.length + 2);
	const after = await documentState(page);
	expect(after.shapes.slice(0, before.shapes.length)).toEqual(before.shapes);
	const label = required(before.shapes.find((shape) => shape.id === 1));
	const wire = required(before.shapes.find((shape) => shape.id === 3));
	const [labelCopy, wireCopy] = after.shapes.slice(before.shapes.length);
	const delta = { x: labelCopy.x - label.x, y: labelCopy.y - label.y };
	const step = await drawingGridStep(page);
	expect(Math.abs(delta.x - 20)).toBeLessThanOrEqual(step);
	expect(Math.abs(delta.y + 20)).toBeLessThanOrEqual(step);
	expect(labelCopy).toEqual({
		...label,
		id: 4,
		x: labelCopy.x,
		y: labelCopy.y,
	});
	expect(wireCopy).toEqual({
		...wire,
		id: 5,
		x: expect.closeTo(wire.x + delta.x, 6),
		y: expect.closeTo(wire.y + delta.y, 6),
	});
	await page.keyboard.press("Control+z");
	await expect
		.poll(async () => (await documentState(page)).shapes)
		.toEqual(before.shapes);
});
