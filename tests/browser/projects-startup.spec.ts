import { expect, test } from "@playwright/test";

test("project startup keeps the file list bounded and excludes editor and renderer dependencies", async ({ page }) => {
	const requests: string[] = [];
	page.on("request", (request) => requests.push(request.url()));
	await page.goto("/tests/browser/projects-startup.html");
	await expect(page.getByRole("heading", { name: "Large project", exact: true })).toBeVisible();
	await expect(page.getByRole("row")).toHaveCount(51);
	await expect(page.getByText("1–50 of 10002 files", { exact: true })).toBeVisible();
	await page.getByLabel("Project name", { exact: true }).fill("Another project");
	await expect(page.getByLabel("Project name", { exact: true })).toHaveValue("Another project");
	await page.getByRole("button", { name: "Next files", exact: true }).click();
	await expect(page.getByText("51–100 of 10002 files", { exact: true })).toBeVisible();
	await expect(page.getByText("file-48.gbr", { exact: true })).toBeVisible();
	await expect(page.getByRole("row")).toHaveCount(51);
	await page.getByRole("button", { name: "Previous files", exact: true }).click();
	await expect(page.getByText("file-0.gbr", { exact: true })).toBeVisible();
	expect(requests.filter((url) => /\/effect\.js\?|\/drawing-commands\.ts|\/drawing-protocol\.ts|\/three(?:_|\/)|\/SceneViewport\.tsx/.test(url))).toEqual([]);
});
