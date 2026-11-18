import { expect, test } from "@playwright/test";

const scene = async (page: import("@playwright/test").Page) =>
	JSON.parse((await page.locator("#editor-scene").textContent()) || "{}");
const drawing = async (page: import("@playwright/test").Page) =>
	JSON.parse((await page.locator("#editor-document").textContent()) || "{}");

test("schematic settings change the paper and title block as one undo step", async ({
	page,
}) => {
	await page.goto("/tests/browser/editor.html");
	const toolbar = page.getByRole("toolbar", {
		name: "Schematic tools",
		exact: true,
	});
	const open = toolbar.getByRole("button", {
		name: "Schematic settings",
		exact: true,
	});
	await expect(open).toBeEnabled();
	await expect
		.poll(async () => (await scene(page)).worksheet)
		.toBe("A3, 420 × 297 mm");

	await open.click();
	const dialog = page.getByRole("dialog", { name: "Schematic settings" });
	await dialog.getByLabel("Size").selectOption("A4");
	await dialog.getByLabel("Orientation").selectOption("portrait");
	await dialog.getByLabel("Title", { exact: true }).fill("Amplifier");
	await dialog.getByLabel("Revision").fill("C");
	await dialog.getByLabel("Company").fill("Bench Labs");
	await dialog.getByLabel("Comment 1").fill("Draft");
	await dialog.getByRole("button", { name: "Today" }).click();
	await expect(dialog.getByLabel("Date")).toHaveValue(/^\d{4}-\d{2}-\d{2}$/);
	await dialog.getByRole("button", { name: "Save" }).click();
	await expect(dialog).toHaveCount(0);

	await expect
		.poll(async () => (await scene(page)).worksheet)
		.toBe("A4, 210 × 297 mm");
	const saved = await drawing(page);
	expect(saved.sheet).toMatchObject({
		paper: "A4",
		portrait: true,
		title: "Amplifier",
		revision: "C",
		company: "Bench Labs",
		comments: ["Draft"],
	});

	await open.click();
	await expect(dialog.getByLabel("Title", { exact: true })).toHaveValue(
		"Amplifier",
	);
	await dialog.getByLabel("Size").selectOption("custom");
	await expect(dialog.getByLabel("Width in mm")).toHaveValue("210");
	await expect(dialog.getByLabel("Orientation")).toBeDisabled();
	await dialog.getByLabel("Width in mm").fill("600");
	await dialog.getByLabel("Height in mm").fill("300");
	await page.keyboard.press("Escape");
	await expect(dialog).toHaveCount(0);
	expect((await drawing(page)).sheet.paper).toBe("A4");

	await page.locator("canvas").click({ position: { x: 400, y: 300 } });
	await page.keyboard.press("Control+z");
	await expect.poll(async () => (await drawing(page)).sheet).toBeUndefined();
	await expect
		.poll(async () => (await scene(page)).worksheet)
		.toBe("A3, 420 × 297 mm");
});
