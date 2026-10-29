import { createHash } from "node:crypto";
import { expect, test } from "@playwright/test";
import { canvasScreenshot } from "./stable-screenshot";
const imageHash = (buffer: Buffer) =>
	createHash("sha256").update(buffer).digest("hex");

test("3D model hover brightens a part and clears on leave without modifying the source", async ({
	page,
}) => {
	await page.goto("/tests/browser/generic-viewers.html?3d");
	const canvas = page.locator("canvas");
	await expect(
		page.getByRole("button", { name: "Zoom", exact: true }),
	).toBeEnabled();
	await page.mouse.move(0, 0);
	const before = imageHash(await canvasScreenshot(canvas));
	const bounds = (await canvas.boundingBox())!;
	await page.mouse.move(
		bounds.x + bounds.width / 2,
		bounds.y + bounds.height / 2,
	);
	await expect
		.poll(async () => imageHash(await canvasScreenshot(canvas)))
		.not.toBe(before);
	await page.mouse.move(0, 0);
	await expect
		.poll(async () => imageHash(await canvasScreenshot(canvas)))
		.toBe(before);
	await page.getByRole("button", { name: "Mount", exact: true }).click();
	await expect(canvas).toHaveCount(0);
	await page.getByRole("button", { name: "Mount", exact: true }).click();
	await expect(
		page.getByRole("button", { name: "Zoom", exact: true }),
	).toBeEnabled();
	await page.mouse.move(0, 0);
	expect(imageHash(await canvasScreenshot(canvas))).toBe(before);
	await expect(page.getByRole("alert")).toHaveCount(0);
});
