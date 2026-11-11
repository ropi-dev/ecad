import { expect, type Page, test } from "@playwright/test";
import { required } from "../helpers/required.ts";

const open = async (page: Page) => {
	// The shortcut flips the saved setting, so press it only while hidden.
	const stats = page.getByRole("region", { name: "Debug stats" });
	await expect(async () => {
		if (!(await stats.isVisible()))
			await page.keyboard.press("Control+Shift+D");
		await expect(stats).toBeVisible({ timeout: 1000 });
	}).toPass();
	return stats;
};
const box = async (page: Page) =>
	required(
		await page.getByRole("region", { name: "Debug stats" }).boundingBox(),
	);

test("the debug stats window moves by drag and keyboard, stays on screen and keeps its place", async ({
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
		name: "Move debug stats with the arrow keys",
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

test("debug stats start hidden and follow the setting and the shortcut", async ({
	page,
}) => {
	await page.goto("/tests/browser/projects.html");
	await expect(page.getByText(".ecadprj")).toBeVisible();
	const stats = page.getByRole("region", { name: "Debug stats" });
	await expect(stats).toBeHidden();

	// The modal settings dialog hides the rest of the page from the
	// accessibility tree, so check the window after closing it.
	const settings = page.getByRole("dialog", { name: "Settings" });
	const toggle = settings.getByRole("checkbox", { name: "Show debug stats" });
	await page.keyboard.press("ControlOrMeta+Comma");
	await expect(toggle).not.toBeChecked();
	await toggle.check();
	await page.keyboard.press("Escape");
	await expect(settings).toBeHidden();
	await expect(stats).toBeVisible();

	await page.keyboard.press("Control+Shift+D");
	await expect(stats).toBeHidden();
	await page.keyboard.press("ControlOrMeta+Comma");
	await expect(toggle).not.toBeChecked();
	await page.keyboard.press("Escape");
	await expect(settings).toBeHidden();

	await page.keyboard.press("Control+Shift+D");
	await expect(stats).toBeVisible();
	await page.reload();
	await expect(stats).toBeVisible();
	await stats.getByRole("button", { name: "Hide debug stats" }).click();
	await expect(stats).toBeHidden();
	await page.reload();
	await expect(page.getByText(".ecadprj")).toBeVisible();
	await expect(stats).toBeHidden();
});
