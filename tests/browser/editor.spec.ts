import { expect, type Page, test } from "@playwright/test";

interface State {
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
 await page.getByRole("button", { name: "Pin", exact: true }).click();
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
	await page.getByRole("button", { name: kind, exact: true }).click();
	if (kind === "Circle") await dragTo(page, [x, y], [x + 15, y]);
	else if (kind === "Wire") {
		await placePin(page, x - 27.5, y);
		await page.getByRole("button", { name: "Wire", exact: true }).click();
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
	await page.getByRole("button", { name: "Wire", exact: true }).click();
	for (const point of points) await clickAt(page, ...point);
	await page.keyboard.press("Enter");
}
test.beforeEach(async ({ page }) => {
	await page.goto("/tests/browser/editor.html");
	await expect(page.getByRole("button", { name: "Rectangle", exact: true })).toBeEnabled();
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
	await page.getByRole("button", { name: "Rectangle", exact: true }).click();
	await clickAt(page, -25, 150);
	expect((await nonPinState(page)).shapes.length).toBe(3);
	expect(errors).toEqual([]);
});

test("stays orthographic through navigation and edits after zoom and resize", async ({ page }) => {
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
	await page.getByRole("button", { name: "Zoom in", exact: true }).click();
	await expect(page.getByRole("button", { name: "Fit drawing", exact: true })).toHaveText("125%");
	await page.setViewportSize({ width: 1000, height: 800 });
	await expect.poll(async () => (await page.locator("canvas").boundingBox())?.width).toBe(1000);
	await expect(checkCamera).toPass();
	await createShape(page, "Circle", 210, 150);
	await expect.poll(async () => (await state(page)).shapes[0]?.x).toBeCloseTo(210, 1);
	await dragTo(page, [210, 150], [230, 180]);
	await expect.poll(async () => (await state(page)).shapes[0].y).toBeCloseTo(180, 1);
	await page.keyboard.press("F6");
	await expect(page.getByRole("button", { name: "Fit drawing", exact: true })).toHaveText("100%");
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
	await page.getByRole("button", { name: "Zoom in", exact: true }).click();
	await expect(page.getByRole("button", { name: "Fit drawing", exact: true })).toHaveText("125%");
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
	await dragTo(page, [307, 90], [310, 110]);
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
	await page.getByRole("button", { name: "Rectangle", exact: true }).click();
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
	await page.getByRole("button", { name: "Rectangle", exact: true }).click();
	await dragTo(page, [280, 200], [220, 175]);
	await expect.poll(async () => (await state(page)).shapes[1]?.width).toBeCloseTo(60, 4);
	expect((await state(page)).shapes[1].height).toBeCloseTo(25, 4);
	expect((await state(page)).shapes[1].x).toBeCloseTo(250, 4);
});

test("clicks and cancelled drafts create nothing, and drawing extends beyond the paper", async ({ page }) => {
	await createShape(page, "Circle", 210, 150);
	await page.getByRole("button", { name: "Rectangle", exact: true }).click();
	await clickAt(page, 100, 100);
	await expect.poll(async () => (await state(page)).shapes.length).toBe(1);
	await expect(page.getByRole("button", { name: "Rectangle", exact: true })).toHaveAttribute("aria-pressed", "true");
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
	await page.getByRole("button", { name: "Rectangle", exact: true }).click();
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
	await page.getByRole("button", { name: "Rectangle", exact: true }).click();
	await dragTo(page, [-40, 160], [-10, 190]);
	await expect.poll(async () => (await state(page)).shapes.length).toBe(3);
	await expect.poll(async () => (await state(page)).shapes[2].x).toBeCloseTo(-25, 4);
	await dragTo(page, [-25, 175], [-10, 200]);
	await expect.poll(async () => (await state(page)).shapes[2].y).toBeCloseTo(200, 4);
	await page.screenshot({ path: test.info().outputPath("drawn-outside-paper.png") });
});

test("wire clicks commit orthogonal segments and pointer release keeps the preview", async ({ page }) => {
	const lineTool = page.getByRole("button", { name: "Wire", exact: true });
	await placePin(page, 100, 100);
	await lineTool.click();
	await dragTo(page, [100, 100], [160, 120]);
	await expect.poll(async () => (await nonPinState(page)).preview?.width).toBeCloseTo(60, 4);
	let view = await nonPinState(page);
	expect(view.shapes).toEqual([]);
	expect(view.preview?.x).toBeCloseTo(130, 4);
	expect(view.preview?.y).toBeCloseTo(100, 4);
	expect(view.preview?.rotation).toBeCloseTo(0, 4);
	await clickAt(page, 160, 120);
	await expect.poll(async () => (await nonPinState(page)).shapes.length).toBe(1);
	await expect(lineTool).toHaveAttribute("aria-pressed", "true");
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
		await page.getByRole("button", { name: "Wire", exact: true }).click();
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
	await page.getByRole("button", { name: "Wire", exact: true }).click();
	await clickAt(page, 100, 100);
	await clickAt(page, 100, 100);
	await moveAt(page, 160, 120);
	await expect.poll(async () => (await nonPinState(page)).preview?.width).toBeCloseTo(60, 4);
	expect((await nonPinState(page)).shapes).toEqual([]);
	await page.getByRole("button", { name: "Rectangle", exact: true }).click();
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
	await page.getByRole("button", { name: "Wire", exact: true }).click();
	await clickAt(page, 95, 105);
	await clickAt(page, 153, 122);
	await moveAt(page, 163, 167);
	await expect.poll(async () => (await nonPinState(page)).preview?.width).toBe(60);
	const preview = (await nonPinState(page)).preview;
	expect(preview?.x).toBe(155);
	expect(preview?.y).toBe(135);
	await clickAt(page, 163, 167);
	await page.keyboard.press("Enter");
	await expect.poll(async () => (await nonPinState(page)).shapes.length).toBe(2);
	const [first, second] = (await nonPinState(page)).shapes;
	expect(first.x).toBe(125);
	expect(first.y).toBe(105);
	expect(first.width).toBe(60);
	expect(first.rotation).toBe(0);
	expect(second.x).toBe(155);
	expect(second.y).toBe(135);
	expect(second.width).toBe(60);
	expect(second.rotation).toBeCloseTo(Math.PI / 2, 4);
});

test("wire chains keep placed corners when grid snapping and zoom change", async ({ page }) => {
	await placePin(page, 93, 103);
	await page.getByRole("button", { name: "Wire", exact: true }).click();
	await clickAt(page, 93, 103);
	await clickAt(page, 153, 122);
	await expect.poll(async () => (await nonPinState(page)).shapes.length).toBe(1);
	const first = (await nonPinState(page)).shapes[0];
	await page.getByRole("button", { name: "Snap to grid", exact: true }).click();
	await clickAt(page, 163, 167);
	await expect.poll(async () => (await nonPinState(page)).shapes.length).toBe(2);
	for (let index = 0; index < 4; index++) {
		await page.getByRole("button", { name: "Zoom in", exact: true }).click();
	}
	await expect.poll(() => visibleGridStep(page)).toBe(2);
	await clickAt(page, 201.2, 181);
	await page.keyboard.press("Enter");
	await expect.poll(async () => (await nonPinState(page)).shapes.length).toBe(3);
	const lines = (await nonPinState(page)).shapes;
	expect(lines[0].x).toBe(first.x);
	expect(lines[0].y).toBe(first.y);
	expect(lines[0].width).toBe(first.width);
	expect(lines[1].x).toBeCloseTo(153, 4);
	expect(lines[1].y).toBeCloseTo(134, 4);
	expect(lines[1].width).toBeCloseTo(62, 4);
	expect(lines[1].rotation).toBeCloseTo(Math.PI / 2, 4);
	expect(lines[2].x).toBeCloseTo(177.5, 4);
	expect(lines[2].y).toBeCloseTo(165, 4);
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
	await expect.poll(async () => (await nonPinState(page)).shapes[1].width).toBeCloseTo(100, 1);
	const shapes = (await nonPinState(page)).shapes;
	expect(shapes[1].x).toBeCloseTo(190, 1);
	expect(shapes[1].y).toBeCloseTo(160, 1);
	expect(shapes[1].rotation).toBeCloseTo(Math.PI / 2, 4);
	expect(shapes[0]).toEqual(moved[0]);
	expect(shapes[2]).toEqual(moved[2]);
	expect(shapes[3]).toEqual(originals[3]);
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
	await expect.poll(() => wireEndpoints(page)).toEqual([[100, 115, 175, 115], [175, 115, 175, 175], [175, 175, 100, 175]]);
	await page.keyboard.press("ArrowRight");
	await expect.poll(() => wireEndpoints(page)).toEqual([[100, 115, 180, 115], [180, 115, 180, 175], [180, 175, 100, 175]]);
	await page.keyboard.press("Shift+ArrowUp");
	await expect.poll(() => wireEndpoints(page)).toEqual([[100, 165, 180, 165], [180, 165, 180, 225], [180, 225, 100, 225]]);
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
 await page.getByRole("button", { name: "Wire", exact: true }).click();
 await clickAt(page, 100, 100);
 await clickAt(page, 160, 100);
 await expect.poll(() => wireEndpoints(page)).toEqual([[100, 100, 160, 100]]);
 await expect.poll(() => selectedNames(page)).toEqual(["wire 3"]);
 // Extend the now-open endpoint, then double back to overlap the existing wire.
 await page.getByRole("button", { name: "Wire", exact: true }).click();
 await clickAt(page, 160, 100);
 await clickAt(page, 190, 100);
 await expect.poll(() => wireEndpoints(page)).toEqual([[100, 100, 190, 100]]);
 await expect.poll(() => selectedNames(page)).toEqual(["wire 4"]);
 await clickAt(page, 140, 100);
 await expect.poll(() => wireEndpoints(page)).toEqual([[190, 100, 100, 100]]);
 await expect.poll(() => selectedNames(page)).toEqual(["wire 5"]);
 await clickAt(page, 150, 160);
 await page.keyboard.press("Enter");
 await expect.poll(() => wireEndpoints(page)).toEqual([[190, 100, 100, 100], [140, 100, 140, 160]]);
 expect((await nonPinState(page)).shapes.map((shape) => shape.name)).toEqual(["wire 5", "wire 6"]);
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
	await page.getByRole("button", { name: "Wire", exact: true }).click();
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
	await dragTo(page, [95, 115], [105, 130]);
	await expect.poll(() => selectedNames(page)).toEqual(["wire 2"]);
	await dragTo(page, [100, 120], [120, 140]);
	await expect.poll(async () => (await nonPinState(page)).shapes[0].x).toBeCloseTo(120, 4);
	await page.getByRole("button", { name: "Circle", exact: true }).click();
	await dragTo(page, [250, 100], [290, 100]);
	await expect.poll(async () => (await nonPinState(page)).shapes[1]?.width).toBeCloseTo(80, 4);
	expect((await nonPinState(page)).shapes[1].height).toBeCloseTo(80, 4);
	await expect(page.getByRole("spinbutton", { name: "Radius", exact: true })).toHaveValue("40");
	await page.getByRole("button", { name: "Triangle", exact: true }).click();
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
	await page.getByRole("button", { name: "Wire", exact: true }).click();
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
	await page.getByRole("button", { name: "Zoom in", exact: true }).click();
	await expect(page.getByRole("button", { name: "Fit drawing", exact: true })).toHaveText("125%");
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
	expect(await visibleGridStep(page)).toBe(5);
	await snap.click();
	await expect(snap).toHaveAttribute("aria-pressed", "true");
	await page.getByRole("button", { name: "Rectangle", exact: true }).click();
	await dragTo(page, [-83, -37], [-23, 32]);
	await expect.poll(async () => (await state(page)).shapes[0]?.width).toBeCloseTo(60, 4);
	let shape = (await state(page)).shapes[0];
	expect(shape.x).toBe(-55);
	expect(shape.y).toBe(-2.5);
	expect(shape.height).toBe(65);
	await dragHandle(page, "1,1", [13, 56]);
	await expect.poll(async () => (await state(page)).shapes[0].width).toBeCloseTo(100, 4);
	shape = (await state(page)).shapes[0];
	expect(shape.height).toBe(90);
	expect(shape.x - shape.width / 2).toBe(-85);
	expect(shape.y - shape.height / 2).toBe(-35);
	await page.keyboard.press("ArrowRight");
	await expect.poll(async () => (await state(page)).shapes[0].x).toBe(-30);
	await page.keyboard.press("Shift+ArrowUp");
	await expect.poll(async () => (await state(page)).shapes[0].y).toBe(60);
	await snap.click();
	await page.getByRole("button", { name: "Triangle", exact: true }).click();
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
	await expect.poll(async () => (await state(page)).shapes[1].x).toBe(-25);
	await page.keyboard.press("Escape");
	await page.mouse.up();
	await expect.poll(async () => (await state(page)).shapes).toEqual(moved);
});

test("snap spacing follows grid zoom for circle radii and line endpoints", async ({ page }) => {
	await fitCenteredEditor(page);
	const initialStep = await visibleGridStep(page);
	for (let index = 0; index < 4; index++) {
		await page.getByRole("button", { name: "Zoom in", exact: true }).click();
	}
	await expect.poll(() => visibleGridStep(page)).not.toBe(initialStep);
	const step = await visibleGridStep(page);
	expect(step).toBe(2);
	const snap = page.getByRole("button", { name: "Snap to grid", exact: true });
	await expect(snap).toHaveAttribute("title", `Snap to grid (${step} mm)`);
	await snap.click();
	await page.getByRole("button", { name: "Circle", exact: true }).click();
	await dragTo(page, [-31.2, -19.2], [-19, -7]);
	await expect.poll(async () => (await nonPinState(page)).shapes[0]?.width).toBe(36);
	let circle = (await nonPinState(page)).shapes[0];
	expect(circle.x).toBe(-32);
	expect(circle.y).toBe(-20);
	await dragHandle(page, "1,0", [-3.1, -20]);
	await expect.poll(async () => (await nonPinState(page)).shapes[0].width).toBe(56);
	circle = (await nonPinState(page)).shapes[0];
	expect(circle.height).toBe(56);
	await placePin(page, 9.2, 9.2);
	await page.getByRole("button", { name: "Wire", exact: true }).click();
	await clickAt(page, 10, 10);
	await clickAt(page, 25.2, 21);
	await page.keyboard.press("Enter");
	await expect.poll(async () => (await nonPinState(page)).shapes[1]?.width).toBeCloseTo(16, 4);
	await dragHandle(page, "1,0", [39.2, 33]);
	await expect.poll(async () => (await nonPinState(page)).shapes[1].width).toBeCloseTo(30, 4);
	const line = (await nonPinState(page)).shapes[1];
	expect(line.x - Math.cos(line.rotation) * line.width / 2).toBeCloseTo(10, 4);
	expect(line.y - Math.sin(line.rotation) * line.width / 2).toBeCloseTo(10, 4);
	expect(line.x + Math.cos(line.rotation) * line.width / 2).toBeCloseTo(40, 4);
	expect(line.y + Math.sin(line.rotation) * line.width / 2).toBeCloseTo(10, 4);
	await page.screenshot({ path: test.info().outputPath("snap-to-grid.png") });
});

async function openHistory(page: Page) {
	const panel = page.getByRole("region", { name: "Drawing history", exact: true });
	if (!await panel.isVisible()) await page.getByRole("button", { name: "History", exact: true }).click();
	await expect(panel).toBeVisible();
	return panel;
}

async function expectHistoryCount(page: Page, count: number) {
	const history = await openHistory(page);
	await expect(history.getByRole("button", { name: /^Restore #/ })).toHaveCount(count);
}

test("history records each completed drawing gesture once and undo and redo restore every edit", async ({ page }) => {
	await openHistory(page);
	const undo = page.getByRole("button", { name: "Undo", exact: true });
	const redo = page.getByRole("button", { name: "Redo", exact: true });
	await expectHistoryCount(page, 1);
	await expect(undo).toBeDisabled();
	await expect(redo).toBeDisabled();
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
	await undo.click();
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
	await expect(undo).toBeDisabled();
	await page.keyboard.press("Control+Shift+z");
	await expect.poll(() => drawing(page)).toEqual(created);
	await page.keyboard.press("Control+y");
	await expect.poll(() => drawing(page)).toEqual(moved);
	await redo.click();
	await expect.poll(() => drawing(page)).toEqual(resized);
	await redo.click();
	await expect.poll(() => drawing(page)).toEqual(nudged);
	await redo.click();
	await expect.poll(() => drawing(page)).toEqual([]);
	await expect(redo).toBeDisabled();
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
	await page.getByRole("button", { name: "Rectangle", exact: true }).click();
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
	await page.getByRole("button", { name: "Zoom in", exact: true }).click();
	await snap.click();
	await expectHistoryCount(page, 2);
	const view = await state(page);
	await page.getByRole("button", { name: "Undo", exact: true }).click();
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
	await page.getByRole("button", { name: "Undo", exact: true }).click();
	await expect.poll(() => drawing(page)).toEqual(loop);
	await page.getByRole("button", { name: "Redo", exact: true }).click();
	await expect.poll(() => drawing(page)).toEqual(merged);
	await expect.poll(() => selectedNames(page)).toEqual(["wire 3"]);
	await expectHistoryCount(page, 7);
});

test("history keeps old futures after a new edit and restores either branch", async ({ page }) => {
	const history = await openHistory(page);
	const undo = page.getByRole("button", { name: "Undo", exact: true });
	const redo = page.getByRole("button", { name: "Redo", exact: true });
	await createShape(page, "Rectangle", 150, 100);
	await expect.poll(async () => (await nonPinState(page)).shapes[0]?.x).toBeCloseTo(150, 4);
	const created = await drawing(page);
	await dragTo(page, [150, 100], [180, 120]);
	await expectHistoryCount(page, 3);
	await expect.poll(async () => (await nonPinState(page)).shapes[0]?.x).toBeCloseTo(180, 4);
	const oldFuture = await drawing(page);
	await undo.click();
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
	await undo.click();
	await expect.poll(() => drawing(page)).toEqual(created);
	await redo.click();
	await expect.poll(() => drawing(page)).toEqual(oldFuture);
	await openHistory(page);
	await resizeNode.click();
	await expect.poll(() => drawing(page)).toEqual(newFuture);
	await expect(resizeNode).toHaveAttribute("aria-current", "step");
	await history.screenshot({ path: test.info().outputPath("drawing-history-branches.png") });
	await placePin(page, 100, 160);
	await page.getByRole("button", { name: "Wire", exact: true }).click();
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
	await undo.click();
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
	await page.getByRole("button", { name: "Wire", exact: true }).click();
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
	await page.getByRole("button", { name: "Undo", exact: true }).click();
	await expect(width).toHaveValue("0.2");
	await page.getByRole("button", { name: "Redo", exact: true }).click();
	await expect(width).toHaveValue("2.5");
	await createShape(page, "Wire", 180, 150);
	await width.fill("4");
	await expect(width).toBeFocused();
	await expect.poll(async () => (await nonPinState(page)).shapes[1].height).toBe(4);
	await width.fill("");
	await width.pressSequentially("4.5");
	await expect(width).toBeFocused();
	await expect.poll(async () => (await nonPinState(page)).shapes[1].height).toBe(4.5);
	await page.getByRole("button", { name: "Undo", exact: true }).click();
	await expect(width).toHaveValue("4");
	await width.fill("0");
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
	await expect.poll(async () => (await nonPinState(page)).shapes[1].height).toBe(3);
	await page.getByRole("button", { name: "Undo", exact: true }).click();
	// Undo restores the selection saved with the preceding edit.
	await expect(width).toHaveValue("4");
	await expect.poll(async () => (await nonPinState(page)).shapes[1].height).toBe(4);
	await clickAt(page, 90, 150);
	await expect(width).toHaveValue("2.5");
});

test("dimension and center fields edit immediately without losing focus", async ({ page }) => {
	const field = (name: string) => page.getByRole("spinbutton", { name, exact: true });
	await createShape(page, "Rectangle", 90, 150);
	await field("Width").fill("70.25");
	await expect(field("Width")).toBeFocused();
	await expect.poll(async () => (await state(page)).shapes[0].width).toBe(70.25);
	await field("Height").fill("40");
	await expect.poll(async () => (await state(page)).shapes[0].height).toBe(40);
	await expect(field("Center X")).toHaveValue("90");
	await expect(field("Center Y")).toHaveValue("150");
	await field("Center X").fill("0");
	await expect.poll(async () => (await state(page)).shapes[0].x).toBe(0);
	await field("Center X").fill("");
	await field("Center X").pressSequentially("-12.5");
	await expect(field("Center X")).toBeFocused();
	await expect.poll(async () => (await state(page)).shapes[0].x).toBe(-12.5);
	await field("Center Y").fill("-20.5");
	await expect.poll(async () => (await state(page)).shapes[0].y).toBe(-20.5);
	await page.getByRole("button", { name: "Undo", exact: true }).click();
	await expect(field("Center Y")).toHaveValue("150");
	await page.getByRole("button", { name: "Redo", exact: true }).click();
	await expect(field("Center Y")).toHaveValue("-20.5");
	await field("Width").fill("0");
	await expect.poll(async () => (await state(page)).shapes[0].width).toBe(70.25);
	await field("Width").press("Tab");
	await expect(field("Width")).toHaveValue("70.25");
	await createShape(page, "Triangle", 220, 150);
	await field("Width").fill("65");
	await field("Height").fill("55");
	await expect.poll(async () => (await state(page)).shapes[1].width).toBe(65);
	await expect.poll(async () => (await state(page)).shapes[1].height).toBe(55);
});

test("circle dimension fields keep width, height and radius in sync", async ({ page }) => {
	const field = (name: string) => page.getByRole("spinbutton", { name, exact: true });
	await createShape(page, "Circle", 150, 100);
	await field("Radius").fill("22.5");
	await expect(field("Radius")).toBeFocused();
	await expect(field("Width")).toHaveValue("45");
	await expect(field("Height")).toHaveValue("45");
	await expect.poll(async () => (await state(page)).shapes[0].width).toBe(45);
	await field("Width").fill("60");
	await expect(field("Height")).toHaveValue("60");
	await expect(field("Radius")).toHaveValue("30");
	await field("Height").fill("50");
	await expect(field("Width")).toHaveValue("50");
	await expect(field("Radius")).toHaveValue("25");
	await expect.poll(async () => (await state(page)).shapes[0].height).toBe(50);
	await expect(field("Center X")).toHaveValue("150");
	await expect(field("Center Y")).toHaveValue("100");
	await page.getByRole("button", { name: "Undo", exact: true }).click();
	await expect(field("Height")).toHaveValue("60");
	await expect(field("Radius")).toHaveValue("30");
});

test("wire center edits move connected endpoints and length and angle fields preserve orthogonal lines", async ({ page }) => {
	const field = (name: string) => page.getByRole("spinbutton", { name, exact: true });
	await createWireChain(page, [[80, 100], [140, 100], [140, 150]]);
	await clickAt(page, 110, 100);
	await field("Center Y").fill("110");
	await expect(field("Center Y")).toBeFocused();
	await expect.poll(() => wireEndpoints(page)).toEqual([[80, 110, 140, 110], [140, 110, 140, 150]]);
	await field("Length").fill("40");
	await expect.poll(() => wireEndpoints(page)).toEqual([[90, 110, 130, 110], [140, 110, 140, 150]]);
	await field("Angle").fill("90");
	await expect(field("Angle")).toBeFocused();
	await expect.poll(() => wireEndpoints(page)).toEqual([[110, 90, 110, 130], [140, 110, 140, 150]]);
	await field("Angle").fill("45");
	await field("Angle").press("Tab");
	await expect(field("Angle")).toHaveValue("90");
	await page.getByRole("button", { name: "Undo", exact: true }).click();
	await expect(field("Angle")).toHaveValue("0");
	await expect(field("Length")).toHaveValue("40");
});

async function insertSymbol(page: Page, name: string, x: number, y: number) {
	await page.getByRole("button", { name: "Symbols", exact: true }).click();
	await page.getByRole("button", { name: `Insert ${name}`, exact: true }).click();
	await clickAt(page, x, y);
}

test("symbols select through any child, move and delete as one, and restore with history", async ({ page }) => {
	await insertSymbol(page, "Resistor", 100, 150);
	await expect.poll(() => selectedNames(page)).toEqual(["symbol 1"]);
	await expect(page.getByLabel("Reference", { exact: true })).toHaveValue("R1");
	await expect(page.getByTestId("resize-handle")).toHaveCount(0);
	await page.getByLabel("Value", { exact: true }).fill("22 kΩ");
	await insertSymbol(page, "Capacitor", 200, 150);
	await insertSymbol(page, "Ground", 290, 150);
	await expect.poll(async () => (await state(page)).shapes.length).toBe(3);
	// Grab only the resistor's left lead.
	await dragTo(page, [97, 150], [117, 170]);
	await expect.poll(async () => (await state(page)).shapes[0].x).toBeCloseTo(120, 4);
	await expect(page.getByLabel("Value", { exact: true })).toHaveValue("22 kΩ");
	await page.keyboard.press("ArrowRight");
	await expect.poll(async () => (await state(page)).shapes[0].x).toBeCloseTo(121, 4);
	await page.getByLabel("Center Y", { exact: true }).fill("180");
	await page.getByLabel("Angle", { exact: true }).fill("90");
	await clickAt(page, 121, 177);
	await expect.poll(() => selectedNames(page)).toEqual(["symbol 1"]);
	await page.keyboard.press("Delete");
	await expect.poll(async () => (await state(page)).shapes.length).toBe(2);
	await page.getByRole("button", { name: "Undo", exact: true }).click();
	await expect(page.getByLabel("Value", { exact: true })).toHaveValue("22 kΩ");
	await expect(page.getByLabel("Angle", { exact: true })).toHaveValue("90");
	await page.getByRole("button", { name: "Redo", exact: true }).click();
	await expect.poll(async () => (await state(page)).shapes.length).toBe(2);
});

test("marquee and shift selection keep symbols intact alongside ordinary shapes", async ({ page }) => {
	await insertSymbol(page, "Capacitor", 100, 150);
	await insertSymbol(page, "Capacitor", 200, 150);
	await createShape(page, "Rectangle", 290, 150);
	// Touch just the first symbol's left lead with a marquee.
	await dragTo(page, [91, 156], [98, 148]);
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
	await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
	await insertSymbol(page, "Resistor", 100, 150);
	await page.getByLabel("Reference", { exact: true }).fill("R_INPUT");
	await page.getByLabel("Value", { exact: true }).fill("47 kΩ");
	await insertSymbol(page, "Resistor", 200, 150);
	await expect(page.getByLabel("Value", { exact: true })).toHaveValue("10 kΩ");
	await clickAt(page, 100, 150);
	await expect(page.getByLabel("Reference", { exact: true })).toHaveValue("R_INPUT");
	await expect(page.getByLabel("Value", { exact: true })).toHaveValue("47 kΩ");
	await page.screenshot({ path: test.info().outputPath("symbols.png") });
});

test("symbol placement snaps and selection-only clicks do not add history", async ({ page }) => {
	await page.getByRole("button", { name: "Snap to grid", exact: true }).click();
	await insertSymbol(page, "Resistor", 101, 151);
	await expect.poll(async () => (await state(page)).shapes.map(({ x, y }) => [x, y])).toEqual([[100, 150]]);
	await clickAt(page, 97, 150);
	await clickAt(page, 103, 150);
	await expectHistoryCount(page, 2);
	await page.getByRole("button", { name: "Undo", exact: true }).click();
	await expect.poll(async () => (await state(page)).shapes.length).toBe(0);
	await page.getByRole("button", { name: "Redo", exact: true }).click();
	await expect.poll(async () => (await state(page)).shapes.length).toBe(1);
});

test("pins restrict wire starts and open ends accept both starts and finishes", async ({ page }) => {
 const wireTool = page.getByRole("button", { name: "Wire", exact: true });
 await expect(page.getByRole("button", { name: "Line", exact: true })).toHaveCount(0);
 await wireTool.click();
 await clickAt(page, 100, 100);
 await moveAt(page, 160, 100);
 await clickAt(page, 160, 100);
 expect((await state(page)).shapes).toEqual([]);
 expect((await state(page)).preview).toBeNull();
 await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
 await placePin(page, 100, 100);
 await expect.poll(async () => (await state(page)).shapes.map(s => s.name)).toEqual(["pin 1"]);
 await expect(page.getByTestId("resize-handle")).toHaveCount(0);
 await wireTool.click();
 await moveAt(page, 101, 101);
 await expect(page.getByTestId("wire-connection")).toBeVisible();
 await clickAt(page, 101, 101);
 await clickAt(page, 160, 100);
 await page.keyboard.press("Enter");
 await expect.poll(() => wireEndpoints(page)).toEqual([[100, 100, 160, 100]]);
 // Neither the midpoint of a segment nor an arbitrary shape is a valid start.
 await wireTool.click();
 await clickAt(page, 130, 100);
 await moveAt(page, 130, 150);
 expect((await state(page)).preview).toBeNull();
 // Continue from the unconnected end with snapping disabled.
 await clickAt(page, 161, 101);
 await clickAt(page, 160, 160);
 await page.keyboard.press("Escape");
 await placePin(page, 240, 160);
 await wireTool.click();
 await clickAt(page, 240, 160);
 await clickAt(page, 161, 160);
 await expect(wireTool).toHaveAttribute("aria-pressed", "false");
 await expect.poll(() => wireEndpoints(page)).toEqual([[100, 100, 160, 100], [160, 100, 160, 160], [240, 160, 160, 160]]);
 await expect.poll(async () => (await state(page)).preview).toBeNull();
 await page.getByRole("button", { name: "Undo", exact: true }).click();
 await expect.poll(async () => (await wireEndpoints(page)).length).toBe(2);
 await page.getByRole("button", { name: "Redo", exact: true }).click();
 await expect.poll(async () => (await wireEndpoints(page)).length).toBe(3);
 await page.screenshot({ path: test.info().outputPath("pins-and-wires.png") });
});

test("wires finish exactly at off-grid pins and rotated symbol terminals", async ({ page }) => {
 await placePin(page, 101, 103);
 await placePin(page, 181, 103);
 await page.getByRole("button", { name: "Snap to grid", exact: true }).click();
 await page.getByRole("button", { name: "Wire", exact: true }).click();
 await clickAt(page, 102, 103);
 await clickAt(page, 180, 103);
 await expect.poll(() => wireEndpoints(page)).toEqual([[101, 103, 181, 103]]);
 await expect(page.getByRole("button", { name: "Select", exact: true })).toHaveAttribute("aria-pressed", "true");
 await insertSymbol(page, "Resistor", 250, 150);
 await page.getByLabel("Angle", { exact: true }).fill("90");
 await placePin(page, 300, 173.81);
 await page.getByRole("button", { name: "Wire", exact: true }).click();
 await clickAt(page, 300, 175);
 await clickAt(page, 250, 152.8125);
 await expect.poll(() => wireEndpoints(page)).toEqual([[101, 103, 181, 103], [300, 175, 250, 175], [250, 175, 250, 152.8125]]);
 await expect(page.getByRole("button", { name: "Select", exact: true })).toHaveAttribute("aria-pressed", "true");
 // The other symbol terminal can start a wire too.
 await page.getByRole("button", { name: "Wire", exact: true }).click();
 await clickAt(page, 250, 147.1875);
 await clickAt(page, 300, 147.1875);
 await page.keyboard.press("Enter");
 await expect.poll(async () => (await wireEndpoints(page)).length).toBe(4);
});


test("offset off-grid pins connect with a right-angle bend and undo together", async ({ page }) => {
 await placePin(page, 101, 103);
 await placePin(page, 181, 153);
 await page.getByRole("button", { name: "Snap to grid", exact: true }).click();
 await page.getByRole("button", { name: "Wire", exact: true }).click();
 await clickAt(page, 101, 103);
 await moveAt(page, 182, 152);
 await expect(page.getByTestId("wire-connection")).toBeVisible();
 await clickAt(page, 182, 152);
 await expect.poll(() => wireEndpoints(page)).toEqual([[101, 103, 181, 103], [181, 103, 181, 153]]);
 await expect(page.getByRole("button", { name: "Select", exact: true })).toHaveAttribute("aria-pressed", "true");
 await page.getByRole("button", { name: "Undo", exact: true }).click();
 await expect.poll(() => wireEndpoints(page)).toEqual([]);
 await page.getByRole("button", { name: "Redo", exact: true }).click();
 await expect.poll(async () => (await wireEndpoints(page)).length).toBe(2);
});


test("compact symbols span 6 mm with KiCad proportions and the grid has ten cells per major square", async ({ page }) => {
 await insertSymbol(page, "Resistor", 100, 150);
 await expect.poll(async () => (await state(page)).shapes[0].width).toBeCloseTo(6, 3);
 await expect(page.getByRole("spinbutton", { name: "Line width", exact: true })).toHaveValue("0.254");
 await insertSymbol(page, "Capacitor", 120, 150);
 await expect.poll(async () => (await state(page)).shapes[1].width).toBeCloseTo(6, 3);
 await insertSymbol(page, "Ground", 140, 150);
 await expect.poll(async () => Math.max((await state(page)).shapes[2].width, (await state(page)).shapes[2].height)).toBeCloseTo(6, 3);
 for (let zoom = 0; zoom < 3; zoom++) {
  const ticks = await page.getByRole("img", { name: "Drawing rulers in millimetres" }).locator('[data-axis="x"]').evaluateAll(nodes => nodes.map(node => ({ value: Number(node.getAttribute("data-value")), major: !!node.querySelector("text") })));
  const majors = ticks.flatMap((tick, index) => tick.major ? [index] : []);
  expect(majors.length).toBeGreaterThan(1);
  expect(majors[1] - majors[0]).toBe(10);
  const step = ticks[1].value - ticks[0].value;
  await expect(page.getByRole("button", { name: "Snap to grid", exact: true })).toHaveAttribute("title", `Snap to grid (${step} mm)`);
  await page.getByRole("button", { name: "Zoom in", exact: true }).click();
 }
 await page.screenshot({ path: test.info().outputPath("compact-symbols-dense-grid.png") });
});

test("text tool places editable multiline text and preserves glyphs through history", async ({ page }) => {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	const baselineTextures = (await state(page)).textures;
	await page.getByRole("button", { name: "Text", exact: true }).click();
	await clickAt(page, 150, 150);
	const content = page.getByRole("textbox", { name: "Text content" });
	await expect(content).toBeFocused();
	await expect(content).toHaveValue("Text");
	await expect(page.getByRole("button", { name: "Select", exact: true })).toHaveAttribute("aria-pressed", "true");
	await expect(page.getByRole("spinbutton", { name: "Line width", exact: true })).toHaveCount(0);
	await expect.poll(async () => (await state(page)).textures).toBe(baselineTextures + 1);
	await content.fill("Board label\nÁrvíz 12Ω");
	await expect(content).toBeFocused();
	await expect.poll(async () => (await state(page)).shapes[0].height).toBeCloseTo(13.75, 4);
	const original = (await state(page)).shapes[0];
	await page.getByRole("spinbutton", { name: "Font size", exact: true }).fill("10");
	await expect.poll(async () => (await state(page)).shapes[0].height).toBe(27.5);
	expect((await state(page)).shapes[0].texture).toBe(original.texture);
	await content.fill("Another label\nÁrvíz 12Ω");
	await expect.poll(async () => (await state(page)).shapes[0].texture).not.toBe(original.texture);
	await expect.poll(async () => (await state(page)).textures).toBe(baselineTextures + 1);
	await page.getByRole("button", { name: "Undo", exact: true }).click();
	await expect(content).toHaveValue("Board label\nÁrvíz 12Ω");
	await page.getByRole("button", { name: "Redo", exact: true }).click();
	await expect(content).toHaveValue("Another label\nÁrvíz 12Ω");
	await page.getByRole("button", { name: "Clear selection", exact: true }).click();
	await page.screenshot({ path: test.info().outputPath("text-label.png") });
	await clickAt(page, 150, 150);
	await page.getByRole("button", { name: "Delete", exact: true }).click();
	await expect.poll(async () => (await state(page)).shapes.length).toBe(0);
	await expect.poll(async () => (await state(page)).textures).toBe(baselineTextures);
	await page.getByRole("button", { name: "Undo", exact: true }).click();
	await expect(content).toHaveValue("Another label\nÁrvíz 12Ω");
	await expect.poll(async () => (await state(page)).textures).toBe(baselineTextures + 1);
	expect(errors).toEqual([]);
});

test("text supports dragging, proportional handles, rotation and double-click editing", async ({ page }) => {
	await page.getByRole("button", { name: "Text", exact: true }).click();
	await clickAt(page, 140, 130);
	const content = page.getByRole("textbox", { name: "Text content" });
	await content.fill("Hello editor");
	await page.getByRole("spinbutton", { name: "Font size", exact: true }).fill("10");
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
	await page.locator("canvas").focus();
	await page.keyboard.press("ArrowRight");
	await expect.poll(async () => (await state(page)).shapes[0].x).toBeCloseTo(shape.x + 1, 3);
});

test("text placement snaps to the grid and equal-width content changes remain undoable", async ({ page }) => {
	await page.getByRole("button", { name: "Snap to grid", exact: true }).click();
	await page.getByRole("button", { name: "Text", exact: true }).click();
	await clickAt(page, 153, 148);
	const content = page.getByRole("textbox", { name: "Text content" });
	await expect(content).toBeFocused();
	await expect(page.getByRole("spinbutton", { name: "Center X", exact: true })).toHaveValue("155");
	await expect(page.getByRole("spinbutton", { name: "Center Y", exact: true })).toHaveValue("150");
	await content.fill("222");
	await page.getByRole("spinbutton", { name: "Font size", exact: true }).fill("10");
	const originalWidth = (await state(page)).shapes[0].width;
	await content.fill("333");
	await page.getByRole("button", { name: "Undo", exact: true }).click();
	await expect(content).toHaveValue("222");
	expect((await state(page)).shapes[0].width).toBe(originalWidth);
	await page.getByRole("button", { name: "Redo", exact: true }).click();
	await expect(content).toHaveValue("333");
	expect((await state(page)).shapes[0].width).toBe(originalWidth);
});
