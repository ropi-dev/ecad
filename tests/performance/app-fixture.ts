import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { openProjectFiles } from "../browser/project-files";
import { pthGerber } from "../fixtures/pth-gerber";
import { ready, report } from "./app-helpers.ts";

export function setupAppTests() {
	test.beforeAll(async ({ browser }) => {
		if (process.env.ECAD_PERF_MODE !== "development") return;
		const page = await browser.newPage();
		try {
			for (const path of ["/", "/editor", "/gerber", "/step"]) {
				await page.goto(`${path}?perf=1`);
				await ready(page);
			}
			await page.goto("/projects?perf=1");
			await ready(page);
			await expect(
				page.getByLabel("Workspace instructions", { exact: true }),
			).toBeVisible();
			await (await openProjectFiles(page))
				.getByLabel("Add Gerber files")
				.setInputFiles({
					name: "PTH.gbr",
					mimeType: "text/plain",
					buffer: Buffer.from(pthGerber(1, false)),
				});
			await (await openProjectFiles(page))
				.getByRole("link", { name: "Open PTH.gbr", exact: true })
				.click();
			await expect
				.poll(
					async () => (await report(page)).metrics["import.gerber"]?.count ?? 0,
				)
				.toBeGreaterThan(0);
			await (await openProjectFiles(page))
				.getByRole("link", { name: "Workspace home", exact: true })
				.click();
			await (await openProjectFiles(page))
				.getByLabel("Add STEP files")
				.setInputFiles(
					resolve(
						"node_modules/occt-import-js/test/testfiles/simple-basic-cube/cube.stp",
					),
				);
			await (await openProjectFiles(page))
				.getByRole("link", { name: "Open cube.stp", exact: true })
				.click();
			await expect(
				page.getByRole("button", { name: "Fit model", exact: true }),
			).toBeEnabled();
			await page.waitForTimeout(750);
		} finally {
			await page.close();
		}
	});

	test.beforeEach(async ({ page }) => {
		const session = await page.context().newCDPSession(page);
		await session.send("Network.enable");
		await session.send("Network.setCacheDisabled", { cacheDisabled: true });
		await session.send("Emulation.setCPUThrottlingRate", {
			rate: Number(process.env.ECAD_PERF_CPU ?? 4),
		});
	});
}
