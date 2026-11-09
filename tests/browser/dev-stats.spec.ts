import { expect, type Page, test } from "@playwright/test";
import { required } from "../helpers/required.ts";

const open = async (page: Page) => {
	// The window starts hidden under automation; the shortcut shows it once
	// its lazily loaded module listens.
	const stats = page.getByRole("region", { name: "Development stats" });
	await expect(async () => {
		if (!(await stats.isVisible()))
			await page.keyboard.press("Control+Shift+D");
		await expect(stats).toBeVisible({ timeout: 1000 });
	}).toPass();
	return stats;
};
const box = async (page: Page) =>
	required(
		await page.getByRole("region", { name: "Development stats" }).boundingBox(),
	);

test("the development stats window moves by drag and keyboard, stays on screen and keeps its place", async ({
	page,
}) => {
	await page.goto("/tests/browser/projects.html");
	await expect(page.locator("main")).toBeVisible();
	const stats = await open(page);
	const start = await box(page);

	const header = required(await stats.locator("header").boundingBox());
	await page.mouse.move(header.x + 40, header.y + header.height / 2);
	await page.mouse.down();
	await page.mouse.move(header.x + 140, header.y + header.height / 2 - 60, {
		steps: 5,
	});
	await page.mouse.up();
	await expect
		.poll(async () => (await box(page)).x)
		.toBeCloseTo(start.x + 100, 0);
	expect((await box(page)).y).toBeCloseTo(start.y - 60, 0);

	const handle = stats.getByRole("button", {
		name: "Move development stats with the arrow keys",
	});
	await handle.focus();
	const dragged = await box(page);
	await page.keyboard.press("ArrowRight");
	await expect
		.poll(async () => (await box(page)).x)
		.toBeCloseTo(dragged.x + 16, 0);
	const moved = await box(page);

	await page.reload();
	await expect(page.locator("main")).toBeVisible();
	await open(page);
	await expect.poll(async () => (await box(page)).x).toBeCloseTo(moved.x, 0);
	expect((await box(page)).y).toBeCloseTo(moved.y, 0);

	// A smaller window pulls it back inside the viewport.
	await page.setViewportSize({ width: 360, height: 320 });
	await expect
		.poll(async () => {
			const { x, y, width, height } = await box(page);
			return x + width <= 360 && y + height <= 320 && x >= 0 && y >= 0;
		})
		.toBe(true);
});
