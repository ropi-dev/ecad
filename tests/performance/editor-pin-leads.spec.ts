import { fromMils } from "@ecad/drawing-core/drawing/units.ts";
import { expect, test } from "@playwright/test";
import { toolbarButton } from "../browser/toolbar";
import { required } from "../helpers/required.ts";
import { setupAppTests } from "./app-fixture.ts";
import { finish, interaction, metric, ready, report } from "./app-helpers.ts";

setupAppTests();

test("editor-pin-leads", async ({ page }, testInfo) => {
	await page.goto("/editor?perf=1");
	await ready(page);
	await (await toolbarButton(page, "Pin")).click();
	const canvas = page.locator("canvas");
	const bounds = required(await canvas.boundingBox());
	await canvas.click({
		position: { x: bounds.width * 0.4, y: bounds.height / 2 },
	});
	await expect(
		page.getByRole("spinbutton", { name: "Lead length", exact: true }),
	).toHaveValue("100");
	for (const [label, value] of [
		["Name", "Signal"],
		["Number", "1"],
	]) {
		await page.getByRole("textbox", { name: label, exact: true }).fill(value);
		await page
			.getByRole("textbox", { name: label, exact: true })
			.press("Enter");
	}
	for (let repeat = 0; repeat < 3; repeat++) {
		for (const [label, value] of [
			["Lead length", 150 + repeat * 50],
			["Angle", 90 * (repeat + 1)],
			["Center X", 200 + repeat * 50],
		] as const) {
			await interaction(page, "pin.edit-lead", async () => {
				const input = page.getByRole("spinbutton", {
					name: label,
					exact: true,
				});
				await input.fill(String(value));
				await input.press("Enter");
				await page.waitForFunction(
					({ label, value }) =>
						Math.abs(
							Number(
								document
									.querySelector<HTMLInputElement>(
										`input[aria-label="${label}"]`,
									)
									?.getAttribute("data-committed-value"),
							) - value,
						) < 1e-8,
					{ label, value: label === "Angle" ? value : fromMils(value) },
				);
			});
		}
	}
	const value = await report(page);
	await finish(page, testInfo, "editor-pin-leads", {
		interactionP95Ms: required(metric(value, "scenario.interaction")),
	});
});
