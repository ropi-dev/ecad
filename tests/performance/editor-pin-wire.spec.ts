import { expect, test } from "@playwright/test";
import { toolbarButton } from "../browser/toolbar";
import { required } from "../helpers/required.ts";
import { setupAppTests } from "./app-fixture.ts";
import {
	finish,
	interaction,
	metric,
	ready,
	report,
	saveCount,
	saved,
} from "./app-helpers.ts";

setupAppTests();

test("editor-pin-wire", { tag: ["@editor"] }, async ({ page }, testInfo) => {
	await page.goto("/editor?perf=1");
	await ready(page);
	await expect(
		page.getByRole("button", { name: "Select", exact: true }),
	).toBeEnabled();
	await page.getByRole("button", { name: "Snap to grid", exact: true }).click();
	await (await toolbarButton(page, "Pin")).click();
	const canvas = page.locator("canvas");
	const bounds = required(await canvas.boundingBox());
	const pin = { x: bounds.width * 0.4, y: bounds.height / 2 };
	let saves = await saveCount(page);
	await canvas.click({ position: pin });
	await expect(page.locator('[data-tool="select"]')).toBeAttached();
	for (let repeat = 0; repeat < 3; repeat++) {
		// A save that lands while a wire is being drawn ends the wire.
		await saved(page, saves);
		await interaction(page, "pin.start-wire", async () => {
			await canvas.click({ position: pin });
			await page.waitForFunction(() =>
				document.querySelector('[data-tool="wire"]'),
			);
		});
		await canvas.click({ position: { x: pin.x + 80, y: pin.y } });
		await page.keyboard.press("Enter");
		await expect(page.locator('[data-tool="select"]')).toBeAttached();
		await expect(
			page.getByRole("spinbutton", { name: "Length", exact: true }),
		).toBeVisible();
		saves = await saveCount(page);
		await (await toolbarButton(page, "Undo")).click();
	}
	const value = await report(page);
	await finish(page, testInfo, "editor-pin-wire", {
		interactionP95Ms: required(metric(value, "scenario.interaction")),
	});
});
