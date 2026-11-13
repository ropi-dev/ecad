import { expect, test } from "@playwright/test";
import { projectRail } from "./project-files";

test("opening another project protects drafts through save, discard, errors and cancellation", async ({
	page,
}) => {
	await page.goto("/tests/browser/projects-design.html?empty");
	await expect(
		page.getByLabel("Workspace instructions", { exact: true }),
	).toBeVisible();
	const open = async () => {
		await projectRail(page)
			.getByRole("button", { name: "Open project", exact: true })
			.click();
		await expect(
			page.getByRole("dialog", { name: "Save this project first?" }),
		).toBeVisible();
	};
	const home = page.getByRole("link", {
		name: "Workspace home",
		exact: true,
		includeHidden: true,
	});
	const calls = () => page.evaluate(() => window.projectSwitchTest.calls);
	await open();
	await page.getByRole("button", { name: "Cancel", exact: true }).click();
	expect(await calls()).toEqual({ open: 0, save: 0 });
	await expect(home).toHaveAttribute("title", "Untitled");
	await page.evaluate(() => {
		window.projectSwitchTest.cancelSave = true;
	});
	await open();
	await page
		.getByRole("button", { name: "Save and open", exact: true })
		.click();
	await expect.poll(calls).toEqual({ open: 0, save: 1 });
	await expect(
		page.getByRole("button", { name: "Save and open", exact: true }),
	).toBeEnabled();
	await expect(
		page.getByRole("dialog", { name: "Save this project first?" }),
	).toBeVisible();
	await page.evaluate(() => {
		window.projectSwitchTest.cancelSave = false;
		window.projectSwitchTest.failSave = true;
	});
	await page
		.getByRole("button", { name: "Save and open", exact: true })
		.click();
	await expect(page.getByRole("dialog").getByRole("alert")).toHaveText(
		"Disk full",
	);
	expect(await calls()).toEqual({ open: 0, save: 2 });
	await page.getByRole("button", { name: "Cancel", exact: true }).click();
	await page.evaluate(() => {
		window.projectSwitchTest.failSave = false;
		window.projectSwitchTest.cancelOpen = true;
	});
	await open();
	await page
		.getByRole("button", { name: "Discard and open", exact: true })
		.click();
	await expect.poll(calls).toEqual({ open: 1, save: 2 });
	await expect(home).toHaveAttribute("title", "Untitled");
	await page.evaluate(() => {
		window.projectSwitchTest.cancelOpen = false;
	});
	await open();
	await page
		.getByRole("button", { name: "Save and open", exact: true })
		.click();
	await expect(home).toHaveAttribute("title", "Existing project");
	expect(await calls()).toEqual({ open: 2, save: 3 });
	await page.goto("/tests/browser/projects-design.html?empty");
	await expect(
		page.getByLabel("Workspace instructions", { exact: true }),
	).toBeVisible();
	await open();
	await page
		.getByRole("button", { name: "Discard and open", exact: true })
		.click();
	await expect(home).toHaveAttribute("title", "Existing project");
	expect(await calls()).toEqual({ open: 1, save: 0 });
});

test("the sidebar Exit button calls the host's exit handler", async ({
	page,
}) => {
	await page.goto("/tests/browser/projects-design.html");
	await page
		.getByRole("navigation", { name: "Sidebar shortcuts", exact: true })
		.getByRole("button", { name: "Exit", exact: true })
		.click();
	await expect
		.poll(() => page.evaluate(() => window.projectSwitchTest.exits))
		.toBe(1);
});
