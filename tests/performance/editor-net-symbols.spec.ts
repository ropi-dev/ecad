import { expect, test } from "@playwright/test";
import { required } from "../helpers/required.ts";
import { setupAppTests } from "./app-fixture.ts";
import { finish, interaction, metric, ready, report } from "./app-helpers.ts";

setupAppTests();

test("editor-net-symbols", async ({ page }, testInfo) => {
	await page.goto("/editor?perf=1");
	await ready(page);
	for (const name of ["Ground", "VDD"]) {
		await page.getByRole("button", { name: "Symbols", exact: true }).click();
		await page.getByRole("searchbox", { name: "Search symbols" }).fill(name);
		await page
			.getByRole("button", { name: `Insert ${name}`, exact: true })
			.click();
		const canvas = page.locator("canvas");
		const bounds = required(await canvas.boundingBox());
		await canvas.click({
			position: {
				x: bounds.width * (name === "Ground" ? 0.35 : 0.55),
				y: bounds.height * 0.45,
			},
		});
		await expect(
			page.getByRole("checkbox", { name: "Net symbol", exact: true }),
		).toBeChecked();
		await expect(
			page.getByRole("textbox", { name: "Reference", exact: true }),
		).toHaveCount(0);
		await expect(
			page.getByRole("textbox", { name: "Value", exact: true }),
		).toHaveCount(0);
		const netName = page.getByRole("textbox", { name: "Name", exact: true });
		await expect(netName).toHaveValue(name === "Ground" ? "GND" : "VDD");
		await interaction(page, "net-symbol.rename", async () => {
			await netName.fill("+3V3");
			await netName.press("Tab");
			await expect(netName).toHaveAttribute("data-committed-value", "+3V3");
		});
		await interaction(page, "net-symbol.role", async () => {
			await page
				.getByRole("checkbox", { name: "Net symbol", exact: true })
				.uncheck();
			await expect(
				page.getByRole("textbox", { name: "Name", exact: true }),
			).toHaveValue("+3V3");
			await page
				.getByRole("checkbox", { name: "Net symbol", exact: true })
				.check();
			await expect(netName).toHaveValue("+3V3");
		});
	}
	await page.screenshot({ path: "/tmp/ecad-net-symbols/interface.png" });
	await finish(page, testInfo, "editor-net-symbols", {
		interactionP95Ms: required(
			metric(await report(page), "scenario.interaction"),
		),
	});
});
