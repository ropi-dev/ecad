import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { openProjectFiles } from "../browser/project-files";
import { required } from "../helpers/required.ts";
import { setupAppTests } from "./app-fixture.ts";
import { finish, interaction, metric, ready, report } from "./app-helpers.ts";

setupAppTests();

test("kicad-import", { tag: ["@import"] }, async ({ page }, testInfo) => {
	await page.goto("/projects?perf=1");
	await ready(page);
	await expect(
		page.getByLabel("Workspace instructions", { exact: true }),
	).toBeVisible();
	const sidebar = await openProjectFiles(page);
	await sidebar.getByLabel("Add KiCad schematic files").setInputFiles({
		name: "broken.kicad_sch",
		mimeType: "text/plain",
		buffer: Buffer.from("(broken"),
	});
	await expect(page.getByRole("alert")).toContainText("Incomplete KiCad");
	const elapsed = await interaction(page, "kicad-import", async () => {
		await sidebar
			.getByLabel("Add KiCad schematic files")
			.setInputFiles(
				resolve("tests/fixtures/kicad/RPI-RP2350A-MINIMAL_R4-S1.kicad_sch"),
			);
		await expect(
			page.getByRole("button", { name: "Download import report", exact: true }),
		).toBeVisible();
		await expect(
			page.getByRole("heading", {
				name: /Schematic editor .* RPI-RP2350A-MINIMAL_R4-S1/,
			}),
		).toBeVisible();
		await page.waitForFunction(
			() =>
				(window.__ecadPerformance?.snapshot().metrics["renderer.frame"]
					?.count ?? 0) > 0,
		);
	});
	const download = page.waitForEvent("download");
	await page
		.getByRole("button", { name: "Download import report", exact: true })
		.click();
	expect((await download).suggestedFilename()).toBe("kicad-import-report.json");
	await page.screenshot({
		path: resolve("perf-artifacts/kicad-import-report.png"),
	});
	await page
		.getByRole("button", { name: "Dismiss import report", exact: true })
		.click();
	await page.keyboard.press("F6");
	await page.screenshot({
		path: resolve("perf-artifacts/kicad-import-schematic.png"),
	});
	const value = await report(page);
	await finish(page, testInfo, "kicad-import", {
		importMs: required(metric(value, "import.kicad")),
		interactionP95Ms: elapsed,
	});
	await page.reload();
	await (await openProjectFiles(page))
		.getByRole("link", {
			name: "Open RPI-RP2350A-MINIMAL_R4-S1.ecaddraw",
			exact: true,
		})
		.click();
	await expect(
		page.getByRole("heading", {
			name: /Schematic editor .* RPI-RP2350A-MINIMAL_R4-S1/,
		}),
	).toBeVisible();
});
