import { expect, test } from "@playwright/test";
import { drawingPoint } from "./symbol-items";
import { stableScreenshot } from "./stable-screenshot";
import { toolbarButton } from "./toolbar";

test.use({ viewport: { width: 1440, height: 1000 } });

test("a pin's lead, labels, and connection move and rotate as one item", async ({ page }) => {
	await page.goto("/tests/browser/editor.html");
	await (await toolbarButton(page, "Pin")).click();
	const canvas = page.locator("canvas");
	const bounds = (await canvas.boundingBox())!;
	await canvas.click({ position: { x: bounds.width / 2, y: bounds.height / 2 } });
	const lead = page.getByRole("spinbutton", { name: "Lead length", exact: true });
	await expect(lead).toHaveValue("2");
	for (const [label, value] of [["Name", "RUN"], ["Number", "26"]]) {
		const input = page.getByRole("textbox", { name: label, exact: true });
		await input.fill(value);
		await input.press("Tab");
	}
	for (const [label, value] of [["Lead length", "4"], ["Angle", "180"], ["Center X", "5"], ["Center Y", "0"]]) {
		const input = page.getByRole("spinbutton", { name: label, exact: true });
		await input.fill(value);
		await input.press("Enter");
	}
	const document = () => page.locator("#editor-document").textContent().then(text => JSON.parse(text!));
	await expect.poll(async () => (await document()).shapes).toEqual([expect.objectContaining({ kind: "pin", name: "RUN", number: "26", length: 4, rotation: Math.PI, x: 5, y: 0 })]);
	await canvas.focus();
	for (let step = 0; step < 7; step++) await page.getByRole("button", { name: "Zoom in", exact: true }).click();
	await (await toolbarButton(page, "Select")).click();
	const midpoint = await drawingPoint(page, { x: 3, y: 0 });
	await page.mouse.click(midpoint.x, midpoint.y);
	await expect(lead).toHaveValue("4");
	await canvas.focus();
	await stableScreenshot(() => page.screenshot({ path: test.info().outputPath("integrated-pin.png") }));
	await (await toolbarButton(page, "Wire")).click();
	const terminal = await drawingPoint(page, { x: 5, y: 0 });
	const end = await drawingPoint(page, { x: 9, y: 0 });
	await page.mouse.click(terminal.x, terminal.y);
	await page.mouse.click(end.x, end.y);
	await page.keyboard.press("Escape");
	await expect.poll(async () => (await document()).shapes.map((shape: { kind: string }) => shape.kind)).toEqual(["pin", "wire"]);
	await (await toolbarButton(page, "Undo")).click();
	await expect.poll(async () => (await document()).shapes.map((shape: { kind: string }) => shape.kind)).toEqual(["pin"]);
	await (await toolbarButton(page, "Redo")).click();
	await expect.poll(async () => (await document()).shapes.map((shape: { kind: string }) => shape.kind)).toEqual(["pin", "wire"]);
});

test("pin name and number visibility are independent and undoable", async ({ page }) => {
	await page.goto("/tests/browser/editor.html");
	await (await toolbarButton(page, "Pin")).click();
	const canvas = page.locator("canvas");
	const bounds = (await canvas.boundingBox())!;
	await canvas.click({ position: { x: bounds.width / 2, y: bounds.height / 2 } });
	for (const [label, value] of [["Name", "SWCLK"], ["Number", "24"]]) {
		const input = page.getByRole("textbox", { name: label, exact: true });
		await input.fill(value);
		await input.press("Enter");
	}
	for (let step = 0; step < 7; step++) await page.getByRole("button", { name: "Zoom in", exact: true }).click();
	const name = page.getByRole("checkbox", { name: "Show name", exact: true });
	const number = page.getByRole("checkbox", { name: "Show number", exact: true });
	const labels = () => page.locator("#editor-scene").textContent().then(text => JSON.parse(text!).pinTexts.map((label: { name: string }) => label.name));
	const document = () => page.locator("#editor-document").textContent().then(text => JSON.parse(text!));
	await expect(name).toBeChecked();
	await expect(number).toBeChecked();
	await name.uncheck();
	await expect.poll(labels).toEqual(["pin number 1"]);
	await expect.poll(async () => (await document()).shapes[0]).toMatchObject({ name: "SWCLK", number: "24", showName: false });
	await stableScreenshot(() => page.screenshot({ path: test.info().outputPath("pin-number-only.png") }));
	await number.uncheck();
	await expect.poll(labels).toEqual([]);
	await name.check();
	await expect.poll(labels).toEqual(["pin name 1"]);
	const angle = page.getByRole("spinbutton", { name: "Angle", exact: true });
	await angle.fill("180");
	await angle.press("Enter");
	await expect.poll(labels).toEqual(["pin name 1"]);
	await stableScreenshot(() => page.screenshot({ path: test.info().outputPath("pin-name-only-rotated.png") }));
	await (await toolbarButton(page, "Undo")).click();
	await (await toolbarButton(page, "Undo")).click();
	await expect(name).not.toBeChecked();
	await expect(number).not.toBeChecked();
	await expect.poll(labels).toEqual([]);
	await (await toolbarButton(page, "Redo")).click();
	await expect(name).toBeChecked();
	await expect.poll(labels).toEqual(["pin name 1"]);
});
