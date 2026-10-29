import { captureArtifacts } from "./artifacts";
import { toolbarButton } from "./toolbar";
import { expect, type Page, test } from "@playwright/test";

// Coordinate fixtures use a desktop viewport with a 10 mm grid at the fitted view.
test.use({ viewport: { width: 1440, height: 900 } });

interface State {
	pinTexts: { name: string; texture?: string; rotation: number }[];
	symbolTexts: {
		symbol: string;
		name: string;
		texture?: string;
		x: number;
		y: number;
	}[];
	outlines: { width: number; height: number }[];
	wireTerminals: { x: number; y: number; width: number; height: number }[];
	wireJunctions: { x: number; y: number; width: number; height: number }[];
	wireBridges: string[];
	textures: number;
	camera: string;
	direction: number[];
	origin: number[];
	corner: number[];
	preview: {
		x: number;
		y: number;
		width: number;
		height: number;
		rotation: number;
	} | null;
	shapes: {
		name: string;
		texture?: string;
		x: number;
		y: number;
		selected: boolean;
		width: number;
		height: number;
		rotation: number;
	}[];
}
const state = async (page: Page): Promise<State> =>
	JSON.parse((await page.locator("#editor-scene").textContent()) || "{}");
const nonPinState = async (page: Page): Promise<State> => {
	const view = await state(page);
	return {
		...view,
		shapes: view.shapes.filter((shape) => !shape.name.startsWith("pin ")),
	};
};
async function placePin(page: Page, x: number, y: number) {
	await (await toolbarButton(page, "Pin")).click();
	await clickAt(page, x, y);
}
const drawing = async (page: Page) =>
	(await state(page)).shapes.map(({ selected: _selected, ...shape }) => shape);
async function screen(page: Page, x: number, y: number) {
	const view = await state(page);
	const box = (await page.locator("canvas").boundingBox())!;
	return {
		x:
			box.x +
			((1 + view.origin[0] + ((view.corner[0] - view.origin[0]) * x) / 420) *
				box.width) /
				2,
		y:
			box.y +
			((1 - view.origin[1] - ((view.corner[1] - view.origin[1]) * y) / 297) *
				box.height) /
				2,
	};
}
async function clickAt(page: Page, x: number, y: number) {
	const point = await screen(page, x, y);
	await page.mouse.click(point.x, point.y);
}
async function moveAt(page: Page, x: number, y: number) {
	const point = await screen(page, x, y);
	await page.mouse.move(point.x, point.y);
}
async function dragTo(
	page: Page,
	from: [number, number],
	to: [number, number],
) {
	const start = await screen(page, ...from);
	const end = await screen(page, ...to);
	await page.mouse.move(start.x, start.y);
	await page.mouse.down();
	await page.mouse.move(end.x, end.y, { steps: 4 });
	await page.mouse.up();
}
async function createShape(page: Page, kind: string, x: number, y: number) {
	await (await toolbarButton(page, kind)).click();
	if (kind === "Circle") await dragTo(page, [x, y], [x + 15, y]);
	else if (kind === "Wire") {
		await placePin(page, x - 27.5, y);
		// Keep the attributes panel from covering the wire's far endpoint.
		await page
			.getByRole("button", { name: "Clear selection", exact: true })
			.click();
		await (await toolbarButton(page, "Wire")).click();
		await clickAt(page, x - 27.5, y);
		await clickAt(page, x + 27.5, y);
		await page.keyboard.press("Enter");
	} else {
		const [width, height] = kind === "Rectangle" ? [50, 30] : [40, 35];
		await dragTo(
			page,
			[x - width / 2, y - height / 2],
			[x + width / 2, y + height / 2],
		);
	}
}
test.beforeEach(async ({ page }) => {
	await page.goto("/tests/browser/editor.html");
	await expect(await toolbarButton(page, "Rectangle")).toBeEnabled();
	const snap = page.getByRole("button", { name: "Snap to grid", exact: true });
	await expect(snap).toHaveAttribute("aria-pressed", "true");
	// Free-placement fixtures opt out of the default; snapping tests enable it explicitly.
	await snap.click();
	await expect
		.poll(async () => (await state(page)).origin.slice(0, 2))
		.toEqual([0, 0]);
	// Keep the existing interaction fixtures' positive world coordinates in view.
	await page.getByRole("button", { name: "Pan", exact: true }).click();
	await dragTo(page, [0, 0], [-210, -148.5]);
	await page.getByRole("button", { name: "Select", exact: true }).click();
});

test("creates a symbol from multiple shapes and restores the selection with undo", async ({
	page,
}) => {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	await createShape(page, "Rectangle", 100, 150);
	await expect(
		page.getByRole("button", { name: "Create symbol", exact: true }),
	).toHaveCount(0);
	await createShape(page, "Circle", 160, 150);
	await createShape(page, "Triangle", 300, 150);
	await expect
		.poll(async () => (await state(page)).shapes[2]?.width)
		.toBeCloseTo(40, 5);
	const original = await drawing(page);
	await clickAt(page, 100, 150);
	await page.keyboard.down("Shift");
	await clickAt(page, 160, 150);
	await page.keyboard.up("Shift");
	const create = page.getByRole("button", {
		name: "Create symbol",
		exact: true,
	});
	await expect(create).toBeEnabled();
	await create.click();
	const dialog = page.getByRole("dialog", {
		name: "Create symbol",
		exact: true,
	});
	await expect(
		dialog.getByRole("button", { name: "Create symbol", exact: true }),
	).toBeDisabled();
	await dialog
		.getByRole("textbox", { name: "Symbol name", exact: true })
		.fill("Input connector");
	await dialog
		.getByRole("button", { name: "Create symbol", exact: true })
		.click();
	await expect.poll(() => selectedNames(page)).toEqual(["symbol 4"]);
	await expect(
		page.getByRole("textbox", { name: "Name", exact: true }),
	).toHaveValue("Input connector");
	await expect(
		page.getByRole("textbox", { name: "Reference", exact: true }),
	).toHaveValue("U4");
	await expect(create).toHaveCount(0);
	await expect.poll(async () => (await state(page)).shapes.length).toBe(2);
	await page
		.getByRole("textbox", { name: "Name", exact: true })
		.fill("Renamed connector");
	await expect(
		page.getByRole("textbox", { name: "Name", exact: true }),
	).toHaveValue("Renamed connector");
	await page.getByRole("textbox", { name: "Name", exact: true }).blur();
	await (await toolbarButton(page, "Undo")).click();
	await expect(
		page.getByRole("textbox", { name: "Name", exact: true }),
	).toHaveValue("Input connector");
	await (await toolbarButton(page, "Undo")).click();
	await expect.poll(() => drawing(page)).toEqual(original);
	await expect
		.poll(() => selectedNames(page))
		.toEqual(["rectangle 1", "circle 2"]);
	await expect(create).toBeEnabled();
	await (await toolbarButton(page, "Redo")).click();
	await expect.poll(() => selectedNames(page)).toEqual(["symbol 4"]);
	const beforeMove = (await state(page)).shapes;
	await page.locator("canvas").focus();
	await page.keyboard.press("ArrowRight");
	await expect
		.poll(async () => (await state(page)).shapes[0].x)
		.toBeCloseTo(beforeMove[0].x + 1, 5);
	expect((await state(page)).shapes[1]).toEqual(beforeMove[1]);
	await page.keyboard.press("Delete");
	await expect
		.poll(async () => (await state(page)).shapes.map((shape) => shape.name))
		.toEqual(["triangle 3"]);
	expect(errors).toEqual([]);
});

test("draws every shape, moves beyond A3 without panning, and deletes", async ({
	page,
}) => {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	const before = await nonPinState(page);
	for (const [index, kind] of [
		"Rectangle",
		"Circle",
		"Triangle",
		"Wire",
	].entries()) {
		await createShape(page, kind, 70 + index * 85, 150);
		await expect
			.poll(async () => (await nonPinState(page)).shapes.length)
			.toBe(index + 1);
	}
	await dragTo(page, [70, 150], [100, 180]);
	await expect
		.poll(async () => (await nonPinState(page)).shapes[0].x)
		.toBeCloseTo(100, 1);
	expect((await nonPinState(page)).shapes[0].y).toBeCloseTo(180, 1);
	expect((await nonPinState(page)).origin).toEqual(before.origin);
	await dragTo(page, [100, 180], [-30, 330]);
	await expect
		.poll(async () => (await nonPinState(page)).shapes[0].x)
		.toBeCloseTo(-30, 4);
	expect((await nonPinState(page)).shapes[0].y).toBeCloseTo(330, 4);
	await page.keyboard.press("ArrowRight");
	await page.keyboard.press("Shift+ArrowDown");
	await expect
		.poll(async () => (await nonPinState(page)).shapes[0].x)
		.toBeCloseTo(-29, 4);
	await expect
		.poll(async () => (await nonPinState(page)).shapes[0].y)
		.toBeCloseTo(320, 4);
	await page.keyboard.press("Delete");
	await expect
		.poll(async () => (await nonPinState(page)).shapes.length)
		.toBe(3);
	await (await toolbarButton(page, "Rectangle")).click();
	await clickAt(page, -25, 150);
	expect((await nonPinState(page)).shapes.length).toBe(3);
	expect(errors).toEqual([]);
});

const selectedNames = async (page: Page) =>
	(await state(page)).shapes
		.filter((shape) => shape.selected)
		.map((shape) => shape.name);

test("wire clicks commit orthogonal segments and pointer release keeps the preview", async ({
	page,
}) => {
	await placePin(page, 100, 100);
	await (await toolbarButton(page, "Wire")).click();
	await dragTo(page, [100, 100], [160, 120]);
	await expect
		.poll(async () => (await nonPinState(page)).preview?.width)
		.toBeCloseTo(60, 4);
	let view = await nonPinState(page);
	expect(view.shapes).toEqual([]);
	expect(view.preview?.x).toBeCloseTo(130, 4);
	expect(view.preview?.y).toBeCloseTo(100, 4);
	expect(view.preview?.rotation).toBeCloseTo(0, 4);
	await clickAt(page, 160, 120);
	await expect
		.poll(async () => (await nonPinState(page)).shapes.length)
		.toBe(1);
	await expect(await toolbarButton(page, "Wire")).toHaveAttribute(
		"aria-pressed",
		"true",
	);
	await moveAt(page, 172, 165);
	await expect
		.poll(async () => (await nonPinState(page)).preview?.width)
		.toBeCloseTo(65, 4);
	view = await nonPinState(page);
	expect(view.shapes).toHaveLength(1);
	expect(view.preview?.x).toBeCloseTo(160, 4);
	expect(view.preview?.y).toBeCloseTo(132.5, 4);
	expect(view.preview?.rotation).toBeCloseTo(Math.PI / 2, 4);
	await clickAt(page, 172, 165);
	await clickAt(page, 105, 174);
	await expect
		.poll(async () => (await nonPinState(page)).shapes.length)
		.toBe(3);
	view = await nonPinState(page);
	expect(view.shapes.map((shape) => shape.name)).toEqual([
		"wire 2",
		"wire 3",
		"wire 4",
	]);
	const [first, second, third] = view.shapes;
	expect(first.x).toBeCloseTo(130, 4);
	expect(first.y).toBeCloseTo(100, 4);
	expect(first.width).toBeCloseTo(60, 4);
	expect(first.rotation).toBeCloseTo(0, 4);
	expect(second.x).toBeCloseTo(160, 4);
	expect(second.y).toBeCloseTo(132.5, 4);
	expect(second.width).toBeCloseTo(65, 4);
	expect(second.rotation).toBeCloseTo(Math.PI / 2, 4);
	expect(third.x).toBeCloseTo(132.5, 4);
	expect(third.y).toBeCloseTo(165, 4);
	expect(third.width).toBeCloseTo(55, 4);
	expect(Math.abs(third.rotation)).toBeCloseTo(Math.PI, 4);
	await moveAt(page, 115, 210);
	await expect
		.poll(async () => (await nonPinState(page)).preview?.width)
		.toBeCloseTo(45, 4);
	if (captureArtifacts)
		await page.screenshot({
			path: test.info().outputPath("drawing-line-chain.png"),
		});
	await clickAt(page, 105, 165);
	await clickAt(page, 105, 165);
	await expect
		.poll(async () => (await nonPinState(page)).shapes.length)
		.toBe(3);
	await page.keyboard.press("Escape");
	await expect.poll(async () => (await nonPinState(page)).preview).toBeNull();
});

// DOM handle positions are rounded to CSS subpixels, so resize assertions allow 0.05 mm.
async function dragHandle(page: Page, handle: string, to: [number, number]) {
	const box = (await page
		.locator(`[data-testid="resize-handle"][data-handle="${handle}"]`)
		.last()
		.boundingBox())!;
	const end = await screen(page, ...to);
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	await page.mouse.down();
	await page.mouse.move(end.x, end.y, { steps: 4 });
	await page.mouse.up();
}

async function openHistory(page: Page) {
	const panel = page.getByRole("region", {
		name: "Drawing history",
		exact: true,
	});
	if (!(await panel.isVisible()))
		await (await toolbarButton(page, "History")).click();
	await expect(panel).toBeVisible();
	return panel;
}

async function expectHistoryCount(page: Page, count: number) {
	const history = await openHistory(page);
	await expect(history.getByRole("button", { name: /^Restore #/ })).toHaveCount(
		count,
	);
}

test("history records each completed drawing gesture once and undo and redo restore every edit", async ({
	page,
}) => {
	await openHistory(page);

	await expectHistoryCount(page, 1);
	await expect(await toolbarButton(page, "Undo")).toBeDisabled();
	await expect(await toolbarButton(page, "Redo")).toBeDisabled();
	await createShape(page, "Rectangle", 150, 100);
	await expectHistoryCount(page, 2);
	await expect
		.poll(async () => (await state(page)).shapes[0]?.x)
		.toBeCloseTo(150, 4);
	const created = await drawing(page);
	await dragTo(page, [150, 100], [180, 120]);
	await expectHistoryCount(page, 3);
	await expect
		.poll(async () => (await state(page)).shapes[0]?.x)
		.toBeCloseTo(180, 4);
	const moved = await drawing(page);
	await dragHandle(page, "1,1", [230, 170]);
	await expectHistoryCount(page, 4);
	await expect
		.poll(async () => (await state(page)).shapes[0]?.width)
		.toBeCloseTo(75, 1);
	const resized = await drawing(page);
	await page.locator("canvas").focus();
	await page.keyboard.press("ArrowRight");
	await expect
		.poll(async () => (await state(page)).shapes[0]?.x)
		.toBeCloseTo(resized[0].x + 1, 4);
	await expectHistoryCount(page, 5);
	const nudged = await drawing(page);
	await page.locator("canvas").focus();
	await page.keyboard.press("Delete");
	await expectHistoryCount(page, 6);
	await expect.poll(() => drawing(page)).toEqual([]);
	await (await toolbarButton(page, "Undo")).click();
	await expect.poll(() => drawing(page)).toEqual(nudged);
	await page.locator("canvas").focus();
	await page.keyboard.press("Control+z");
	await expect.poll(() => drawing(page)).toEqual(resized);
	await page.keyboard.press("Control+z");
	await expect.poll(() => drawing(page)).toEqual(moved);
	await page.keyboard.press("Control+z");
	await expect.poll(() => drawing(page)).toEqual(created);
	await page.keyboard.press("Control+z");
	await expect.poll(() => drawing(page)).toEqual([]);
	await expect(await toolbarButton(page, "Undo")).toBeDisabled();
	await page.keyboard.press("Control+Shift+z");
	await expect.poll(() => drawing(page)).toEqual(created);
	await page.keyboard.press("Control+y");
	await expect.poll(() => drawing(page)).toEqual(moved);
	await (await toolbarButton(page, "Redo")).click();
	await expect.poll(() => drawing(page)).toEqual(resized);
	await (await toolbarButton(page, "Redo")).click();
	await expect.poll(() => drawing(page)).toEqual(nudged);
	await (await toolbarButton(page, "Redo")).click();
	await expect.poll(() => drawing(page)).toEqual([]);
	await expect(await toolbarButton(page, "Redo")).toBeDisabled();
	await expectHistoryCount(page, 6);
});

test("text tool places editable multiline text and preserves glyphs through history", async ({
	page,
}) => {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	const baselineTextures = (await state(page)).textures;
	await (await toolbarButton(page, "Text")).click();
	await clickAt(page, 150, 150);
	const content = page.getByRole("textbox", { name: "Text content" });
	await expect(content).toBeFocused();
	await expect(content).toHaveValue("Text");
	await expect(
		page.getByRole("button", { name: "Select", exact: true }),
	).toHaveAttribute("aria-pressed", "true");
	await expect(
		page.getByRole("spinbutton", { name: "Line width", exact: true }),
	).toHaveCount(0);
	await expect
		.poll(async () => (await state(page)).textures)
		.toBe(baselineTextures + 1);
	await content.fill("Board label\nÁrvíz 12Ω");
	await expect(content).toBeFocused();
	await content.blur();
	await expect
		.poll(async () => (await state(page)).shapes[0].height)
		.toBeCloseTo(13.75, 4);
	const original = (await state(page)).shapes[0];
	await page
		.getByRole("spinbutton", { name: "Font size", exact: true })
		.fill("10");
	await page.getByRole("spinbutton", { name: "Font size", exact: true }).blur();
	await expect
		.poll(async () => (await state(page)).shapes[0].height)
		.toBe(27.5);
	expect((await state(page)).shapes[0].texture).toBe(original.texture);
	await content.fill("Another label\nÁrvíz 12Ω");
	await content.blur();
	await expect
		.poll(async () => (await state(page)).shapes[0].texture)
		.not.toBe(original.texture);
	await expect
		.poll(async () => (await state(page)).textures)
		.toBe(baselineTextures + 1);
	await (await toolbarButton(page, "Undo")).click();
	await expect(content).toHaveValue("Board label\nÁrvíz 12Ω");
	await (await toolbarButton(page, "Redo")).click();
	await expect(content).toHaveValue("Another label\nÁrvíz 12Ω");
	await page
		.getByRole("button", { name: "Clear selection", exact: true })
		.click();
	if (captureArtifacts)
		await page.screenshot({ path: test.info().outputPath("text-label.png") });
	await clickAt(page, 150, 150);
	await page.getByRole("button", { name: "Delete", exact: true }).click();
	await expect.poll(async () => (await state(page)).shapes.length).toBe(0);
	await expect
		.poll(async () => (await state(page)).textures)
		.toBe(baselineTextures);
	await (await toolbarButton(page, "Undo")).click();
	await expect(content).toHaveValue("Another label\nÁrvíz 12Ω");
	await expect
		.poll(async () => (await state(page)).textures)
		.toBe(baselineTextures + 1);
	expect(errors).toEqual([]);
});
