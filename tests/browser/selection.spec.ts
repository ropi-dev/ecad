import { expect, test } from "@playwright/test";

for (const projection of ["perspective", "orthographic"]) {
	test(`click selects a shape in ${projection} and keeps its attributes after leaving`, async ({ page }) => {
		await page.goto("/tests/browser/generic-viewers.html");
		await expect(page.getByRole("button", { name: "Fit drawing", exact: true })).toBeEnabled();
		if (projection === "orthographic") await page.getByRole("button", { name: "Orthographic camera" }).click();
		const canvas = page.locator("canvas");
		const bounds = (await canvas.boundingBox())!;
		const state = JSON.parse((await page.locator("#snapshot").textContent())!);
		const x = bounds.x + bounds.width / 2 + (-12 - state.camera.x) * state.camera.scale;
		const y = bounds.y + bounds.height / 2 + state.camera.y * state.camera.scale;
		await page.mouse.move(0, 0);
		await page.mouse.click(x, y);
		const attributes = page.getByRole("complementary", { name: "Selection attributes" });
		await expect(attributes).toContainText("Shapes");
		await expect(attributes).toContainText("10.00 × 10.00 mm");
		const panel = (await attributes.boundingBox())!;
		expect(panel.x + panel.width).toBeCloseTo(bounds.x + bounds.width - 40, 4);
		expect(panel.y).toBeCloseTo(bounds.y + 40, 4);
		await page.mouse.move(0, 0);
		await expect(attributes).toBeVisible();
		await canvas.press("Escape");
		await expect(attributes).toHaveCount(0);
		await canvas.evaluate(element => (element as HTMLCanvasElement).blur());
		await page.mouse.click(x, y);
		await expect(attributes).toBeVisible();
		await page.mouse.click(bounds.x + bounds.width / 2, y);
		await expect(attributes).toHaveCount(0);
		await page.mouse.move(x, y);
		await page.mouse.down();
		await page.mouse.move(x + 40, y, { steps: 5 });
		await page.mouse.up();
		await expect(attributes).toHaveCount(0);
	});
}

test("3D selection clears when the selected part is hidden", async ({ page }) => {
	await page.goto("/tests/browser/generic-viewers.html?3d");
	await expect(page.getByRole("button", { name: "Zoom", exact: true })).toBeEnabled();
	const bounds = (await page.locator("canvas").boundingBox())!;
	await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
	const attributes = page.getByRole("complementary", { name: "Selection attributes" });
	await expect(attributes).toContainText("3D part");
	await page.mouse.move(0, 0);
	await expect(attributes).toBeVisible();
	await page.getByRole("button", { name: "Visibility", exact: true }).click();
	await expect(attributes).toHaveCount(0);
});
