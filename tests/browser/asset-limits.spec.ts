import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Page } from "@playwright/test";
import { openProjectFiles } from "./project-files";
import { expect, test } from "./seeded-project";

const cube = readFileSync(
	resolve(
		"node_modules/occt-import-js/test/testfiles/simple-basic-cube/cube.stp",
	),
);
const MiB = 1024 * 1024;

const documentState = async (page: Page) =>
	JSON.parse((await page.locator("#project-document").textContent()) ?? "{}");

test("a partly rejected import names the rejected file and keeps the valid one", async ({
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
	await expect(error).toContainText("oversized.step");
	await expect(error).toContainText(/256\s*MiB/i);
	await expect(page.locator('.app-toast[data-type="success"]')).toHaveCount(0);
	await error.getByRole("button", { name: /dismiss/i }).click();
	await (await openProjectFiles(page))
		.getByLabel("Add STEP files", { exact: true })
		.setInputFiles([
			rejected,
			{ name: "small.step", mimeType: "application/step", buffer: cube },
		]);
	await expect(page.locator('.app-toast[data-type="warning"]')).toBeVisible();
	await expect
		.poll(async () =>
			(await documentState(page)).assets?.map(
				(asset: { name: string }) => asset.name,
			),
		)
		.toEqual(["small.step"]);
});
