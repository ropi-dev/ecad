import { expect, test } from "@playwright/test";
import { closeProjectFiles } from "../browser/project-files";
import { required } from "../helpers/required.ts";
import { setupAppTests } from "./app-fixture.ts";
import {
	finish,
	interaction,
	metric,
	openCircuitWorkload,
	percentile,
	report,
} from "./app-helpers.ts";

setupAppTests();

test("circuit-keyboard-placement", async ({ page }, testInfo) => {
	await openCircuitWorkload(page, false);
	await closeProjectFiles(page);
	const canvas = page.getByLabel("Circuit connections graph", { exact: true });
	const times: number[] = [];
	for (let index = 1; index <= 3; index++) {
		times.push(
			await interaction(page, "circuit.keyboard-placement", async () => {
				await page
					.getByRole("button", { name: "Components", exact: true })
					.press("Enter");
				await page
					.getByRole("searchbox", { name: "Search components", exact: true })
					.fill("Resistor");
				await page.keyboard.press("Tab");
				await page
					.getByRole("button", { name: "Place Resistor", exact: true })
					.press("Enter");
				await expect(canvas).toBeFocused();
				await page.keyboard.press("ArrowRight");
				await page.keyboard.press("Enter");
				await expect(page.locator(".circuit-component")).toHaveCount(
					32 + index,
				);
				await page
					.getByRole("button", { name: "Add net", exact: true })
					.press("Enter");
				await expect(canvas).toBeFocused();
				await page.keyboard.press("Shift+ArrowLeft");
				await page.keyboard.press("Enter");
				await expect(
					page.getByRole("textbox", { name: "Net name", exact: true }),
				).toBeFocused();
				await page.keyboard.press("Escape");
				await expect(page.locator(".circuit-net")).toHaveCount(1);
				await page.keyboard.press("Control+z");
				await expect(page.locator(".circuit-net")).toHaveCount(0);
			}),
		);
	}
	await expect(page.locator(".circuit-editor")).toHaveAttribute(
		"data-pending-changes",
		"false",
	);
	const value = await report(page);
	await finish(page, testInfo, "circuit-keyboard-placement", {
		interactionP95Ms: percentile(times),
		graphP95Ms: required(metric(value, "circuit.graph")),
		editP95Ms: required(metric(value, "circuit.edit")),
	});
});
