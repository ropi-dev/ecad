import { fromMils } from "@ecad/drawing-core/drawing/units.ts";
import { expect, test } from "@playwright/test";
import {
	selectSymbolAttribute,
	selectSymbolParent,
} from "../browser/symbol-items";
import { required } from "../helpers/required.ts";
import { setupAppTests } from "./app-fixture.ts";
import {
	committed,
	finish,
	interaction,
	metric,
	ready,
	report,
} from "./app-helpers.ts";

setupAppTests();

test(
	"editor-symbol-text",
	{ tag: ["@editor", "@symbols"] },
	async ({ page }, testInfo) => {
		await page.goto("/editor?perf=1");
		await ready(page);
		await page.getByRole("button", { name: "Symbols", exact: true }).click();
		await page
			.getByRole("button", { name: "Insert Resistor", exact: true })
			.click();
		const canvas = page.locator("canvas");
		const box = required(await canvas.boundingBox());
		await canvas.click({
			position: { x: box.width * 0.5, y: box.height * 0.5 },
		});
		const center = page.getByRole("spinbutton", {
			name: "Center X",
			exact: true,
		});
		const initialCenter = await center.inputValue();
		for (let repeat = 0; repeat < 3; repeat++) {
			for (const attribute of ["Reference", "Value"]) {
				await selectSymbolAttribute(page, attribute.toLowerCase());
				await interaction(page, "symbol.text-position", async () => {
					const input = page.getByRole("spinbutton", {
						name: "Anchor X",
						exact: true,
					});
					await input.fill(String(10 + repeat * 5));
					await input.press("Tab");
					await committed(page, "Anchor X", fromMils(10 + repeat * 5));
					await page.evaluate(
						() =>
							new Promise<void>((resolve) =>
								requestAnimationFrame(() =>
									requestAnimationFrame(() => resolve()),
								),
							),
					);
				});
				await selectSymbolParent(page);
				await expect(center).toHaveValue(initialCenter);
			}
		}
		const value = await report(page);
		await finish(page, testInfo, "editor-symbol-text", {
			interactionP95Ms: required(metric(value, "scenario.interaction")),
		});
	},
);
