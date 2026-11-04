import { expect, test } from "@playwright/test";
import { closeProjectFiles } from "../browser/project-files";
import { toolbarButton } from "../browser/toolbar";
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

test("circuit-merge-names", async ({ page }, testInfo) => {
	await openCircuitWorkload(page);
	await closeProjectFiles(page);
	const times: number[] = [];
	for (let index = 0; index < 3; index++) {
		times.push(
			await interaction(page, "circuit.merge-names", async () => {
				await page
					.getByRole("button", { name: "Net SIGNAL_0", exact: true })
					.focus();
				await page
					.getByRole("button", { name: "Net SIGNAL_0", exact: true })
					.press("Enter");
				await page
					.getByRole("textbox", { name: "Net name", exact: true })
					.fill("GND");
				await page
					.getByRole("textbox", { name: "Net name", exact: true })
					.press("Enter");
				await expect(page.locator(".circuit-net")).toHaveCount(16);
				await expect(page.locator(".circuit-editor")).toHaveAttribute(
					"data-pending-changes",
					"false",
				);
			}),
		);
		await (await toolbarButton(page, "Undo")).click();
		await expect(page.locator(".circuit-net")).toHaveCount(17);
		await expect(page.locator(".circuit-editor")).toHaveAttribute(
			"data-pending-changes",
			"false",
		);
	}
	const value = await report(page);
	await finish(page, testInfo, "circuit-merge-names", {
		interactionP95Ms: percentile(times),
		syncP95Ms: metric(value, "pcb.synchronize")!,
	});
});
