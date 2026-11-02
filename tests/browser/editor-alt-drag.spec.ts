import { expect, test, type Page } from "@playwright/test";
import { snapPoint, type EditorShape } from "#/drawing/shapes.ts";
import { drawingGridStep, drawingPoint } from "./symbol-items";

test.use({ viewport: { width: 1440, height: 900 } });
const documentState = async (
	page: Page,
): Promise<{ shapes: EditorShape[]; historyId: number; historySize: number }> =>
	JSON.parse((await page.locator("#editor-document").textContent())!);

async function shapePoint(page: Page, id: number) {
	const center = await page.evaluate(async (id) => {
		const fixturePath = "/tests/browser/editor.tsx";
		const shapesPath = "/packages/core/src/drawing/shapes.ts";
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
		const storePath = "/packages/core/src/commands/drawing-store.ts";
		const textPath = "/packages/core/src/components/editor/text.ts";
		const shapesPath = "/packages/core/src/drawing/shapes.ts";
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
		expect(after.historySize).toBe(before.historySize + 1);
		const source = before.shapes.find((shape) => shape.id === id)!;
		expect(after.shapes.at(-1)).toEqual({
			...source,
			id: before.shapes.length + 1,
			...snapPoint({ x: source.x + 20, y: source.y - 20 }, (await drawingGridStep(page)) / (id === 1 ? 1 : 10)),
		});
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

test("Alt-drag copies topmost text instead of a symbol behind it", async ({
	page,
}) => {
	await page.evaluate(async () => {
		const fixturePath = "/tests/browser/editor.tsx";
		const storePath = "/packages/core/src/commands/drawing-store.ts";
		const symbolsPath = "/packages/core/src/drawing/symbols.ts";
		const { drawingStore } = await import(fixturePath);
		const { createDrawingStore } = await import(storePath);
		const { createSymbol, symbolDefinitions } = await import(symbolsPath);
		const shapes = drawingStore.getSnapshot().shapes;
		drawingStore.transact(() => [
			undefined,
			createDrawingStore([
				...shapes,
				createSymbol(4, symbolDefinitions[0], { x: 0, y: -60 }),
				{ ...shapes[1], id: 5, x: 0, y: -60 },
			]).getSnapshot(),
		]);
	});
	const before = await documentState(page);
	await altDrag(page, 5);
	await expect
		.poll(async () => (await documentState(page)).shapes.length)
		.toBe(6);
	const after = await documentState(page);
	expect(after.shapes.slice(0, 5)).toEqual(before.shapes);
	expect(after.shapes[5]).toMatchObject({
		kind: "text",
		text: "Board notes",
		...snapPoint({ x: 20, y: -80 }, (await drawingGridStep(page)) / 10),
	});
});
