import { expect, test } from "@playwright/test";
import { stableScreenshot } from "./stable-screenshot";

test.use({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });

test("thumbnails render near the viewport and load after scrolling or searching", async ({ page }) => {
	await page.goto("/tests/browser/editor.html");
	await page.getByRole("button", { name: "Symbols", exact: true }).click();
	const picker = page.locator("[data-symbol-picker]");
	await expect(page.getByRole("button", { name: "Insert Resistor", exact: true }).locator("svg")).toHaveCount(1);
	const chip = page.getByRole("button", { name: "Insert RP2350B", exact: true });
	await expect(chip.locator("[data-thumbnail-skeleton]")).toHaveCount(1);
	await expect(chip.locator("svg")).toHaveCount(0);
	expect(await picker.locator("svg").count()).toBeLessThan(20);
	await chip.scrollIntoViewIfNeeded();
	await expect(chip.locator("svg")).toHaveCount(1);
	await expect(chip.locator("[data-thumbnail-skeleton]")).toHaveCount(0);
	await stableScreenshot(() => picker.screenshot({ path: test.info().outputPath("scrolled-thumbnails.png") }));
	await page.keyboard.press("Escape");
	await page.getByRole("button", { name: "Symbols", exact: true }).click();
	await page.getByRole("searchbox", { name: "Search symbols" }).fill("RP2350B");
	await expect(chip.locator("svg")).toHaveCount(1);
	await expect(chip.locator("[data-thumbnail-skeleton]")).toHaveCount(0);
	await stableScreenshot(() => picker.screenshot({ path: test.info().outputPath("loaded-thumbnail.png") }));
});

test("a delayed thumbnail shows a skeleton and still allows placement", async ({ page }) => {
	let release = () => {};
	const pending = new Promise<void>(resolve => { release = resolve; });
	await page.route("**/SymbolPreview.tsx*", async route => {
		await pending;
		await route.continue();
	});
	try {
		await page.goto("/tests/browser/editor.html");
		await page.getByRole("button", { name: "Symbols", exact: true }).click();
		const resistor = page.getByRole("button", { name: "Insert Resistor", exact: true });
		await expect(resistor.locator("[data-thumbnail-skeleton]")).toHaveCount(1);
		await expect(resistor.locator("svg")).toHaveCount(0);
		await stableScreenshot(() => page.locator("[data-symbol-picker]").screenshot({ path: test.info().outputPath("thumbnail-skeletons.png") }));
		await resistor.click();
		const canvas = page.locator("canvas");
		const bounds = (await canvas.boundingBox())!;
		await canvas.click({ position: { x: bounds.width / 2, y: bounds.height / 2 } });
		await expect(page.getByRole("textbox", { name: "Reference", exact: true })).toHaveValue("R1");
	} finally {
		release();
		await page.unrouteAll({ behavior: "wait" });
	}
	await page.getByRole("button", { name: "Symbols", exact: true }).click();
	await expect(page.getByRole("button", { name: "Insert Resistor", exact: true }).locator("svg")).toHaveCount(1);
});
