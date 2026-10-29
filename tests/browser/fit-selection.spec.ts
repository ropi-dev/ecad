import { captureArtifacts } from "./artifacts";
import { expect, type Page, test } from "@playwright/test";

const editorView = async (page: Page) =>
	JSON.parse((await page.locator("#editor-scene").textContent())!);

const editorCenter = async (page: Page) => {
	const { origin, corner } = await editorView(page);
	return {
		x: -origin[0] * 420 / (corner[0] - origin[0]),
		y: -origin[1] * 297 / (corner[1] - origin[1]),
	};
};

test("editor Fit centers and enlarges the selection, then restores the sheet after deselection", async ({ page }) => {
	await page.goto("/tests/browser/editor.html");
	const fit = page.getByRole("button", { name: "Fit drawing", exact: true });
	await expect(fit).toBeEnabled();
	await expect(fit).toHaveText("100%");
	await page.evaluate(async () => {
		const path = "/tests/browser/editor.tsx";
		const { placeRectangle }: typeof import("./editor") = await import(path);
		placeRectangle({ x: 60, y: 30, width: 40, height: 20, rotation: 0, lineWidth: 0.4 });
		placeRectangle({ x: -100, y: -60, width: 20, height: 20, rotation: 0, lineWidth: 0.4 });
	});
	await expect.poll(async () => (await editorView(page)).shapes.length).toBe(2);
	const canvas = page.locator("canvas");
	const box = (await canvas.boundingBox())!;
	const { origin, corner } = await editorView(page);
	const initialScale = corner[0] - origin[0];
	await page.mouse.click(
		box.x + box.width * (1 + origin[0] + 60 * initialScale / 420) / 2,
		box.y + box.height * (1 - origin[1] - 30 * (corner[1] - origin[1]) / 297) / 2,
	);
	await fit.click();
	await expect.poll(async () => (await editorCenter(page)).x).toBeCloseTo(60, 2);
	await expect.poll(async () => (await editorCenter(page)).y).toBeCloseTo(30, 2);
	const fitted = await editorView(page);
	expect(fitted.corner[0] - fitted.origin[0]).toBeGreaterThan(initialScale * 2);
	const fittedZoom = `${Math.round((fitted.corner[0] - fitted.origin[0]) / initialScale * 100)}%`;
	await expect(fit).toHaveText(fittedZoom);
	await fit.click();
	await expect(fit).toHaveText(fittedZoom);
	const selectedWidth = 40 * (fitted.corner[0] - fitted.origin[0]) / 420 / 2;
	expect(selectedWidth).toBeLessThan(0.6);
	await canvas.press("ArrowRight");
	await canvas.press("F6");
	await expect.poll(async () => (await editorCenter(page)).x).toBeGreaterThan(60);
	await page.mouse.move(0, 0);
	if (captureArtifacts) await page.screenshot({ path: "artifacts/fit-selected-item-fixed-zoom-reference.png" });
	await canvas.press("Escape");
	await fit.click();
	await expect.poll(async () => (await editorCenter(page)).x).toBeCloseTo(0, 2);
	await expect.poll(async () => (await editorCenter(page)).y).toBeCloseTo(0, 2);
	await expect(fit).toHaveText("100%");
});

for (const projection of ["perspective", "orthographic"]) {
	test(`viewer Fit centers the selected region in ${projection}`, async ({ page }) => {
		await page.goto("/tests/browser/generic-viewers.html");
		const fit = page.getByRole("button", { name: "Fit drawing", exact: true });
		await expect(fit).toBeEnabled();
		if (projection === "orthographic")
			await page.getByRole("button", { name: "Orthographic camera" }).click();
		const snapshot = async () => JSON.parse((await page.locator("#snapshot").textContent())!);
		const initial = await snapshot();
		const canvas = page.locator("canvas");
		const box = (await canvas.boundingBox())!;
		await page.mouse.click(
			box.x + box.width / 2 + (-12 - initial.camera.x) * initial.camera.scale,
			box.y + box.height / 2 + initial.camera.y * initial.camera.scale,
		);
		await expect(page.getByRole("complementary", { name: "Selection attributes" })).toBeVisible();
		await fit.click();
		await expect.poll(async () => (await snapshot()).camera.x).toBeCloseTo(-12, 3);
		await expect.poll(async () => (await snapshot()).camera.y).toBeCloseTo(0, 3);
		expect((await snapshot()).camera.scale).toBeGreaterThan(initial.camera.scale);
		const fittedZoom = `${Math.round((await snapshot()).camera.scale / initial.camera.scale * 100)}%`;
		await expect(fit).toHaveText(fittedZoom);
		await page.getByRole("button", { name: "Orthographic camera" }).click();
		await expect(fit).toHaveText(fittedZoom);
		await canvas.press("Escape");
		await canvas.press("F6");
		await expect.poll(async () => (await snapshot()).camera.x).toBeCloseTo(0, 3);
		await expect(fit).toHaveText("100%");
	});
}
