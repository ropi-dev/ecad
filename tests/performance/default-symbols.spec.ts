import { generateDefaultSymbols } from "@ecad/default-symbols";
import { expect, test } from "@playwright/test";
import { required } from "../helpers/required.ts";
import { setupAppTests } from "./app-fixture.ts";
import { finish, interaction, metric, ready, report } from "./app-helpers.ts";

setupAppTests();
for (const [scenario, names] of [
	[
		"default-symbols",
		[
			"Inductor",
			"LED",
			"NPN transistor",
			"P-channel MOSFET",
			"Transformer",
			"8-pin connector",
		],
	],
	["microcontroller-symbols", ["RP2040", "RP2350A", "RP2350B"]],
] as const) {
	test(
		scenario,
		{ tag: ["@symbols", "@editor"] },
		async ({ page }, testInfo) => {
			await page.goto("/editor?perf=1");
			await ready(page);
			const canvas = page.locator("canvas");
			await expect(canvas).toBeVisible();
			for (const [index, name] of names.entries()) {
				await interaction(page, "symbol.picker", async () => {
					await page
						.getByRole("button", { name: "Symbols", exact: true })
						.click();
					await expect(
						page.getByRole("button", { name: /^Insert / }),
					).toHaveCount(generateDefaultSymbols().length);
					await expect(
						page
							.getByRole("button", { name: "Insert Resistor", exact: true })
							.locator("svg"),
					).toHaveCount(1);
					await expect(
						page
							.getByRole("button", { name: "Insert RP2350B", exact: true })
							.locator("svg"),
					).toHaveCount(0);
					await expect(
						page
							.getByRole("region", { name: "Diodes", exact: true })
							.getByRole("button", { name: "Insert LED", exact: true }),
					).toBeVisible();
					await expect(
						page
							.getByRole("region", { name: "Transistors", exact: true })
							.getByRole("button", {
								name: "Insert NPN transistor",
								exact: true,
							}),
					).toBeVisible();
				});
				await interaction(page, "symbol.search", async () => {
					const search = page.getByRole("searchbox", {
						name: "Search symbols",
					});
					await expect(search).toBeFocused();
					await search.fill(name);
					await expect(
						page.getByRole("button", { name: /^Insert / }),
					).toHaveCount(1);
				});
				await interaction(page, "symbol.place", async () => {
					await page
						.getByRole("button", { name: `Insert ${name}`, exact: true })
						.click();
					const bounds = required(await canvas.boundingBox());
					await canvas.click({
						position: {
							x: bounds.width * (0.25 + (index % 3) * 0.2),
							y: bounds.height * (0.35 + Math.floor(index / 3) * 0.25),
						},
					});
					await expect(
						page.getByRole("textbox", { name: "Name", exact: true }),
					).toHaveValue(name);
				});
			}
			await page.getByRole("button", { name: "Symbols", exact: true }).click();
			const value = await report(page);
			await finish(page, testInfo, scenario, {
				interactionP95Ms: required(metric(value, "scenario.interaction")),
				thumbnailP95Ms: required(metric(value, "symbol.thumbnail")),
			});
		},
	);
}
