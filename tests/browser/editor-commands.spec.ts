import { toolbarButton } from "./toolbar";
import { expect, type Page, test } from "@playwright/test";

test.use({ viewport: { width: 1440, height: 900 } });

const committed = async (page: Page) =>
	JSON.parse((await page.locator("#editor-document").textContent())!);
const rendered = async (page: Page) =>
	JSON.parse((await page.locator("#editor-scene").textContent())!).shapes;

test.beforeEach(async ({ page }) => {
	await page.goto("/tests/browser/editor.html");
	await expect(await toolbarButton(page, "Rectangle")).toBeEnabled();
	await page.getByRole("button", { name: "Snap to grid", exact: true }).click();
	await expect
		.poll(async () => {
			const scene = JSON.parse(
				(await page.locator("#editor-scene").textContent()) || "{}",
			);
			return scene.worksheet;
		})
		.toBe("A3, 420 × 297 mm");
});

test("draw and move previews leave the document untouched until pointer release", async ({
	page,
}) => {
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
	await expect
		.poll(async () => (await rendered(page))[0].x)
		.not.toBeCloseTo(placed.shapes[0].x, 3);
	expect(await committed(page)).toEqual(placed);
	await page.keyboard.press("Escape");
	await page.mouse.up();
	expect(await committed(page)).toEqual(placed);
	await expect
		.poll(async () => (await rendered(page))[0].x)
		.toBeCloseTo(placed.shapes[0].x, 3);
});
