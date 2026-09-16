import { expect, test } from "@playwright/test";

test("overlapping X-ray outlines do not tint the focused layer", async ({ page }) => {
	await page.goto("/tests/browser/viewer.html");
	await page.locator("input[type=file]").setInputFiles(
		[8, 4].map((size, index) => ({
			name: `${index === 0 ? "lower" : "upper"}.gbr`,
			mimeType: "text/plain",
			buffer: Buffer.from(
				`%FSLAX46Y46*%%MOMM*%%ADD10R,${size}X${size}*%D10*X0Y0D03*M02*`,
			),
		})),
	);
	const state = async () =>
		JSON.parse((await page.locator("#scene-state").textContent()) || "{}");
	await expect.poll(async () => (await state()).objects?.length).toBe(2);
	const canvas = (await page.locator("canvas").boundingBox())!;
	const upper = (await state()).objects.find(
		(object: { name: string }) => object.name === "upper.gbr",
	);
	// Sample across the upper pad's left edge, entirely inside the lower pad.
	const x = Math.min(...upper.corners.map((point: number[]) => point[0]));
	const clip = {
		x: Math.floor(canvas.x + ((x + 1) * canvas.width) / 2) - 6,
		y: Math.floor(canvas.y + canvas.height / 2) - 6,
		width: 12,
		height: 12,
	};
	const capture = async () => {
		await page.mouse.move(0, 0);
		return (await page.screenshot({ clip, animations: "disabled" })).toString("base64");
	};
	const unfocused = await capture();
	await page.getByRole("button", { name: "Focus lower.gbr", exact: true }).click();
	await expect.poll(async () => (await state()).objects[1].hoverEnabled).toBe(false);
	const focused = await capture();
	await page.getByRole("button", { name: "Hide upper.gbr", exact: true }).click();
	await expect.poll(async () => (await state()).objects[1].visible).toBe(false);
	// Hiding an overlapping layer must not change the focused pad's pixels.
	expect(await capture()).toBe(focused);
	await page.getByRole("button", { name: "Show upper.gbr", exact: true }).click();
	await page.getByRole("button", { name: "Focus lower.gbr", exact: true }).click();
	await expect.poll(async () => (await state()).objects[1].hoverEnabled).toBe(true);
	await expect.poll(capture).toBe(unfocused);
});
