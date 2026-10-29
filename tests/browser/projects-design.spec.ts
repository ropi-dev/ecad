import { captureArtifacts } from "./artifacts";
import { closeProjectFiles, openProjectFiles } from "./project-files";
import { mkdir } from "node:fs/promises";
import { expect, test } from "@playwright/test";

test("desktop project files fit desktop and mobile layouts and remain usable by keyboard", async ({
	page,
}, testInfo) => {
	await mkdir("perf-artifacts", { recursive: true });
	await page.setViewportSize({ width: 1280, height: 800 });
	await page.goto("/tests/browser/projects-design.html");
	await openProjectFiles(page);
	await expect(
		page.getByRole("link", { name: "Workspace home", exact: true }),
	).toBeVisible();
	await expect(page.getByRole("button", { name: "Project actions", exact: true })).toBeVisible();
	await expect(
		(await openProjectFiles(page)).getByRole("link", {
			name: "Open enclosure.step",
			exact: true,
		}),
	).toBeVisible();
	if (captureArtifacts)
		await page.screenshot({
			path: "perf-artifacts/projects-desktop.png",
			fullPage: true,
		});
	if (captureArtifacts)
		await testInfo.attach("desktop layout", {
			path: "perf-artifacts/projects-desktop.png",
			contentType: "image/png",
		});
	await page.getByLabel("Search project files").fill("enclosure");
	await expect(
		(await openProjectFiles(page)).getByRole("link", {
			name: "Open enclosure.step",
			exact: true,
		}),
	).toHaveAttribute("href", "/step");
	await page.getByRole("button", { name: "Clear file search" }).focus();
	await page.keyboard.press("Enter");
	await expect(
		(await openProjectFiles(page)).getByRole("link", {
			name: "Open enclosure.step",
			exact: true,
		}),
	).toBeVisible();
	await closeProjectFiles(page);
	await page.setViewportSize({ width: 375, height: 812 });
	await expect(
		page.getByRole("button", { name: "Project actions", exact: true }),
	).toBeVisible();
	expect(
		await page.evaluate(
			() => document.documentElement.scrollWidth <= window.innerWidth,
		),
	).toBe(true);
	await page.getByRole("button", { name: "Show project files" }).click();
	await page.getByLabel("Search project files").fill("enclosure");
	await expect(
		(await openProjectFiles(page)).getByRole("link", {
			name: "Open enclosure.step",
			exact: true,
		}),
	).toBeVisible();
	await page.getByRole("button", { name: "Clear file search" }).click();
	if (captureArtifacts)
		await page.screenshot({
			path: "perf-artifacts/projects-mobile.png",
			fullPage: true,
		});
	if (captureArtifacts)
		await testInfo.attach("mobile layout", {
			path: "perf-artifacts/projects-mobile.png",
			contentType: "image/png",
		});
});


test("memory autosave retains unload protection until disk save, and failed saves stay visible", async ({ page }) => {
	await page.goto("/tests/browser/projects-design.html?empty");
	await expect(page.getByText("Kept in memory. Choose Save project to keep your work.")).toBeVisible();
	const unloadBlocked = () => page.evaluate(() => {
		const event = new Event("beforeunload", { cancelable: true });
		window.dispatchEvent(event);
		return event.defaultPrevented;
	});
	expect(await unloadBlocked()).toBe(true);
	await page.getByRole("button", { name: "Project actions", exact: true }).click();
	await page.getByRole("menuitem", { name: "Save project", exact: true }).click();
	await expect(page.getByText("Your changes save automatically.")).toBeVisible();
	expect(await unloadBlocked()).toBe(false);
	await page.goto("/tests/browser/projects-design.html?save-error");
	await expect(page.getByRole("heading", { name: "Ready when you are" })).toBeVisible();
	await page.getByRole("button", { name: "Project actions", exact: true }).click();
	await page.getByRole("menuitem", { name: "Save project", exact: true }).click();
	await expect(page.getByRole("alert", { name: "Project save failed", exact: true })).toContainText("changed on disk");
	await page.getByRole("button", { name: "Dismiss save error", exact: true }).click();
	await expect(page.getByRole("alert", { name: "Project save failed", exact: true })).toHaveCount(0);
});


test("opening another project protects drafts through save, discard, errors and cancellation", async ({ page }) => {
	await page.goto("/tests/browser/projects-design.html?empty");
	await expect(page.getByText("Kept in memory. Choose Save project to keep your work.")).toBeVisible();
	const open = async () => {
		await page.getByRole("button", { name: "Project actions", exact: true }).click();
		await page.getByRole("menuitem", { name: "Open project...", exact: true }).click();
		await expect(page.getByRole("dialog", { name: "Save this project first?" })).toBeVisible();
	};
	const home = page.getByRole("link", { name: "Workspace home", exact: true });
	const calls = () => page.evaluate(() => window.projectSwitchTest.calls);
	await open();
	await page.getByRole("button", { name: "Cancel", exact: true }).click();
	expect(await calls()).toEqual({ open: 0, save: 0 });
	await expect(home).toHaveAttribute("title", "Untitled");
	await page.evaluate(() => { window.projectSwitchTest.cancelSave = true; });
	await open();
	await page.getByRole("button", { name: "Save and open", exact: true }).click();
	await expect.poll(calls).toEqual({ open: 0, save: 1 });
	await expect(page.getByRole("button", { name: "Save and open", exact: true })).toBeEnabled();
	await expect(page.getByRole("dialog", { name: "Save this project first?" })).toBeVisible();
	await page.evaluate(() => { window.projectSwitchTest.cancelSave = false; window.projectSwitchTest.failSave = true; });
	await page.getByRole("button", { name: "Save and open", exact: true }).click();
	await expect(page.getByRole("dialog").getByRole("alert")).toHaveText("Disk full");
	expect(await calls()).toEqual({ open: 0, save: 2 });
	await page.getByRole("button", { name: "Cancel", exact: true }).click();
	await page.evaluate(() => { window.projectSwitchTest.failSave = false; window.projectSwitchTest.cancelOpen = true; });
	await open();
	await page.getByRole("button", { name: "Discard and open", exact: true }).click();
	await expect.poll(calls).toEqual({ open: 1, save: 2 });
	await expect(home).toHaveAttribute("title", "Untitled");
	await page.evaluate(() => { window.projectSwitchTest.cancelOpen = false; });
	await open();
	await page.getByRole("button", { name: "Save and open", exact: true }).click();
	await expect(home).toHaveAttribute("title", "Existing project");
	expect(await calls()).toEqual({ open: 2, save: 3 });
	await page.goto("/tests/browser/projects-design.html?empty");
	await expect(page.getByText("Kept in memory. Choose Save project to keep your work.")).toBeVisible();
	await open();
	await page.getByRole("button", { name: "Discard and open", exact: true }).click();
	await expect(home).toHaveAttribute("title", "Existing project");
	expect(await calls()).toEqual({ open: 1, save: 0 });
});
