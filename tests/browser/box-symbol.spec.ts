import { captureArtifacts } from "./artifacts";
import { expect, type Page, test } from "@playwright/test";
import { symbolChildren, type EditorSymbol } from "#/drawing/shapes.ts";
import {
	drawingPoint,
	selectDrawingShape,
	selectSymbolItem,
} from "./symbol-items";
import { closeProjectFiles, openProjectFiles } from "./project-files";
import { toolbarButton } from "./toolbar";

test.use({ viewport: { width: 1440, height: 1000 } });

const state = async (page: Page) =>
	JSON.parse((await page.locator("#project-document").textContent())!) as {
		shapes: EditorSymbol[];
		dirty: boolean;
	};

async function number(page: Page, name: string, value: string) {
	const input = page.getByRole("spinbutton", { name, exact: true });
	await input.fill(value);
	await input.press("Tab");
}

test("Box resizes, styles and edits text independently, then survives saving and reloading", async ({
	page,
}) => {
	await page.goto("/tests/browser/projects.html");
	await closeProjectFiles(page);
	await expect(page.getByRole("heading", { name: "Ready when you are", exact: true })).toBeVisible();
	await expect(page.getByLabel("Project save status")).toHaveText("Saved");
	await (await openProjectFiles(page))
		.getByRole("link", { name: "Schematic editor", exact: true })
		.click();
	for (const x of [0.4, 0.65]) {
		await page.getByRole("button", { name: "Symbols", exact: true }).click();
		await page.getByRole("searchbox", { name: "Search symbols" }).fill("box");
		await page.getByRole("button", { name: "Insert Box", exact: true }).click();
		const bounds = (await page.locator("canvas").boundingBox())!;
		await page
			.locator("canvas")
			.click({ position: { x: bounds.width * x, y: bounds.height / 2 } });
	}
	const original = (await state(page)).shapes;
	const originalBody = symbolChildren(original[0])[0].shape;
	expect(original[0].width).toBe(originalBody.width);
	expect(original[0].height).toBe(originalBody.height);
	expect(originalBody.x - originalBody.width / 2).toBe(0);
	expect(originalBody.y + originalBody.height / 2).toBe(0);
	const selectParent = () => selectDrawingShape(page, 1);
	await selectParent();
	const rectangle = page.getByTestId("symbol-child-selection");
	await expect(rectangle).toHaveCount(0);
	await selectParent();
	await expect(rectangle).toHaveCount(0);
	await expect(page.getByTestId("symbol-child-selection")).toHaveCount(0);
	await selectParent();
	await expect(page.getByTestId("resize-handle")).toHaveCount(8);
	const origin = await drawingPoint(page, original[0]);
	const topLeft = (await page
		.locator('[data-testid="resize-handle"][data-handle="-1,1"]')
		.boundingBox())!;
	expect(topLeft.x + topLeft.width / 2).toBeCloseTo(origin.x, 0);
	expect(topLeft.y + topLeft.height / 2).toBeCloseTo(origin.y, 0);
	await expect(
		page.getByRole("checkbox", { name: "Locked", exact: true }),
	).not.toBeChecked();
	const handle = page.locator(
		'[data-testid="resize-handle"][data-handle="1,-1"]',
	);
	const bounds = (await handle.boundingBox())!;
	const start = {
		x: bounds.x + bounds.width / 2,
		y: bounds.y + bounds.height / 2,
	};
	await page.mouse.move(start.x, start.y);
	await page.mouse.down();
	await page.mouse.move(start.x + 45, start.y + 30, { steps: 5 });
	await page.mouse.up();
	await expect
		.poll(
			async () => symbolChildren((await state(page)).shapes[0])[0].shape.width,
		)
		.toBeGreaterThan(20);
	const resized = (await state(page)).shapes;
	const resizedBody = symbolChildren(resized[0])[0].shape;
	expect(resized[0].width).toBe(resizedBody.width);
	expect(resized[0].height).toBe(resizedBody.height);
	expect(resizedBody.x - resizedBody.width / 2).toBeCloseTo(0);
	expect(resizedBody.y + resizedBody.height / 2).toBeCloseTo(0);
	expect(resized[0].x).toBe(original[0].x);
	expect(resized[0].y).toBe(original[0].y);
	expect(resized[1]).toEqual(original[1]);
	expect(symbolChildren(resized[0])[1]).toEqual(symbolChildren(original[0])[1]);
	await (await toolbarButton(page, "Undo")).click();
	expect((await state(page)).shapes).toEqual(original);
	await (await toolbarButton(page, "Redo")).click();
	expect((await state(page)).shapes).toEqual(resized);
	await selectParent();
	const cancelBounds = (await handle.boundingBox())!;
	await page.mouse.move(cancelBounds.x + 5, cancelBounds.y + 5);
	await page.mouse.down();
	await page.mouse.move(cancelBounds.x + 30, cancelBounds.y - 30, { steps: 3 });
	await page.keyboard.press("Escape");
	await page.mouse.up();
	expect((await state(page)).shapes).toEqual(resized);
	await selectParent();
	await number(page, "Width", "32");
	await number(page, "Height", "18");
	await number(page, "Line width", "0.6");
	await page
		.getByRole("combobox", { name: "Line style", exact: true })
		.selectOption("dashed");
	if (captureArtifacts)
		await page.screenshot({ path: test.info().outputPath("box-border.png") });
	await selectSymbolItem(page, "shape:2");
	const text = page.getByRole("textbox", { name: "Text content", exact: true });
	await text.fill("Power supply\n3.3 V");
	await text.press("Tab");
	await number(page, "Width", "28");
	await number(page, "Height", "14");
	await number(page, "Font size", "2");
	await page
		.getByRole("combobox", { name: "Text horizontal alignment", exact: true })
		.selectOption("left");
	const edited = (await state(page)).shapes;
	expect(edited[1]).toEqual(original[1]);
	await expect.poll(async () => (await state(page)).dirty).toBe(false);
	await page.reload();
	await expect.poll(async () => (await state(page)).shapes.length).toBe(2);
	await (await openProjectFiles(page))
		.getByRole("link", { name: "Schematic editor", exact: true })
		.click();
	expect(
		(await state(page)).shapes.map((shape) => shape.childOverrides),
	).toEqual(edited.map((shape) => shape.childOverrides));
	await selectParent();
	await expect(
		page.getByRole("spinbutton", { name: "Width", exact: true }),
	).toHaveValue("32");
	await expect(
		page.getByRole("combobox", { name: "Line style", exact: true }),
	).toHaveValue("dashed");
	await expect(
		page.getByRole("spinbutton", { name: "Line width", exact: true }),
	).toHaveValue("0.6");
	await selectParent();
	await number(page, "Center X", "0");
	await number(page, "Center Y", "0");
	await selectParent();
	for (let i = 0; i < 3; i++)
		await page.getByRole("button", { name: "Zoom in", exact: true }).click();
	await page.evaluate(
		() =>
			new Promise<void>((resolve) =>
				requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
			),
	);
	if (captureArtifacts)
		await page.screenshot({ path: test.info().outputPath("box-symbol.png") });
	await selectSymbolItem(page, "shape:2");
	await expect(text).toHaveValue("Power supply\n3.3 V");
	await expect(
		page.getByRole("spinbutton", { name: "Font size", exact: true }),
	).toHaveValue("2");
	if (captureArtifacts)
		await page.screenshot({ path: test.info().outputPath("box-text.png") });
	await expect(page.getByRole("alert")).toHaveCount(0);
});
