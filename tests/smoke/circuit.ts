import { expect, type Page } from "@playwright/test";
import { projectRail } from "../browser/project-files.ts";

export async function createCircuit(
	page: Page,
	dialogWindow?: () => Promise<Page>,
) {
	await page.waitForFunction(
		() => !document.querySelector('[aria-busy="true"]'),
	);
	await projectRail(page)
		.getByRole("button", { name: "Add file", exact: true })
		.click();
	const opened = dialogWindow?.();
	await page
		.getByRole("menuitem", { name: "New circuit", exact: true })
		.click();
	const dialog = (await opened) ?? page;
	await dialog.getByLabel("Circuit name", { exact: true }).fill("Smoke");
	await dialog
		.getByRole("button", { name: "Create circuit", exact: true })
		.click();
	await expect(
		page.getByRole("heading", { level: 1, name: "Smoke", exact: true }),
	).toBeAttached();
}
