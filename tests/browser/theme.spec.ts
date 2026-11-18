import type { Page } from "@playwright/test";
import { expect, test } from "./seeded-project";
import { toolbarButton } from "./toolbar";

const shown = (page: Page) =>
	page.evaluate(() => ({
		theme: document.documentElement.dataset.theme,
		desk: getComputedStyle(
			document.querySelector("[data-tool]") ?? document.body,
		).backgroundColor,
		shape: JSON.parse(
			document.querySelector("#editor-scene")?.textContent || "{}",
		).shapes?.at(-1)?.color as string | undefined,
	}));

test("the theme setting recolours the page and an open canvas, and is remembered", async ({
	page,
	context,
}) => {
	await page.goto("/tests/browser/editor.html");
	await (await toolbarButton(page, "Rectangle")).click();
	await page.mouse.move(600, 300);
	await page.mouse.down();
	await page.mouse.move(800, 420, { steps: 4 });
	await page.mouse.up();
	await page.keyboard.press("Escape");
	await page.mouse.click(300, 200);
	await expect.poll(async () => (await shown(page)).shape).toBeTruthy();
	const dark = await shown(page);

	const other = await context.newPage();
	await other.goto("/tests/browser/projects.html");
	await other.waitForFunction(
		() => !document.querySelector('[aria-busy="true"]'),
	);
	await other
		.getByRole("navigation", { name: "Sidebar shortcuts", exact: true })
		.getByRole("button", { name: "Settings", exact: true })
		.click();
	const select = other
		.getByRole("dialog", { name: "Settings" })
		.getByLabel("Theme", { exact: true });
	await expect(select).toHaveValue("system");
	await select.selectOption("light");
	await expect(other.locator("html")).toHaveAttribute("data-theme", "light");
	await expect
		.poll(async () => {
			const light = await shown(page);
			return (
				light.theme === "light" &&
				light.desk !== dark.desk &&
				!!light.shape &&
				light.shape !== dark.shape
			);
		})
		.toBe(true);

	await page.reload();
	await expect.poll(() => shown(page)).toMatchObject({ theme: "light" });
});

test("with no theme chosen the app follows the system", async ({ page }) => {
	await page.emulateMedia({ colorScheme: "light" });
	await page.goto("/tests/browser/editor.html");
	await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
	await page.emulateMedia({ colorScheme: "dark" });
	await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});
