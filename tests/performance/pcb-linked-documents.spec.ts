import { expect, test } from "@playwright/test";
import { closeProjectFiles, openProjectFiles } from "../browser/project-files";
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

test("pcb-linked-documents", async ({ page }, testInfo) => {
	await openCircuitWorkload(page);
	await closeProjectFiles(page);
	const times: number[] = [];
	times.push(
		await interaction(page, "pcb-add-component", async () => {
			await page
				.getByRole("button", { name: "Components", exact: true })
				.click();
			await page
				.getByRole("searchbox", { name: "Search components", exact: true })
				.fill("Resistor");
			await page
				.getByRole("button", { name: "Place Resistor", exact: true })
				.click();
			await page
				.getByLabel("Circuit connections graph", { exact: true })
				.click({ position: { x: 350, y: 250 } });
			await expect(page.locator(".circuit-editor")).toHaveAttribute(
				"data-pending-changes",
				"false",
			);
		}),
	);
	times.push(
		await interaction(page, "pcb-open-schematic", async () => {
			await (await openProjectFiles(page))
				.getByRole("link", {
					name: "Open Circuit workload.ecaddraw",
					exact: true,
				})
				.click();
			await closeProjectFiles(page);
			await expect(
				page.getByRole("button", { name: "Symbols", exact: true }),
			).toBeVisible();
		}),
	);
	const value = await report(page);
	await finish(page, testInfo, "pcb-linked-documents", {
		interactionP95Ms: percentile(times),
		syncP95Ms: metric(value, "pcb.synchronize")!,
	});
});
