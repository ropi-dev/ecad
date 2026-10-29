import { generateDefaultSymbols } from "@ecad/default-symbols";
import { expect, test } from "@playwright/test";
import { type EditorSymbol } from "#/drawing/shapes.ts";
import { toolbarButton } from "./toolbar";

test.use({ viewport: { width: 1440, height: 1000 } });

test("representative default symbols preview, place, and expose editable attributes", async ({
	page,
}) => {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	await page.goto("/tests/browser/editor.html");
	const defaults = generateDefaultSymbols().filter(({ file }) =>
		["resistor", "transformer", "rp2350b"].includes(file.id),
	);
	for (const [index, { file, category }] of defaults.entries()) {
		await page.getByRole("button", { name: "Symbols", exact: true }).click();
		await expect(
			page.getByRole("region", { name: "Custom symbols", exact: true }),
		).toHaveCount(0);
		const button = page
			.getByRole("region", { name: category, exact: true })
			.getByRole("button", { name: `Insert ${file.name}`, exact: true });
		await button.scrollIntoViewIfNeeded();
		await expect(button.locator("svg")).toHaveCount(1);
		await button.click();
		const canvas = page.locator("canvas");
		const bounds = (await canvas.boundingBox())!;
		const panel = page.getByRole("complementary", {
			name: "Selection attributes",
			exact: true,
		});
		const attributes = (await panel.count()) ? await panel.boundingBox() : null;
		const left = bounds.width * 0.15;
		const right = attributes
			? attributes.x - bounds.x - 24
			: bounds.width * 0.75;
		await canvas.click({
			position: {
				x: left + ((right - left) * (index % 9)) / 8,
				y: bounds.height * (0.2 + Math.floor(index / 9) * 0.12),
			},
		});
		await expect(
			page.getByRole("textbox", { name: "Reference", exact: true }),
		).toHaveValue(`${file.prefix}${index + 1}`);
		await expect(
			page.getByRole("textbox", { name: "Value", exact: true }),
		).toHaveValue(file.value);
	}
	const document = JSON.parse(
		(await page.locator("#editor-document").textContent())!,
	) as { shapes: EditorSymbol[] };
	expect(document.shapes.map(({ definitionId }) => definitionId)).toEqual(
		defaults.map(({ file }) => file.id),
	);
	for (const [index, shape] of document.shapes.entries()) {
		expect(shape.children).toHaveLength(defaults[index].file.shapes.length);
		expect(
			shape.children
				.filter((child) => child.kind === "pin")
				.map(({ name }) => name),
		).toEqual(
			defaults[index].file.shapes
				.filter((child) => child.kind === "pin")
				.map(({ name }) => name),
		);
	}
	await page
		.getByRole("textbox", { name: "Value", exact: true })
		.fill("Edited value");
	await page.getByRole("textbox", { name: "Value", exact: true }).press("Tab");
	await (await toolbarButton(page, "Undo")).click();
	await expect(
		page.getByRole("textbox", { name: "Value", exact: true }),
	).toHaveValue(defaults.at(-1)!.file.value);
	expect(errors).toEqual([]);
});
