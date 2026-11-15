import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Page } from "@playwright/test";
import { captureArtifacts } from "./artifacts";
import { closeProjectFiles, openProjectFiles } from "./project-files";
import { expect, test } from "./seeded-project";

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

test("an oversized stored STEP asset is named while valid assets still restore", async ({
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
	await closeProjectFiles(page);
	await expect(page.getByRole("alert")).toContainText(problem);
	// Importing opened b.step on its own. After a reload no model is selected,
	// so a plain /step link restores every STEP model like opening /step does.
	await page.reload();
	await expect
		.poll(async () => (await documentState(page)).assets?.length)
		.toBe(2);
	await page.evaluate(() => {
		const link = document.createElement("a");
		link.href = "/step";
		document.body.append(link);
		link.click();
		link.remove();
	});
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
});

test("sidebar rejection toasts distinguish a rejected batch from partial success", async ({
	page,
}) => {
	await page.addInitScript((oversized) => {
		const size = Object.getOwnPropertyDescriptor(Blob.prototype, "size")?.get;
		if (!size) throw new Error("Blob size getter is unavailable");
		Object.defineProperty(File.prototype, "size", {
			get() {
				return this.name === "oversized.step" ? oversized : size.call(this);
			},
		});
	}, 300 * MiB);
	await page.goto("/tests/browser/projects.html");
	const sidebar = await openProjectFiles(page);
	const upload = sidebar.getByLabel("Add STEP files", { exact: true });
	const rejected = {
		name: "oversized.step",
		mimeType: "application/step",
		buffer: cube,
	};
	await upload.setInputFiles(rejected);
	const error = page.locator('.app-toast[data-type="error"]');
	await expect(error).toContainText("Unable to add project files");
	await expect(error).toContainText(
		"oversized.step: STEP files must be 256 MiB or smaller.",
	);
	await expect(page.locator('.app-toast[data-type="success"]')).toHaveCount(0);
	await page
		.getByRole("button", {
			name: "Dismiss Unable to add project files",
			exact: true,
		})
		.click();
	await (await openProjectFiles(page))
		.getByLabel("Add STEP files", { exact: true })
		.setInputFiles([
			rejected,
			{ name: "small.step", mimeType: "application/step", buffer: cube },
		]);
	await expect(page.locator('.app-toast[data-type="warning"]')).toContainText(
		"Files added with issues",
	);
	await expect
		.poll(async () =>
			(await documentState(page)).assets?.map(
				(asset: { name: string }) => asset.name,
			),
		)
		.toEqual(["small.step"]);
});
