import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { captureArtifacts } from "./artifacts";
import {
	closeProjectFiles,
	openProjectActions,
	openProjectFiles,
} from "./project-files";

const cube = readFileSync(
	resolve(
		"node_modules/occt-import-js/test/testfiles/simple-basic-cube/cube.stp",
	),
);
const MiB = 1024 * 1024;

async function screenshot(page: Page, name: string) {
	if (captureArtifacts)
		await page.screenshot({
			path: resolve("/tmp/ecad-browser-artifacts", test.info().testId, name),
		});
}

const documentState = async (page: Page) =>
	JSON.parse((await page.locator("#project-document").textContent()) ?? "{}");

test("an oversized stored STEP asset is named while valid assets still restore, and project copies say what they left out", async ({
	page,
}) => {
	test.setTimeout(120_000);
	// Stored files named b.step report a size over the STEP limit, as if they
	// had been stored before the limit existed. Their bytes stay small.
	await page.addInitScript((size) => {
		const getFile = FileSystemFileHandle.prototype.getFile;
		FileSystemFileHandle.prototype.getFile = async function () {
			const file = await getFile.call(this);
			if (/(^|-)b\.step$/.test(this.name))
				Object.defineProperty(file, "size", { value: size });
			return file;
		};
	}, 300 * MiB);
	await page.goto("/tests/browser/projects.html");
	await closeProjectFiles(page);
	for (const name of ["small.step", "b.step"]) {
		await (await openProjectFiles(page))
			.getByLabel("Add STEP files", { exact: true })
			.setInputFiles({ name, mimeType: "application/step", buffer: cube });
		await expect
			.poll(async () =>
				(await documentState(page)).assets?.map(
					(asset: { name: string }) => asset.name,
				),
			)
			.toContain(name);
	}
	const problem = "b.step: STEP files must be 256 MiB or smaller.";
	await (await openProjectFiles(page))
		.getByRole("link", { name: "STEP viewer", exact: true })
		.click();
	await closeProjectFiles(page);
	await expect(page.getByRole("alert")).toContainText(problem);
	await expect(
		page.getByRole("button", { name: "Fit model", exact: true }),
	).toBeEnabled({ timeout: 30_000 });
	await screenshot(page, "restore-problem.png");

	// Opening a valid asset replaces the earlier restore problem.
	await (await openProjectFiles(page))
		.getByRole("link", { name: "Open small.step", exact: true })
		.click();
	await closeProjectFiles(page);
	await expect(
		page.getByRole("button", { name: "Fit model", exact: true }),
	).toBeEnabled({ timeout: 30_000 });
	await expect(
		page.getByRole("alert").filter({ hasText: problem }),
	).toHaveCount(0);

	await openProjectActions(page);
	await page
		.getByRole("menuitem", { name: "New untitled project", exact: true })
		.click();
	const notice =
		"The new project leaves out an asset over the size limit, which stays in the original project. b.step: STEP files must be 256 MiB or smaller.";
	await expect(page.getByRole("alert")).toContainText(notice);
	await expect
		.poll(async () =>
			(await documentState(page)).assets?.map(
				(asset: { name: string }) => asset.name,
			),
		)
		.toEqual(["small.step"]);
	await expect(
		page.getByRole("button", { name: "Fit model", exact: true }),
	).toBeEnabled({ timeout: 30_000 });
	await screenshot(page, "copy-notice.png");
});
