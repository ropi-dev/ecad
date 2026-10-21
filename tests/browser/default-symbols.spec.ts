import { generateDefaultSymbols, symbolCategories } from "@ecad/default-symbols";
import { expect, test } from "@playwright/test";
import type { EditorSymbol } from "#/drawing/shapes.ts";
import { toolbarButton } from "./toolbar";

test.use({ viewport: { width: 1440, height: 1000 } });

test("selector focuses search on every opening and filters symbols without library upload controls", async ({ page }) => {
	await page.goto("/tests/browser/editor.html");
	const trigger = page.getByRole("button", { name: "Symbols", exact: true });
	await trigger.click();
	const search = page.getByRole("searchbox", { name: "Search symbols" });
	await expect(search).toBeFocused();
	await expect(page.locator('input[type="file"]')).toHaveCount(0);
	await expect(page.getByRole("group", { name: "User libraries", exact: true })).toHaveCount(0);
	await page.keyboard.type("  sChOtTkY  ");
	await expect(page.getByRole("button", { name: /^Insert / })).toHaveCount(1);
	await expect(page.getByRole("heading", { level: 3 })).toHaveText(["Diodes"]);
	await page.getByRole("button", { name: "Insert Schottky diode", exact: true }).click();
	const canvas = page.locator("canvas");
	const bounds = (await canvas.boundingBox())!;
	await canvas.click({ position: { x: bounds.width / 2, y: bounds.height / 2 } });
	await expect(page.getByRole("textbox", { name: "Reference", exact: true })).toHaveValue("D1");
	await trigger.click();
	await expect(search).toBeFocused();
	await expect(search).toHaveValue("");
	await expect(page.getByRole("button", { name: /^Insert / })).toHaveCount(45);
	await search.fill("transistors");
	await expect(page.getByRole("heading", { level: 3 })).toHaveText(["Transistors"]);
	await expect(page.getByRole("button", { name: /^Insert / })).toHaveCount(6);
	await search.fill("body diode");
	await expect(page.getByRole("button", { name: /^Insert / })).toHaveCount(2);
	await search.fill("16 MHz");
	await expect(page.getByRole("button", { name: "Insert Crystal", exact: true })).toBeVisible();
	await search.fill("missing component");
	await expect(page.getByRole("status")).toHaveText("No symbols match your search.");
	await expect(page.getByRole("button", { name: /^Insert / })).toHaveCount(0);
	await expect(page.getByRole("heading", { level: 3 })).toHaveCount(0);
	await search.fill("");
	await expect(page.getByRole("heading", { level: 3 })).toHaveText([...symbolCategories]);
	await page.keyboard.press("Escape");
	await expect(trigger).toBeFocused();
	await trigger.click();
	await expect(search).toBeFocused();
});

test("every default symbol previews and places with its geometry, pins, and editable attributes", async ({ page }) => {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	await page.goto("/tests/browser/editor.html");
	const defaults = generateDefaultSymbols();
	for (const [index, { file, category }] of defaults.entries()) {
		await page.getByRole("button", { name: "Symbols", exact: true }).click();
		await expect(page.getByRole("button", { name: /^Insert / })).toHaveCount(defaults.length);
		await expect(page.getByRole("heading", { level: 3 })).toHaveText([...symbolCategories]);
		await expect(page.getByRole("region", { name: "Custom symbols", exact: true })).toHaveCount(0);
		const button = page.getByRole("region", { name: category, exact: true }).getByRole("button", { name: `Insert ${file.name}`, exact: true });
		await expect(button.locator("svg")).toHaveCount(1);
		await button.click();
		const canvas = page.locator("canvas");
		const bounds = (await canvas.boundingBox())!;
		await canvas.click({ position: { x: bounds.width * (0.15 + (index % 9) * 0.075), y: bounds.height * (0.2 + Math.floor(index / 9) * 0.12) } });
		await expect(page.getByRole("textbox", { name: "Reference", exact: true })).toHaveValue(`${file.prefix}${index + 1}`);
		await expect(page.getByRole("textbox", { name: "Value", exact: true })).toHaveValue(file.value);
	}
	const document = JSON.parse((await page.locator("#editor-document").textContent())!) as { shapes: EditorSymbol[] };
	expect(document.shapes.map(({ definitionId }) => definitionId)).toEqual(defaults.map(({ file }) => file.id));
	for (const [index, shape] of document.shapes.entries()) {
		expect(shape.children).toHaveLength(defaults[index].file.shapes.length);
		expect(shape.children.filter((child) => child.kind === "pin").map(({ name }) => name)).toEqual(
			defaults[index].file.shapes.filter((child) => child.kind === "pin").map(({ name }) => name),
		);
	}
	await page.getByRole("textbox", { name: "Value", exact: true }).fill("Edited antenna");
	await page.getByRole("textbox", { name: "Value", exact: true }).press("Tab");
	await (await toolbarButton(page, "Undo")).click();
	await expect(page.getByRole("textbox", { name: "Value", exact: true })).toHaveValue("Antenna");
	expect(errors).toEqual([]);
});
