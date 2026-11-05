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

// Untangle leaves R1 overlapping R2 after the second drag in this workload.
test.fixme("circuit-untangle", async ({ page }, testInfo) => {
	await openCircuitWorkload(page);
	await closeProjectFiles(page);
	const times: number[] = [];
	for (let index = 0; index < 3; index++) {
		const headers = await page
			.locator(".circuit-node-handle button")
			.evaluateAll((elements) =>
				elements
					.map((element) => {
						const box = element.getBoundingClientRect();
						return {
							label:
								element.getAttribute("aria-label") ??
								(() => {
									throw new Error("Expected a value");
								})(),
							x: box.x,
							y: box.y,
							width: box.width,
							height: box.height,
						};
					})
					.sort((a, b) => a.y - b.y || a.x - b.x),
			);
		const [source, target] = headers;
		await page.mouse.move(
			source.x + source.width / 2,
			source.y + source.height / 4,
		);
		await page.mouse.down();
		await page.mouse.move(
			target.x + source.width / 2,
			target.y + source.height / 4,
			{ steps: 6 },
		);
		await page.mouse.up();
		times.push(
			await interaction(page, "circuit.untangle-ui", async () => {
				await page
					.getByRole("button", { name: "Untangle", exact: true })
					.click();
				await page.waitForFunction(
					() => {
						const boxes = Array.from(
							document.querySelectorAll(".circuit-component-body"),
							(element) => element.getBoundingClientRect(),
						);
						return boxes.every((box, a) =>
							boxes.every(
								(other, b) =>
									a === b ||
									!(
										box.x < other.right &&
										box.right > other.x &&
										box.y < other.bottom &&
										box.bottom > other.y
									),
							),
						);
					},
					undefined,
					{ polling: "raf" },
				);
			}),
		);
	}
	await expect(page.locator(".circuit-editor")).toHaveAttribute(
		"data-pending-changes",
		"false",
	);
	const value = await report(page);
	await finish(page, testInfo, "circuit-untangle", {
		interactionP95Ms: percentile(times),
		untangleP95Ms: required(metric(value, "circuit.untangle")),
		graphP95Ms: required(metric(value, "circuit.graph")),
	});
});
