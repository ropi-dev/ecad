import { expect, test } from "@playwright/test";
import { setupAppTests } from "./app-fixture.ts";
import {
	finish,
	interaction,
	metric,
	openComponentWorkload,
	percentile,
	report,
} from "./app-helpers.ts";

setupAppTests();

test("circuit-components", async ({ page }, testInfo) => {
	await openComponentWorkload(page);
	const times: number[] = [];
	for (const [index, name] of [
		"Resistor",
		"Resistor",
		"128-pin device",
	].entries()) {
		times.push(
			await interaction(page, "circuit.place-symbol", async () => {
				await page
					.getByRole("button", { name: "Components", exact: true })
					.click();
				await page
					.getByRole("searchbox", { name: "Search components", exact: true })
					.fill(name);
				await expect(
					page
						.getByRole("button", { name: `Place ${name}`, exact: true })
						.locator("svg")
						.first(),
				).toBeVisible();
				await page
					.getByRole("button", { name: `Place ${name}`, exact: true })
					.click();
				await page
					.getByLabel("Circuit connections graph", { exact: true })
					.click({ position: { x: 250 + index * 150, y: 300 } });
				await page.waitForFunction(
					(count) =>
						document.querySelectorAll(".circuit-component").length === count &&
						document
							.querySelector(".circuit-editor")
							?.getAttribute("data-pending-changes") === "false",
					index + 1,
					{ polling: "raf" },
				);
			}),
		);
	}
	await page.getByRole("button", { name: "Fit graph", exact: true }).click();
	const value = await report(page);
	await finish(page, testInfo, "circuit-components", {
		interactionP95Ms: percentile(times),
		graphP95Ms: metric(value, "circuit.graph")!,
		componentP95Ms: metric(value, "circuit.component-from-symbol")!,
		thumbnailP95Ms: metric(value, "symbol.thumbnail")!,
		libraryResolveMs: metric(value, "symbol-library.resolve")!,
	});
});
