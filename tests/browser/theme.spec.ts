import type { Page } from "@playwright/test";
import { schematicThemes, type ThemeName } from "#/drawing/schematic-theme.ts";
import { expect, test } from "./seeded-project";
import { toolbarButton } from "./toolbar";

const rgb = (hex: string) =>
	`rgb(${[1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16)).join(", ")})`;

const shown = (page: Page) =>
	page.evaluate(() => ({
		theme: document.documentElement.dataset.theme,
		desk: getComputedStyle(
			document.querySelector("[data-tool]") ?? document.body,
		).backgroundColor,
		panel: getComputedStyle(
			document.querySelector(".ui-panel") ?? document.body,
		).backgroundColor,
		shape: JSON.parse(
			document.querySelector("#editor-scene")?.textContent || "{}",
		).shapes?.at(-1)?.color as string | undefined,
	}));

const expected = (theme: ThemeName, panel: string) => ({
	theme,
	desk: rgb(schematicThemes[theme].desk),
	panel: rgb(panel),
	shape: schematicThemes[theme].appearance.stroke.slice(1),
});

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
	await expect.poll(() => shown(page)).toEqual(expected("dark", "#16191f"));

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
	await expect.poll(() => shown(page)).toEqual(expected("light", "#f8f9fa"));

	await page.reload();
	await expect.poll(() => shown(page)).toMatchObject({ theme: "light" });
	expect(
		await page.evaluate(
			() => JSON.parse(localStorage.getItem("ecad.settings.v1") ?? "{}").theme,
		),
	).toBe("light");
});

test("with no theme chosen the app follows the system", async ({ page }) => {
	await page.emulateMedia({ colorScheme: "light" });
	await page.goto("/tests/browser/editor.html");
	await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
	await page.emulateMedia({ colorScheme: "dark" });
	await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});
