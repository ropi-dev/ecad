import { toolbarButton } from "./toolbar";
import { expect, type Page, test } from "@playwright/test";

test.use({ viewport: { width: 1440, height: 900 } });

const committed = async (page: Page) =>
	JSON.parse((await page.locator("#editor-document").textContent())!);
const rendered = async (page: Page) =>
	JSON.parse((await page.locator("#editor-scene").textContent())!).shapes;

test.beforeEach(async ({ page }) => {
	await page.goto("/tests/browser/editor.html");
	await expect((await toolbarButton(page, "Rectangle"))).toBeEnabled();
	await page.getByRole("button", { name: "Snap to grid", exact: true }).click();
	await expect.poll(async () => {
		const scene = JSON.parse((await page.locator("#editor-scene").textContent()) || "{}");
		return scene.worksheet;
	}).toBe("A3, 420 × 297 mm");
});

test("draw and move previews leave the document untouched until pointer release", async ({ page }) => {
	const canvas = page.locator("canvas");
	const box = (await canvas.boundingBox())!;
	const x = box.x + box.width / 2;
	const y = box.y + box.height / 2;
	const empty = await committed(page);
	await (await toolbarButton(page, "Rectangle")).click();
	await page.mouse.move(x, y);
	await page.mouse.down();
	await page.mouse.move(x + 100, y + 60, { steps: 4 });
	await expect.poll(async () => (await rendered(page)).length).toBe(1);
	expect(await committed(page)).toEqual(empty);
	await page.mouse.up();
	await expect.poll(async () => (await committed(page)).historySize).toBe(2);
	const placed = await committed(page);
	expect(placed.shapes).toHaveLength(1);
	expect(placed.shapes[0].width).toBeGreaterThan(0);
	expect(placed.shapes[0].height).toBeGreaterThan(0);

	await page.mouse.move(x + 50, y + 30);
	await page.mouse.down();
	await page.mouse.move(x + 140, y + 100, { steps: 4 });
	await expect.poll(async () => (await rendered(page))[0].x).not.toBeCloseTo(placed.shapes[0].x, 3);
	expect(await committed(page)).toEqual(placed);
	await page.keyboard.press("Escape");
	await page.mouse.up();
	expect(await committed(page)).toEqual(placed);
	await expect.poll(async () => (await rendered(page))[0].x).toBeCloseTo(placed.shapes[0].x, 3);
});

test("an external Effect places exact geometry while the editor has another tool selected", async ({ page }) => {
	await (await toolbarButton(page, "Circle")).click();
	await page.evaluate(async () => {
		const fixturePath = "/tests/browser/editor.tsx";
		const { placeRectangle }: typeof import("./editor") = await import(fixturePath);
		placeRectangle({ x: 12.3, y: -4.7, width: 25, height: 14, rotation: 0, lineWidth: 0.4 });
	});
	await expect.poll(async () => (await rendered(page)).length).toBe(1);
	expect((await committed(page)).shapes[0]).toEqual({
		id: 1, kind: "rectangle", x: 12.3, y: -4.7, width: 25, height: 14, rotation: 0, lineWidth: 0.4,
	});
	await expect((await toolbarButton(page, "Circle"))).toHaveAttribute("aria-pressed", "true");
	await (await toolbarButton(page, "Undo")).click();
	await expect.poll(async () => (await rendered(page)).length).toBe(0);
	await (await toolbarButton(page, "Redo")).click();
	await expect.poll(async () => (await rendered(page)).length).toBe(1);
});

test("an external replacement cancels stale drag geometry before it can overwrite the command", async ({ page }) => {
	await page.evaluate(async () => {
		const fixturePath = "/tests/browser/editor.tsx";
		const { placeRectangle }: typeof import("./editor") = await import(fixturePath);
		placeRectangle({ x: 0, y: 0, width: 30, height: 20, rotation: 0, lineWidth: 0.2 });
	});
	await expect.poll(async () => (await rendered(page)).length).toBe(1);
	const box = (await page.locator("canvas").boundingBox())!;
	const x = box.x + box.width / 2;
	const y = box.y + box.height / 2;
	await page.mouse.move(x, y);
	await page.mouse.down();
	await page.mouse.move(x + 90, y + 70, { steps: 4 });
	await expect.poll(async () => (await rendered(page))[0].x).toBeGreaterThan(1);
	await page.evaluate(async () => {
		const fixturePath = "/tests/browser/editor.tsx";
		const { drawingStore, replaceShapes }: typeof import("./editor") = await import(fixturePath);
		replaceShapes([{ ...drawingStore.getSnapshot().shapes[0], x: -50, y: 40 }]);
	});
	await expect.poll(async () => (await rendered(page))[0].x).toBe(-50);
	await page.mouse.up();
	expect((await committed(page)).shapes[0]).toMatchObject({ x: -50, y: 40 });
	expect((await committed(page)).historySize).toBe(3);
});

for (const duringCommand of [false, true]) test(`external deletion ${duringCommand ? "during a command" : "between commands"} removes stale selection IDs`, async ({ page }) => {
	await page.evaluate(async () => {
		const fixturePath = "/tests/browser/editor.tsx";
		const { placeRectangle }: typeof import("./editor") = await import(fixturePath);
		for (const x of [-40, 40]) placeRectangle({ x, y: 0, width: 20, height: 20, rotation: 0, lineWidth: 0.2 });
	});
	await expect.poll(async () => (await rendered(page)).length).toBe(2);
	const box = (await page.locator("canvas").boundingBox())!;
	const scene = JSON.parse((await page.locator("#editor-scene").textContent())!);
	const offset = (scene.corner[0] - scene.origin[0]) * 40 / 420 * box.width / 2;
	const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
	await page.mouse.click(center.x - offset, center.y);
	await page.keyboard.down("Shift");
	await page.mouse.click(center.x + offset, center.y);
	await page.keyboard.up("Shift");
	await expect.poll(async () => (await rendered(page)).filter((shape: { selected: boolean }) => shape.selected).length).toBe(2);
	await page.evaluate(async (nested) => {
		const fixturePath = "/tests/browser/editor.tsx";
		const { drawingStore, removeShapes }: typeof import("./editor") = await import(fixturePath);
		if (nested) {
			const unsubscribe = drawingStore.subscribe(() => {
				unsubscribe();
				removeShapes([1]);
			});
		} else removeShapes([1]);
	}, duringCommand);
	await page.keyboard.press("ArrowRight");
	await expect.poll(async () => (await rendered(page)).length).toBe(1);
	await expect.poll(async () => (await committed(page)).shapes[0].x).toBe(41);
	await page.keyboard.press("ArrowRight");
	await expect.poll(async () => (await committed(page)).shapes[0].x).toBe(42);
	await expect(page.getByRole("alert")).toHaveCount(0);
});

test("a selection-only click does not replace the selection saved by the last edit", async ({ page }) => {
	const box = (await page.locator("canvas").boundingBox())!;
	const x = box.x + box.width / 2;
	const y = box.y + box.height / 2;
	for (const offset of [-180, 0]) {
		await (await toolbarButton(page, "Rectangle")).click();
		await page.mouse.move(x + offset, y);
		await page.mouse.down();
		await page.mouse.move(x + offset + 100, y + 60, { steps: 3 });
		await page.mouse.up();
	}
	await expect.poll(async () => (await committed(page)).historySize).toBe(3);
	await page.mouse.click(x - 130, y + 30);
	await (await toolbarButton(page, "Rectangle")).click();
	await page.mouse.move(x + 180, y);
	await page.mouse.down();
	await page.mouse.move(x + 280, y + 60, { steps: 3 });
	await page.mouse.up();
	await (await toolbarButton(page, "Undo")).click();
	await expect.poll(async () => (await rendered(page)).filter((shape: { selected: boolean }) => shape.selected).map((shape: { name: string }) => shape.name)).toEqual(["rectangle 2"]);
});
