import type { Page } from "@playwright/test";
import {
	closeProjectFiles,
	openProjectFiles,
	projectRail,
} from "./project-files";
import { expect, test } from "./seeded-project";

const documentState = async (page: Page) =>
	JSON.parse((await page.locator("#project-document").textContent()) ?? "{}");

test("the RP2350A example opens as a routed PCB that passes DRC and switches views", async ({
	page,
}) => {
	await page.goto("/tests/browser/projects.html");
	await (await openProjectFiles(page))
		.getByRole("link", { name: "Workspace home", exact: true })
		.click();
	await closeProjectFiles(page);
	await projectRail(page)
		.getByRole("button", { name: "Add file", exact: true })
		.click();
	await page
		.getByRole("menuitem", { name: "RP2350A reference design", exact: true })
		.click();
	await expect(page.getByRole("heading", { level: 1 })).toHaveText(
		"PCB editor · RP2350A",
	);
	await expect
		.poll(async () => (await documentState(page)).boards)
		.toEqual(["rp2350a"]);
	await expect(page.getByText("All connections routed")).toBeVisible();

	await page.getByRole("button", { name: "Design rules check" }).click();
	await page.getByRole("button", { name: "Run DRC", exact: true }).click();
	await expect(
		page.getByText("No violations, and every connection is routed."),
	).toBeVisible();

	await page.getByRole("button", { name: "Switch to schematic view" }).click();
	await expect(page.getByRole("heading", { level: 1 })).toContainText(
		"Schematic editor · RP2350A",
	);
	await page.getByRole("button", { name: "Switch to pcb view" }).click();
	await expect(page.getByRole("heading", { level: 1 })).toHaveText(
		"PCB editor · RP2350A",
	);
	await expect
		.poll(async () => (await documentState(page)).editorShapes.length)
		.toBeGreaterThan(100);
});
