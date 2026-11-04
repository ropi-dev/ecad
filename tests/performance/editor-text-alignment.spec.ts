import { expect, test } from "@playwright/test";
import {
	selectSymbolAttribute,
	selectSymbolParent,
} from "../browser/symbol-items";
import { toolbarButton } from "../browser/toolbar";
import { setupAppTests } from "./app-fixture.ts";
import { finish, interaction, metric, ready, report } from "./app-helpers.ts";

setupAppTests();

test("editor-text-alignment", async ({ page }, testInfo) => {
	await page.addInitScript(() => {
		const file = {
			format: "ecad-symbol",
			version: 1,
			units: "mm",
			id: "alignment-connector",
			name: "Alignment connector",
			description: "",
			prefix: "J",
			value: "",
			shapes: [
				{ kind: "rectangle", x: 0, y: 0, width: 40, height: 30 },
				...Array.from({ length: 12 }, (_, index) => ({
					kind: "text",
					text: `Terminal ${index + 1}`,
					fontSize: 1.3,
					width: 8,
					height: 2,
					x: -15 + (index % 4) * 10,
					y: 10 - Math.floor(index / 4) * 10,
					horizontalAlign: "left",
					verticalAlign: "top",
				})),
			],
		};
		localStorage.setItem(
			"ecad.user-config.v1",
			JSON.stringify({
				version: 1,
				symbolLibraries: [
					{
						id: "builtin",
						name: "Built-in symbols",
						enabled: true,
						source: { kind: "builtin" },
					},
					{
						id: "alignment",
						name: "Alignment",
						enabled: true,
						source: { kind: "embedded", symbols: [file] },
					},
				],
			}),
		);
	});
	await page.goto("/editor?perf=1");
	await ready(page);
	const canvas = page.locator("canvas");
	const box = (await canvas.boundingBox())!;
	for (const x of [0.3, 0.6]) {
		await interaction(page, "symbol.text-placement", async () => {
			await page.getByRole("button", { name: "Symbols", exact: true }).click();
			await page
				.getByRole("button", {
					name: "Insert Alignment connector",
					exact: true,
				})
				.click();
			await canvas.click({
				position: { x: box.width * x, y: box.height * 0.7 },
			});
			await page.evaluate(
				() =>
					new Promise<void>((resolve) =>
						requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
					),
			);
		});
	}
	await page.getByRole("button", { name: "Symbols", exact: true }).click();
	await page
		.getByRole("button", { name: "Insert Resistor", exact: true })
		.click();
	await canvas.click({ position: { x: box.width * 0.4, y: box.height * 0.5 } });
	const center = await page
		.getByRole("spinbutton", { name: "Center X", exact: true })
		.inputValue();
	await selectSymbolAttribute(page, "reference");
	for (const [horizontal, vertical] of [
		["left", "top"],
		["center", "middle"],
		["right", "bottom"],
	]) {
		await interaction(page, "symbol.text-alignment", async () => {
			await page
				.getByRole("combobox", {
					name: "Text horizontal alignment",
					exact: true,
				})
				.selectOption(horizontal);
			await page
				.getByRole("combobox", { name: "Text vertical alignment", exact: true })
				.selectOption(vertical);
			await page.evaluate(
				() =>
					new Promise<void>((resolve) =>
						requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
					),
			);
		});
	}
	await selectSymbolParent(page);
	await expect(
		page.getByRole("spinbutton", { name: "Center X", exact: true }),
	).toHaveValue(center);
	await (await toolbarButton(page, "Text")).click();
	await canvas.click({ position: { x: box.width * 0.6, y: box.height * 0.5 } });
	const content = page.getByRole("textbox", {
		name: "Text content",
		exact: true,
	});
	await content.fill("Supply voltage\n3.3 V");
	await content.press("Tab");
	for (const [horizontal, vertical] of [
		["left", "top"],
		["center", "middle"],
		["right", "bottom"],
	]) {
		await interaction(page, "text.alignment", async () => {
			await page
				.getByRole("combobox", {
					name: "Text horizontal alignment",
					exact: true,
				})
				.selectOption(horizontal);
			await page
				.getByRole("combobox", { name: "Text vertical alignment", exact: true })
				.selectOption(vertical);
			await page.evaluate(
				() =>
					new Promise<void>((resolve) =>
						requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
					),
			);
		});
	}
	const value = await report(page);
	await finish(page, testInfo, "editor-text-alignment", {
		interactionP95Ms: metric(value, "scenario.interaction")!,
	});
});
