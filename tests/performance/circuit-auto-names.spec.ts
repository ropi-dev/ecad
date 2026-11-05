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

test(
	"circuit-auto-names",
	{ tag: ["@circuit"] },
	async ({ page }, testInfo) => {
		await openCircuitWorkload(page, false);
		await closeProjectFiles(page);
		const times: number[] = [];
		for (let index = 1; index <= 5; index += 2) {
			const label = `R${index}.1 / R${index + 1}.1`;
			const from = await page
				.getByRole("button", { name: `Pin R${index}.1`, exact: true })
				.locator("circle")
				.boundingBox();
			const to = await page
				.getByRole("button", { name: `Pin R${index + 1}.1`, exact: true })
				.locator("circle")
				.boundingBox();
			if (!from || !to) throw new Error("Missing terminals.");
			times.push(
				await interaction(page, "circuit.auto-name", async () => {
					await page.mouse.move(
						from.x + from.width / 2,
						from.y + from.height / 2,
					);
					await page.mouse.down();
					await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, {
						steps: 6,
					});
					await page.mouse.up();
					await expect(
						page.getByRole("button", { name: `Net ${label}`, exact: true }),
					).toBeVisible();
				}),
			);
			await expect(page.locator(".circuit-editor")).toHaveAttribute(
				"data-pending-changes",
				"false",
			);
			await page.keyboard.press("Control+z");
			await expect(page.locator(".circuit-net")).toHaveCount(0);
		}
		const value = await report(page);
		await finish(page, testInfo, "circuit-auto-names", {
			interactionP95Ms: percentile(times),
			graphP95Ms: required(metric(value, "circuit.graph")),
			editP95Ms: required(metric(value, "circuit.edit")),
		});
	},
);
