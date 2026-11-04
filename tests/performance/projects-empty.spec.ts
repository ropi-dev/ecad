import { expect, test } from "@playwright/test";
import { setupAppTests } from "./app-fixture.ts";
import { finish, ready } from "./app-helpers.ts";

setupAppTests();

test("projects-empty", async ({ page }, testInfo) => {
	await page.goto("/projects?perf=1");
	await ready(page);
	await expect(
		page.getByLabel("Workspace instructions", { exact: true }),
	).toBeVisible();
	await expect(
		page.getByRole("link", {
			name: "Workspace home",
			exact: true,
			includeHidden: true,
		}),
	).toHaveAttribute("title", "Untitled");
	await expect(
		page.getByRole("button", {
			name: "Add file",
			exact: true,
			includeHidden: true,
		}),
	).toBeEnabled();
	const names = await page.evaluate(async () => {
		const root = await navigator.storage.getDirectory();
		const result = [];
		for await (const name of root.keys())
			if (name.startsWith("Untitled-")) result.push(name);
		return result;
	});
	expect(names).toHaveLength(1);
	await finish(page, testInfo, "projects-empty");
});
