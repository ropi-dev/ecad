import { required } from "../helpers/required.ts";
import { expect, test } from "./seeded-project";
import { toolbarButton } from "./toolbar";

const hints = '[data-slot="button-shortcut"]';

test.beforeEach(async ({ page }) => {
	await page.goto("/tests/browser/editor.html");
	await expect(
		page.getByRole("button", { name: "Shapes", exact: true }),
	).toBeEnabled();
});

test("hints wait for Ctrl to be held for 1 second while shortcuts work at once", async ({
	page,
}) => {
	// Read the clock before the press. Read after it, the hold would start
	// late by one round trip and could measure under a second.
	const pressed = await page.evaluate(() => performance.now());
	await page.keyboard.down("Control");
	await page.keyboard.press("s");
	await expect(
		page.getByRole("toolbar", { name: "Shapes toolbar", exact: true }),
	).toBeVisible();
	await page.waitForTimeout(500);
	await expect(page.locator(hints)).toHaveCount(0);
	await expect(page.locator(`${hints}[title="Rectangle"]`)).toBeVisible();
	const shown = await page.evaluate(() => performance.now());
	expect(shown - pressed).toBeGreaterThanOrEqual(1_000);
	await page.keyboard.up("Control");
	await expect(page.locator(hints)).toHaveCount(0);
	await page.keyboard.down("Control");
	await page.waitForTimeout(700);
	await page.keyboard.up("Control");
	await page.keyboard.down("Control");
	await page.waitForTimeout(700);
	await expect(page.locator(hints)).toHaveCount(0);
	await page.keyboard.up("Control");
});

test("Ctrl shows separate hints for every visible button and activates a group", async ({
	page,
}) => {
	await expect(page.locator(hints)).toHaveCount(0);
	await page.keyboard.down("Control");
	await expect(page.locator(hints).first()).toBeVisible();
	const buttons = await page.locator("button:visible").count();
	await expect(page.locator(hints)).toHaveCount(buttons);
	const shapes = page.getByRole("button", { name: "Shapes", exact: true });
	const key = await page
		.locator(`${hints}[title="Shapes"]`)
		.getAttribute("data-shortcut");
	expect(key).toBeTruthy();
	await page.keyboard.press(required(key));
	await expect(shapes).toHaveAttribute("aria-expanded", "true");
	await expect(page.locator(`${hints}[title="Rectangle"]`)).toBeVisible();
	await page.keyboard.press(required(key));
	await expect(page.locator(`${hints}[title="Rectangle"]`)).toHaveCount(0);
	await page.keyboard.press(required(key));
	await expect(page.locator(`${hints}[title="Rectangle"]`)).toHaveAttribute(
		"data-shortcut",
		"R",
	);
	await page.keyboard.up("Control");
	await expect(page.locator(hints)).toHaveCount(0);
});

test("Undo and Redo follow the key labels on a QWERTZ layout", async ({
	page,
}) => {
	await (await toolbarButton(page, "Rectangle")).click();
	await page.mouse.move(600, 300);
	await page.mouse.down();
	await page.mouse.move(710, 400);
	await page.mouse.up();
	await page.keyboard.press("Escape");
	const shapes = async () =>
		JSON.parse(required(await page.locator("#editor-document").textContent()))
			.shapes;
	await expect.poll(async () => (await shapes()).length).toBe(1);
	await expect(
		page.getByRole("button", { name: "Undo", exact: true }),
	).toBeEnabled();
	await page.keyboard.down("Control");
	await page
		.locator("body")
		.dispatchEvent("keydown", { key: "z", code: "KeyY", ctrlKey: true });
	await expect.poll(async () => (await shapes()).length).toBe(0);
	await page
		.locator("body")
		.dispatchEvent("keydown", { key: "y", code: "KeyZ", ctrlKey: true });
	await expect.poll(async () => (await shapes()).length).toBe(1);
	await page.keyboard.up("Control");
});

test("macOS uses Cmd for hints and actions", async ({ page }) => {
	await page.addInitScript(() => {
		Object.defineProperty(navigator, "platform", { value: "MacIntel" });
	});
	await page.reload();
	const modifier = "Meta";
	const other = "Control";
	await expect(
		page.getByRole("button", { name: "Shapes", exact: true }),
	).toBeEnabled();
	await page.keyboard.down(other);
	await expect(page.locator(hints)).toHaveCount(0);
	await page.keyboard.up(other);
	await page.keyboard.down(modifier);
	const shapes = page.locator(`${hints}[title="Shapes"]`);
	await expect(shapes).toHaveAttribute("aria-label", `${modifier}+S`);
	await page.keyboard.press("s");
	await expect(
		page.getByRole("toolbar", { name: "Shapes toolbar", exact: true }),
	).toBeVisible();
	await expect(page.locator(`${hints}[title="Rectangle"]`)).toBeVisible();
	await page.keyboard.up(modifier);
	await expect(page.locator(hints)).toHaveCount(0);
	await page.keyboard.down(modifier);
	await expect(shapes).toBeVisible();
	await page.evaluate(() => window.dispatchEvent(new Event("blur")));
	await expect(page.locator(hints)).toHaveCount(0);
	await page.keyboard.up(modifier);

	await page.goto("/tests/browser/projects.html");
	const sidebar = page.getByRole("complementary", {
		name: "Project files",
		exact: true,
		includeHidden: true,
	});
	const addFile = page.getByRole("menu", { name: "Add file", exact: true });
	await page.keyboard.press(`${other}+Shift+n`);
	await expect(addFile).toHaveCount(0);
	await page.keyboard.press(`${modifier}+Shift+n`);
	await expect(addFile).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(addFile).toHaveCount(0);
	await expect(sidebar).toHaveAttribute("data-open", "false");
});
