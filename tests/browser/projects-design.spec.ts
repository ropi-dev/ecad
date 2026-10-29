import { captureArtifacts } from "./artifacts";
import { openProjectFiles } from "./project-files";
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
		page.getByRole("heading", { name: "Motor controller", exact: true }),
	).toBeVisible();
	await expect(page.getByLabel("Open project directory")).toBeVisible();
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
	await page.getByRole("button", { name: "Hide project files" }).click();
	await page.setViewportSize({ width: 375, height: 812 });
	await expect(
		page.getByRole("button", { name: "Save project", exact: true }),
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
