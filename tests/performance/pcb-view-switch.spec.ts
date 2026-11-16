import { expect, type Page, test } from "@playwright/test";
import { projectRail } from "../browser/project-files";
import { setupAppTests } from "./app-fixture.ts";
import {
	editorReady,
	finish,
	interaction,
	percentile,
	ready,
} from "./app-helpers.ts";

setupAppTests();

const heading = (page: Page) => page.getByRole("heading", { level: 1 });
const views = {
	schematic: async (page: Page) => {
		await expect(heading(page)).toContainText("Schematic editor · RP2350A");
		await expect(
			page.getByRole("button", { name: "Symbols", exact: true }),
		).toBeEnabled();
	},
	circuit: async (page: Page) => {
		await expect(heading(page)).toHaveText("RP2350A");
		await expect(
			page.getByRole("button", { name: "Select component U1", exact: true }),
		).toBeVisible();
	},
	pcb: async (page: Page) => {
		await expect(heading(page)).toHaveText("PCB editor · RP2350A");
		await expect(page.getByText("All connections routed")).toBeVisible();
	},
};

async function switchTo(page: Page, view: keyof typeof views) {
	await page
		.getByRole("button", { name: `Switch to ${view} view`, exact: true })
		.click();
	await views[view](page);
}

test(
	"pcb-view-switch",
	{ tag: ["@pcb", "@circuit", "@editor"] },
	async ({ page }, testInfo) => {
		await page.goto("/editor?perf=1");
		await ready(page);
		await projectRail(page)
			.getByRole("button", { name: "Add file", exact: true })
			.click();
		await page
			.getByRole("menuitem", { name: "RP2350A reference design", exact: true })
			.click();
		await editorReady(page, "PCB editor · RP2350A");
		await views.pcb(page);
		for (const view of ["schematic", "circuit", "pcb"] as const)
			await switchTo(page, view);
		const times: number[] = [];
		for (let round = 0; round < 3; round++)
			for (const view of ["schematic", "circuit", "pcb"] as const)
				times.push(
					await interaction(page, `switch-to-${view}`, () =>
						switchTo(page, view),
					),
				);
		await finish(page, testInfo, "pcb-view-switch", {
			interactionP95Ms: percentile(times),
		});
	},
);
