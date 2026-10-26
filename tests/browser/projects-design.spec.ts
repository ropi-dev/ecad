import { openProjectFiles, closeProjectFiles } from "./project-files";
import { mkdir } from "node:fs/promises";
import { expect, test } from "@playwright/test";

test("desktop project files fit desktop and mobile layouts and remain usable by keyboard", async ({ page }, testInfo) => {
	await mkdir("perf-artifacts", { recursive: true });
	await page.setViewportSize({ width: 1280, height: 800 });
	await page.goto("/tests/browser/projects-design.html");
	await openProjectFiles(page);
	await expect(page.getByRole("heading", { name: "Motor controller", exact: true })).toBeVisible();
	await expect(page.getByLabel("Open project directory")).toBeVisible();
	await expect(page.getByRole("row")).toHaveCount(9);
	await page.screenshot({ path: "perf-artifacts/projects-desktop.png", fullPage: true });
	await testInfo.attach("desktop layout", { path: "perf-artifacts/projects-desktop.png", contentType: "image/png" });
	await page.getByLabel("Search project files").fill("enclosure");
	await expect((await openProjectFiles(page)).getByRole("link", { name: "Open enclosure.step", exact: true })).toHaveAttribute("href", "/step");
	await page.getByRole("button", { name: "Clear file search" }).focus();
	await page.keyboard.press("Enter");
	await expect(page.getByRole("row")).toHaveCount(9);
	await page.getByRole("button", { name: "Hide project files" }).click();
	await page.setViewportSize({ width: 375, height: 812 });
	await expect(page.getByRole("button", { name: "Save project", exact: true })).toBeVisible();
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
	await page.getByRole("button", { name: "Show project files" }).click();
	await page.getByLabel("Search project files").fill("enclosure");
	await expect((await openProjectFiles(page)).getByRole("link", { name: "Open enclosure.step", exact: true })).toBeVisible();
	await page.getByRole("button", { name: "Clear file search" }).click();
	await page.screenshot({ path: "perf-artifacts/projects-mobile.png", fullPage: true });
	await testInfo.attach("mobile layout", { path: "perf-artifacts/projects-mobile.png", contentType: "image/png" });
});

test("the desktop empty state focuses project creation and can open an existing folder", async ({ page }, testInfo) => {
	await mkdir("perf-artifacts", { recursive: true });
	await page.setViewportSize({ width: 1280, height: 800 });
	await page.goto("/tests/browser/projects-design.html?empty");
	await openProjectFiles(page);
	await expect(page.getByRole("heading", { name: "No project open", exact: true })).toBeVisible();
	await closeProjectFiles(page);
	await page.getByRole("button", { name: "Start a new project" }).click();
	await expect(page.getByLabel("Project name", { exact: true })).toBeFocused();
	await page.screenshot({ path: "perf-artifacts/projects-empty.png", fullPage: true });
	await testInfo.attach("empty layout", { path: "perf-artifacts/projects-empty.png", contentType: "image/png" });
	await closeProjectFiles(page);
	await page.getByLabel("Open project directory").click();
	await expect(page.getByRole("heading", { name: "Motor controller", exact: true })).toBeVisible();
});

test("save errors retain the project and show the reload action", async ({ page }) => {
	await page.goto("/tests/browser/projects-design.html?save-error");
	await openProjectFiles(page);
	await page.getByRole("button", { name: "Save project", exact: true }).click();
	await expect(page.getByRole("alert")).toContainText("changed on disk");
	await page.getByRole("button", { name: "Reload project", exact: true }).click();
	await expect(page.getByRole("alert")).toHaveCount(0);
	await expect(page.getByRole("heading", { name: "Motor controller", exact: true })).toBeVisible();
});
