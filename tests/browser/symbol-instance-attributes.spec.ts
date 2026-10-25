import { expect, type Page, test } from "@playwright/test";
import type { EditorSymbol } from "#/drawing/shapes.ts";
import { toolbarButton } from "./toolbar";

test.use({ viewport: { width: 1440, height: 1000 } });

const state = async (page: Page) =>
	JSON.parse((await page.locator("#editor-document").textContent())!) as {
		shapes: EditorSymbol[];
		historySize: number;
	};

async function placeSymbol(page: Page, x = 0.4, name = "Resistor") {
	await page.getByRole("button", { name: "Symbols", exact: true }).click();
	await page.getByRole("button", { name: `Insert ${name}`, exact: true }).click();
	const box = (await page.locator("canvas").boundingBox())!;
	await page.locator("canvas").click({
		position: { x: box.width * x, y: box.height * 0.5 },
	});
	return box;
}

test("symbol fields validate on blur and commit only valid changes", async ({ page }) => {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	await page.goto("/tests/browser/editor.html");
	await placeSymbol(page);
	await expect(page.getByRole("form", { name: "Symbol instance attributes" })).toBeVisible();
	const before = await state(page);
	const angle = page.getByRole("spinbutton", { name: "Angle", exact: true });
	await angle.fill("45");
	await angle.press("Enter");
	await expect(angle).toHaveAttribute("aria-invalid", "true");
	await expect(angle).toHaveAccessibleDescription("Use an angle in 90° increments.");
	expect(await state(page)).toEqual(before);
	await page.screenshot({ path: test.info().outputPath("symbol-attribute-validation.png") });

	const reference = page.getByRole("textbox", { name: "Reference", exact: true });
	await reference.fill("R42");
	await reference.press("Tab");
	await expect.poll(async () => (await state(page)).shapes[0].attributes.reference).toBe("R42");
	await expect(angle).toHaveValue("45");
	await expect(angle).toHaveAttribute("aria-invalid", "true");
	await angle.fill("90");
	await angle.press("Tab");
	await expect(angle).not.toHaveAttribute("aria-invalid");
	await expect.poll(async () => (await state(page)).shapes[0].rotation).toBe(Math.PI / 2);

	for (const [label, invalid, message, valid] of [
		["Center X", "", "Enter a finite number.", "12.125"],
		["Line width", "0", "Line width must be greater than zero.", "0.5"],
		["Line width", "-1", "Line width must be greater than zero.", "0.75"],
	]) {
		const input = page.getByRole("spinbutton", { name: label, exact: true });
		const committed = await state(page);
		await input.fill(invalid);
		await input.press("Tab");
		await expect(input).toHaveAttribute("aria-invalid", "true");
		await expect(input).toHaveAccessibleDescription(message);
		expect(await state(page)).toEqual(committed);
		await input.fill(valid);
		await input.press("Enter");
		await expect(input).not.toHaveAttribute("aria-invalid");
		await expect(input).toHaveAttribute("data-committed-value", valid);
		expect((await state(page)).historySize).toBe(committed.historySize + 1);
	}

	const value = page.getByRole("textbox", { name: "Value", exact: true });
	await value.fill("");
	await value.press("Tab");
	await expect.poll(async () => (await state(page)).shapes[0].attributes.value).toBe("");
	const saved = await state(page);
	await value.focus();
	await value.press("Tab");
	await angle.focus();
	await angle.press("Tab");
	expect(await state(page)).toEqual(saved);
	await page.screenshot({ path: test.info().outputPath("symbol-instance-attributes.png") });
	expect(errors).toEqual([]);
});

test("symbol form follows undo, redo, dragging, and selection changes", async ({ page }) => {
	await page.goto("/tests/browser/editor.html");
	const box = await placeSymbol(page);
	const x = page.getByRole("spinbutton", { name: "Center X", exact: true });
	const original = (await state(page)).shapes[0].x;
	await x.fill("-20");
	await x.press("Tab");
	await expect(x).toHaveAttribute("data-committed-value", "-20");
	await (await toolbarButton(page, "Undo")).click();
	await expect(x).toHaveValue(String(Number(original.toFixed(4)) || original));
	await (await toolbarButton(page, "Redo")).click();
	await expect(x).toHaveValue("-20");
	await placeSymbol(page, 0.65);
	const reference = page.getByRole("textbox", { name: "Reference", exact: true });
	await expect(reference).toHaveValue("R2");
	await x.fill("");
	await x.press("Tab");
	await expect(x).toHaveAttribute("aria-invalid", "true");
	await page.getByRole("button", { name: "Clear selection", exact: true }).click();
	await page.mouse.move(box.x + box.width * 0.65, box.y + box.height * 0.5);
	await page.mouse.down();
	await page.mouse.move(box.x + box.width * 0.65 + 40, box.y + box.height * 0.5 + 40, { steps: 5 });
	await page.mouse.up();
	await expect(reference).toHaveValue("R2");
	await expect(x).not.toHaveAttribute("aria-invalid");
	const moved = (await state(page)).shapes[1].x;
	await expect(x).toHaveValue(String(Number(moved.toFixed(4)) || moved));
	await expect(page.getByRole("alert")).toHaveCount(0);
});

test("mixed line widths stay unset until a valid width is entered", async ({ page }) => {
	await page.goto("/tests/browser/editor.html");
	await page.evaluate(() => {
		localStorage.setItem("ecad.user-config.v1", JSON.stringify({
			version: 1,
			symbolLibraries: [{
				id: "mixed", name: "Mixed", enabled: true,
				source: { kind: "embedded", symbols: [{
					format: "ecad-symbol", version: 1, units: "mm",
					id: "mixed-part", name: "Mixed part", prefix: "M", value: "", description: "",
					shapes: [
						{ kind: "rectangle", x: 0, y: 0, width: 10, height: 6, lineWidth: 0.5 },
						{ kind: "line", x1: -6, y1: 0, x2: -5, y2: 0, lineWidth: 0.25 },
					],
				}] },
			}],
		}));
	});
	await page.reload();
	await placeSymbol(page, 0.4, "Mixed part");
	const width = page.getByRole("spinbutton", { name: "Line width", exact: true });
	await expect(width).toHaveValue("");
	const before = await state(page);
	await width.focus();
	await width.press("Tab");
	await expect(page.getByRole("alert")).toHaveCount(0);
	expect(await state(page)).toEqual(before);
	const name = page.getByRole("textbox", { name: "Name", exact: true });
	await name.fill("Mixed resistor");
	await name.press("Tab");
	await expect.poll(async () => (await state(page)).shapes[0].attributes.name).toBe("Mixed resistor");
	expect((await state(page)).shapes[0].children).toEqual(before.shapes[0].children);
	await width.fill("0.75");
	await width.press("Tab");
	await expect(width).toHaveAttribute("data-committed-value", "0.75");
	expect((await state(page)).shapes[0].children.every((child) => child.lineWidth === 0.75)).toBe(true);
	await expect(page.getByRole("alert")).toHaveCount(0);
});
