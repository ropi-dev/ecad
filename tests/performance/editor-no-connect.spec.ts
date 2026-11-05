import { expect, test } from "@playwright/test";
import { toolbarButton } from "../browser/toolbar";
import { required } from "../helpers/required.ts";
import { setupAppTests } from "./app-fixture.ts";
import { finish, interaction, metric, ready, report } from "./app-helpers.ts";

setupAppTests();

test("editor-no-connect", { tag: ["@editor"] }, async ({ page }, testInfo) => {
	await page.goto("/editor?perf=1");
	await ready(page);
	await expect(
		page.getByRole("button", { name: "Select", exact: true }),
	).toBeEnabled();
	const canvas = page.locator("canvas");
	const bounds = required(await canvas.boundingBox());
	const pin = { x: bounds.width * 0.45, y: bounds.height / 2 };
	await (await toolbarButton(page, "Pin")).click();
	await canvas.click({ position: pin });
	const pinX = await page
		.getByRole("spinbutton", { name: "Center X", exact: true })
		.inputValue();
	for (let repeat = 0; repeat < 3; repeat++) {
		await (await toolbarButton(page, "No connect")).click();
		await interaction(page, "no-connect.place", async () => {
			await canvas.click({ position: { x: pin.x + 2, y: pin.y + 2 } });
			await page.waitForFunction(() =>
				document.querySelector('[data-tool="select"]'),
			);
		});
		await expect(
			page.getByRole("spinbutton", { name: "Center X", exact: true }),
		).toHaveValue(pinX);
		await expect(page.getByText("no-connect", { exact: true })).toBeVisible();
		if (repeat === 2) {
			await page.keyboard.press("F6");
			await page.mouse.move(50, 50);
			await page.screenshot({ path: "/tmp/ecad-no-connect.png" });
		}
		await (await toolbarButton(page, "Undo")).click();
	}
	const value = await report(page);
	await finish(page, testInfo, "editor-no-connect", {
		interactionP95Ms: required(metric(value, "scenario.interaction")),
	});
});
