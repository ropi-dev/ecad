import { generateDefaultSymbols, symbolCategories } from "@ecad/default-symbols";
import { expect, test } from "@playwright/test";
import { type EditorSymbol, pinTerminals } from "#/drawing/shapes.ts";
import { stableScreenshot } from "./stable-screenshot";
import { toolbarButton } from "./toolbar";

test.use({ viewport: { width: 1440, height: 1000 } });

test("signal ground hides its pin name while keeping the terminal available for wires", async ({ page }) => {
	await page.goto("/tests/browser/editor.html");
	await page.getByRole("button", { name: "Symbols", exact: true }).click();
	await page.getByRole("button", { name: "Insert Signal ground", exact: true }).click();
	const canvas = page.locator("canvas");
	const bounds = (await canvas.boundingBox())!;
	await canvas.click({ position: { x: bounds.width / 2, y: bounds.height / 2 } });
	await expect(page.getByRole("textbox", { name: "Reference", exact: true })).toHaveValue("GND1");
	await expect(page.getByRole("textbox", { name: "Value", exact: true })).toHaveValue("0 V");
	const scene = () => page.locator("#editor-scene").textContent().then(text => JSON.parse(text!));
	await expect.poll(async () => (await scene()).pinTexts).toEqual([]);
	const document = JSON.parse((await page.locator("#editor-document").textContent())!) as { shapes: EditorSymbol[] };
	const ground = document.shapes[0];
	expect(ground.children.find(child => child.kind === "pin")).toMatchObject({ name: "GND", showLabels: false });
	const [terminal] = pinTerminals(ground);
	const rendered = await scene();
	const scale = (rendered.corner[0] - rendered.origin[0]) / 420 * bounds.width / 2;
	const x = (rendered.origin[0] + 1) * bounds.width / 2 + terminal.x * scale;
	const y = (1 - rendered.origin[1]) * bounds.height / 2 - terminal.y * scale;
	await canvas.click({ position: { x, y } });
	await canvas.click({ position: { x, y: y - 100 } });
	await page.keyboard.press("Escape");
	await expect.poll(async () => JSON.parse((await page.locator("#editor-document").textContent())!).shapes.map((shape: { kind: string }) => shape.kind)).toEqual(["symbol", "wire"]);
	await expect.poll(async () => (await scene()).pinTexts).toEqual([]);
	await page.keyboard.press("F6");
	for (let repeat = 0; repeat < 10; repeat++) {
		await page.getByRole("button", { name: "Zoom in", exact: true }).click();
	}
	await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
	await expect.poll(async () => (await scene()).symbolTexts.length).toBe(2);
	const zoomed = await scene();
	const zoomedScale = (zoomed.corner[0] - zoomed.origin[0]) / 420 * bounds.width / 2;
	await canvas.click({ position: {
		x: (zoomed.origin[0] + 1) * bounds.width / 2 + (terminal.x + 0.8) * zoomedScale,
		y: (1 - zoomed.origin[1]) * bounds.height / 2 - (terminal.y - 1.2) * zoomedScale,
	} });
	await expect(page.getByRole("textbox", { name: "Reference", exact: true })).toHaveValue("GND1");
	await stableScreenshot(() => page.screenshot({ path: test.info().outputPath("signal-ground.png") }));
	await page.screenshot({
		path: test.info().outputPath("signal-ground-detail.png"),
		clip: { x: bounds.x + bounds.width / 2 - 180, y: bounds.y + bounds.height / 2 - 180, width: 360, height: 360 },
	});
});

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
	// This test places the entire catalog using software graphics in CI.
	test.setTimeout(120_000);
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
