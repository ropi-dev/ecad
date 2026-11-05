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

test("circuit-connect", { tag: ["@circuit"] }, async ({ page }, testInfo) => {
	await openCircuitWorkload(page);
	await closeProjectFiles(page);
	const times: number[] = [];
	for (let index = 0; index < 3; index++) {
		const source = await page
			.getByRole("button", { name: "Pin R1.2", exact: true })
			.locator("circle")
			.boundingBox();
		const target = await page
			.getByRole("button", { name: "Pin R2.1", exact: true })
			.locator("circle")
			.boundingBox();
		if (!source || !target) throw new Error("Missing connection terminals.");
		times.push(
			await interaction(page, "circuit.connect-drag", async () => {
				await page.mouse.move(
					source.x + source.width / 2,
					source.y + source.height / 2,
				);
				await page.mouse.down();
				await page.mouse.move(
					target.x + target.width / 2,
					target.y + target.height / 2,
					{ steps: 6 },
				);
				await expect(page.locator("[data-connection-preview]")).toBeVisible();
				await page.mouse.up();
				await page.waitForFunction(
					() =>
						document.querySelectorAll(".circuit-net").length === 16 &&
						!document.querySelector("[data-connection-preview]"),
					undefined,
					{ polling: "raf" },
				);
			}),
		);
		await expect(page.locator(".circuit-editor")).toHaveAttribute(
			"data-pending-changes",
			"false",
		);
		await page.keyboard.press("Control+z");
		await expect(page.locator(".circuit-net")).toHaveCount(17);
	}
	const value = await report(page);
	await finish(page, testInfo, "circuit-connect", {
		interactionP95Ms: percentile(times),
		graphP95Ms: required(metric(value, "circuit.graph")),
		editP95Ms: required(metric(value, "circuit.edit")),
	});
});
