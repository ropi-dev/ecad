import { expect, test } from "@playwright/test";
import { openProjectFiles, projectRail } from "./project-files";

test("a new project's editor offers to create a drawing and opens it", async ({
	page,
}) => {
	await page.goto("/tests/browser/projects.html");
	await page.evaluate(() =>
		document.querySelector<HTMLAnchorElement>('a[href="/editor"]')?.click(),
	);
	await expect(
		page.getByLabel("Workspace instructions", { exact: true }),
	).toBeVisible();

	await projectRail(page)
		.getByRole("button", { name: "Add file", exact: true })
		.click();
	await page
		.getByRole("menuitem", { name: "New drawing", exact: true })
		.click();
	await page.getByLabel("Drawing name", { exact: true }).fill("Power stage");
	await page
		.getByRole("button", { name: "Create drawing", exact: true })
		.click();
	await expect(page.getByRole("heading", { level: 1 })).toContainText(
		"Schematic editor · Power stage",
	);
	await expect(
		(await openProjectFiles(page)).getByRole("link", {
			name: "Open Power stage.ecaddraw",
			exact: true,
		}),
	).toBeVisible();
});
