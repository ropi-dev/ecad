import { expect, test } from "@playwright/test";
import { closeProjectFiles } from "../browser/project-files";
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

test("circuit-grid-snap", async ({ page }, testInfo) => {
	await openCircuitWorkload(page);
	await closeProjectFiles(page);
	const header = page.getByRole("button", {
		name: "Select component R1",
		exact: true,
	});
	const node = header.locator("xpath=../..");
	const times: number[] = [];
	for (let index = 0; index < 3; index++) {
		const box = await header.boundingBox();
		if (!box) throw new Error("Missing component header.");
		const original = await node.getAttribute("transform");
		times.push(
			await interaction(page, "circuit.snap-drag", async () => {
				await page.mouse.move(box.x + box.width / 2, box.y + box.height / 4);
				await page.mouse.down();
				await page.mouse.move(
					box.x + box.width / 2 + 37,
					box.y + box.height / 4 + 23,
					{ steps: 6 },
				);
				await page.mouse.up();
				await expect(node).not.toHaveAttribute("transform", original!);
			}),
		);
		await page.keyboard.press("Control+z");
		await expect(node).toHaveAttribute("transform", original!);
	}
	await expect(page.locator(".circuit-editor")).toHaveAttribute(
		"data-pending-changes",
		"false",
	);
	const value = await report(page);
	await finish(page, testInfo, "circuit-grid-snap", {
		interactionP95Ms: percentile(times),
		graphP95Ms: metric(value, "circuit.graph")!,
		editP95Ms: metric(value, "circuit.edit")!,
	});
});
