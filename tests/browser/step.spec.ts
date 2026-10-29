import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

const cube = resolve(
	"node_modules/occt-import-js/test/testfiles/simple-basic-cube/cube.stp",
);

test("STEP import renders geometry and supports view controls, visibility and reopening", async ({
	page,
}) => {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	await page.goto("/tests/browser/step.html");
	await expect(
		page.getByRole("heading", { name: "STEP viewer" }),
	).toBeVisible();
	await page.getByLabel("Open STEP file").setInputFiles(cube);
	await expect(
		page.getByRole("button", { name: "Fit model", exact: true }),
	).toBeEnabled({ timeout: 30000 });
	await expect(page.getByRole("alert")).toHaveCount(0);
	const canvas = page.locator("canvas");
	const original = await canvas.screenshot();
	await page.getByRole("checkbox").first().uncheck();
	const hidden = await canvas.screenshot();
	expect(hidden.equals(original)).toBe(false);
	await page.getByRole("checkbox").first().check();
	await page.getByRole("button", { name: "Zoom in", exact: true }).click();
	const zoomed = await canvas.screenshot();
	expect(zoomed.equals(original)).toBe(false);
	await page.getByRole("button", { name: "Fit model", exact: true }).click();
	expect((await canvas.screenshot()).equals(zoomed)).toBe(false);
	await page.getByRole("button", { name: "Top", exact: true }).click();
	expect((await canvas.screenshot()).equals(original)).toBe(false);
	await page.getByRole("button", { name: "Wire", exact: true }).click();
	await expect(
		page.getByRole("button", { name: "Wire", exact: true }),
	).toHaveAttribute("aria-pressed", "true");
	await canvas.focus();
	await page.keyboard.press("F6");
	await page.getByRole("button", { name: "Close", exact: true }).click();
	await expect(canvas).toHaveCount(0);
	await page.getByLabel("Open STEP file").setInputFiles(cube);
	await expect(
		page.getByRole("button", { name: "Fit model", exact: true }),
	).toBeEnabled({ timeout: 30000 });
	expect(errors).toEqual([]);
});

test("invalid STEP files report an error and retain the current model", async ({
	page,
}) => {
	await page.goto("/tests/browser/step.html");
	const input = page.getByLabel("Open STEP file");
	await input.setInputFiles(cube);
	await expect(
		page.getByRole("button", { name: "Fit model", exact: true }),
	).toBeEnabled({ timeout: 30000 });
	await input.setInputFiles({
		name: "broken.step",
		mimeType: "application/octet-stream",
		buffer: Buffer.from("not a STEP file"),
	});
	await expect(page.getByRole("alert")).toContainText("Unable to read", {
		timeout: 30000,
	});
	await expect(page.getByRole("heading", { name: "cube.stp" })).toBeVisible();
	await input.setInputFiles({
		name: "empty.stp",
		mimeType: "application/octet-stream",
		buffer: Buffer.alloc(0),
	});
	await expect(page.getByRole("alert")).toContainText("empty");
});
