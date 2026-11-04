import { expect, test } from "@playwright/test";
import { required } from "../helpers/required.ts";
import { setupAppTests } from "./app-fixture.ts";
import { finish, interaction, metric, ready, report } from "./app-helpers.ts";

setupAppTests();

test("editor-symbol-rotate", async ({ page }, testInfo) => {
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
	const box = required(await canvas.boundingBox());
	await canvas.click({ position: { x: box.width / 2, y: box.height / 2 } });
	const center = page.getByRole("spinbutton", {
		name: "Center X",
		exact: true,
	});
	const originalCenter = await center.inputValue();
	for (let repeat = 0; repeat < 3; repeat++) {
		for (const [key, angle] of [
			["r", 90],
			["Shift+r", 0],
		] as const) {
			await interaction(page, "symbol.rotate", async () => {
				await page.keyboard.press(key);
				await page.waitForFunction(
					(angle) =>
						document
							.querySelector<HTMLInputElement>('input[aria-label="Angle"]')
							?.getAttribute("data-committed-value") === String(angle),
					angle,
					{ polling: "raf" },
				);
				await page.evaluate(
					() =>
						new Promise<void>((resolve) =>
							requestAnimationFrame(() =>
								requestAnimationFrame(() => resolve()),
							),
						),
				);
			});
		}
	}
	await expect(center).toHaveValue(originalCenter);
	const value = await report(page);
	await finish(page, testInfo, "editor-symbol-rotate", {
		interactionP95Ms: required(metric(value, "scenario.interaction")),
	});
});
