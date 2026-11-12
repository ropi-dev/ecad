import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { openProjectFiles } from "../browser/project-files";
import { toolbarButton } from "../browser/toolbar";
import { pthGerber } from "../fixtures/pth-gerber";
import { setupAppTests } from "./app-fixture.ts";
import { finish, ready, report } from "./app-helpers.ts";

setupAppTests();

test(
	"editor-imports",
	{ tag: ["@editor", "@import"] },
	async ({ page }, testInfo) => {
		await page.goto("/projects?perf=1");
		await ready(page);
		await expect(
			page.getByLabel("Workspace instructions", { exact: true }),
		).toBeVisible();
		await (await openProjectFiles(page))
			.getByRole("link", { name: "Schematic editor", exact: true })
			.click();
		await expect(page.locator("canvas")).toBeVisible();
		await expect
			.poll(
				async () => (await report(page)).metrics["renderer.frame"]?.count ?? 0,
			)
			.toBeGreaterThan(0);
		await (await toolbarButton(page, "Rectangle")).click();
		await page.mouse.move(600, 300);
		await page.mouse.down();
		await page.mouse.move(710, 400);
		await page.mouse.up();
		await expect
			.poll(
				async () => (await report(page)).metrics["project.save"]?.count ?? 0,
			)
			.toBeGreaterThan(0);
		await (await openProjectFiles(page))
			.getByRole("link", { name: "Workspace home", exact: true })
			.click();
		await (await openProjectFiles(page))
			.getByLabel("Add Gerber files")
			.setInputFiles({
				name: "Pads-F_Cu.gbr",
				mimeType: "text/plain",
				buffer: Buffer.from(pthGerber(2000, false)),
			});
		await (await openProjectFiles(page))
			.getByRole("link", { name: "Open Pads-F_Cu.gbr", exact: true })
			.click();
		await expect
			.poll(
				async () => (await report(page)).metrics["import.gerber"]?.count ?? 0,
			)
			.toBeGreaterThan(0);
		await expect(page.getByTestId("viewer-message")).toHaveCount(0);
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
		await expect(page.getByRole("alert")).toHaveCount(0);
		await finish(page, testInfo, "editor-imports");
		await (await openProjectFiles(page))
			.getByLabel("Add Gerber files")
			.setInputFiles({
				name: "Back.gbr",
				mimeType: "text/plain",
				buffer: Buffer.from(pthGerber(2)),
			});
		let started = await page.evaluate(() => performance.now());
		const importedFiles = async () =>
			(await report(page)).events
				.filter(
					(event) =>
						event.name === "import.gerber" &&
						event.startTime >= started &&
						event.status === "ok",
				)
				.at(-1)?.data?.files;
		await (await openProjectFiles(page))
			.getByRole("link", { name: "Open all Gerber layers", exact: true })
			.click();
		await expect.poll(importedFiles).toBe(2);
		await expect
			.poll(() => new URL(page.url()).searchParams.get("file"))
			.toBeNull();
		started = await page.evaluate(() => performance.now());
		await (await openProjectFiles(page))
			.getByRole("link", { name: "Open Pads-F_Cu.gbr", exact: true })
			.click();
		await expect.poll(importedFiles).toBe(1);
		await expect
			.poll(() => new URL(page.url()).searchParams.get("file"))
			.toMatch(/Pads-F_Cu\.gbr$/);
		started = await page.evaluate(() => performance.now());
		await page.goBack();
		await expect.poll(importedFiles).toBe(2);
		await expect
			.poll(() => new URL(page.url()).searchParams.get("file"))
			.toBeNull();
		started = await page.evaluate(() => performance.now());
		await page.goForward();
		await expect.poll(importedFiles).toBe(1);
		await expect
			.poll(() => new URL(page.url()).searchParams.get("file"))
			.toMatch(/Pads-F_Cu\.gbr$/);
	},
);
