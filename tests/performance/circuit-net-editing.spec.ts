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
	"circuit-net-editing",
	{ tag: ["@circuit"] },
	async ({ page }, testInfo) => {
		await openCircuitWorkload(page, false);
		await closeProjectFiles(page);
		const canvas = page.getByLabel("Circuit connections graph", {
			exact: true,
		});
		const times: number[] = [];
		times.push(
			await interaction(page, "circuit.add-net", async () => {
				await page
					.getByRole("button", { name: "Add net", exact: true })
					.click();
				await canvas.click({ position: { x: 200, y: 350 } });
				await page
					.getByRole("textbox", { name: "Net name", exact: true })
					.fill("GND");
				await page
					.getByRole("textbox", { name: "Net name", exact: true })
					.press("Enter");
				await expect(
					page.getByRole("button", { name: "Net GND", exact: true }),
				).toBeVisible();
			}),
		);
		for (let index = 0; index < 3; index++) {
			const source = await page
				.getByRole("button", { name: `Pin R${index + 1}.1`, exact: true })
				.locator("circle")
				.boundingBox();
			const target = await page
				.getByRole("button", { name: "Net GND", exact: true })
				.locator("circle")
				.boundingBox();
			if (!source || !target)
				throw new Error("Missing ground connection targets.");
			times.push(
				await interaction(page, "circuit.connect-to-net", async () => {
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
					await page.mouse.up();
					await expect(page.locator(".circuit-connection")).toHaveCount(
						index + 1,
					);
				}),
			);
		}
		for (let index = 0; index < 3; index++) {
			times.push(
				await interaction(page, "circuit.delete-membership", async () => {
					await page
						.getByRole("button", {
							name: `Connection R${index + 1}.1`,
							exact: true,
						})
						.press("Enter");
					await page.keyboard.press("Delete");
					await expect(page.locator(".circuit-connection")).toHaveCount(
						2 - index,
					);
				}),
			);
		}
		await expect(
			page.getByRole("button", { name: "Net GND", exact: true }),
		).toBeVisible();
		await expect(page.locator(".circuit-editor")).toHaveAttribute(
			"data-pending-changes",
			"false",
		);
		const value = await report(page);
		await finish(page, testInfo, "circuit-net-editing", {
			interactionP95Ms: percentile(times),
			graphP95Ms: required(metric(value, "circuit.graph")),
			editP95Ms: required(metric(value, "circuit.edit")),
		});
	},
);
