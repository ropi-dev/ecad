import { fromMils } from "@ecad/drawing-core/drawing/units.ts";
import { expect, type Page, test } from "@playwright/test";
import { selectSymbolParent } from "../browser/symbol-items";
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

async function openSymbolAttribute(page: Page, attribute: string) {
	await selectSymbolParent(page);
	const marker = required(
		await page
			.locator(
				`[data-testid="text-anchor"][data-anchor-id$=":label:${attribute === "Reference" ? 0 : 1}"]`,
			)
			.boundingBox(),
	);
	await page.mouse.dblclick(
		marker.x + marker.width / 2,
		marker.y + marker.height / 2,
	);
	await expect(page.getByTestId("symbol-child-selection")).toBeVisible();
}

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
		const position = { x: box.width * 0.5, y: box.height * 0.5 };
		await canvas.click({ position });
		await canvas.dblclick({ position });
		const center = page.getByRole("spinbutton", {
			name: "Center X",
			exact: true,
		});
		const initialCenter = await center.inputValue();
		for (let repeat = 0; repeat < 3; repeat++) {
			for (const attribute of ["Reference", "Value"]) {
				await openSymbolAttribute(page, attribute);
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
				await canvas.dblclick({ position });
				await expect(center).toHaveValue(initialCenter);
			}
		}
		const value = await report(page);
		await finish(page, testInfo, "editor-symbol-text", {
			interactionP95Ms: required(metric(value, "scenario.interaction")),
		});
	},
);
