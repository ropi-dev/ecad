import { expect, type Page, test } from "@playwright/test";

interface State {
	camera: string;
	direction: number[];
	origin: number[];
	corner: number[];
	shapes: { name: string; x: number; y: number; selected: boolean; width: number; height: number; rotation: number }[];
}
const state = async (page: Page): Promise<State> => JSON.parse(await page.locator("#editor-scene").textContent() || "{}");
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
	else if (kind === "Line") await dragTo(page, [x - 27.5, y], [x + 27.5, y]);
	else {
		const [width, height] = kind === "Rectangle" ? [50, 30] : [40, 35];
		await dragTo(page, [x - width / 2, y - height / 2], [x + width / 2, y + height / 2]);
	}
}
test.beforeEach(async ({ page }) => {
	await page.goto("/tests/browser/editor.html");
	await expect(page.getByRole("button", { name: "Rectangle", exact: true })).toBeEnabled();
	await expect.poll(async () => (await state(page)).origin.slice(0, 2)).toEqual([0, 0]);
	// Keep the existing interaction fixtures' positive world coordinates in view.
	await page.getByRole("button", { name: "Pan", exact: true }).click();
	await dragTo(page, [0, 0], [-210, -148.5]);
	await page.getByRole("button", { name: "Select", exact: true }).click();
});

test("draws every shape, moves beyond A3 without panning, and deletes", async ({ page }) => {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	const before = await state(page);
	for (const [index, kind] of ["Rectangle", "Circle", "Triangle", "Line"].entries()) {
		await createShape(page, kind, 70 + index * 85, 150);
		await expect.poll(async () => (await state(page)).shapes.length).toBe(index + 1);
	}
	await dragTo(page, [70, 150], [100, 180]);
	await expect.poll(async () => (await state(page)).shapes[0].x).toBeCloseTo(100, 1);
	expect((await state(page)).shapes[0].y).toBeCloseTo(180, 1);
	expect((await state(page)).origin).toEqual(before.origin);
	await dragTo(page, [100, 180], [-30, 330]);
	await expect.poll(async () => (await state(page)).shapes[0].x).toBeCloseTo(-30, 4);
	expect((await state(page)).shapes[0].y).toBeCloseTo(330, 4);
	await page.keyboard.press("ArrowRight");
	await page.keyboard.press("Shift+ArrowDown");
	await expect.poll(async () => (await state(page)).shapes[0].x).toBeCloseTo(-29, 4);
	await expect.poll(async () => (await state(page)).shapes[0].y).toBeCloseTo(320, 4);
	await page.keyboard.press("Delete");
	await expect.poll(async () => (await state(page)).shapes.length).toBe(3);
	await page.getByRole("button", { name: "Rectangle", exact: true }).click();
	await clickAt(page, -25, 150);
	expect((await state(page)).shapes.length).toBe(3);
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
	for (const [kind, x] of [["Rectangle", 100], ["Circle", 180], ["Triangle", 260], ["Line", 330]] as const) {
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
	await expect.poll(() => selectedNames(page)).toEqual(["line 4"]);
	await clickAt(page, 60, 60);
	await expect.poll(() => selectedNames(page)).toEqual([]);
});

test("attributes reuse the floating layer panel and follow the selected shape", async ({ page }) => {
	const panel = page.getByRole("complementary", { name: "Selection attributes" });
	await expect(panel).toHaveCount(0);
	await createShape(page, "Circle", 150, 100);
	await expect(panel).toHaveClass("layer-panel");
	await expect(panel.locator(".layer-list")).toHaveCount(1);
	await expect(panel.getByRole("list")).toHaveCount(0);
	const attribute = (label: string) => panel.locator("dl > div").filter({ has: page.getByText(label, { exact: true }) }).locator("dd");
	await expect(attribute("Type")).toHaveText("circle");
	await expect(attribute("Center X")).toHaveText("150.0 mm");
	await expect(attribute("Radius")).toHaveText("15.0 mm");
	await dragTo(page, [150, 100], [170, 120]);
	await expect(attribute("Center X")).toHaveText("170.0 mm");
	await expect(attribute("Center Y")).toHaveText("120.0 mm");
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
	await expect(page.getByRole("complementary", { name: "Selection attributes" })).toContainText("80.0 mm");
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

test("draws circles, triangles and diagonal lines with accurate hit selection", async ({ page }) => {
	await page.getByRole("button", { name: "Line", exact: true }).click();
	await dragTo(page, [100, 100], [130, 140]);
	await expect.poll(async () => (await state(page)).shapes[0]?.width).toBeCloseTo(50, 4);
	expect((await state(page)).shapes[0].rotation).toBeCloseTo(Math.atan2(40, 30), 4);
	await clickAt(page, 70, 70);
	await clickAt(page, 115, 120);
	await expect.poll(() => selectedNames(page)).toEqual(["line 1"]);
	// The empty corner of the diagonal line's bounding box is not part of the line.
	await dragTo(page, [99, 135], [103, 139]);
	await expect.poll(() => selectedNames(page)).toEqual([]);
	await dragTo(page, [100, 115], [125, 130]);
	await expect.poll(() => selectedNames(page)).toEqual(["line 1"]);
	await dragTo(page, [115, 120], [135, 140]);
	await expect.poll(async () => (await state(page)).shapes[0].x).toBeCloseTo(135, 4);
	await page.getByRole("button", { name: "Circle", exact: true }).click();
	await dragTo(page, [250, 100], [290, 100]);
	await expect.poll(async () => (await state(page)).shapes[1]?.width).toBeCloseTo(80, 4);
	expect((await state(page)).shapes[1].height).toBeCloseTo(80, 4);
	await expect(page.getByRole("complementary", { name: "Selection attributes" })).toContainText("40.0 mm");
	await page.getByRole("button", { name: "Triangle", exact: true }).click();
	await dragTo(page, [100, 200], [160, 240]);
	await expect.poll(async () => (await state(page)).shapes[2]?.width).toBeCloseTo(60, 4);
	expect((await state(page)).shapes[2].height).toBeCloseTo(40, 4);
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

test("circle radius and diagonal line endpoints resize independently", async ({ page }) => {
	await createShape(page, "Circle", 150, 150);
	await expect(page.getByTestId("resize-handle")).toHaveCount(4);
	await dragHandle(page, "1,0", [180, 150]);
	await expect.poll(async () => (await state(page)).shapes[0].width).toBeCloseTo(60, 1);
	const circle = (await state(page)).shapes[0];
	expect(circle.height).toBeCloseTo(60, 1);
	expect(circle.x).toBeCloseTo(150, 1);
	expect(circle.y).toBeCloseTo(150, 1);
	await page.getByRole("button", { name: "Line", exact: true }).click();
	await dragTo(page, [220, 100], [250, 140]);
	await expect(page.getByTestId("resize-handle")).toHaveCount(2);
	await dragHandle(page, "1,0", [280, 180]);
	await expect.poll(async () => (await state(page)).shapes[1].width).toBeCloseTo(100, 1);
	await dragHandle(page, "-1,0", [200, 180]);
	await expect.poll(async () => (await state(page)).shapes[1].width).toBeCloseTo(80, 1);
	const line = (await state(page)).shapes[1];
	expect(line.x).toBeCloseTo(240, 1);
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
	return page.locator('.viewport-rulers [data-axis="x"]').evaluateAll((ticks) =>
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
	await page.getByRole("button", { name: "Rectangle", exact: true }).click();
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
	await expect.poll(async () => (await state(page)).shapes[1].x).toBe(-30);
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
	expect(step).toBe(4);
	const snap = page.getByRole("button", { name: "Snap to grid", exact: true });
	await expect(snap).toHaveAttribute("title", `Snap to grid (${step} mm)`);
	await snap.click();
	await page.getByRole("button", { name: "Circle", exact: true }).click();
	await dragTo(page, [-31, -19], [-19, -7]);
	await expect.poll(async () => (await state(page)).shapes[0]?.width).toBe(40);
	let circle = (await state(page)).shapes[0];
	expect(circle.x).toBe(-32);
	expect(circle.y).toBe(-20);
	await dragHandle(page, "1,0", [-3, -20]);
	await expect.poll(async () => (await state(page)).shapes[0].width).toBe(56);
	circle = (await state(page)).shapes[0];
	expect(circle.height).toBe(56);
	await page.getByRole("button", { name: "Line", exact: true }).click();
	await dragTo(page, [9, 9], [25, 21]);
	await expect.poll(async () => (await state(page)).shapes[1]?.width).toBeCloseTo(20, 4);
	await dragHandle(page, "1,0", [39, 33]);
	await expect.poll(async () => (await state(page)).shapes[1].width).toBeCloseTo(40, 4);
	const line = (await state(page)).shapes[1];
	expect(line.x - Math.cos(line.rotation) * line.width / 2).toBeCloseTo(8, 4);
	expect(line.y - Math.sin(line.rotation) * line.width / 2).toBeCloseTo(8, 4);
	expect(line.x + Math.cos(line.rotation) * line.width / 2).toBeCloseTo(40, 4);
	expect(line.y + Math.sin(line.rotation) * line.width / 2).toBeCloseTo(32, 4);
	await page.screenshot({ path: test.info().outputPath("snap-to-grid.png") });
});
