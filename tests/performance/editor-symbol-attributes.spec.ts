import { expect, test } from "@playwright/test";
import { openProjectFiles } from "../browser/project-files";
import { required } from "../helpers/required.ts";
import { setupAppTests } from "./app-fixture.ts";
import {
	finish,
	interaction,
	percentile,
	ready,
	report,
} from "./app-helpers.ts";

setupAppTests();

test(
	"editor-symbol-attributes",
	{ tag: ["@editor", "@symbols"] },
	async ({ page }, testInfo) => {
		await page.goto("/projects?perf=1");
		await ready(page);
		await expect(
			(await openProjectFiles(page)).getByLabel("Add symbol files"),
		).toBeEnabled();
		const symbol = {
			format: "ecad-symbol",
			version: 1,
			units: "mm",
			id: "editable-package",
			name: "Editable package",
			description: "",
			prefix: "U",
			value: "",
			shapes: Array.from({ length: 128 }, (_, index) => ({
				kind: "pin",
				name: `Pin ${index + 1}`,
				x: index < 64 ? -10 : 10,
				y: (index % 64) - 32,
			})),
		};
		await (await openProjectFiles(page))
			.getByLabel("Add symbol files")
			.setInputFiles({
				name: "package.ecadsym",
				mimeType: "application/json",
				buffer: Buffer.from(JSON.stringify(symbol)),
			});
		for (let repeat = 0; repeat < 3; repeat++) {
			await (await openProjectFiles(page))
				.getByRole("link", {
					name: /^(?:Open Drawing|Open Untitled\.ecaddraw)$/,
					exact: true,
				})
				.click();
			await page.getByRole("button", { name: "Symbols", exact: true }).click();
			await page
				.getByRole("button", { name: "Insert Editable package", exact: true })
				.click();
			const bounds = required(await page.locator("canvas").boundingBox());
			await page
				.locator("canvas")
				.click({ position: { x: bounds.width * 0.4, y: bounds.height / 2 } });
			await interaction(page, "symbol.open-definition", async () => {
				await page
					.getByRole("button", { name: "Edit symbol", exact: true })
					.click();
				await expect(page.getByRole("heading", { level: 1 })).toHaveText(
					"Symbol editor · Editable package",
				);
				await expect(
					page.getByRole("button", { name: "Select", exact: true }),
				).toBeEnabled();
				await expect(
					page.getByTestId("viewport-grid").locator("mask"),
				).toHaveCount(0);
			});
			if (repeat < 2)
				await (await openProjectFiles(page))
					.getByRole("link", { name: "Workspace home", exact: true })
					.click();
		}
		const value = await report(page);
		await finish(page, testInfo, "editor-symbol-attributes", {
			interactionP95Ms: percentile(
				value.events
					.filter((event) => event.name === "scenario.interaction")
					.map((event) => event.duration),
			),
		});
	},
);
