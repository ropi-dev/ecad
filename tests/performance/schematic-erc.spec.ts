import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { closeProjectFiles, openProjectFiles } from "../browser/project-files";
import { required } from "../helpers/required.ts";
import { setupAppTests } from "./app-fixture.ts";
import {
	finish,
	interaction,
	metric,
	percentile,
	ready,
	report,
} from "./app-helpers.ts";

setupAppTests();

test(
	"schematic-erc",
	{ tag: ["@editor", "@circuit"] },
	async ({ page }, testInfo) => {
		await page.goto("/projects?perf=1");
		await ready(page);
		const sidebar = await openProjectFiles(page);
		await sidebar
			.getByLabel("Add KiCad schematic files")
			.setInputFiles(
				resolve("tests/fixtures/kicad/RPI-RP2350A-MINIMAL_R4-S1.kicad_sch"),
			);
		await page
			.getByRole("button", { name: "Dismiss import report", exact: true })
			.click();
		await closeProjectFiles(page);
		const toolbar = page.getByRole("toolbar", {
			name: "Schematic tools",
			exact: true,
		});
		await expect(
			toolbar.getByRole("button", { name: "Shapes", exact: true }),
		).toBeEnabled();
		// The imported reference design has one finding: KiCad pin types make
		// its RC-filtered VREG_AVDD rail an undriven power input, as in KiCad
		// without a PWR_FLAG. Builds before pin types report none. An unwired
		// resistor adds two warnings.
		await toolbar.getByRole("button", { name: "Symbols", exact: true }).click();
		await page
			.getByRole("button", { name: "Insert Resistor, US", exact: true })
			.click();
		await page
			.locator("canvas")
			.first()
			.click({ position: { x: 60, y: 120 } });
		await page.keyboard.press("Escape");
		await toolbar
			.getByRole("button", { name: "Electrical rules check", exact: true })
			.click();
		const panel = page.getByRole("region", { name: "Electrical rules check" });
		const status = panel.getByRole("status");
		const times: number[] = [];
		for (let repeat = 0; repeat < 3; repeat++) {
			times.push(
				await interaction(page, "schematic-erc-run", async () => {
					await panel
						.getByRole("button", { name: "Run ERC", exact: true })
						.click();
					await expect(status).toHaveText(/^(0 errors|1 error), 2 warnings$/);
				}),
			);
		}
		// Selecting a finding selects the symbols behind it in the drawing.
		await panel.getByRole("listitem").first().getByRole("button").click();
		await expect(
			page.getByRole("complementary", { name: "Selection attributes" }),
		).toBeVisible();
		await page.screenshot({
			path: resolve("perf-artifacts/schematic-erc.png"),
		});
		const value = await report(page);
		await finish(page, testInfo, "schematic-erc", {
			interactionP95Ms: percentile(times),
			ercP95Ms: required(metric(value, "circuit.erc")),
			noConnectP95Ms: required(metric(value, "schematic.no-connect")),
		});
	},
);
