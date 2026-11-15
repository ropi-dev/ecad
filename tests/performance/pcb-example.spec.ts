import { expect, test } from "@playwright/test";
import { projectRail } from "../browser/project-files";
import { required } from "../helpers/required.ts";
import { setupAppTests } from "./app-fixture.ts";
import {
	editorReady,
	finish,
	interaction,
	metric,
	ready,
	report,
} from "./app-helpers.ts";

setupAppTests();

test(
	"pcb-example",
	{ tag: ["@pcb", "@editor"] },
	async ({ page }, testInfo) => {
		await page.goto("/editor?perf=1");
		await ready(page);
		await interaction(page, "pcb.open-example", async () => {
			await projectRail(page)
				.getByRole("button", { name: "Add file", exact: true })
				.click();
			await page
				.getByRole("menuitem", {
					name: "RP2350A reference design",
					exact: true,
				})
				.click();
			await editorReady(page, "PCB editor · RP2350A");
			await expect(page.getByText("All connections routed")).toBeVisible();
		});
		const layers = page.getByRole("complementary", { name: "Layers" });
		for (let round = 0; round < 3; round++)
			await interaction(page, "pcb.hide-layer", async () => {
				await layers.getByRole("button", { name: "Hide Back copper" }).click();
				await layers.getByRole("button", { name: "Show Back copper" }).click();
			});
		await page.getByRole("button", { name: "Design rules check" }).click();
		for (let round = 0; round < 3; round++)
			await interaction(page, "pcb.drc", async () => {
				await page
					.getByRole("button", { name: "Run DRC", exact: true })
					.click();
				await expect(
					page.getByText("No violations, and every connection is routed."),
				).toBeVisible();
			});
		const value = await report(page);
		await finish(page, testInfo, "pcb-example", {
			interactionP95Ms: required(metric(value, "scenario.interaction")),
			openBoardMs: required(metric(value, "editor.open-board")),
		});
	},
);
