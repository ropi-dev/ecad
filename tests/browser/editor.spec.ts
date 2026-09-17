import { expect, type Page, test } from "@playwright/test";

interface State {
	camera: string;
	direction: number[];
	origin: number[];
	corner: number[];
	shapes: { name: string; x: number; y: number; selected: boolean }[];
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
test.beforeEach(async ({ page }) => {
	await page.goto("/tests/browser/editor.html");
	await expect(page.getByRole("button", { name: "Rectangle", exact: true })).toBeEnabled();
});

test("places every shape, drags without panning, clamps to A3, and deletes", async ({ page }) => {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	const before = await state(page);
	for (const [index, kind] of ["Rectangle", "Circle", "Triangle", "Line"].entries()) {
		await page.getByRole("button", { name: kind, exact: true }).click();
		await clickAt(page, 70 + index * 85, 150);
		await expect.poll(async () => (await state(page)).shapes.length).toBe(index + 1);
	}
	await dragTo(page, [70, 150], [100, 180]);
	await expect.poll(async () => (await state(page)).shapes[0].x).toBeCloseTo(100, 1);
	expect((await state(page)).shapes[0].y).toBeCloseTo(180, 1);
	expect((await state(page)).origin).toEqual(before.origin);
	await dragTo(page, [100, 180], [-30, 330]);
	await expect.poll(async () => (await state(page)).shapes[0].x).toBe(25);
	expect((await state(page)).shapes[0].y).toBe(282);
	await page.keyboard.press("ArrowRight");
	await page.keyboard.press("Shift+ArrowDown");
	await expect.poll(async () => (await state(page)).shapes[0].x).toBe(26);
	expect((await state(page)).shapes[0].y).toBe(272);
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
	await page.getByRole("button", { name: "Circle", exact: true }).click();
	await clickAt(page, 210, 150);
	await expect.poll(async () => (await state(page)).shapes[0]?.x).toBeCloseTo(210, 1);
	await dragTo(page, [210, 150], [230, 180]);
	await expect.poll(async () => (await state(page)).shapes[0].y).toBeCloseTo(180, 1);
	await page.keyboard.press("F6");
	await expect(page.getByRole("button", { name: "Fit drawing", exact: true })).toHaveText("100%");
	await expect(checkCamera).toPass();
});

test("Escape rolls back a drag and overlapping shapes select the top shape", async ({ page }) => {
	for (const kind of ["Rectangle", "Circle"]) {
		await page.getByRole("button", { name: kind, exact: true }).click();
		await clickAt(page, 210, 150);
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
		await page.getByRole("button", { name: kind, exact: true }).click();
		await clickAt(page, x, 150);
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
	await expect.poll(async () => (await state(page)).shapes[0].x).toBe(25);
	expect((await state(page)).shapes[1].x).toBeCloseTo(105, 1);
	await page.keyboard.press("Shift+ArrowRight");
	await expect.poll(async () => (await state(page)).shapes[0].x).toBe(35);
	expect((await state(page)).shapes[1].x).toBeCloseTo(115, 1);
	await page.keyboard.press("Delete");
	await expect.poll(async () => (await state(page)).shapes.map((shape) => shape.name)).toEqual(["triangle 3"]);
	await expect(page.getByRole("complementary", { name: "Selection attributes" })).toHaveCount(0);
});

test("selection works after zoom, supports Shift additions and cancels with Escape", async ({ page }) => {
	for (const [kind, x] of [["Rectangle", 100], ["Circle", 180], ["Triangle", 260], ["Line", 330]] as const) {
		await page.getByRole("button", { name: kind, exact: true }).click();
		await clickAt(page, x, 100);
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
	await page.getByRole("button", { name: "Circle", exact: true }).click();
	await clickAt(page, 150, 100);
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
