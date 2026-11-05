import { expect, test } from "@playwright/test";
import { required } from "../helpers/required.ts";
import { setupAppTests } from "./app-fixture.ts";
import {
	finish,
	interaction,
	metric,
	pointAt,
	ready,
	report,
	saveCount,
	saved,
} from "./app-helpers.ts";

setupAppTests();

test(
	"editor-symbol-duplicate",
	{ tag: ["@editor"] },
	async ({ page }, testInfo) => {
		await page.goto("/editor?perf=1");
		await ready(page);
		await expect(
			page.getByRole("button", { name: "Select", exact: true }),
		).toBeEnabled();
		await page.getByRole("button", { name: "Symbols", exact: true }).click();
		await page
			.getByRole("button", { name: "Insert Resistor", exact: true })
			.click();
		const canvas = page.locator("canvas");
		const bounds = required(await canvas.boundingBox());
		const source = {
			x: bounds.x + bounds.width * 0.35,
			y: bounds.y + bounds.height * 0.5,
		};
		let saves = await saveCount(page);
		await page.mouse.click(source.x, source.y);
		await expect(
			page.getByRole("textbox", { name: "Reference", exact: true }),
		).toHaveValue("R1");
		await expect(page.locator('[data-tool="select"]')).toBeAttached();
		await saved(page, saves);
		for (let repeat = 0; repeat < 3; repeat++) {
			await pointAt(page, source);
			saves = await saveCount(page);
			await interaction(page, "symbol.duplicate", async () => {
				await page.keyboard.down("Alt");
				await page.mouse.move(source.x, source.y);
				await page.mouse.down();
				await page.mouse.move(source.x + 80 + repeat * 40, source.y + 60, {
					steps: 4,
				});
				await page.mouse.up();
				await page.keyboard.up("Alt");
				await page.waitForFunction(
					(reference) =>
						document.querySelector<HTMLInputElement>(
							'input[aria-label="Reference"]',
						)?.value === reference,
					`R${repeat + 2}`,
					{ polling: "raf" },
				);
			});
			await saved(page, saves);
		}
		const value = await report(page);
		await finish(page, testInfo, "editor-symbol-duplicate", {
			interactionP95Ms: required(metric(value, "scenario.interaction")),
		});
	},
);
