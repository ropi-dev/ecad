import { toolbarButton, toolbarTooltip } from "./toolbar";
import { expect, type Page, test } from "@playwright/test";

// Coordinate fixtures use a desktop viewport with a 10 mm grid at the fitted view.
test.use({ viewport: { width: 1440, height: 900 } });

interface State {
	pinTexts: { name: string; texture?: string; rotation: number }[];
	symbolTexts: { symbol: string; name: string; texture?: string; x: number; y: number }[];
	outlines: { width: number; height: number }[];
	wireTerminals: { x: number; y: number; width: number; height: number }[];
	wireJunctions: { x: number; y: number; width: number; height: number }[];
	wireBridges: string[];
	textures: number;
	camera: string;
	direction: number[];
	origin: number[];
	corner: number[];
	preview: { x: number; y: number; width: number; height: number; rotation: number } | null;
	shapes: { name: string; texture?: string; x: number; y: number; selected: boolean; width: number; height: number; rotation: number }[];
}
const state = async (page: Page): Promise<State> => JSON.parse(await page.locator("#editor-scene").textContent() || "{}");
const nonPinState = async (page: Page): Promise<State> => {
 const view = await state(page);
 return { ...view, shapes: view.shapes.filter((shape) => !shape.name.startsWith("pin ")) };
};
async function placePin(page: Page, x: number, y: number) {
 await (await toolbarButton(page, "Pin")).click();
 await clickAt(page, x, y);
}
const drawing = async (page: Page) => (await state(page)).shapes.map(({ selected: _selected, ...shape }) => shape);
const wireEndpoints = async (page: Page) => (await state(page)).shapes.filter((shape) => shape.name.startsWith("wire ")).map((shape) => {
	const dx = Math.cos(shape.rotation) * shape.width / 2;
	const dy = Math.sin(shape.rotation) * shape.width / 2;
	return [shape.x - dx, shape.y - dy, shape.x + dx, shape.y + dy].map((value) => Number(value.toFixed(4)));
});
async function screen(page: Page, x: number, y: number) {
	const view = await state(page);
	const box = (await page.locator("canvas").boundingBox())!;
	return {
		x: box.x + (1 + view.origin[0] + (view.corner[0] - view.origin[0]) * x / 420) * box.width / 2,
		y: box.y + (1 - view.origin[1] - (view.corner[1] - view.origin[1]) * y / 297) * box.height / 2,
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
async function dragTo(page: Page, from: [number, number], to: [number, number]) {
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
		await page.getByRole("button", { name: "Clear selection", exact: true }).click();
		await (await toolbarButton(page, "Wire")).click();
		await clickAt(page, x - 27.5, y);
		await clickAt(page, x + 27.5, y);
		await page.keyboard.press("Enter");
	} else {
		const [width, height] = kind === "Rectangle" ? [50, 30] : [40, 35];
		await dragTo(page, [x - width / 2, y - height / 2], [x + width / 2, y + height / 2]);
	}
}
async function createWireChain(page: Page, points: [number, number][]) {
	await placePin(page, ...points[0]);
	await (await toolbarButton(page, "Wire")).click();
	for (const point of points) await clickAt(page, ...point);
	await page.keyboard.press("Enter");
}
test.beforeEach(async ({ page }) => {
	await page.goto("/tests/browser/editor.html");
	await expect((await toolbarButton(page, "Rectangle"))).toBeEnabled();
	const snap = page.getByRole("button", { name: "Snap to grid", exact: true });
	await expect(snap).toHaveAttribute("aria-pressed", "true");
	// Free-placement fixtures opt out of the default; snapping tests enable it explicitly.
	await snap.click();
	await expect.poll(async () => (await state(page)).origin.slice(0, 2)).toEqual([0, 0]);
	// Keep the existing interaction fixtures' positive world coordinates in view.
	await page.getByRole("button", { name: "Pan", exact: true }).click();
	await dragTo(page, [0, 0], [-210, -148.5]);
	await page.getByRole("button", { name: "Select", exact: true }).click();
});

test("creates a symbol from multiple shapes and restores the selection with undo", async ({ page }) => {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	await createShape(page, "Rectangle", 100, 150);
	await expect(page.getByRole("button", { name: "Create symbol", exact: true })).toHaveCount(0);
	await createShape(page, "Circle", 160, 150);
	await createShape(page, "Triangle", 300, 150);
	await expect.poll(async () => (await state(page)).shapes[2]?.width).toBeCloseTo(40, 5);
	const original = await drawing(page);
	await clickAt(page, 100, 150);
	await page.keyboard.down("Shift");
	await clickAt(page, 160, 150);
	await page.keyboard.up("Shift");
	const create = page.getByRole("button", { name: "Create symbol", exact: true });
	await expect(create).toBeEnabled();
	await create.click();
	const dialog = page.getByRole("dialog", { name: "Create symbol", exact: true });
	await expect(dialog.getByRole("button", { name: "Create symbol", exact: true })).toBeDisabled();
	await dialog.getByRole("textbox", { name: "Symbol name", exact: true }).fill("Input connector");
	await dialog.getByRole("button", { name: "Create symbol", exact: true }).click();
	await expect.poll(() => selectedNames(page)).toEqual(["symbol 4"]);
	await expect(page.getByRole("textbox", { name: "Name", exact: true })).toHaveValue("Input connector");
	await expect(page.getByRole("textbox", { name: "Reference", exact: true })).toHaveValue("U4");
	await expect(create).toHaveCount(0);
	await expect.poll(async () => (await state(page)).shapes.length).toBe(2);
	await page.getByRole("textbox", { name: "Name", exact: true }).fill("Renamed connector");
	await expect(page.getByRole("textbox", { name: "Name", exact: true })).toHaveValue("Renamed connector");
	await page.getByRole("textbox", { name: "Name", exact: true }).blur();
	await (await toolbarButton(page, "Undo")).click();
	await expect(page.getByRole("textbox", { name: "Name", exact: true })).toHaveValue("Input connector");
	await (await toolbarButton(page, "Undo")).click();
	await expect.poll(() => drawing(page)).toEqual(original);
	await expect.poll(() => selectedNames(page)).toEqual(["rectangle 1", "circle 2"]);
	await expect(create).toBeEnabled();
	await (await toolbarButton(page, "Redo")).click();
	await expect.poll(() => selectedNames(page)).toEqual(["symbol 4"]);
	const beforeMove = (await state(page)).shapes;
	await page.locator("canvas").focus();
	await page.keyboard.press("ArrowRight");
	await expect.poll(async () => (await state(page)).shapes[0].x).toBeCloseTo(beforeMove[0].x + 1, 5);
	expect((await state(page)).shapes[1]).toEqual(beforeMove[1]);
	await page.keyboard.press("Delete");
	await expect.poll(async () => (await state(page)).shapes.map((shape) => shape.name)).toEqual(["triangle 3"]);
	expect(errors).toEqual([]);
});

test("symbol creation explains unsupported selections containing existing symbols", async ({ page }) => {
	await createShape(page, "Rectangle", 100, 150);
	await insertSymbol(page, "Resistor", 160, 150);
	await page.keyboard.press("Escape");
	await clickAt(page, 100, 150);
	await page.keyboard.down("Shift");
	await clickAt(page, 160, 150);
	await page.keyboard.up("Shift");
	await expect(page.getByRole("button", { name: "Create symbol", exact: true })).toBeDisabled();
	await expect(page.getByRole("complementary", { name: "Selection attributes" })).toContainText("Select shapes without existing symbols");
});

test("canceling symbol naming preserves the drawing and does not save a definition", async ({ page }) => {
	await createShape(page, "Rectangle", 100, 150);
	await createShape(page, "Circle", 160, 150);
	await clickAt(page, 100, 150);
	await page.keyboard.down("Shift");
	await clickAt(page, 160, 150);
	await page.keyboard.up("Shift");
	const before = (await page.locator("#editor-document").textContent())!;
	await page.getByRole("button", { name: "Create symbol", exact: true }).click();
	const dialog = page.getByRole("dialog", { name: "Create symbol", exact: true });
	await dialog.getByRole("textbox", { name: "Symbol name", exact: true }).fill("   ");
	await expect(dialog.getByRole("button", { name: "Create symbol", exact: true })).toBeDisabled();
	await dialog.getByRole("textbox", { name: "Symbol name", exact: true }).fill("Canceled symbol");
	await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
	await expect(dialog).toHaveCount(0);
	expect(await page.locator("#editor-document").textContent()).toBe(before);
	await page.getByRole("button", { name: "Create symbol", exact: true }).click();
	await page.keyboard.press("Escape");
	await expect(dialog).toHaveCount(0);
	expect(await page.locator("#editor-document").textContent()).toBe(before);
	await page.getByRole("button", { name: "Symbols", exact: true }).click();
	await expect(page.getByRole("button", { name: "Insert Canceled symbol", exact: true })).toHaveCount(0);
});

test("draws, resizes, and edits a line at any angle as a distinct shape", async ({ page }) => {
	await (await toolbarButton(page, "Line")).click();
	await dragTo(page, [80, 100], [140, 140]);
	await expect.poll(async () => (await state(page)).shapes.map((shape) => shape.name)).toEqual(["line 1"]);
	const document = async () => JSON.parse((await page.locator("#editor-document").textContent())!);
	await expect.poll(async () => (await document()).shapes[0].kind).toBe("line");
	await expect.poll(async () => (await state(page)).shapes[0].rotation).toBeCloseTo(Math.atan2(40, 60), 5);
	await expect(page.getByRole("spinbutton", { name: "Length", exact: true })).toHaveValue(String(Number(Math.hypot(60, 40).toFixed(4))));
	await expect(page.getByRole("spinbutton", { name: "Height", exact: true })).toHaveCount(0);
	expect((await state(page)).wireTerminals).toEqual([]);
	await dragTo(page, [140, 140], [160, 170]);
	await expect.poll(async () => (await document()).shapes[0].width).toBeCloseTo(Math.hypot(80, 70), 5);
	const resized = (await document()).shapes[0];
	expect(resized.x - Math.cos(resized.rotation) * resized.width / 2).toBeCloseTo(80, 5);
	expect(resized.y - Math.sin(resized.rotation) * resized.width / 2).toBeCloseTo(100, 5);
	await page.getByRole("spinbutton", { name: "Angle", exact: true }).fill("37");
	await page.getByRole("spinbutton", { name: "Angle", exact: true }).blur();
	await expect.poll(async () => (await document()).shapes[0].rotation).toBeCloseTo(37 * Math.PI / 180, 5);
	await page.getByRole("spinbutton", { name: "Length", exact: true }).fill("25");
	await page.getByRole("spinbutton", { name: "Length", exact: true }).blur();
	await expect.poll(async () => (await document()).shapes[0].width).toBe(25);
	await (await toolbarButton(page, "Undo")).click();
	await expect.poll(async () => (await document()).shapes[0].width).toBeCloseTo(resized.width, 5);
	await (await toolbarButton(page, "Redo")).click();
	await expect.poll(async () => (await document()).shapes[0].width).toBe(25);
	await page.locator("canvas").focus();
	await page.keyboard.press("Delete");
	await expect.poll(async () => (await state(page)).shapes.length).toBe(0);
});

test("horizontal and vertical lines snap to grid and can be turned into a symbol", async ({ page }) => {
	await page.getByRole("button", { name: "Snap to grid", exact: true }).click();
	await (await toolbarButton(page, "Line")).click();
	await dragTo(page, [83, 97], [137, 97]);
	await expect.poll(async () => (await state(page)).shapes[0]?.width).toBeCloseTo(60, 5);
	await (await toolbarButton(page, "Line")).click();
	await dragTo(page, [163, 97], [163, 147]);
	await expect.poll(async () => (await state(page)).shapes[1]?.rotation).toBeCloseTo(Math.PI / 2, 5);
	await dragTo(page, [70, 80], [170, 160]);
	await expect.poll(() => selectedNames(page)).toEqual(["line 1", "line 2"]);
	await page.getByRole("button", { name: "Create symbol", exact: true }).click();
	const dialog = page.getByRole("dialog", { name: "Create symbol", exact: true });
	await dialog.getByRole("textbox", { name: "Symbol name", exact: true }).fill("Corner lines");
	await dialog.getByRole("button", { name: "Create symbol", exact: true }).click();
	await expect.poll(() => selectedNames(page)).toEqual(["symbol 3"]);
	const shapes = JSON.parse((await page.locator("#editor-document").textContent())!).shapes;
	expect(shapes[0].children.map((child: { kind: string }) => child.kind)).toEqual(["line", "line"]);
	await (await toolbarButton(page, "Undo")).click();
	await expect.poll(() => selectedNames(page)).toEqual(["line 1", "line 2"]);
	await page.getByRole("button", { name: "Symbols", exact: true }).click();
	await page.getByRole("button", { name: "Insert Corner lines", exact: true }).click();
	await clickAt(page, 240, 150);
	await expect.poll(() => selectedNames(page)).toEqual(["symbol 4"]);
	await expect(page.getByRole("textbox", { name: "Name", exact: true })).toHaveValue("Corner lines");
	await page.reload();
	await page.getByRole("button", { name: "Symbols", exact: true }).click();
	await expect(page.getByRole("button", { name: "Insert Corner lines", exact: true })).toBeVisible();
});

test("draws every shape, moves beyond A3 without panning, and deletes", async ({ page }) => {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	const before = await nonPinState(page);
	for (const [index, kind] of ["Rectangle", "Circle", "Triangle", "Wire"].entries()) {
		await createShape(page, kind, 70 + index * 85, 150);
		await expect.poll(async () => (await nonPinState(page)).shapes.length).toBe(index + 1);
	}
	await dragTo(page, [70, 150], [100, 180]);
	await expect.poll(async () => (await nonPinState(page)).shapes[0].x).toBeCloseTo(100, 1);
	expect((await nonPinState(page)).shapes[0].y).toBeCloseTo(180, 1);
	expect((await nonPinState(page)).origin).toEqual(before.origin);
	await dragTo(page, [100, 180], [-30, 330]);
	await expect.poll(async () => (await nonPinState(page)).shapes[0].x).toBeCloseTo(-30, 4);
	expect((await nonPinState(page)).shapes[0].y).toBeCloseTo(330, 4);
	await page.keyboard.press("ArrowRight");
	await page.keyboard.press("Shift+ArrowDown");
	await expect.poll(async () => (await nonPinState(page)).shapes[0].x).toBeCloseTo(-29, 4);
	await expect.poll(async () => (await nonPinState(page)).shapes[0].y).toBeCloseTo(320, 4);
	await page.keyboard.press("Delete");
	await expect.poll(async () => (await nonPinState(page)).shapes.length).toBe(3);
	await (await toolbarButton(page, "Rectangle")).click();
	await clickAt(page, -25, 150);
	expect((await nonPinState(page)).shapes.length).toBe(3);
	expect(errors).toEqual([]);
});

test("stays orthographic through navigation and edits after zoom and resize", async ({ page }) => {
	await expect((await toolbarButton(page, "Fit drawing"))).toHaveText("100%");
	await expect(page.getByRole("button", { name: "Orthographic camera" })).toHaveCount(0);
	const checkCamera = async () => {
		const view = await state(page);
		expect(view.camera).toBe("OrthographicCamera");
		expect(view.direction[0]).toBeCloseTo(0, 8);
		expect(view.direction[1]).toBeCloseTo(0, 8);
		expect(view.direction[2]).toBeCloseTo(-1, 8);
		const box = (await page.locator("canvas").boundingBox())!;
		expect((view.corner[0] - view.origin[0]) * box.width / ((view.corner[1] - view.origin[1]) * box.height)).toBeCloseTo(420 / 297, 8);
	};
	await expect(checkCamera).toPass();
	await page.getByRole("button", { name: "Pan", exact: true }).click();
	await dragTo(page, [210, 150], [230, 160]);
	await (await toolbarButton(page, "Zoom in")).click();
	await expect((await toolbarButton(page, "Fit drawing"))).toHaveText("125%");
	await page.setViewportSize({ width: 1000, height: 800 });
	await expect.poll(async () => (await page.locator("canvas").boundingBox())?.width).toBe(1000);
	await expect(checkCamera).toPass();
	await createShape(page, "Circle", 210, 150);
	await expect.poll(async () => (await state(page)).shapes[0]?.x).toBeCloseTo(210, 1);
	await dragTo(page, [210, 150], [230, 180]);
	await expect.poll(async () => (await state(page)).shapes[0].y).toBeCloseTo(180, 1);
	await page.keyboard.press("F6");
	await expect((await toolbarButton(page, "Fit drawing"))).toHaveText("100%");
	await expect(checkCamera).toPass();
});

test("Escape rolls back a drag and overlapping shapes select the top shape", async ({ page }) => {
	for (const kind of ["Rectangle", "Circle"]) {
		await createShape(page, kind, 210, 150);
	}
	await dragTo(page, [210, 150], [260, 180]);
	await expect.poll(async () => (await state(page)).shapes[1].x).toBeCloseTo(260, 1);
	expect((await state(page)).shapes[0].x).toBeCloseTo(210, 1);
	const start = await screen(page, 260, 180);
	const end = await screen(page, 310, 200);
	await page.mouse.move(start.x, start.y);
	await page.mouse.down();
	await page.mouse.move(end.x, end.y);
	await page.keyboard.press("Escape");
	await page.mouse.up();
	await expect.poll(async () => (await state(page)).shapes[1].x).toBeCloseTo(260, 1);
	await clickAt(page, 210, 150);
	await page.getByRole("button", { name: "Delete", exact: true }).click();
	await expect.poll(async () => (await state(page)).shapes.length).toBe(1);
});

const selectedNames = async (page: Page) => (await state(page)).shapes.filter((shape) => shape.selected).map((shape) => shape.name);

test("rectangle selection previews, moves and deletes the group without panning", async ({ page }) => {
	for (const [kind, x] of [["Rectangle", 100], ["Circle", 180], ["Triangle", 260]] as const) {
		await createShape(page, kind, x, 150);
	}
	const before = await state(page);
	// Start at the upper-right and drag backwards across both shapes.
	const start = await screen(page, 210, 195);
	const end = await screen(page, 65, 120);
	await page.mouse.move(start.x, start.y);
	await page.mouse.down();
	await page.mouse.move(end.x, end.y, { steps: 4 });
	await expect(page.getByTestId("selection-rectangle")).toBeVisible();
	await expect.poll(() => selectedNames(page)).toEqual(["rectangle 1", "circle 2"]);
	await page.screenshot({ path: test.info().outputPath("rectangle-selection.png") });
	await page.mouse.up();
	await expect(page.getByTestId("selection-rectangle")).toHaveCount(0);
	await expect(page.getByRole("complementary", { name: "Selection attributes" })).toContainText("2 shapes selected");
	expect((await state(page)).origin).toEqual(before.origin);
	await dragTo(page, [100, 150], [120, 170]);
	await expect.poll(async () => (await state(page)).shapes[1].x).toBeCloseTo(200, 1);
	await dragTo(page, [120, 170], [-25, 170]);
	await expect.poll(async () => (await state(page)).shapes[0].x).toBeCloseTo(-25, 4);
	expect((await state(page)).shapes[1].x).toBeCloseTo(55, 1);
	await page.keyboard.press("Shift+ArrowRight");
	await expect.poll(async () => (await state(page)).shapes[0].x).toBeCloseTo(-15, 4);
	expect((await state(page)).shapes[1].x).toBeCloseTo(65, 1);
	await page.keyboard.press("Delete");
	await expect.poll(async () => (await state(page)).shapes.map((shape) => shape.name)).toEqual(["triangle 3"]);
	await expect(page.getByRole("complementary", { name: "Selection attributes" })).toHaveCount(0);
});

test("selection works after zoom, supports Shift additions and cancels with Escape", async ({ page }) => {
	for (const [kind, x] of [["Rectangle", 100], ["Circle", 180], ["Triangle", 260], ["Wire", 330]] as const) {
		await createShape(page, kind, x, 100);
	}
	await (await toolbarButton(page, "Zoom in")).click();
	await expect((await toolbarButton(page, "Fit drawing"))).toHaveText("125%");
	await dragTo(page, [65, 70], [130, 125]);
	await expect.poll(() => selectedNames(page)).toEqual(["rectangle 1"]);
	await page.keyboard.down("Shift");
	await dragTo(page, [160, 75], [200, 120]);
	await page.keyboard.up("Shift");
	await expect.poll(() => selectedNames(page)).toEqual(["rectangle 1", "circle 2"]);
	const start = await screen(page, 230, 70);
	const end = await screen(page, 285, 130);
	await page.mouse.move(start.x, start.y);
	await page.mouse.down();
	await page.mouse.move(end.x, end.y, { steps: 3 });
	await expect.poll(() => selectedNames(page)).toEqual(["triangle 3"]);
	await page.keyboard.press("Escape");
	await page.mouse.up();
	await expect.poll(() => selectedNames(page)).toEqual(["rectangle 1", "circle 2"]);
	await page.keyboard.down("Shift");
	await clickAt(page, 100, 100);
	await page.keyboard.up("Shift");
	await expect.poll(() => selectedNames(page)).toEqual(["circle 2"]);
	// A narrow crossing rectangle must include the line, even without its center.
	await dragTo(page, [310, 90], [307, 110]);
	await expect.poll(() => selectedNames(page)).toEqual(["wire 5"]);
	await clickAt(page, 60, 60);
	await expect.poll(() => selectedNames(page)).toEqual([]);
});

test("attributes reuse the floating layer panel and follow the selected shape", async ({ page }) => {
	const panel = page.getByRole("complementary", { name: "Selection attributes" });
	await expect(panel).toHaveCount(0);
	await createShape(page, "Circle", 150, 100);
	await expect(panel).toHaveCSS("position", "absolute");
	await expect(panel).toHaveCSS("width", "320px");
	await expect(panel.locator(":scope > div")).toHaveCSS("overflow-y", "auto");
	await expect(panel.getByRole("list")).toHaveCount(0);
	const attribute = (label: string) => panel.locator("dl > div").filter({ has: page.getByText(label, { exact: true }) }).locator("dd");
	await expect(attribute("Type")).toHaveText("circle");
	await expect(page.getByRole("spinbutton", { name: "Center X", exact: true })).toHaveValue("150");
	await expect(page.getByRole("spinbutton", { name: "Radius", exact: true })).toHaveValue("15");
	await dragTo(page, [150, 100], [170, 120]);
	await expect(page.getByRole("spinbutton", { name: "Center X", exact: true })).toHaveValue("170");
	await expect(page.getByRole("spinbutton", { name: "Center Y", exact: true })).toHaveValue("120");
	await panel.screenshot({ path: test.info().outputPath("selection-attributes.png") });
	await panel.getByRole("button", { name: "Clear selection" }).click();
	await expect(panel).toHaveCount(0);
	await expect.poll(async () => (await state(page)).shapes.length).toBe(1);
});

test("draws a live two-corner rectangle and retains its dimensions when moved", async ({ page }) => {
	await (await toolbarButton(page, "Rectangle")).click();
	const start = await screen(page, 80, 100);
	const end = await screen(page, 160, 145);
	const original = await state(page);
	await page.mouse.move(start.x, start.y);
	await page.mouse.down();
	await page.mouse.move(end.x, end.y, { steps: 4 });
	await expect.poll(async () => (await state(page)).shapes[0]?.width).toBeCloseTo(80, 4);
	await expect.poll(async () => (await state(page)).shapes[0]?.height).toBeCloseTo(45, 4);
	await expect(page.getByRole("spinbutton", { name: "Width", exact: true })).toHaveValue("80");
	await page.screenshot({ path: test.info().outputPath("drawing-rectangle.png") });
	await page.mouse.up();
	await expect(page.getByRole("button", { name: "Select", exact: true })).toHaveAttribute("aria-pressed", "true");
	expect((await state(page)).origin).toEqual(original.origin);
	await dragTo(page, [120, 122.5], [140, 152.5]);
	await expect.poll(async () => (await state(page)).shapes[0]?.x).toBeCloseTo(140, 4);
	expect((await state(page)).shapes[0].width).toBeCloseTo(80, 4);
	expect((await state(page)).shapes[0].height).toBeCloseTo(45, 4);
	await (await toolbarButton(page, "Rectangle")).click();
	await dragTo(page, [280, 200], [220, 175]);
	await expect.poll(async () => (await state(page)).shapes[1]?.width).toBeCloseTo(60, 4);
	expect((await state(page)).shapes[1].height).toBeCloseTo(25, 4);
	expect((await state(page)).shapes[1].x).toBeCloseTo(250, 4);
});

test("clicks and cancelled drafts create nothing, and drawing extends beyond the paper", async ({ page }) => {
	await createShape(page, "Circle", 210, 150);
	await (await toolbarButton(page, "Rectangle")).click();
	await clickAt(page, 100, 100);
	await expect.poll(async () => (await state(page)).shapes.length).toBe(1);
	await expect((await toolbarButton(page, "Rectangle"))).toHaveAttribute("aria-pressed", "true");
	const start = await screen(page, 100, 100);
	const end = await screen(page, 160, 140);
	await page.mouse.move(start.x, start.y);
	await page.mouse.down();
	await page.mouse.move(end.x, end.y);
	await expect.poll(async () => (await state(page)).shapes.length).toBe(2);
	await page.keyboard.press("Escape");
	await page.mouse.up();
	await expect.poll(async () => (await state(page)).shapes.length).toBe(1);
	await expect.poll(() => selectedNames(page)).toEqual(["circle 1"]);
	await (await toolbarButton(page, "Rectangle")).click();
	await dragTo(page, [100, 100], [160, 100]);
	await expect.poll(async () => (await state(page)).shapes.length).toBe(1);
	await dragTo(page, [100, 100], [-30, -30]);
	await expect.poll(async () => (await state(page)).shapes.length).toBe(2);
	await expect.poll(async () => (await state(page)).shapes[1].x).toBeCloseTo(35, 4);
	const drawn = (await state(page)).shapes[1];
	expect(drawn.x).toBeCloseTo(35, 4);
	expect(drawn.y).toBeCloseTo(35, 4);
	expect(drawn.width).toBeCloseTo(130, 4);
	expect(drawn.height).toBeCloseTo(130, 4);
	await (await toolbarButton(page, "Rectangle")).click();
	await dragTo(page, [-40, 160], [-10, 190]);
	await expect.poll(async () => (await state(page)).shapes.length).toBe(3);
	await expect.poll(async () => (await state(page)).shapes[2].x).toBeCloseTo(-25, 4);
	await dragTo(page, [-25, 175], [-10, 200]);
	await expect.poll(async () => (await state(page)).shapes[2].y).toBeCloseTo(200, 4);
	await page.screenshot({ path: test.info().outputPath("drawn-outside-paper.png") });
});

test("wire clicks commit orthogonal segments and pointer release keeps the preview", async ({ page }) => {

	await placePin(page, 100, 100);
	await (await toolbarButton(page, "Wire")).click();
	await dragTo(page, [100, 100], [160, 120]);
	await expect.poll(async () => (await nonPinState(page)).preview?.width).toBeCloseTo(60, 4);
	let view = await nonPinState(page);
	expect(view.shapes).toEqual([]);
	expect(view.preview?.x).toBeCloseTo(130, 4);
	expect(view.preview?.y).toBeCloseTo(100, 4);
	expect(view.preview?.rotation).toBeCloseTo(0, 4);
	await clickAt(page, 160, 120);
	await expect.poll(async () => (await nonPinState(page)).shapes.length).toBe(1);
	await expect(await toolbarButton(page, "Wire")).toHaveAttribute("aria-pressed", "true");
	await moveAt(page, 172, 165);
	await expect.poll(async () => (await nonPinState(page)).preview?.width).toBeCloseTo(65, 4);
	view = await nonPinState(page);
	expect(view.shapes).toHaveLength(1);
	expect(view.preview?.x).toBeCloseTo(160, 4);
	expect(view.preview?.y).toBeCloseTo(132.5, 4);
	expect(view.preview?.rotation).toBeCloseTo(Math.PI / 2, 4);
	await clickAt(page, 172, 165);
	await clickAt(page, 105, 174);
	await expect.poll(async () => (await nonPinState(page)).shapes.length).toBe(3);
	view = await nonPinState(page);
	expect(view.shapes.map((shape) => shape.name)).toEqual(["wire 2", "wire 3", "wire 4"]);
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
	await expect.poll(async () => (await nonPinState(page)).preview?.width).toBeCloseTo(45, 4);
	await page.screenshot({ path: test.info().outputPath("drawing-line-chain.png") });
	await clickAt(page, 105, 165);
	await clickAt(page, 105, 165);
	await expect.poll(async () => (await nonPinState(page)).shapes.length).toBe(3);
	await page.keyboard.press("Escape");
	await expect.poll(async () => (await nonPinState(page)).preview).toBeNull();
});

for (const finishKey of ["Escape", "Enter"]) {
	test(`${finishKey} finishes a line chain and discards only the unfinished segment`, async ({ page }) => {
		await placePin(page, 100, 100);
		await (await toolbarButton(page, "Wire")).click();
		await clickAt(page, 100, 100);
		await clickAt(page, 160, 120);
		await clickAt(page, 170, 165);
		await expect.poll(async () => (await nonPinState(page)).shapes.length).toBe(2);
		const committed = (await nonPinState(page)).shapes;
		await moveAt(page, 220, 170);
		await expect.poll(async () => (await nonPinState(page)).preview?.width).toBeCloseTo(60, 4);
		await page.keyboard.press(finishKey);
		await expect(page.getByRole("button", { name: "Select", exact: true })).toHaveAttribute("aria-pressed", "true");
		await expect.poll(async () => (await nonPinState(page)).preview).toBeNull();
		expect((await nonPinState(page)).shapes).toEqual(committed);
		await moveAt(page, 190, 180);
		expect((await nonPinState(page)).shapes).toEqual(committed);
	});
}

test("switching tools clears an uncommitted line and starts the next chain independently", async ({ page }) => {
	await placePin(page, 100, 100);
	await (await toolbarButton(page, "Wire")).click();
	await clickAt(page, 100, 100);
	await clickAt(page, 100, 100);
	await moveAt(page, 160, 120);
	await expect.poll(async () => (await nonPinState(page)).preview?.width).toBeCloseTo(60, 4);
	expect((await nonPinState(page)).shapes).toEqual([]);
	await (await toolbarButton(page, "Rectangle")).click();
	await expect.poll(async () => (await nonPinState(page)).preview).toBeNull();
	expect((await nonPinState(page)).shapes).toEqual([]);
	await createShape(page, "Wire", 240, 140);
	await expect.poll(async () => (await nonPinState(page)).shapes.length).toBe(1);
	const line = (await nonPinState(page)).shapes[0];
	expect(line.x).toBeCloseTo(240, 4);
	expect(line.y).toBeCloseTo(140, 4);
	expect(line.width).toBeCloseTo(55, 4);
});

test("snapped line chains keep consecutive corners on the grid", async ({ page }) => {
	await page.getByRole("button", { name: "Snap to grid", exact: true }).click();
	await placePin(page, 93, 103);
	await (await toolbarButton(page, "Wire")).click();
	await clickAt(page, 90, 100);
	await clickAt(page, 153, 122);
	await moveAt(page, 163, 167);
	await expect.poll(async () => (await nonPinState(page)).preview?.width).toBe(70);
	const preview = (await nonPinState(page)).preview;
	expect(preview?.x).toBe(150);
	expect(preview?.y).toBe(135);
	await clickAt(page, 163, 167);
	await page.keyboard.press("Enter");
	await expect.poll(async () => (await nonPinState(page)).shapes.length).toBe(2);
	const [first, second] = (await nonPinState(page)).shapes;
	expect(first.x).toBe(120);
	expect(first.y).toBe(100);
	expect(first.width).toBe(60);
	expect(first.rotation).toBe(0);
	expect(second.x).toBe(150);
	expect(second.y).toBe(135);
	expect(second.width).toBe(70);
	expect(second.rotation).toBeCloseTo(Math.PI / 2, 4);
});

test("wire chains keep placed corners when grid snapping and zoom change", async ({ page }) => {
	await placePin(page, 93, 103);
	await (await toolbarButton(page, "Wire")).click();
	await clickAt(page, 93, 103);
	await clickAt(page, 153, 122);
	await expect.poll(async () => (await nonPinState(page)).shapes.length).toBe(1);
	const first = (await nonPinState(page)).shapes[0];
	await page.getByRole("button", { name: "Snap to grid", exact: true }).click();
	await clickAt(page, 163, 167);
	await expect.poll(async () => (await nonPinState(page)).shapes.length).toBe(2);
	for (let index = 0; index < 4; index++) {
		await (await toolbarButton(page, "Zoom in")).click();
	}
	await expect((await toolbarButton(page, "Fit drawing"))).toHaveText("244%");
	await expect.poll(() => visibleGridStep(page)).toBe(2);
	await clickAt(page, 201.2, 181);
	await page.keyboard.press("Enter");
	await expect.poll(async () => (await nonPinState(page)).shapes.length).toBe(3);
	const lines = (await nonPinState(page)).shapes;
	expect(lines[0].x).toBe(first.x);
	expect(lines[0].y).toBe(first.y);
	expect(lines[0].width).toBe(first.width);
	expect(lines[1].x).toBeCloseTo(153, 4);
	expect(lines[1].y).toBeCloseTo(136.5, 4);
	expect(lines[1].width).toBeCloseTo(67, 4);
	expect(lines[1].rotation).toBeCloseTo(Math.PI / 2, 4);
	expect(lines[2].x).toBeCloseTo(177.5, 4);
	expect(lines[2].y).toBeCloseTo(170, 4);
	expect(lines[2].width).toBeCloseTo(49, 4);
	expect(lines[2].rotation).toBeCloseTo(0, 4);
});

test("moving one segment keeps connected endpoints together while resize and delete stay independent", async ({ page }) => {
	await createWireChain(page, [[100, 100], [160, 100], [160, 165], [105, 165]]);
	await createShape(page, "Rectangle", 280, 120);
	await expect.poll(async () => (await nonPinState(page)).shapes.length).toBe(4);
	await clickAt(page, 160, 132.5);
	await expect.poll(() => selectedNames(page)).toEqual(["wire 3"]);
	await expect(page.getByTestId("resize-handle")).toHaveCount(2);
	const originals = (await nonPinState(page)).shapes;
	await dragTo(page, [160, 132.5], [190, 142.5]);
	await expect.poll(() => wireEndpoints(page)).toEqual([[100, 110, 190, 110], [190, 110, 190, 175], [190, 175, 105, 175]]);
	await expect.poll(() => selectedNames(page)).toEqual(["wire 3"]);
	const moved = (await nonPinState(page)).shapes;
	expect(moved.map((shape) => shape.name)).toEqual(["wire 2", "wire 3", "wire 4", "rectangle 5"]);
	expect(moved[3]).toEqual(originals[3]);
	await page.screenshot({ path: test.info().outputPath("moving-connected-endpoints.png") });
	await dragHandle(page, "1,0", [220, 210]);
	await expect.poll(async () => (await wireEndpoints(page)).map((ends) => ends.map((value) => Number(value.toFixed(2))))).toEqual([[100, 110, 190, 110], [190, 110, 190, 175], [190, 175, 190, 210], [190, 175, 105, 175]]);
	const shapes = (await nonPinState(page)).shapes;
	expect(shapes[1].x).toBeCloseTo(190, 1);
	expect(shapes[1].y).toBeCloseTo(142.5, 1);
	expect(shapes[1].rotation).toBeCloseTo(Math.PI / 2, 4);
	expect(shapes[0]).toEqual(moved[0]);
	expect(shapes[3]).toEqual(moved[2]);
	expect(shapes[4]).toEqual(originals[3]);
	await page.keyboard.press("Delete");
	await expect.poll(async () => (await nonPinState(page)).shapes).toEqual([moved[0], moved[2], originals[3]]);
	await expect(page.getByTestId("resize-handle")).toHaveCount(0);
});

test("snapped segment dragging and keyboard movement carry neighboring endpoints", async ({ page }) => {
	await createWireChain(page, [[100, 100], [160, 100], [160, 160], [100, 160]]);
	await page.getByRole("button", { name: "Snap to grid", exact: true }).click();
	await clickAt(page, 160, 135);
	await expect.poll(() => selectedNames(page)).toEqual(["wire 3"]);
	const original = (await nonPinState(page)).shapes;
	await clickAt(page, 160, 135);
	await expect.poll(async () => (await nonPinState(page)).shapes).toEqual(original);
	await dragTo(page, [160, 135], [173, 148]);
	await expect.poll(() => wireEndpoints(page)).toEqual([[100, 110, 170, 110], [170, 110, 170, 170], [170, 170, 100, 170]]);
	await page.keyboard.press("ArrowRight");
	await expect.poll(() => wireEndpoints(page)).toEqual([[100, 110, 180, 110], [180, 110, 180, 170], [180, 170, 100, 170]]);
	await page.keyboard.press("Shift+ArrowUp");
	await expect.poll(() => wireEndpoints(page)).toEqual([[100, 210, 180, 210], [180, 210, 180, 270], [180, 270, 100, 270]]);
	await expect.poll(() => selectedNames(page)).toEqual(["wire 3"]);
	expect((await nonPinState(page)).shapes).toHaveLength(3);
});

for (const cancelWith of ["Escape", "pointercancel"]) {
	test(`${cancelWith} restores the dragged segment and all affected neighbors`, async ({ page }) => {
		await createWireChain(page, [[100, 100], [160, 100], [160, 165], [105, 165]]);
		await clickAt(page, 160, 132.5);
		await expect.poll(() => selectedNames(page)).toEqual(["wire 3"]);
		const originals = (await nonPinState(page)).shapes;
		await moveAt(page, 160, 132.5);
		await page.mouse.down();
		await moveAt(page, 190, 142.5);
		await expect.poll(() => wireEndpoints(page)).toEqual([[100, 110, 190, 110], [190, 110, 190, 175], [190, 175, 105, 175]]);
		const duringDrag = await nonPinState(page);
		await page.keyboard.press("ArrowRight");
		await expect.poll(async () => (await nonPinState(page)).shapes).toEqual(duringDrag.shapes);
		expect((await nonPinState(page)).origin).toEqual(duringDrag.origin);
		await moveAt(page, 220, 152.5);
		await expect.poll(() => wireEndpoints(page)).toEqual([[100, 120, 220, 120], [220, 120, 220, 185], [220, 185, 105, 185]]);
		if (cancelWith === "Escape") await page.keyboard.press("Escape");
		else await page.locator("canvas").dispatchEvent("pointercancel", { pointerId: 1 });
		await page.mouse.up();
		await expect.poll(async () => (await nonPinState(page)).shapes).toEqual(originals);
		await expect.poll(() => selectedNames(page)).toEqual(["wire 3"]);
	});
}

test("moving multiple selected segments carries their shared unselected neighbor once", async ({ page }) => {
	await createWireChain(page, [[100, 100], [160, 100], [160, 165], [105, 165]]);
	await clickAt(page, 130, 100);
	await page.keyboard.down("Shift");
	await clickAt(page, 160, 132.5);
	await page.keyboard.up("Shift");
	await expect.poll(() => selectedNames(page)).toEqual(["wire 2", "wire 3"]);
	await dragTo(page, [160, 132.5], [190, 142.5]);
	await expect.poll(() => wireEndpoints(page)).toEqual([[130, 110, 190, 110], [190, 110, 190, 175], [190, 175, 105, 175]]);
	await page.keyboard.press("ArrowLeft");
	await expect.poll(() => wireEndpoints(page)).toEqual([[129, 110, 189, 110], [189, 110, 189, 175], [189, 175, 105, 175]]);
	await expect.poll(() => selectedNames(page)).toEqual(["wire 2", "wire 3"]);
	expect((await nonPinState(page)).shapes).toHaveLength(3);
});

test("folding a loop removes collapsed edges and keeps the selected merged segment usable", async ({ page }) => {
	await createWireChain(page, [[100, 100], [160, 100], [160, 160], [100, 160], [100, 100]]);
	await expect.poll(async () => (await nonPinState(page)).shapes.length).toBe(4);
	await clickAt(page, 160, 130);
	await expect.poll(() => selectedNames(page)).toEqual(["wire 3"]);
	await dragTo(page, [160, 130], [100, 130]);
	await expect.poll(() => wireEndpoints(page)).toEqual([[100, 100, 100, 160]]);
	await expect.poll(() => selectedNames(page)).toEqual(["wire 3"]);
	await expect(page.getByTestId("resize-handle")).toHaveCount(2);
	await page.screenshot({ path: test.info().outputPath("merged-collapsed-loop.png") });
	await dragTo(page, [100, 130], [120, 140]);
	await expect.poll(() => wireEndpoints(page)).toEqual([[120, 110, 120, 170]]);
	await expect.poll(() => selectedNames(page)).toEqual(["wire 3"]);
	await page.keyboard.press("Delete");
	await expect.poll(async () => (await nonPinState(page)).shapes).toEqual([]);
	await expect(page.getByTestId("resize-handle")).toHaveCount(0);
});

for (const cancelWith of ["Escape", "pointercancel"]) {
	test(`${cancelWith} restores a loop while its edges are collapsed and overlapping`, async ({ page }) => {
		await createWireChain(page, [[100, 100], [160, 100], [160, 160], [100, 160], [100, 100]]);
		await clickAt(page, 160, 130);
		await expect.poll(() => selectedNames(page)).toEqual(["wire 3"]);
		const originals = (await nonPinState(page)).shapes;
		await moveAt(page, 160, 130);
		await page.mouse.down();
		await moveAt(page, 100, 130);
		await expect.poll(() => wireEndpoints(page)).toEqual([[100, 100, 100, 100], [100, 100, 100, 160], [100, 160, 100, 160], [100, 160, 100, 100]]);
		if (cancelWith === "Escape") await page.keyboard.press("Escape");
		else await page.locator("canvas").dispatchEvent("pointercancel", { pointerId: 1 });
		await page.mouse.up();
		await expect.poll(async () => (await nonPinState(page)).shapes).toEqual(originals);
		await expect.poll(() => selectedNames(page)).toEqual(["wire 3"]);
	});
}

test("a drag can pass through a collapsed loop and reopen it before release", async ({ page }) => {
	await createWireChain(page, [[100, 100], [160, 100], [160, 160], [100, 160], [100, 100]]);
	await moveAt(page, 160, 130);
	await page.mouse.down();
	await moveAt(page, 100, 130);
	await expect.poll(() => wireEndpoints(page)).toEqual([[100, 100, 100, 100], [100, 100, 100, 160], [100, 160, 100, 160], [100, 160, 100, 100]]);
	await moveAt(page, 80, 130);
	await expect.poll(() => wireEndpoints(page)).toEqual([[100, 100, 80, 100], [80, 100, 80, 160], [80, 160, 100, 160], [100, 160, 100, 100]]);
	// Pointer release can carry a newer position than the last pointer move.
	const release = await screen(page, 130, 130);
	await page.locator("canvas").dispatchEvent("pointerup", { pointerId: 1, clientX: release.x, clientY: release.y, button: 0, buttons: 0 });
	await page.mouse.up();
	await expect.poll(() => wireEndpoints(page)).toEqual([[100, 100, 130, 100], [130, 100, 130, 160], [130, 160, 100, 160], [100, 160, 100, 100]]);
	expect((await nonPinState(page)).shapes.map((shape) => shape.name)).toEqual(["wire 2", "wire 3", "wire 4", "wire 5"]);
	await expect.poll(() => selectedNames(page)).toEqual(["wire 3"]);
});

test("keyboard folding merges overlap while preserving separate parallel and gapped segments", async ({ page }) => {
	await createWireChain(page, [[100, 100], [110, 100], [110, 160], [100, 160], [100, 100]]);
	await createWireChain(page, [[100, 200], [100, 240]]);
	await createWireChain(page, [[130, 100], [130, 160]]);
	await clickAt(page, 110, 130);
	await expect.poll(() => selectedNames(page)).toEqual(["wire 3"]);
	const separate = (await nonPinState(page)).shapes.slice(4);
	await page.keyboard.press("Shift+ArrowLeft");
	await expect.poll(async () => (await nonPinState(page)).shapes.length).toBe(3);
	await expect.poll(() => wireEndpoints(page)).toEqual([[100, 100, 100, 160], [100, 200, 100, 240], [130, 100, 130, 160]]);
	await expect.poll(() => selectedNames(page)).toEqual(["wire 3"]);
	expect((await nonPinState(page)).shapes.slice(1)).toEqual(separate);
});

test("drawing duplicate and overlapping wires merges their extent from valid anchors", async ({ page }) => {
 await createWireChain(page, [[100, 100], [160, 100]]);
 await (await toolbarButton(page, "Wire")).click();
 await clickAt(page, 100, 100);
 await clickAt(page, 160, 100);
 await expect.poll(() => wireEndpoints(page)).toEqual([[100, 100, 160, 100]]);
 await expect.poll(() => selectedNames(page)).toEqual(["wire 3"]);
 // Extend the now-open endpoint, then double back to overlap the existing wire.
 await (await toolbarButton(page, "Wire")).click();
 await clickAt(page, 160, 100);
 await clickAt(page, 190, 100);
 await expect.poll(() => wireEndpoints(page)).toEqual([[100, 100, 190, 100]]);
 await expect.poll(() => selectedNames(page)).toEqual(["wire 4"]);
 await clickAt(page, 140, 100);
 await expect.poll(() => wireEndpoints(page)).toEqual([[190, 100, 100, 100]]);
 await expect.poll(() => selectedNames(page)).toEqual(["wire 5"]);
 // Finishing on the trunk ends the chain. Start a new branch at that point.
 await expect(page.locator('[data-tool="select"]')).toBeAttached();
 await (await toolbarButton(page, "Wire")).click();
 await clickAt(page, 140, 100);
 await clickAt(page, 140, 160);
 await page.keyboard.press("Enter");
 await expect.poll(() => wireEndpoints(page)).toEqual([[190, 100, 140, 100], [140, 100, 100, 100], [140, 100, 140, 160]]);
 expect((await nonPinState(page)).shapes.map((shape) => shape.name)).toEqual(["wire 5", "wire 7", "wire 6"]);
 await expect.poll(() => selectedNames(page)).toEqual(["wire 6"]);
});

test("resizing a snapped segment to zero removes it and clears its selection", async ({ page }) => {
	await createWireChain(page, [[100, 100], [160, 100], [160, 160]]);
	await expect.poll(() => selectedNames(page)).toEqual(["wire 3"]);
	const retained = (await nonPinState(page)).shapes[0];
	await page.getByRole("button", { name: "Snap to grid", exact: true }).click();
	await dragHandle(page, "-1,0", [160, 160]);
	await expect.poll(async () => (await nonPinState(page)).shapes).toEqual([retained]);
	await expect.poll(() => selectedNames(page)).toEqual([]);
	await expect(page.getByTestId("resize-handle")).toHaveCount(0);
});

test("draws circles, triangles and orthogonal lines with accurate hit selection", async ({ page }) => {
	await placePin(page, 100, 100);
	await (await toolbarButton(page, "Wire")).click();
	await clickAt(page, 100, 100);
	await clickAt(page, 130, 140);
	await page.keyboard.press("Enter");
	await expect.poll(async () => (await nonPinState(page)).shapes[0]?.width).toBeCloseTo(40, 4);
	expect((await nonPinState(page)).shapes[0].rotation).toBeCloseTo(Math.PI / 2, 4);
	await clickAt(page, 70, 70);
	await clickAt(page, 100, 120);
	await expect.poll(() => selectedNames(page)).toEqual(["wire 2"]);
	await dragTo(page, [109, 135], [113, 139]);
	await expect.poll(() => selectedNames(page)).toEqual([]);
	await dragTo(page, [105, 115], [95, 130]);
	await expect.poll(() => selectedNames(page)).toEqual(["wire 2"]);
	await dragTo(page, [100, 120], [120, 140]);
	await expect.poll(async () => (await nonPinState(page)).shapes[0].x).toBeCloseTo(120, 4);
	await (await toolbarButton(page, "Circle")).click();
	await dragTo(page, [250, 100], [290, 100]);
	await expect.poll(async () => (await nonPinState(page)).shapes[1]?.width).toBeCloseTo(80, 4);
	expect((await nonPinState(page)).shapes[1].height).toBeCloseTo(80, 4);
	await expect(page.getByRole("spinbutton", { name: "Radius", exact: true })).toHaveValue("40");
	await (await toolbarButton(page, "Triangle")).click();
	await dragTo(page, [100, 200], [160, 240]);
	await expect.poll(async () => (await nonPinState(page)).shapes[2]?.width).toBeCloseTo(60, 4);
	expect((await nonPinState(page)).shapes[2].height).toBeCloseTo(40, 4);
});

// DOM handle positions are rounded to CSS subpixels, so resize assertions allow 0.05 mm.
async function dragHandle(page: Page, handle: string, to: [number, number]) {
	const box = (await page.locator(`[data-testid="resize-handle"][data-handle="${handle}"]`).last().boundingBox())!;
	const end = await screen(page, ...to);
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	await page.mouse.down();
	await page.mouse.move(end.x, end.y, { steps: 4 });
	await page.mouse.up();
}

test("corner and edge handles resize shapes while keeping the opposite side fixed", async ({ page }) => {
	await createShape(page, "Rectangle", 150, 150);
	await expect(page.getByTestId("resize-handle")).toHaveCount(8);
	const before = await state(page);
	await dragHandle(page, "1,1", [200, 200]);
	await expect.poll(async () => (await state(page)).shapes[0].width).toBeCloseTo(75, 1);
	let shape = (await state(page)).shapes[0];
	expect(shape.height).toBeCloseTo(65, 1);
	expect(shape.x - shape.width / 2).toBeCloseTo(125, 1);
	expect(shape.y - shape.height / 2).toBeCloseTo(135, 1);
	await dragHandle(page, "-1,0", [110, 160]);
	await expect.poll(async () => (await state(page)).shapes[0].width).toBeCloseTo(90, 1);
	shape = (await state(page)).shapes[0];
	expect(shape.height).toBeCloseTo(65, 1);
	expect(shape.x + shape.width / 2).toBeCloseTo(200, 1);
	expect((await state(page)).origin).toEqual(before.origin);
	await page.screenshot({ path: test.info().outputPath("resize-handles.png") });
	await createShape(page, "Triangle", 280, 100);
	await dragHandle(page, "1,1", [320, 140]);
	await expect.poll(async () => (await state(page)).shapes[1].width).toBeCloseTo(60, 1);
	expect((await state(page)).shapes[1].height).toBeCloseTo(57.5, 1);
});

test("circle radius and orthogonal line endpoints resize independently", async ({ page }) => {
	await createShape(page, "Circle", 150, 150);
	await expect(page.getByTestId("resize-handle")).toHaveCount(4);
	await dragHandle(page, "1,0", [180, 150]);
	await expect.poll(async () => (await nonPinState(page)).shapes[0].width).toBeCloseTo(60, 1);
	const circle = (await nonPinState(page)).shapes[0];
	expect(circle.height).toBeCloseTo(60, 1);
	expect(circle.x).toBeCloseTo(150, 1);
	expect(circle.y).toBeCloseTo(150, 1);
	await placePin(page, 220, 100);
	await (await toolbarButton(page, "Wire")).click();
	await clickAt(page, 220, 100);
	await clickAt(page, 250, 140);
	await page.keyboard.press("Enter");
	await expect(page.getByTestId("resize-handle")).toHaveCount(2);
	await dragHandle(page, "1,0", [280, 180]);
	await expect.poll(async () => (await nonPinState(page)).shapes[1].width).toBeCloseTo(80, 1);
	let line = (await nonPinState(page)).shapes[1];
	expect(line.x).toBeCloseTo(220, 1);
	expect(line.y).toBeCloseTo(140, 1);
	expect(line.rotation).toBeCloseTo(Math.PI / 2, 1);
	await dragHandle(page, "-1,0", [200, 180]);
	await expect.poll(async () => (await nonPinState(page)).shapes[1].width).toBeCloseTo(20, 1);
	await expect.poll(async () => (await nonPinState(page)).shapes[1].x).toBeCloseTo(210, 1);
	line = (await nonPinState(page)).shapes[1];
	expect(line.x).toBeCloseTo(210, 1);
	expect(line.y).toBeCloseTo(180, 1);
	expect(line.rotation).toBeCloseTo(0, 1);
});

test("handles track zoom and viewport changes and cancelled resizing restores dimensions", async ({ page }) => {
	await createShape(page, "Rectangle", 150, 150);
	await expect.poll(async () => (await state(page)).shapes[0]?.width).toBeCloseTo(50, 4);
	const original = (await state(page)).shapes[0];
	await (await toolbarButton(page, "Zoom in")).click();
	await expect((await toolbarButton(page, "Fit drawing"))).toHaveText("125%");
	await page.setViewportSize({ width: 1000, height: 800 });
	await expect.poll(async () => (await page.locator("canvas").boundingBox())?.width).toBe(1000);
	const handle = page.locator('[data-testid="resize-handle"][data-handle="1,1"]');
	await expect(async () => {
		const box = (await handle.boundingBox())!;
		const point = await screen(page, 175, 165);
		expect(box.width).toBe(10);
		expect(box.x + 5).toBeCloseTo(point.x, 1);
		expect(box.y + 5).toBeCloseTo(point.y, 1);
	}).toPass();
	const box = (await handle.boundingBox())!;
	const end = await screen(page, 220, 200);
	await page.mouse.move(box.x + 5, box.y + 5);
	await page.mouse.down();
	await page.mouse.move(end.x, end.y);
	await expect.poll(async () => (await state(page)).shapes[0].width).toBeCloseTo(95, 1);
	await page.keyboard.press("Escape");
	await page.mouse.up();
	await expect.poll(async () => (await state(page)).shapes[0]).toEqual(original);
	await dragHandle(page, "1,1", [220, 200]);
	await expect.poll(async () => (await state(page)).shapes[0].width).toBeCloseTo(95, 1);
});

test("resizing one of several selected shapes preserves the others and pointer cancellation restores it", async ({ page }) => {
	await createShape(page, "Rectangle", 130, 150);
	await createShape(page, "Circle", 230, 150);
	await page.keyboard.down("Shift");
	await clickAt(page, 130, 150);
	await page.keyboard.up("Shift");
	await expect(page.getByTestId("resize-handle")).toHaveCount(12);
	await expect.poll(() => selectedNames(page)).toEqual(["rectangle 1", "circle 2"]);
	const originals = (await state(page)).shapes;
	const handle = page.locator('[data-shape-id="1"][data-handle="1,1"]');
	const box = (await handle.boundingBox())!;
	const end = await screen(page, 180, 180);
	await page.mouse.move(box.x + 5, box.y + 5);
	await page.mouse.down();
	await page.mouse.move(end.x, end.y);
	await expect.poll(async () => (await state(page)).shapes[0].width).toBeCloseTo(75, 1);
	expect((await state(page)).shapes[1]).toEqual(originals[1]);
	await expect.poll(() => selectedNames(page)).toEqual(["rectangle 1", "circle 2"]);
	await page.locator("canvas").dispatchEvent("pointercancel", { pointerId: 1 });
	await page.mouse.up();
	await expect.poll(async () => (await state(page)).shapes).toEqual(originals);
});

async function fitCenteredEditor(page: Page) {
	await page.locator("canvas").focus();
	await page.keyboard.press("F6");
	await expect.poll(async () => (await state(page)).origin.slice(0, 2)).toEqual([0, 0]);
}

async function visibleGridStep(page: Page) {
	return page.getByRole("img", { name: "Drawing rulers in millimetres" }).locator('[data-axis="x"]').evaluateAll((ticks) =>
		Math.abs(Number(ticks[1].getAttribute("data-value")) - Number(ticks[0].getAttribute("data-value"))),
	);
}

test("snap mode aligns drawing, resizing and keyboard placement to the visible grid", async ({ page }) => {
	await fitCenteredEditor(page);
	const snap = page.getByRole("button", { name: "Snap to grid", exact: true });
	await expect(snap).toHaveAttribute("aria-pressed", "false");
	expect(await visibleGridStep(page)).toBe(10);
	await snap.click();
	await expect(snap).toHaveAttribute("aria-pressed", "true");
	await (await toolbarButton(page, "Rectangle")).click();
	await dragTo(page, [-83, -37], [-23, 32]);
	await expect.poll(async () => (await state(page)).shapes[0]?.width).toBeCloseTo(60, 4);
	let shape = (await state(page)).shapes[0];
	expect(shape.x).toBe(-50);
	expect(shape.y).toBe(-5);
	expect(shape.height).toBe(70);
	await dragHandle(page, "1,1", [13, 56]);
	await expect.poll(async () => (await state(page)).shapes[0].width).toBeCloseTo(90, 4);
	shape = (await state(page)).shapes[0];
	expect(shape.height).toBe(100);
	expect(shape.x - shape.width / 2).toBe(-80);
	expect(shape.y - shape.height / 2).toBe(-40);
	await page.keyboard.press("ArrowRight");
	await expect.poll(async () => (await state(page)).shapes[0].x).toBe(-25);
	await page.keyboard.press("Shift+ArrowUp");
	await expect.poll(async () => (await state(page)).shapes[0].y).toBe(110);
	await snap.click();
	await (await toolbarButton(page, "Triangle")).click();
	await dragTo(page, [-83, -37], [-23, 32]);
	await expect.poll(async () => (await state(page)).shapes[1]?.height).toBeCloseTo(69, 4);
	expect((await state(page)).shapes[1].x).toBeCloseTo(-53, 4);
});

test("snapped moves respect grab offsets, preserve groups, and cancel without changing selection", async ({ page }) => {
	await fitCenteredEditor(page);
	await createShape(page, "Rectangle", -130, 0);
	await createShape(page, "Circle", -62, 8);
	await expect.poll(async () => (await state(page)).shapes[1]?.width).toBeCloseTo(30, 4);
	await page.getByRole("button", { name: "Snap to grid", exact: true }).click();
	await page.keyboard.down("Shift");
	await clickAt(page, -130, 0);
	await page.keyboard.up("Shift");
	await expect.poll(() => selectedNames(page)).toEqual(["rectangle 1", "circle 2"]);
	const originals = (await state(page)).shapes;
	await clickAt(page, -60, 10);
	await expect.poll(async () => (await state(page)).shapes).toEqual(originals);
	await dragTo(page, [-60, 10], [-47, 23]);
	await expect.poll(async () => (await state(page)).shapes[1].x).toBe(-50);
	const moved = (await state(page)).shapes;
	expect(moved[1].y).toBe(20);
	expect(moved[1].x - moved[0].x).toBeCloseTo(originals[1].x - originals[0].x, 4);
	expect(moved[1].y - moved[0].y).toBeCloseTo(originals[1].y - originals[0].y, 4);
	const start = await screen(page, -50, 20);
	const end = await screen(page, -27, 43);
	await page.mouse.move(start.x, start.y);
	await page.mouse.down();
	await page.mouse.move(end.x, end.y);
	await expect.poll(async () => (await state(page)).shapes[1].x).toBe(-30);
	await page.keyboard.press("Escape");
	await page.mouse.up();
	await expect.poll(async () => (await state(page)).shapes).toEqual(moved);
});

test("snap spacing follows grid zoom for circle radii and line endpoints", async ({ page }) => {
	await fitCenteredEditor(page);
	const initialStep = await visibleGridStep(page);
	for (let index = 0; index < 10; index++) {
		await (await toolbarButton(page, "Zoom in")).click();
	}
	await expect((await toolbarButton(page, "Fit drawing"))).toHaveText("800%");
	await expect.poll(() => visibleGridStep(page)).not.toBe(initialStep);
	const step = await visibleGridStep(page);
	expect(step).toBe(1);
	const snap = page.getByRole("button", { name: "Snap to grid", exact: true });
	await expect(await toolbarTooltip(page, "Snap to grid")).toHaveText(`Snap to grid, ${step} mm`);
	await snap.click();
	await (await toolbarButton(page, "Circle")).click();
	await dragTo(page, [-8.2, -5.2], [-4, -1]);
	await expect.poll(async () => (await nonPinState(page)).shapes[0]?.width).toBe(12);
	let circle = (await nonPinState(page)).shapes[0];
	expect(circle.x).toBe(-8);
	expect(circle.y).toBe(-5);
	await dragHandle(page, "1,0", [3.1, -5]);
	await expect.poll(async () => (await nonPinState(page)).shapes[0].width).toBe(22);
	circle = (await nonPinState(page)).shapes[0];
	expect(circle.height).toBe(22);
	await placePin(page, -18.8, 9.2);
	await (await toolbarButton(page, "Wire")).click();
	await clickAt(page, -19, 9);
	await clickAt(page, -12.8, 12);
	await page.keyboard.press("Enter");
	await expect.poll(async () => (await nonPinState(page)).shapes[1]?.width).toBeCloseTo(6, 4);
	await dragHandle(page, "1,0", [-8.8, 13]);
	await expect.poll(async () => (await nonPinState(page)).shapes[1].width).toBeCloseTo(10, 4);
	const line = (await nonPinState(page)).shapes[1];
	expect(line.x - Math.cos(line.rotation) * line.width / 2).toBeCloseTo(-19, 4);
	expect(line.y - Math.sin(line.rotation) * line.width / 2).toBeCloseTo(9, 4);
	expect(line.x + Math.cos(line.rotation) * line.width / 2).toBeCloseTo(-9, 4);
	expect(line.y + Math.sin(line.rotation) * line.width / 2).toBeCloseTo(9, 4);
	await page.screenshot({ path: test.info().outputPath("snap-to-grid.png") });
});

async function openHistory(page: Page) {
	const panel = page.getByRole("region", { name: "Drawing history", exact: true });
	if (!await panel.isVisible()) await (await toolbarButton(page, "History")).click();
	await expect(panel).toBeVisible();
	return panel;
}

async function expectHistoryCount(page: Page, count: number) {
	const history = await openHistory(page);
	await expect(history.getByRole("button", { name: /^Restore #/ })).toHaveCount(count);
}

test("history records each completed drawing gesture once and undo and redo restore every edit", async ({ page }) => {
	await openHistory(page);


	await expectHistoryCount(page, 1);
	await expect(await toolbarButton(page, "Undo")).toBeDisabled();
	await expect(await toolbarButton(page, "Redo")).toBeDisabled();
	await createShape(page, "Rectangle", 150, 100);
	await expectHistoryCount(page, 2);
	await expect.poll(async () => (await state(page)).shapes[0]?.x).toBeCloseTo(150, 4);
	const created = await drawing(page);
	await dragTo(page, [150, 100], [180, 120]);
	await expectHistoryCount(page, 3);
	await expect.poll(async () => (await state(page)).shapes[0]?.x).toBeCloseTo(180, 4);
	const moved = await drawing(page);
	await dragHandle(page, "1,1", [230, 170]);
	await expectHistoryCount(page, 4);
	await expect.poll(async () => (await state(page)).shapes[0]?.width).toBeCloseTo(75, 1);
	const resized = await drawing(page);
	await page.locator("canvas").focus();
	await page.keyboard.press("ArrowRight");
	await expect.poll(async () => (await state(page)).shapes[0]?.x).toBeCloseTo(resized[0].x + 1, 4);
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

test("history ignores selection, view settings, cancelled gestures and moves that return to their start", async ({ page }) => {
	await openHistory(page);
	await createShape(page, "Circle", 150, 100);
	await expectHistoryCount(page, 2);
	await expect.poll(async () => (await state(page)).shapes[0]?.x).toBeCloseTo(150, 4);
	const original = await drawing(page);
	await clickAt(page, 60, 60);
	await clickAt(page, 150, 100);
	const snap = page.getByRole("button", { name: "Snap to grid", exact: true });
	await snap.click();
	await snap.click();
	await (await toolbarButton(page, "Rectangle")).click();
	await clickAt(page, 100, 100);
	await moveAt(page, 100, 100);
	await page.mouse.down();
	await moveAt(page, 180, 140);
	await page.keyboard.press("Escape");
	await page.mouse.up();
	await expect.poll(() => drawing(page)).toEqual(original);
	await page.getByRole("button", { name: "Select", exact: true }).click();
	await moveAt(page, 150, 100);
	await page.mouse.down();
	await moveAt(page, 170, 120);
	await expect.poll(async () => (await state(page)).shapes[0]?.x).toBeCloseTo(170, 4);
	await moveAt(page, 150, 100);
	await page.mouse.up();
	await expect.poll(() => drawing(page)).toEqual(original);
	await page.getByRole("button", { name: "Pan", exact: true }).click();
	await dragTo(page, [210, 150], [230, 160]);
	await page.getByRole("button", { name: "Select", exact: true }).click();
	await (await toolbarButton(page, "Zoom in")).click();
	await snap.click();
	await expectHistoryCount(page, 2);
	const view = await state(page);
	await (await toolbarButton(page, "Undo")).click();
	await expect.poll(() => drawing(page)).toEqual([]);
	expect((await state(page)).origin).toEqual(view.origin);
	expect((await state(page)).corner).toEqual(view.corner);
	await expect(snap).toHaveAttribute("aria-pressed", "true");
	await expect(page.getByRole("button", { name: "Select", exact: true })).toHaveAttribute("aria-pressed", "true");
	await expectHistoryCount(page, 2);
});

test("history records line corners separately and connected collapse and merge as one edit", async ({ page }) => {
	const history = await openHistory(page);
	await createWireChain(page, [[100, 100], [160, 100], [160, 160], [100, 160], [100, 100]]);
	await expectHistoryCount(page, 6);
	await expect(history.getByRole("button", { name: /^Restore #\d+: Draw wire$/ })).toHaveCount(4);
	await expect.poll(async () => (await nonPinState(page)).shapes.length).toBe(4);
	const loop = await drawing(page);
	await clickAt(page, 160, 130);
	await dragTo(page, [160, 130], [100, 130]);
	await expectHistoryCount(page, 7);
	await expect.poll(() => wireEndpoints(page)).toEqual([[100, 100, 100, 160]]);
	const merged = await drawing(page);
	await (await toolbarButton(page, "Undo")).click();
	await expect.poll(() => drawing(page)).toEqual(loop);
	await (await toolbarButton(page, "Redo")).click();
	await expect.poll(() => drawing(page)).toEqual(merged);
	await expect.poll(() => selectedNames(page)).toEqual(["wire 3"]);
	await expectHistoryCount(page, 7);
});

test("history keeps old futures after a new edit and restores either branch", async ({ page }) => {
	const history = await openHistory(page);


	await createShape(page, "Rectangle", 150, 100);
	await expect.poll(async () => (await nonPinState(page)).shapes[0]?.x).toBeCloseTo(150, 4);
	const created = await drawing(page);
	await dragTo(page, [150, 100], [180, 120]);
	await expectHistoryCount(page, 3);
	await expect.poll(async () => (await nonPinState(page)).shapes[0]?.x).toBeCloseTo(180, 4);
	const oldFuture = await drawing(page);
	await (await toolbarButton(page, "Undo")).click();
	await expect.poll(() => drawing(page)).toEqual(created);
	await dragHandle(page, "1,1", [200, 130]);
	await expectHistoryCount(page, 4);
	await expect.poll(async () => (await nonPinState(page)).shapes[0]?.width).toBeCloseTo(75, 1);
	const newFuture = await drawing(page);
	const moveNode = history.getByRole("button", { name: /^Restore #\d+: Move selection$/ });
	const resizeNode = history.getByRole("button", { name: /^Restore #\d+: Resize rectangle$/ });
	await expect(moveNode).toBeVisible();
	await expect(resizeNode).toHaveAttribute("aria-current", "step");
	await moveNode.click();
	await expect.poll(() => drawing(page)).toEqual(oldFuture);
	await expect(moveNode).toHaveAttribute("aria-current", "step");
	await (await toolbarButton(page, "Undo")).click();
	await expect.poll(() => drawing(page)).toEqual(created);
	await (await toolbarButton(page, "Redo")).click();
	await expect.poll(() => drawing(page)).toEqual(oldFuture);
	await openHistory(page);
	await resizeNode.click();
	await expect.poll(() => drawing(page)).toEqual(newFuture);
	await expect(resizeNode).toHaveAttribute("aria-current", "step");
	await history.screenshot({ path: test.info().outputPath("drawing-history-branches.png") });
	await placePin(page, 100, 160);
	await (await toolbarButton(page, "Wire")).click();
	await clickAt(page, 100, 160);
	await moveAt(page, 180, 170);
	await expect.poll(async () => (await nonPinState(page)).preview?.width).toBeCloseTo(80, 4);
	await openHistory(page);
	await history.getByRole("button", { name: /^Restore #\d+: Empty drawing$/ }).focus();
	await page.keyboard.press("Enter");
	await expect.poll(() => drawing(page)).toEqual([]);
	await expect.poll(async () => (await nonPinState(page)).preview).toBeNull();
	await history.getByRole("button", { name: /^Restore #\d+: Draw rectangle$/ }).click();
	await expect.poll(() => drawing(page)).toEqual(created);
	await expectHistoryCount(page, 5);
	await createShape(page, "Circle", 250, 100);
	await expect.poll(async () => (await nonPinState(page)).shapes.map((shape) => shape.name)).toEqual(["rectangle 1", "circle 3"]);
	await (await toolbarButton(page, "Undo")).click();
	await expect.poll(() => drawing(page)).toEqual(created);
	await createShape(page, "Triangle", 250, 100);
	await expect.poll(async () => (await nonPinState(page)).shapes.map((shape) => shape.name)).toEqual(["rectangle 1", "triangle 4"]);
	await expectHistoryCount(page, 7);
	await history.getByRole("button", { name: /^Restore #\d+: Draw circle$/ }).click();
	await expect.poll(async () => (await nonPinState(page)).shapes.map((shape) => shape.name)).toEqual(["rectangle 1", "circle 3"]);
	await history.getByRole("button", { name: /^Restore #\d+: Draw triangle$/ }).click();
	await expect.poll(async () => (await nonPinState(page)).shapes.map((shape) => shape.name)).toEqual(["rectangle 1", "triangle 4"]);
});

test("undo and redo clear unfinished previews and active drags without adding history", async ({ page }) => {
	await openHistory(page);
	await placePin(page, 150, 100);
	await expectHistoryCount(page, 2);
	await expect.poll(async () => (await state(page)).shapes[0]?.x).toBeCloseTo(150, 4);
	const created = await drawing(page);
	await (await toolbarButton(page, "Wire")).click();
	await clickAt(page, 150, 100);
	await moveAt(page, 230, 110);
	await expect.poll(async () => (await state(page)).preview?.width).toBeCloseTo(80, 4);
	await page.keyboard.press("Control+z");
	await expect.poll(() => drawing(page)).toEqual([]);
	await expect.poll(async () => (await state(page)).preview).toBeNull();
	await page.keyboard.press("Control+Shift+z");
	await expect.poll(() => drawing(page)).toEqual(created);
	await expect.poll(async () => (await state(page)).preview).toBeNull();
	await page.getByRole("button", { name: "Select", exact: true }).click();
	await moveAt(page, 150, 100);
	await page.mouse.down();
	await moveAt(page, 180, 120);
	await expect.poll(async () => (await state(page)).shapes[0].x).toBeCloseTo(180, 4);
	await page.keyboard.press("Control+z");
	await page.mouse.up();
	await expect.poll(() => drawing(page)).toEqual([]);
	await page.keyboard.press("Control+y");
	await expect.poll(() => drawing(page)).toEqual(created);
	await expectHistoryCount(page, 2);
});

test("wire width edits apply to shapes and groups and support undo and redo", async ({ page }) => {
	const width = page.getByRole("spinbutton", { name: "Line width", exact: true });
	await createShape(page, "Rectangle", 90, 150);
	await expect(width).toHaveValue("0.2");
	await width.fill("2.5");
	await expect(width).toBeFocused();
	await expect(width).toHaveValue("2.5");
	await width.blur();
	await (await toolbarButton(page, "Undo")).click();
	await expect(width).toHaveValue("0.2");
	await (await toolbarButton(page, "Redo")).click();
	await expect(width).toHaveValue("2.5");
	await createShape(page, "Wire", 180, 150);
	await width.fill("4");
	await expect(width).toBeFocused();
	await width.blur();
	await expect.poll(async () => (await nonPinState(page)).shapes[1].height).toBe(4);
	await width.fill("");
	await width.pressSequentially("4.5");
	await expect(width).toBeFocused();
	await width.blur();
	await expect.poll(async () => (await nonPinState(page)).shapes[1].height).toBe(4.5);
	await (await toolbarButton(page, "Undo")).click();
	await expect(width).toHaveValue("4");
	await width.fill("0");
	await width.blur();
	await width.press("Enter");
	await expect(width).toHaveValue("4");
	await width.fill("");
	await width.press("Escape");
	await expect(width).toHaveValue("4");
	await dragTo(page, [55, 115], [220, 180]);
	await expect(width).toHaveValue("");
	await expect(width).toHaveAttribute("placeholder", "Mixed");
	await width.fill("3");
	await expect(width).toBeFocused();
	await expect(width).toHaveValue("3");
	await width.blur();
	await expect.poll(async () => (await nonPinState(page)).shapes[1].height).toBe(3);
	await (await toolbarButton(page, "Undo")).click();
	// Undo restores the selection saved with the preceding edit.
	await expect(width).toHaveValue("4");
	await expect.poll(async () => (await nonPinState(page)).shapes[1].height).toBe(4);
	await clickAt(page, 90, 150);
	await expect(width).toHaveValue("2.5");
});

test("typing an attribute records only the final value on blur or Enter", async ({ page }) => {
	await createShape(page, "Rectangle", 90, 150);
	const document = async () => JSON.parse((await page.locator("#editor-document").textContent())!);
	const original = await document();
	const width = page.getByRole("spinbutton", { name: "Width", exact: true });
	await width.fill("");
	await width.pressSequentially("4");
	expect(await document()).toEqual(original);
	await width.pressSequentially("0");
	expect(await document()).toEqual(original);
	await width.press("Tab");
	await expect.poll(async () => (await document()).shapes[0].width).toBe(40);
	expect((await document()).historySize).toBe(original.historySize + 1);
	await (await toolbarButton(page, "Undo")).click();
	await expect(width).toHaveValue(String(original.shapes[0].width));
	await (await toolbarButton(page, "Redo")).click();
	await expect(width).toHaveValue("40");
	const saved = await document();
	await width.fill("4");
	await width.fill("40");
	await width.blur();
	expect(await document()).toEqual(saved);
	await width.fill("0");
	await width.press("Enter");
	await expect(width).toHaveValue("40");
	expect(await document()).toEqual(saved);
	await width.fill("");
	await width.pressSequentially("60");
	await width.press("Enter");
	await expect.poll(async () => (await document()).shapes[0].width).toBe(60);
	expect((await document()).historySize).toBe(saved.historySize + 1);
});

test("typing pin and symbol names records one change per completed edit", async ({ page }) => {
	const document = async () => JSON.parse((await page.locator("#editor-document").textContent())!);
	await placePin(page, 100, 100);
	const name = page.getByRole("textbox", { name: "Name", exact: true });
	const original = await document();
	await name.pressSequentially("VCC");
	expect(await document()).toEqual(original);
	await name.press("Enter");
	await expect.poll(async () => (await document()).shapes[0].name).toBe("VCC");
	expect((await document()).historySize).toBe(original.historySize + 1);
	await (await toolbarButton(page, "Undo")).click();
	await expect(name).toHaveValue("");
	await (await toolbarButton(page, "Redo")).click();
	await expect(name).toHaveValue("VCC");
	await insertSymbol(page, "Resistor", 200, 150);
	const placed = await document();
	await name.fill("");
	await name.pressSequentially("Input resistor");
	expect(await document()).toEqual(placed);
	await name.blur();
	await expect.poll(async () => (await document()).shapes[1].attributes.name).toBe("Input resistor");
	expect((await document()).historySize).toBe(placed.historySize + 1);
	await (await toolbarButton(page, "Undo")).click();
	await expect(name).toHaveValue("Resistor");
});

test("dimension and center fields commit on blur", async ({ page }) => {
	const field = (name: string) => page.getByRole("spinbutton", { name, exact: true });
	await createShape(page, "Rectangle", 90, 150);
	await field("Width").fill("70.25");
	await expect(field("Width")).toBeFocused();
	await field("Width").blur();
	await expect.poll(async () => (await state(page)).shapes[0].width).toBe(70.25);
	await field("Height").fill("40");
	await field("Height").blur();
	await expect.poll(async () => (await state(page)).shapes[0].height).toBe(40);
	await expect(field("Center X")).toHaveValue("90");
	await expect(field("Center Y")).toHaveValue("150");
	await field("Center X").fill("0");
	await field("Center X").blur();
	await expect.poll(async () => (await state(page)).shapes[0].x).toBe(0);
	await field("Center X").fill("");
	await field("Center X").pressSequentially("-12.5");
	await expect(field("Center X")).toBeFocused();
	await field("Center X").blur();
	await expect.poll(async () => (await state(page)).shapes[0].x).toBe(-12.5);
	await field("Center Y").fill("-20.5");
	await field("Center Y").blur();
	await expect.poll(async () => (await state(page)).shapes[0].y).toBe(-20.5);
	await (await toolbarButton(page, "Undo")).click();
	await expect(field("Center Y")).toHaveValue("150");
	await (await toolbarButton(page, "Redo")).click();
	await expect(field("Center Y")).toHaveValue("-20.5");
	await field("Width").fill("0");
	await field("Width").blur();
	await expect.poll(async () => (await state(page)).shapes[0].width).toBe(70.25);
	await field("Width").press("Tab");
	await expect(field("Width")).toHaveValue("70.25");
	await createShape(page, "Triangle", 220, 150);
	await field("Width").fill("65");
	await field("Width").blur();
	await field("Height").fill("55");
	await field("Height").blur();
	await expect.poll(async () => (await state(page)).shapes[1].width).toBe(65);
	await expect.poll(async () => (await state(page)).shapes[1].height).toBe(55);
});

test("circle dimension fields keep width, height and radius in sync", async ({ page }) => {
	const field = (name: string) => page.getByRole("spinbutton", { name, exact: true });
	await createShape(page, "Circle", 150, 100);
	await field("Radius").fill("22.5");
	await expect(field("Radius")).toBeFocused();
	await field("Radius").blur();
	await expect(field("Width")).toHaveValue("45");
	await expect(field("Height")).toHaveValue("45");
	await expect.poll(async () => (await state(page)).shapes[0].width).toBe(45);
	await field("Width").fill("60");
	await field("Width").blur();
	await expect(field("Height")).toHaveValue("60");
	await expect(field("Radius")).toHaveValue("30");
	await field("Height").fill("50");
	await field("Height").blur();
	await expect(field("Width")).toHaveValue("50");
	await expect(field("Radius")).toHaveValue("25");
	await expect.poll(async () => (await state(page)).shapes[0].height).toBe(50);
	await expect(field("Center X")).toHaveValue("150");
	await expect(field("Center Y")).toHaveValue("100");
	await (await toolbarButton(page, "Undo")).click();
	await expect(field("Height")).toHaveValue("60");
	await expect(field("Radius")).toHaveValue("30");
});

test("wire center edits move connected endpoints and length and angle fields preserve orthogonal lines", async ({ page }) => {
	const field = (name: string) => page.getByRole("spinbutton", { name, exact: true });
	await createWireChain(page, [[80, 100], [140, 100], [140, 150]]);
	await clickAt(page, 110, 100);
	await field("Center Y").fill("110");
	await expect(field("Center Y")).toBeFocused();
	await field("Center Y").blur();
	await expect.poll(() => wireEndpoints(page)).toEqual([[80, 110, 140, 110], [140, 110, 140, 150]]);
	await field("Length").fill("40");
	await field("Length").blur();
	await expect.poll(() => wireEndpoints(page)).toEqual([[90, 110, 130, 110], [140, 110, 140, 150]]);
	await field("Angle").fill("90");
	await expect(field("Angle")).toBeFocused();
	await field("Angle").blur();
	await expect.poll(() => wireEndpoints(page)).toEqual([[110, 90, 110, 130], [140, 110, 140, 150]]);
	await field("Angle").fill("45");
	await field("Angle").blur();
	await field("Angle").press("Tab");
	await expect(field("Angle")).toHaveValue("90");
	await (await toolbarButton(page, "Undo")).click();
	await expect(field("Angle")).toHaveValue("0");
	await expect(field("Length")).toHaveValue("40");
});

async function insertSymbol(page: Page, name: string, x: number, y: number) {
	await page.getByRole("button", { name: "Symbols", exact: true }).click();
	await page.getByRole("button", { name: `Insert ${name}`, exact: true }).click();
	await clickAt(page, x, y);
}

test("Alt-drag duplicates only the hit symbol, preserving its attributes and attached wires through history", async ({ page }, testInfo) => {
	await insertSymbol(page, "Resistor", 100, 150);
	await page.getByLabel("Value", { exact: true }).fill("22 kΩ");
	await page.getByLabel("Value", { exact: true }).blur();
	await page.getByLabel("Reference", { exact: true }).fill("R4");
	await page.getByLabel("Reference", { exact: true }).blur();
	await page.getByLabel("Angle", { exact: true }).fill("90");
	await page.getByLabel("Angle", { exact: true }).blur();
	await (await toolbarButton(page, "Wire")).click();
	await clickAt(page, 100, 153);
	await clickAt(page, 180, 153);
	await page.keyboard.press("Enter");
	await insertSymbol(page, "Capacitor", 200, 150);
	await page.keyboard.down("Shift");
	await clickAt(page, 100, 150);
	await page.keyboard.up("Shift");
	const committed = async () => JSON.parse((await page.locator("#editor-document").textContent())!);
	const before = await committed();
	const wires = await wireEndpoints(page);
	await page.keyboard.down("Alt");
	await moveAt(page, 100, 150);
	await page.mouse.down();
	await moveAt(page, 120, 160);
	await expect.poll(async () => (await state(page)).shapes.length).toBe(4);
	expect(await committed()).toEqual(before);
	// Releasing Alt during the gesture must keep moving the same copy.
	await page.keyboard.up("Alt");
	await moveAt(page, 140, 180);
	await page.mouse.up();
	const after = await committed();
	expect(after.historySize).toBe(before.historySize + 1);
	expect(after.shapes.slice(0, 3)).toEqual(before.shapes);
	expect(after.shapes[3]).toEqual({
		...before.shapes[0], id: 4, x: expect.closeTo(140, 4), y: expect.closeTo(180, 4),
		attributes: { ...before.shapes[0].attributes, reference: "R5" },
	});
	expect(await wireEndpoints(page)).toEqual(wires);
	await expect.poll(() => selectedNames(page)).toEqual(["symbol 4"]);
	await (await toolbarButton(page, "Undo")).click();
	await expect.poll(async () => (await committed()).shapes).toEqual(before.shapes);
	await (await toolbarButton(page, "Redo")).click();
	await expect.poll(async () => (await committed()).shapes).toEqual(after.shapes);
	await expect.poll(() => selectedNames(page)).toEqual(["symbol 4"]);
	await page.screenshot({ path: testInfo.outputPath("alt-drag-symbol.png") });
});

for (const target of ["unconnected pin", "connected pin", "body under a wire"] as const) {
	test(`Alt-drag from a symbol ${target} duplicates with grid snapping`, async ({ page }, testInfo) => {
		await insertSymbol(page, "Resistor", 100, 150);
		if (target !== "unconnected pin") {
			await (await toolbarButton(page, "Wire")).click();
			await clickAt(page, target === "connected pin" ? 103 : 97, 150);
			await clickAt(page, 180, 150);
			await page.keyboard.press("Enter");
		}
		const committed = async () => JSON.parse((await page.locator("#editor-document").textContent())!);
		const before = await committed();
		await expect.poll(async () => (await wireEndpoints(page)).length).toBe(before.shapes.filter((shape: { kind: string }) => shape.kind === "wire").length);
		const wires = await wireEndpoints(page);
		await page.getByRole("button", { name: "Snap to grid", exact: true }).click();
		const x = target === "unconnected pin" ? 97 : target === "connected pin" ? 103 : 100;
		await page.keyboard.down("Alt");
		await dragTo(page, [x, 150], [x + 18, 167]);
		await page.keyboard.up("Alt");
		await expect.poll(async () => (await state(page)).shapes.length).toBe(before.shapes.length + 1);
		const after = await committed();
		expect(after.shapes.slice(0, -1)).toEqual(before.shapes);
		expect(after.historySize).toBe(before.historySize + 1);
		expect(after.shapes.at(-1)).toMatchObject({ kind: "symbol", x: expect.closeTo(120, 4), y: expect.closeTo(170, 4) });
		expect(await wireEndpoints(page)).toEqual(wires);
		await expect(page.locator('[data-tool="select"]')).toBeAttached();
		if (target === "connected pin")
			await page.screenshot({ path: testInfo.outputPath("alt-drag-connected-pin.png") });
	});
}

test("Alt-click and canceled duplicate gestures leave the document and selection unchanged", async ({ page }) => {
	await insertSymbol(page, "Resistor", 100, 150);
	const committed = async () => JSON.parse((await page.locator("#editor-document").textContent())!);
	const before = await committed();
	await page.keyboard.down("Alt");
	await clickAt(page, 100, 150);
	expect(await committed()).toEqual(before);
	for (const cancel of ["Escape", "pointercancel", "lostpointercapture"]) {
		await moveAt(page, 100, 150);
		await page.mouse.down();
		await moveAt(page, 140, 180);
		await expect.poll(async () => (await state(page)).shapes.length).toBe(2);
		if (cancel === "Escape") await page.keyboard.press("Escape");
		else await page.locator("canvas").dispatchEvent(cancel, { pointerId: 1 });
		await page.mouse.up();
		expect(await committed()).toEqual(before);
		await expect.poll(() => selectedNames(page)).toEqual(["symbol 1"]);
		await expect.poll(async () => (await state(page)).shapes.length).toBe(1);
	}
	await page.keyboard.up("Alt");
});

test("symbols select through any child, move and delete as one, and restore with history", async ({ page }) => {
	await insertSymbol(page, "Resistor", 100, 150);
	await expect.poll(() => selectedNames(page)).toEqual(["symbol 1"]);
	await expect(page.getByLabel("Reference", { exact: true })).toHaveValue("R1");
	await expect(page.getByTestId("resize-handle")).toHaveCount(0);
	await page.getByLabel("Value", { exact: true }).fill("22 kΩ");
	await page.getByLabel("Value", { exact: true }).blur();
	await insertSymbol(page, "Capacitor", 200, 150);
	await insertSymbol(page, "Ground", 290, 150);
	await expect.poll(async () => (await state(page)).shapes.length).toBe(3);
	await dragTo(page, [97, 150], [117, 170]);
	await expect.poll(async () => (await state(page)).shapes[0].x).toBeCloseTo(120, 4);
	await expect(page.getByLabel("Value", { exact: true })).toHaveValue("22 kΩ");
	await page.keyboard.press("ArrowRight");
	await expect.poll(async () => (await state(page)).shapes[0].x).toBeCloseTo(121, 4);
	await page.getByLabel("Center Y", { exact: true }).fill("180");
	await page.getByLabel("Center Y", { exact: true }).blur();
	await page.getByLabel("Angle", { exact: true }).fill("90");
	await page.getByLabel("Angle", { exact: true }).blur();
	await clickAt(page, 121, 180);
	await expect.poll(() => selectedNames(page)).toEqual(["symbol 1"]);
	await page.keyboard.press("Delete");
	await expect.poll(async () => (await state(page)).shapes.length).toBe(2);
	await (await toolbarButton(page, "Undo")).click();
	await expect(page.getByLabel("Value", { exact: true })).toHaveValue("22 kΩ");
	await expect(page.getByLabel("Angle", { exact: true })).toHaveValue("90");
	await (await toolbarButton(page, "Redo")).click();
	await expect.poll(async () => (await state(page)).shapes.length).toBe(2);
});

test("symbols select and drag anywhere inside their compact outline, including after rotation", async ({ page }) => {
	await insertSymbol(page, "Capacitor", 200, 150);
	const symbol = (await state(page)).shapes[0];
	await expect.poll(async () => (await state(page)).outlines).toEqual([{ width: symbol.width + 0.5, height: symbol.height + 0.5 }]);
	for (let index = 0; index < 4; index++)
		await (await toolbarButton(page, "Zoom in")).click();
	await clickAt(page, 200 + symbol.width / 2 + 0.4, 150 + symbol.height / 2 + 0.4);
	await expect.poll(() => selectedNames(page)).toEqual([]);
	await clickAt(page, 200, 150);
	await expect.poll(() => selectedNames(page)).toEqual(["symbol 1"]);
	await dragTo(page, [203.3, 151.7], [223.3, 161.7]);
	await expect.poll(async () => (await state(page)).shapes[0].x).toBeCloseTo(220, 4);
	await expect.poll(async () => (await state(page)).shapes[0].y).toBeCloseTo(160, 4);
	await page.getByLabel("Angle", { exact: true }).fill("90");
	await page.getByLabel("Angle", { exact: true }).blur();
	await dragTo(page, [218.3, 163.3], [208.3, 168.3]);
	await expect.poll(async () => (await state(page)).shapes[0].x).toBeCloseTo(210, 4);
	await expect.poll(async () => (await state(page)).shapes[0].y).toBeCloseTo(165, 4);
	await (await toolbarButton(page, "Undo")).click();
	await expect.poll(async () => (await state(page)).shapes[0].x).toBeCloseTo(220, 4);
	await (await toolbarButton(page, "Redo")).click();
	await expect.poll(async () => (await state(page)).shapes[0].x).toBeCloseTo(210, 4);
});

test("symbol movement extends connections through drag, history, keyboard and attributes", async ({ page }, testInfo) => {
	await insertSymbol(page, "Resistor", 100, 150);
	await (await toolbarButton(page, "Wire")).click();
	await clickAt(page, 103, 150);
	await clickAt(page, 180, 150);
	await clickAt(page, 180, 210);
	await page.keyboard.press("Enter");
	const original = await wireEndpoints(page);
	await dragTo(page, [100, 150], [120, 170]);
	const extended = [[103, 150, 123, 150], [123, 150, 180, 150], [180, 150, 180, 210], [123, 150, 123, 170]];
	await expect.poll(() => wireEndpoints(page)).toEqual(extended);
	await expect.poll(() => selectedNames(page)).toEqual(["symbol 1"]);
	await page.screenshot({ path: testInfo.outputPath("moved-component-connections.png") });
	await (await toolbarButton(page, "Undo")).click();
	await expect.poll(() => wireEndpoints(page)).toEqual(original);
	await expect.poll(async () => (await state(page)).shapes[0].x).toBeCloseTo(100, 4);
	await (await toolbarButton(page, "Redo")).click();
	await expect.poll(() => wireEndpoints(page)).toEqual(extended);
	await clickAt(page, 120, 170);
	await page.keyboard.press("ArrowRight");
	await expect.poll(() => wireEndpoints(page)).toEqual([...extended, [123, 170, 124, 170]]);
	await page.getByLabel("Center Y", { exact: true }).fill("180");
	await page.getByLabel("Center Y", { exact: true }).blur();
	const beforeCancel = [...extended, [123, 170, 124, 170], [124, 170, 124, 180]];
	await expect.poll(() => wireEndpoints(page)).toEqual(beforeCancel);
	await moveAt(page, 121, 180);
	await page.mouse.down();
	await moveAt(page, 141, 190);
	await expect.poll(() => wireEndpoints(page)).toEqual([...beforeCancel, [124, 180, 144, 180], [144, 180, 144, 190]]);
	await page.keyboard.press("Escape");
	await page.mouse.up();
	await expect.poll(() => wireEndpoints(page)).toEqual(beforeCancel);
});

test("a free component does not acquire wire extensions while dragging across a wire", async ({ page }, testInfo) => {
	await insertSymbol(page, "Resistor", 170, 150);
	await createWireChain(page, [[200, 170], [240, 170]]);
	await expect.poll(() => wireEndpoints(page)).toEqual([[200, 170, 240, 170]]);
	await moveAt(page, 170, 150);
	await page.mouse.down();
	await moveAt(page, 203, 170);
	await expect.poll(async () => (await state(page)).shapes.find(({ name }) => name === "symbol 1")?.x).toBeCloseTo(203, 4);
	await expect.poll(() => wireEndpoints(page)).toEqual([[200, 170, 240, 170]]);
	await moveAt(page, 210, 190);
	await page.mouse.up();
	await expect.poll(async () => (await state(page)).shapes.find(({ name }) => name === "symbol 1")?.x).toBeCloseTo(210, 4);
	await expect.poll(() => wireEndpoints(page)).toEqual([[200, 170, 240, 170]]);
	for (let repeat = 0; repeat < 4; repeat++) await page.getByRole("button", { name: "Zoom in", exact: true }).click();
	await page.screenshot({ path: testInfo.outputPath("free-component-without-wire-extensions.png") });
});

test("moving a component attached to two pins keeps the connections separate", async ({ page }, testInfo) => {
	await insertSymbol(page, "Resistor", 170, 150);
	await placePin(page, 167, 150);
	await placePin(page, 173, 150);
	await dragTo(page, [170, 150], [200, 170]);
	await expect.poll(() => wireEndpoints(page)).toEqual([
		[167, 150, 167, 170], [167, 170, 197, 170],
		[173, 150, 203, 150], [203, 150, 203, 170],
	]);
	await expect.poll(async () => (await state(page)).shapes.filter(({ name }) => name.startsWith("pin ")).map(({ x, y }) => [Number(x.toFixed(4)), Number(y.toFixed(4))])).toEqual([[167, 150], [173, 150]]);
	await expect.poll(() => selectedNames(page)).toEqual(["symbol 1"]);
	for (let repeat = 0; repeat < 4; repeat++) await page.getByRole("button", { name: "Zoom in", exact: true }).click();
	await page.screenshot({ path: testInfo.outputPath("component-connected-to-two-pins.png") });
});

for (const attachment of ["wire", "pin"] as const) {
	test(`moving from an attached ${attachment} replaces preview bends on reversal and cancels cleanly`, async ({ page }, testInfo) => {
		await insertSymbol(page, "Resistor", 100, 150);
		if (attachment === "pin") await placePin(page, 103, 150);
		else {
			await (await toolbarButton(page, "Wire")).click();
			await clickAt(page, 103, 150);
			await clickAt(page, 180, 150);
			await page.keyboard.press("Enter");
		}
		await expect.poll(async () => (await state(page)).shapes.length).toBe(2);
		const before = JSON.parse((await page.locator("#editor-document").textContent())!);
		await moveAt(page, 100, 150);
		await page.mouse.down();
		await moveAt(page, 80, 180);
		await expect.poll(() => wireEndpoints(page)).toEqual([
			...(attachment === "wire" ? [[103, 150, 180, 150]] : []),
			[103, 150, 103, 180], [103, 180, 83, 180],
		]);
		await moveAt(page, 120, 130);
		await expect.poll(() => wireEndpoints(page)).toEqual([
			...(attachment === "wire" ? [[103, 150, 180, 150]] : []),
			[103, 150, 123, 150], [123, 150, 123, 130],
		]);
		await moveAt(page, 100, 150);
		await expect.poll(() => wireEndpoints(page)).toEqual(attachment === "wire" ? [[103, 150, 180, 150]] : []);
		await page.mouse.up();
		await expect.poll(async () => JSON.parse((await page.locator("#editor-document").textContent())!)).toEqual(before);
		await dragTo(page, [100, 150], [80, 180]);
		await expect.poll(() => selectedNames(page)).toEqual(["symbol 1"]);
		await expect.poll(() => wireEndpoints(page)).toEqual([
			...(attachment === "wire" ? [[103, 150, 180, 150]] : []),
			[103, 150, 103, 180], [103, 180, 83, 180],
		]);
		await page.screenshot({ path: testInfo.outputPath(`component-moved-from-${attachment}.png`) });
		await (await toolbarButton(page, "Undo")).click();
		await expect.poll(async () => JSON.parse((await page.locator("#editor-document").textContent())!).shapes).toEqual(before.shapes);
	});
}

for (const [startY, endY] of [[140, 160], [160, 140]]) {
	test(`marquee direction controls symbol containment and color from y=${startY}`, async ({ page }) => {
		await insertSymbol(page, "Capacitor", 100, 150);
		const rectangle = page.getByTestId("selection-rectangle");
		await moveAt(page, 91, startY);
		await page.mouse.down();
		await moveAt(page, 98, endY);
		await expect(rectangle).toHaveAttribute("data-selection-mode", "window");
		await expect(rectangle).toHaveCSS("border-color", "rgb(96, 165, 250)");
		await expect(rectangle).toHaveCSS("border-style", "solid");
		await expect.poll(() => selectedNames(page)).toEqual([]);
		await page.mouse.up();

		await moveAt(page, 98, startY);
		await page.mouse.down();
		await moveAt(page, 91, endY);
		await expect(rectangle).toHaveAttribute("data-selection-mode", "crossing");
		await expect(rectangle).toHaveCSS("border-color", "rgb(74, 222, 128)");
		await expect(rectangle).toHaveCSS("border-style", "dashed");
		await expect.poll(() => selectedNames(page)).toEqual(["symbol 1"]);
		// Moving back across the starting X changes the mode during the same drag.
		await moveAt(page, 109, endY);
		await expect(rectangle).toHaveAttribute("data-selection-mode", "window");
		await expect(rectangle).toHaveCSS("border-color", "rgb(96, 165, 250)");
		await expect.poll(() => selectedNames(page)).toEqual([]);
		await page.mouse.up();
		await dragTo(page, [90, 135], [110, 165]);
		await expect.poll(() => selectedNames(page)).toEqual(["symbol 1"]);
	});
}

test("marquee and shift selection keep symbols intact alongside ordinary shapes", async ({ page }) => {
	await insertSymbol(page, "Capacitor", 100, 150);
	await insertSymbol(page, "Capacitor", 200, 150);
	await createShape(page, "Rectangle", 290, 150);
	// Touch just the first symbol's left lead with a marquee.
	await dragTo(page, [98, 140], [91, 151]);
	await expect.poll(() => selectedNames(page)).toEqual(["symbol 1"]);
	await page.keyboard.down("Shift");
	await clickAt(page, 197, 150);
	await clickAt(page, 290, 150);
	await page.keyboard.up("Shift");
	await expect.poll(() => selectedNames(page)).toEqual(["symbol 1", "symbol 2", "rectangle 3"]);
	await dragTo(page, [97, 150], [107, 160]);
	await expect.poll(async () => (await state(page)).shapes.map(({ x }) => Math.round(x))).toEqual([110, 210, 300]);
	await page.keyboard.down("Shift");
	await clickAt(page, 207, 160);
	await page.keyboard.up("Shift");
	await expect.poll(() => selectedNames(page)).toEqual(["symbol 1", "rectangle 3"]);
	await page.keyboard.press("Delete");
	await expect.poll(async () => (await state(page)).shapes.map(({ name }) => name)).toEqual(["symbol 2"]);
});

test("symbol picker cancels placement and attributes belong to each instance", async ({ page }) => {
	await page.getByRole("button", { name: "Symbols", exact: true }).click();
	await expect(page.getByRole("dialog", { name: "Symbol library" })).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(page.getByRole("dialog", { name: "Symbol library" })).toHaveCount(0);
	await page.getByRole("button", { name: "Symbols", exact: true }).click();
	await page.getByRole("button", { name: "Insert Resistor", exact: true }).click();
	await moveAt(page, 100, 150);
	await page.keyboard.press("Escape");
	await clickAt(page, 100, 150);
	await expect.poll(async () => (await state(page)).shapes.length).toBe(0);
	await expect((await toolbarButton(page, "Undo"))).toBeDisabled();
	await insertSymbol(page, "Resistor", 100, 150);
	await page.getByLabel("Reference", { exact: true }).fill("R_INPUT");
	await page.getByLabel("Reference", { exact: true }).blur();
	await page.getByLabel("Value", { exact: true }).fill("47 kΩ");
	await page.getByLabel("Value", { exact: true }).blur();
	await insertSymbol(page, "Resistor", 200, 150);
	await expect(page.getByLabel("Value", { exact: true })).toHaveValue("10 kΩ");
	await clickAt(page, 100, 150);
	await expect(page.getByLabel("Reference", { exact: true })).toHaveValue("R_INPUT");
	await expect(page.getByLabel("Value", { exact: true })).toHaveValue("47 kΩ");
	await page.screenshot({ path: test.info().outputPath("symbols.png") });
});

test("symbol labels follow attribute edits and remain instance specific", async ({ page }) => {
	await insertSymbol(page, "Resistor", 100, 150);
	await expect.poll(async () => (await state(page)).symbolTexts.map((label) => label.name)).toEqual(["reference 1", "value 1"]);
	const original = (await state(page)).symbolTexts;
	await page.getByLabel("Reference", { exact: true }).fill("R_INPUT");
	await page.getByLabel("Reference", { exact: true }).blur();
	await page.getByLabel("Value", { exact: true }).fill("47 kΩ");
	await page.getByLabel("Value", { exact: true }).blur();
	await expect.poll(async () => (await state(page)).symbolTexts.every((label, index) => label.texture !== original[index].texture)).toBe(true);
	const edited = (await state(page)).symbolTexts;
	await insertSymbol(page, "Resistor", 200, 150);
	await expect.poll(async () => (await state(page)).symbolTexts.map((label) => label.name)).toEqual(["reference 1", "value 1", "reference 2", "value 2"]);
	const labels = (await state(page)).symbolTexts;
	expect(labels.slice(0, 2)).toEqual(edited);
	expect(labels[2].texture).not.toBe(edited[0].texture);
	await clickAt(page, edited[0].x, edited[0].y);
	await expect.poll(() => selectedNames(page)).toEqual(["symbol 1"]);
	await page.getByLabel("Angle", { exact: true }).fill("90");
	await page.getByLabel("Angle", { exact: true }).blur();
	await expect.poll(async () => (await state(page)).symbolTexts[0].x).not.toBeCloseTo(edited[0].x, 4);
	for (let index = 0; index < 7; index++) await (await toolbarButton(page, "Zoom in")).click();
	await page.screenshot({ path: test.info().outputPath("symbol-text.png") });
});

test("symbol placement snaps and selection-only clicks do not add history", async ({ page }) => {
	await page.getByRole("button", { name: "Snap to grid", exact: true }).click();
	await insertSymbol(page, "Resistor", 101, 151);
	await expect.poll(async () => (await state(page)).shapes.map(({ x, y }) => [x, y])).toEqual([[100, 150]]);
	await clickAt(page, 100, 150);
	await clickAt(page, 100, 150);
	await expectHistoryCount(page, 2);
	await (await toolbarButton(page, "Undo")).click();
	await expect.poll(async () => (await state(page)).shapes.length).toBe(0);
	await (await toolbarButton(page, "Redo")).click();
	await expect.poll(async () => (await state(page)).shapes.length).toBe(1);
});

test("pin names and numbers appear on canvas and restore with undo and redo", async ({ page }) => {
 const textures = (await state(page)).textures;
 await placePin(page, 210, 148.5);
 const name = page.getByRole("textbox", { name: "Name", exact: true });
 const number = page.getByRole("textbox", { name: "Number", exact: true });
 await expect(name).toHaveValue("");
 await expect(number).toHaveValue("");
 await name.fill("VCC");
 await name.press("Enter");
 await number.fill("01");
 await number.press("Enter");
 await expect.poll(async () => (await state(page)).pinTexts.map(label => label.name)).toEqual(["pin name 1", "pin number 1"]);
 const labels = (await state(page)).pinTexts;
 expect(labels.every(label => label.texture)).toBe(true);
 expect(new Set(labels.map(label => label.texture)).size).toBe(1);
 expect((await state(page)).textures).toBe(textures + 1);
 await (await toolbarButton(page, "Undo")).click();
 await expect(number).toHaveValue("");
 await expect(name).toHaveValue("VCC");
 await (await toolbarButton(page, "Redo")).click();
 await expect(number).toHaveValue("01");
 await (await toolbarButton(page, "Undo")).click();
 await (await toolbarButton(page, "Undo")).click();
 await expect(name).toHaveValue("");
 await expect.poll(async () => (await state(page)).pinTexts).toEqual([]);
 expect((await state(page)).textures).toBe(textures);
 await (await toolbarButton(page, "Redo")).click();
 await expect(name).toHaveValue("VCC");
 await (await toolbarButton(page, "Redo")).click();
 await expect(number).toHaveValue("01");
 await page.getByRole("button", { name: "Clear selection", exact: true }).click();
 await page.keyboard.down("Shift");
 await clickAt(page, 210, 148.5);
 await page.keyboard.up("Shift");
 await expect(name).toHaveValue("VCC");
 await expect(number).toHaveValue("01");
 await name.fill("");
 await name.blur();
 await (await toolbarButton(page, "Undo")).click();
 await expect(name).toHaveValue("VCC");
 await number.fill("A1");
 await number.blur();
 await expect.poll(async () => (await state(page)).pinTexts[1]?.texture).not.toBe(labels[1].texture);
 for (let index = 0; index < 8; index++) await (await toolbarButton(page, "Zoom in")).click();
 await page.screenshot({ path: test.info().outputPath("pin-name-number.png") });
});

test("pin labels stay upright on rotated library symbols", async ({ page }) => {
 await page.evaluate(() => localStorage.setItem("ecad.user-config.v1", JSON.stringify({
  version: 1, symbolLibraries: [{ id: "pins", name: "Pins", enabled: true, source: { kind: "embedded", symbols: [{
   format: "ecad-symbol", version: 1, units: "mm", id: "numbered-part", name: "Numbered part", description: "", prefix: "U", value: "",
   shapes: [{ kind: "rectangle", x: 0, y: 0, width: 10, height: 6 }, { kind: "pin", name: "VCC", number: "01", x: -7, y: 0 }],
  }] } }],
 })));
 await page.reload();
 await page.getByRole("button", { name: "Symbols", exact: true }).click();
 await page.getByRole("button", { name: "Insert Numbered part", exact: true }).click();
 const box = (await page.locator("canvas").boundingBox())!;
 await page.locator("canvas").click({ position: { x: box.width / 2, y: box.height / 2 } });
 await expect.poll(async () => (await state(page)).pinTexts.length).toBe(2);
 const labels = (await state(page)).pinTexts;
 await page.getByRole("spinbutton", { name: "Angle", exact: true }).fill("90");
 await page.getByRole("spinbutton", { name: "Angle", exact: true }).press("Enter");
 await expect.poll(async () => (await state(page)).shapes[0].rotation).toBeCloseTo(Math.PI / 2);
 expect((await state(page)).pinTexts.map(label => label.rotation)).toEqual([0, 0]);
 expect((await state(page)).pinTexts.map(label => label.texture)).toEqual(labels.map(label => label.texture));
 for (let index = 0; index < 5; index++) await (await toolbarButton(page, "Zoom in")).click();
 await page.screenshot({ path: test.info().outputPath("rotated-pin-labels.png") });
});

for (const snap of [false, true]) {
 test(`free pins still drag and restore through history with snapping ${snap}`, async ({ page }) => {
  await placePin(page, 101, 103);
  if (snap) await page.getByRole("button", { name: "Snap to grid", exact: true }).click();
  const original = await drawing(page);
  const from = await screen(page, 101, 103);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await expect(page.locator('[data-tool="select"]')).toBeAttached();
  await page.mouse.move(from.x + 1, from.y + 1);
  expect(await drawing(page)).toEqual(original);
  await moveAt(page, 131, 133);
  await page.mouse.up();
  await expect.poll(async () => (await state(page)).shapes.map(({ x, y }) => [Math.round(x), Math.round(y)]))
   .toEqual([[snap ? 130 : 131, snap ? 130 : 133]]);
  await expect(page.locator('[data-tool="select"]')).toBeAttached();
  expect((await state(page)).preview).toBeNull();
  const moved = await drawing(page);
  await (await toolbarButton(page, "Undo")).click();
  await expect.poll(() => drawing(page)).toEqual(original);
  await (await toolbarButton(page, "Redo")).click();
  await expect.poll(() => drawing(page)).toEqual(moved);
 });
}

test("clicking a free pin starts a wire without selecting the Wire tool", async ({ page }) => {
 await placePin(page, 101, 103);
 await placePin(page, 181, 153);
 await page.getByRole("button", { name: "Snap to grid", exact: true }).click();
 const document = async () => JSON.parse((await page.locator("#editor-document").textContent())!);
 const before = await document();
 await clickAt(page, 102, 103);
 await expect(page.locator('[data-tool="wire"]')).toBeAttached();
 await moveAt(page, 141, 103);
 await expect.poll(async () => (await state(page)).preview?.width).toBeGreaterThan(0);
 expect(await document()).toEqual(before);
 await page.keyboard.press("Escape");
 await expect(page.locator('[data-tool="select"]')).toBeAttached();
 expect(await document()).toEqual(before);
 await clickAt(page, 102, 103);
 await clickAt(page, 182, 152);
 await expect.poll(() => wireEndpoints(page)).toEqual([[101, 103, 181, 103], [181, 103, 181, 153]]);
 await expect(page.locator('[data-tool="select"]')).toBeAttached();
 await clickAt(page, 101, 103);
 await expect(page.locator('[data-tool="select"]')).toBeAttached();
 await moveAt(page, 130, 130);
 expect((await state(page)).preview).toBeNull();
 await (await toolbarButton(page, "Undo")).click();
 await expect.poll(() => wireEndpoints(page)).toEqual([]);
 await page.getByRole("button", { name: "Clear selection", exact: true }).click();
 await page.keyboard.down("Shift");
 await clickAt(page, 101, 103);
 await page.keyboard.up("Shift");
 await expect(page.locator('[data-tool="select"]')).toBeAttached();
 await expect.poll(() => selectedNames(page)).toEqual(["pin 1"]);
 await (await toolbarButton(page, "Redo")).click();
 await expect.poll(async () => (await wireEndpoints(page)).length).toBe(2);
});

for (const cancelWith of ["Escape", "pointercancel", "lostpointercapture"]) {
 test(`${cancelWith} cancels a pending pin click without starting a wire`, async ({ page }) => {
  await placePin(page, 101, 103);
  const original = await drawing(page);
  await moveAt(page, 101, 103);
  await page.mouse.down();
  if (cancelWith === "Escape") await page.keyboard.press("Escape");
  else await page.locator("canvas").dispatchEvent(cancelWith, { pointerId: 1 });
  await page.mouse.up();
  await moveAt(page, 141, 103);
  await expect(page.locator('[data-tool="select"]')).toBeAttached();
  expect((await state(page)).preview).toBeNull();
  expect(await drawing(page)).toEqual(original);
 });
}

test("clicking a rotated symbol's free pin starts an exact wire and Enter keeps its corner", async ({ page }) => {
 await insertSymbol(page, "Resistor", 201, 153);
 await page.getByLabel("Angle", { exact: true }).fill("90");
 await page.getByLabel("Angle", { exact: true }).blur();
 for (let index = 0; index < 6; index++) await (await toolbarButton(page, "Zoom in")).click();
 await page.getByRole("button", { name: "Snap to grid", exact: true }).click();
 await clickAt(page, 201, 156);
 await expect(page.locator('[data-tool="wire"]')).toBeAttached();
 await clickAt(page, 260, 156);
 await page.keyboard.press("Enter");
 await expect.poll(() => wireEndpoints(page)).toEqual([[201, 156, 260, 156]]);
 await expect(page.locator('[data-tool="select"]')).toBeAttached();
 await clickAt(page, 201, 150);
 await moveAt(page, 160, 150);
 await expect.poll(async () => (await state(page)).preview?.width).toBeGreaterThan(0);
 await page.screenshot({ path: test.info().outputPath("pin-click-wire-preview.png") });
 await page.keyboard.press("Escape");
 await expect.poll(async () => (await wireEndpoints(page)).length).toBe(1);
});

test("pins restrict wire starts and open ends accept both starts and finishes", async ({ page }) => {

 await expect((await toolbarButton(page, "Line"))).toBeEnabled();
 await (await toolbarButton(page, "Wire")).click();
 await clickAt(page, 100, 100);
 await moveAt(page, 160, 100);
 await clickAt(page, 160, 100);
 expect((await state(page)).shapes).toEqual([]);
 expect((await state(page)).preview).toBeNull();
 await expect((await toolbarButton(page, "Undo"))).toBeDisabled();
 await placePin(page, 100, 100);
 await expect.poll(async () => (await state(page)).shapes.map(s => s.name)).toEqual(["pin 1"]);
 await expect(page.getByTestId("resize-handle")).toHaveCount(0);
 await (await toolbarButton(page, "Wire")).click();
 await moveAt(page, 101, 101);
 await expect(page.getByTestId("wire-connection")).toBeVisible();
 await clickAt(page, 101, 101);
 await clickAt(page, 160, 100);
 await page.keyboard.press("Enter");
 await expect.poll(() => wireEndpoints(page)).toEqual([[100, 100, 160, 100]]);
 await expect.poll(async () => (await state(page)).wireTerminals.map(({ x, y, width, height }) => [Math.round(x), Math.round(y), width, height])).toEqual([[160, 100, 0.508, 0.508]]);
 // A midpoint can start a branch without changing the document until commit.
 await (await toolbarButton(page, "Wire")).click();
 await clickAt(page, 130, 100);
 await moveAt(page, 130, 150);
 await expect.poll(async () => (await state(page)).preview).not.toBeNull();
 await page.keyboard.press("Escape");
 await (await toolbarButton(page, "Wire")).click();
 // Continue from the unconnected end with snapping disabled.
 await clickAt(page, 161, 101);
 await clickAt(page, 160, 160);
 await page.keyboard.press("Escape");
 await expect.poll(async () => (await state(page)).wireTerminals.map(({ x, y }) => [Math.round(x), Math.round(y)])).toEqual([[160, 160]]);
 await placePin(page, 240, 160);
 await (await toolbarButton(page, "Wire")).click();
 await clickAt(page, 240, 160);
 await clickAt(page, 161, 160);
 await expect(await toolbarButton(page, "Wire")).toHaveAttribute("aria-pressed", "false");
 await expect.poll(() => wireEndpoints(page)).toEqual([[100, 100, 160, 100], [160, 100, 160, 160], [240, 160, 160, 160]]);
 await expect.poll(async () => (await state(page)).preview).toBeNull();
 await expect.poll(async () => (await state(page)).wireTerminals).toEqual([]);
 await (await toolbarButton(page, "Undo")).click();
 await expect.poll(async () => (await wireEndpoints(page)).length).toBe(2);
 await expect.poll(async () => (await state(page)).wireTerminals.map(({ x, y }) => [Math.round(x), Math.round(y)])).toEqual([[160, 160]]);
 await (await toolbarButton(page, "Redo")).click();
 await expect.poll(async () => (await wireEndpoints(page)).length).toBe(3);
 await expect.poll(async () => (await state(page)).wireTerminals).toEqual([]);
 await page.screenshot({ path: test.info().outputPath("pins-and-wires.png") });
});

test("wires finish exactly at off-grid pins and rotated symbol terminals", async ({ page }) => {
 await placePin(page, 101, 103);
 await placePin(page, 181, 103);
 await page.getByRole("button", { name: "Snap to grid", exact: true }).click();
 await (await toolbarButton(page, "Wire")).click();
 await clickAt(page, 102, 103);
 await clickAt(page, 180, 103);
 await expect.poll(() => wireEndpoints(page)).toEqual([[101, 103, 181, 103]]);
 await expect(page.getByRole("button", { name: "Select", exact: true })).toHaveAttribute("aria-pressed", "true");
 await insertSymbol(page, "Resistor", 250, 150);
 await page.getByLabel("Angle", { exact: true }).fill("90");
 await page.getByLabel("Angle", { exact: true }).blur();
 await placePin(page, 300, 173.81);
 await (await toolbarButton(page, "Wire")).click();
 await clickAt(page, 300, 170);
 await clickAt(page, 250, 153);
 await expect.poll(() => wireEndpoints(page)).toEqual([[101, 103, 181, 103], [300, 170, 250, 170], [250, 170, 250, 153]]);
 await expect(page.getByRole("button", { name: "Select", exact: true })).toHaveAttribute("aria-pressed", "true");
 // The other symbol terminal can start a wire too.
 await (await toolbarButton(page, "Wire")).click();
 await clickAt(page, 250, 147);
 await clickAt(page, 300, 147);
 await page.keyboard.press("Enter");
 await expect.poll(async () => (await wireEndpoints(page)).length).toBe(4);
});


test("offset off-grid pins connect with a right-angle bend and undo together", async ({ page }) => {
 await placePin(page, 101, 103);
 await placePin(page, 181, 153);
 await page.getByRole("button", { name: "Snap to grid", exact: true }).click();
 await (await toolbarButton(page, "Wire")).click();
 await clickAt(page, 101, 103);
 await moveAt(page, 182, 152);
 await expect(page.getByTestId("wire-connection")).toBeVisible();
 await clickAt(page, 182, 152);
 await expect.poll(() => wireEndpoints(page)).toEqual([[101, 103, 181, 103], [181, 103, 181, 153]]);
 await expect(page.getByRole("button", { name: "Select", exact: true })).toHaveAttribute("aria-pressed", "true");
 await (await toolbarButton(page, "Undo")).click();
 await expect.poll(() => wireEndpoints(page)).toEqual([]);
 await (await toolbarButton(page, "Redo")).click();
 await expect.poll(async () => (await wireEndpoints(page)).length).toBe(2);
});


test("compact symbols have a 6 mm pin span and the grid has ten cells per major square", async ({ page }) => {
 await insertSymbol(page, "Resistor", 100, 150);
 await expect.poll(async () => (await state(page)).shapes[0]?.width).toBeCloseTo(6.508, 3);
 await expect(page.getByRole("spinbutton", { name: "Line width", exact: true })).toHaveValue("0.254");
 await insertSymbol(page, "Capacitor", 120, 150);
 await expect.poll(async () => (await state(page)).shapes[1]?.width).toBeCloseTo(6.508, 3);
 await insertSymbol(page, "Ground", 140, 150);
 await expect.poll(async () => Math.max((await state(page)).shapes[2]?.width, (await state(page)).shapes[2]?.height)).toBeCloseTo(6.508, 3);
 for (let zoom = 0; zoom < 3; zoom++) {
  const ticks = await page.getByRole("img", { name: "Drawing rulers in millimetres" }).locator('[data-axis="x"]').evaluateAll(nodes => nodes.map(node => ({ value: Number(node.getAttribute("data-value")), major: !!node.querySelector("text") })));
  const majors = ticks.flatMap((tick, index) => tick.major ? [index] : []);
  expect(majors.length).toBeGreaterThan(1);
  expect(majors[1] - majors[0]).toBe(10);
  const step = ticks[1].value - ticks[0].value;
  await expect(await toolbarTooltip(page, "Snap to grid")).toHaveText(`Snap to grid, ${step} mm`);
  await (await toolbarButton(page, "Zoom in")).click();
 }
 await page.screenshot({ path: test.info().outputPath("compact-symbols-dense-grid.png") });
});

test("text tool places editable multiline text and preserves glyphs through history", async ({ page }) => {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	const baselineTextures = (await state(page)).textures;
	await (await toolbarButton(page, "Text")).click();
	await clickAt(page, 150, 150);
	const content = page.getByRole("textbox", { name: "Text content" });
	await expect(content).toBeFocused();
	await expect(content).toHaveValue("Text");
	await expect(page.getByRole("button", { name: "Select", exact: true })).toHaveAttribute("aria-pressed", "true");
	await expect(page.getByRole("spinbutton", { name: "Line width", exact: true })).toHaveCount(0);
	await expect.poll(async () => (await state(page)).textures).toBe(baselineTextures + 1);
	await content.fill("Board label\nÁrvíz 12Ω");
	await expect(content).toBeFocused();
	await content.blur();
	await expect.poll(async () => (await state(page)).shapes[0].height).toBeCloseTo(13.75, 4);
	const original = (await state(page)).shapes[0];
	await page.getByRole("spinbutton", { name: "Font size", exact: true }).fill("10");
	await page.getByRole("spinbutton", { name: "Font size", exact: true }).blur();
	await expect.poll(async () => (await state(page)).shapes[0].height).toBe(27.5);
	expect((await state(page)).shapes[0].texture).toBe(original.texture);
	await content.fill("Another label\nÁrvíz 12Ω");
	await content.blur();
	await expect.poll(async () => (await state(page)).shapes[0].texture).not.toBe(original.texture);
	await expect.poll(async () => (await state(page)).textures).toBe(baselineTextures + 1);
	await (await toolbarButton(page, "Undo")).click();
	await expect(content).toHaveValue("Board label\nÁrvíz 12Ω");
	await (await toolbarButton(page, "Redo")).click();
	await expect(content).toHaveValue("Another label\nÁrvíz 12Ω");
	await page.getByRole("button", { name: "Clear selection", exact: true }).click();
	await page.screenshot({ path: test.info().outputPath("text-label.png") });
	await clickAt(page, 150, 150);
	await page.getByRole("button", { name: "Delete", exact: true }).click();
	await expect.poll(async () => (await state(page)).shapes.length).toBe(0);
	await expect.poll(async () => (await state(page)).textures).toBe(baselineTextures);
	await (await toolbarButton(page, "Undo")).click();
	await expect(content).toHaveValue("Another label\nÁrvíz 12Ω");
	await expect.poll(async () => (await state(page)).textures).toBe(baselineTextures + 1);
	expect(errors).toEqual([]);
});

test("text supports dragging, proportional handles, rotation and double-click editing", async ({ page }) => {
	await (await toolbarButton(page, "Text")).click();
	await clickAt(page, 140, 130);
	const content = page.getByRole("textbox", { name: "Text content" });
	await content.fill("Hello editor");
	await content.blur();
	await page.getByRole("spinbutton", { name: "Font size", exact: true }).fill("10");
	await page.getByRole("spinbutton", { name: "Font size", exact: true }).blur();
	await dragTo(page, [140, 130], [170, 150]);
	await expect.poll(async () => (await state(page)).shapes[0].x).toBeCloseTo(170, 4);
	await expect.poll(async () => (await state(page)).shapes[0].y).toBeCloseTo(150, 4);
	const before = (await state(page)).shapes[0];
	await expect(page.getByTestId("resize-handle")).toHaveCount(4);
	await dragHandle(page, "1,1", [before.x + before.width, before.y + before.height]);
	await expect.poll(async () => (await state(page)).shapes[0].width).toBeCloseTo(before.width * 1.5, 2);
	await expect.poll(async () => (await state(page)).shapes[0].height).toBeCloseTo(before.height * 1.5, 2);
	expect((await state(page)).shapes[0].width / (await state(page)).shapes[0].height).toBeCloseTo(before.width / before.height, 8);
	await page.getByRole("spinbutton", { name: "Angle", exact: true }).fill("30");
	await page.getByRole("spinbutton", { name: "Angle", exact: true }).blur();
	await expect.poll(async () => (await state(page)).shapes[0].rotation).toBeCloseTo(Math.PI / 6, 8);
	const shape = (await state(page)).shapes[0];
	await page.getByRole("button", { name: "Clear selection", exact: true }).click();
	const point = await screen(page, shape.x, shape.y);
	await page.mouse.dblclick(point.x, point.y);
	await expect(content).toBeFocused();
	await page.keyboard.insertText("Renamed");
	await expect(content).toHaveValue("Renamed");
	await content.fill("");
	await expect(content).toBeFocused();
	await expect.poll(async () => (await state(page)).shapes[0].width).toBeGreaterThan(0);
	await content.fill("Restored");
	await content.blur();
	await page.locator("canvas").focus();
	await page.keyboard.press("ArrowRight");
	await expect.poll(async () => (await state(page)).shapes[0].x).toBeCloseTo(shape.x + 1, 3);
});

test("text placement snaps to the grid and equal-width content changes remain undoable", async ({ page }) => {
	await page.getByRole("button", { name: "Snap to grid", exact: true }).click();
	await (await toolbarButton(page, "Text")).click();
	await clickAt(page, 153, 148);
	const content = page.getByRole("textbox", { name: "Text content" });
	await expect(content).toBeFocused();
	await expect(page.getByRole("spinbutton", { name: "Anchor X", exact: true })).toHaveValue("150");
	await expect(page.getByRole("spinbutton", { name: "Anchor Y", exact: true })).toHaveValue("150");
	await content.fill("222");
	await content.blur();
	await page.getByRole("spinbutton", { name: "Font size", exact: true }).fill("10");
	await page.getByRole("spinbutton", { name: "Font size", exact: true }).blur();
	await expect.poll(async () => (await state(page)).shapes[0].height).toBe(15);
	const originalWidth = (await state(page)).shapes[0].width;
	await content.fill("333");
	await content.blur();
	await (await toolbarButton(page, "Undo")).click();
	await expect(content).toHaveValue("222");
	expect((await state(page)).shapes[0].width).toBe(originalWidth);
	await (await toolbarButton(page, "Redo")).click();
	await expect(content).toHaveValue("333");
	expect((await state(page)).shapes[0].width).toBe(originalWidth);
});

test("text movement snaps at one-tenth of the grid spacing for dragging and arrow keys", async ({ page }) => {
	await page.getByRole("button", { name: "Snap to grid", exact: true }).click();
	await (await toolbarButton(page, "Text")).click();
	await clickAt(page, 140, 130);
	await page.getByRole("textbox", { name: "Text content" }).blur();
	await dragTo(page, [140, 130], [143.4, 127.4]);
	await expect.poll(async () => (await state(page)).shapes.map(({ x, y }) => [x, y])).toEqual([[143, 127]]);
	await (await toolbarButton(page, "Undo")).click();
	await expect.poll(async () => (await state(page)).shapes.map(({ x, y }) => [x, y])).toEqual([[140, 130]]);
	await (await toolbarButton(page, "Redo")).click();
	await expect.poll(async () => (await state(page)).shapes.map(({ x, y }) => [x, y])).toEqual([[143, 127]]);
	await page.locator("canvas").focus();
	await page.keyboard.press("ArrowRight");
	await page.keyboard.press("Shift+ArrowDown");
	await expect.poll(async () => (await state(page)).shapes.map(({ x, y }) => [x, y])).toEqual([[144, 117]]);
	await expect(page.getByText("Arrow keys move 1 mm; Shift + arrows move 10 mm when the drawing is focused.", { exact: false })).toBeVisible();
	for (let zoom = 0; zoom < 4; zoom++) await (await toolbarButton(page, "Zoom in")).click();
	const tooltip = await toolbarTooltip(page, "Snap to grid");
	const step = Number((await tooltip.innerText()).match(/[\d.]+/)![0]) / 10;
	expect(step).toBeLessThan(1);
	await page.locator("canvas").focus();
	await page.keyboard.press("ArrowLeft");
	await expect.poll(async () => (await state(page)).shapes[0].x).toBeCloseTo(144 - step, 8);
	const before = (await state(page)).shapes[0];
	await dragTo(page, [before.x, before.y], [before.x + 3.4 * step, before.y - 2.6 * step]);
	await expect.poll(async () => (await state(page)).shapes[0].x).toBeCloseTo(Math.round((before.x + 3.4 * step) / step) * step, 8);
	await expect.poll(async () => (await state(page)).shapes[0].y).toBeCloseTo(Math.round((before.y - 2.6 * step) / step) * step, 8);
	await page.screenshot({ path: test.info().outputPath("text-fine-snapping.png") });
});

test("junction dots and arches distinguish connected branches from crossings", async ({ page }) => {
	await page.evaluate(async () => {
		const editorPath = "/tests/browser/editor.tsx";
		const shapesPath = "/packages/core/src/drawing/shapes.ts";
		const storePath = "/packages/core/src/commands/drawing-store.ts";
		const { drawingStore } = await import(editorPath);
		const { createDrawingStore } = await import(storePath);
		const { drawShape } = await import(shapesPath);
		let id = 1;
		const wire = (x: number, y: number, endX: number, endY: number) =>
			drawShape(id++, "wire", { x, y }, { x: endX, y: endY });
		const fixture = createDrawingStore([
			wire(181, 150, 193, 150), wire(187, 150, 187, 157),
			wire(198, 150, 204, 150), wire(204, 150, 210, 150),
			wire(204, 143, 204, 150), wire(204, 150, 204, 157),
			wire(215, 150, 227, 150), wire(221, 143, 221, 157),
			wire(232, 150, 244, 150), drawShape(id++, "pin", { x: 238, y: 150 }, { x: 238, y: 150 }),
		]);
		drawingStore.transact(() => [undefined, fixture.getSnapshot()]);
	});
	await expect.poll(async () => (await state(page)).wireJunctions.length).toBe(3);
	await expect.poll(async () => (await state(page)).wireBridges).toEqual(["wire 7"]);
	for (let index = 0; index < 8; index++) await (await toolbarButton(page, "Zoom in")).click();
	await moveAt(page, 210, 165);
	await page.screenshot({ path: test.info().outputPath("junction-dots-and-arches.png") });
});

test("wire endpoints split a trunk into three-way and four-way junctions with atomic undo", async ({ page }) => {
	const committed = async () => JSON.parse((await page.locator("#editor-document").textContent())!) as { shapes: import("#/drawing/shapes.ts").EditorShape[]; historySize: number };
	await createWireChain(page, [[100, 150], [260, 150]]);
	await placePin(page, 180, 230);
	await clickAt(page, 180, 230);
	await moveAt(page, 180, 151);
	await expect(page.getByTestId("wire-connection")).toBeVisible();
	const before = await committed();
	await clickAt(page, 180, 151);
	await expect(page.locator('[data-tool="select"]')).toBeAttached();
	await expect.poll(async () => (await wireEndpoints(page)).length).toBe(3);
	const tee = await committed();
	expect(tee.historySize).toBe(before.historySize + 1);
	const junctionEnds = (shapes: typeof tee.shapes) => shapes
		.filter((shape) => shape.kind === "wire")
		.flatMap((shape) => [-1, 1].map((sign) => ({
			x: shape.x + sign * Math.cos(shape.rotation) * shape.width / 2,
			y: shape.y + sign * Math.sin(shape.rotation) * shape.width / 2,
		})))
		.filter((point) => Math.abs(point.x - 180) < 0.001 && Math.abs(point.y - 150) < 0.001);
	expect(junctionEnds(tee.shapes)).toHaveLength(3);
	await expect.poll(async () => (await state(page)).wireJunctions).toEqual([{ x: expect.closeTo(180, 6), y: expect.closeTo(150, 6), width: 0.508, height: 0.508 }]);
	await expect.poll(() => selectedNames(page)).toEqual(["wire 4"]);
	await page.screenshot({ path: test.info().outputPath("branch-only-selected.png") });
	await page.getByRole("button", { name: "Clear selection", exact: true }).click();
	await clickAt(page, 140, 150);
	await expect(page.getByRole("spinbutton", { name: "Length", exact: true })).toHaveValue("80");
	await page.screenshot({ path: test.info().outputPath("wire-three-way-junction.png") });
	await (await toolbarButton(page, "Undo")).click();
	await expect.poll(async () => (await committed()).shapes).toEqual(before.shapes);
	await expect.poll(async () => (await state(page)).wireJunctions).toEqual([]);
	await (await toolbarButton(page, "Redo")).click();
	await expect.poll(async () => (await committed()).shapes).toEqual(tee.shapes);
	// Start the fourth leg at the existing junction itself.
	await (await toolbarButton(page, "Wire")).click();
	await clickAt(page, 180, 150);
	await clickAt(page, 180, 70);
	await page.keyboard.press("Enter");
	await expect.poll(async () => (await wireEndpoints(page)).length).toBe(4);
	const cross = await committed();
	expect(junctionEnds(cross.shapes)).toHaveLength(4);
	await expect.poll(async () => (await state(page)).wireJunctions).toEqual([{ x: expect.closeTo(180, 6), y: expect.closeTo(150, 6), width: 0.508, height: 0.508 }]);
	await page.getByRole("button", { name: "Clear selection", exact: true }).click();
	await clickAt(page, 140, 150);
	await expect(page.getByRole("spinbutton", { name: "Length", exact: true })).toHaveValue("80");
	await page.screenshot({ path: test.info().outputPath("wire-four-way-junction.png") });
	await (await toolbarButton(page, "Undo")).click();
	await expect.poll(async () => (await committed()).shapes).toEqual(tee.shapes);
	await (await toolbarButton(page, "Redo")).click();
	await expect.poll(async () => (await committed()).shapes).toEqual(cross.shapes);
});

test("drawing between components selects all new segments across a middle connection", async ({ page }) => {
	await createWireChain(page, [[180, 230], [180, 150]]);
	await insertSymbol(page, "Resistor", 100, 150);
	await insertSymbol(page, "Resistor", 260, 150);
	await (await toolbarButton(page, "Wire")).click();
	await clickAt(page, 103, 150);
	await clickAt(page, 257, 150);
	await expect(page.locator('[data-tool="select"]')).toBeAttached();
	await expect.poll(() => wireEndpoints(page)).toEqual([[180, 230, 180, 150], [103, 150, 180, 150], [180, 150, 257, 150]]);
	await expect.poll(() => selectedNames(page)).toEqual(["wire 5", "wire 6"]);
	await expect(page.getByTestId("resize-handle")).toHaveCount(4);
	await page.screenshot({ path: test.info().outputPath("all-new-wire-segments-selected.png") });
	await (await toolbarButton(page, "Undo")).click();
	await expect.poll(() => wireEndpoints(page)).toEqual([[180, 230, 180, 150]]);
	await (await toolbarButton(page, "Redo")).click();
	await expect.poll(() => selectedNames(page)).toEqual(["wire 5", "wire 6"]);
});

test("placing a pin on a wire splits it and selects only the pin through undo and redo", async ({ page }) => {
	await createWireChain(page, [[100, 150], [260, 150]]);
	await placePin(page, 180, 150);
	await expect.poll(() => wireEndpoints(page)).toEqual([[100, 150, 180, 150], [180, 150, 260, 150]]);
	await expect.poll(() => selectedNames(page)).toEqual(["pin 3"]);
	await page.screenshot({ path: test.info().outputPath("pin-splits-existing-wire.png") });
	await (await toolbarButton(page, "Undo")).click();
	await expect.poll(() => wireEndpoints(page)).toEqual([[100, 150, 260, 150]]);
	await (await toolbarButton(page, "Redo")).click();
	await expect.poll(() => selectedNames(page)).toEqual(["pin 3"]);
	await expect.poll(async () => (await wireEndpoints(page)).length).toBe(2);
});

test("drawing through an existing pin selects every new wire segment", async ({ page }) => {
	await placePin(page, 180, 150);
	await insertSymbol(page, "Resistor", 100, 150);
	await insertSymbol(page, "Resistor", 260, 150);
	await (await toolbarButton(page, "Wire")).click();
	await clickAt(page, 103, 150);
	await clickAt(page, 257, 150);
	await expect.poll(() => wireEndpoints(page)).toEqual([[103, 150, 180, 150], [180, 150, 257, 150]]);
	await expect.poll(() => selectedNames(page)).toEqual(["wire 4", "wire 5"]);
	await page.screenshot({ path: test.info().outputPath("wire-split-at-existing-pin.png") });
	await (await toolbarButton(page, "Undo")).click();
	await expect.poll(() => wireEndpoints(page)).toEqual([]);
	await (await toolbarButton(page, "Redo")).click();
	await expect.poll(() => selectedNames(page)).toEqual(["wire 4", "wire 5"]);
});

test("placing a rotated component splits a wire at its pin terminal", async ({ page }) => {
	await createWireChain(page, [[100, 150], [260, 150]]);
	await insertSymbol(page, "Resistor", 180, 153);
	await page.getByLabel("Angle", { exact: true }).fill("90");
	await page.getByLabel("Angle", { exact: true }).blur();
	await expect.poll(() => wireEndpoints(page)).toEqual([[100, 150, 180, 150], [180, 150, 260, 150]]);
	await expect.poll(() => selectedNames(page)).toEqual(["symbol 3"]);
});

for (const vertical of [false, true]) test(`a bent branch leaves every split ${vertical ? "vertical" : "horizontal"} trunk segment unselected`, async ({ page }) => {
	const point = (along: number, across: number): [number, number] => vertical ? [across, along] : [along, across];
	await createWireChain(page, [point(100, 150), point(260, 150)]);
	await placePin(page, ...point(160, 230));
	await clickAt(page, ...point(160, 230));
	await clickAt(page, ...point(200, 150));
	await expect(page.locator('[data-tool="select"]')).toBeAttached();
	await expect.poll(async () => (await wireEndpoints(page)).length).toBe(3);
	await expect.poll(() => selectedNames(page)).toEqual(["wire 4"]);
	const selectedWires = (await state(page)).shapes.filter((shape) => shape.name.startsWith("wire ") && shape.selected);
	expect(selectedWires).toHaveLength(1);
	expect(selectedWires[0].width).toBeCloseTo(80, 3);
	await page.screenshot({ path: test.info().outputPath(`bent-branch-${vertical ? "vertical" : "horizontal"}.png`) });
	await (await toolbarButton(page, "Undo")).click();
	await expect.poll(async () => (await wireEndpoints(page)).length).toBe(1);
	await (await toolbarButton(page, "Redo")).click();
	await expect.poll(() => selectedNames(page)).toEqual(["wire 4"]);
});
