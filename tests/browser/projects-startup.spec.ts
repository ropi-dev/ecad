import { openProjectFiles } from "./project-files";
import { expect, test } from "@playwright/test";

test("file search and type filters reset pagination and can find the last file in a large project", async ({
	page,
}) => {
	await page.goto("/tests/browser/projects-startup.html");
	await openProjectFiles(page);
	await expect(page.getByRole("row")).toHaveCount(51);
	await page.getByRole("button", { name: "Next files", exact: true }).click();
	await page.getByLabel("Search project files").fill("FILE-9999.GBR");
	await expect(page.getByRole("row")).toHaveCount(2);
	await expect(page.getByText("file-9999.gbr", { exact: true })).toBeVisible();
	await expect(page.getByText("1–1 of 1 files", { exact: true })).toBeVisible();
	const types = page.getByRole("group", { name: "File types" });
	await types.getByRole("button", { name: /^STEP/ }).click();
	await expect(
		page.getByText("No matching files", { exact: true }),
	).toBeVisible();
	await expect(page.getByRole("row")).toHaveCount(1);
	await page.getByRole("button", { name: "Clear filters" }).click();
	await expect(page.getByLabel("Search project files")).toHaveValue("");
	await expect(page.getByRole("row")).toHaveCount(51);
	await types.getByRole("button", { name: /^Gerber/ }).click();
	await expect(
		page.getByText("1–50 of 10000 files", { exact: true }),
	).toBeVisible();
	await page.getByRole("button", { name: "Next files", exact: true }).click();
	await expect(
		page.getByText("51–100 of 10000 files", { exact: true }),
	).toBeVisible();
	await page.getByLabel("Search project files").fill("drawing");
	await expect(
		page.getByText("No matching files", { exact: true }),
	).toBeVisible();
	await types.getByRole("button", { name: /^All files/ }).click();
	await expect(
		(await openProjectFiles(page)).getByRole("link", {
			name: "Open Drawing",
			exact: true,
		}),
	).toBeVisible();
});
