import { captureArtifacts } from "./artifacts";
import { expect, type Page, test } from "@playwright/test";
import { toolbarButton } from "./toolbar";

test.use({ viewport: { width: 1440, height: 900 } });

const documentShapes = async (page: Page) => JSON.parse((await page.locator("#editor-document").textContent())!).shapes;

async function clickShape(page: Page, x: number, y: number) {
	const scene = JSON.parse((await page.locator("#editor-scene").textContent())!);
	const box = (await page.locator("canvas").boundingBox())!;
	await page.mouse.click(
		box.x + (1 + scene.origin[0] + (scene.corner[0] - scene.origin[0]) * x / 420) * box.width / 2,
		box.y + (1 - scene.origin[1] - (scene.corner[1] - scene.origin[1]) * y / 297) * box.height / 2,
	);
}

test("line style edits support every basic shape, mixed selections, undo, and redo", async ({ page }) => {
	await page.goto("/tests/browser/editor.html");
	await expect((await toolbarButton(page, "Rectangle"))).toBeEnabled();
	await page.evaluate(async () => {
		const fixturePath = "/tests/browser/editor.tsx";
		const { placeRectangle, replaceShapes } = await import(fixturePath);
		for (let index = 0; index < 5; index++) placeRectangle({ x: -90 + index * 40, y: 0, width: 24, height: 24, lineWidth: 0.8, rotation: 0 });
		replaceShapes([
			{ id: 2, kind: "circle", x: -50, y: 0, width: 24, height: 24, lineWidth: 0.8, rotation: 0 },
			{ id: 3, kind: "triangle", x: -10, y: 0, width: 24, height: 24, lineWidth: 0.8, rotation: 0 },
			{ id: 4, kind: "line", x: 30, y: 0, width: 24, height: 0.8, lineWidth: 0.8, rotation: 0.3 },
			{ id: 5, kind: "wire", x: 70, y: 0, width: 24, height: 0.8, lineWidth: 0.8, rotation: 0 },
		]);
	});
	await page.getByRole("button", { name: "Select", exact: true }).click();
	const select = page.getByRole("combobox", { name: "Line style", exact: true });
	for (const [index, style] of ["dashed", "dotted", "dash-dot", "dash-dot-dot"].entries()) {
		await clickShape(page, -90 + index * 40, 0);
		await expect(select).toHaveValue("solid");
		await select.selectOption(style);
		await expect.poll(async () => (await documentShapes(page))[index].lineStyle).toBe(style);
		await (await toolbarButton(page, "Undo")).click();
		await clickShape(page, -90 + index * 40, 0);
		await expect(select).toHaveValue("solid");
		await (await toolbarButton(page, "Redo")).click();
		await expect(select).toHaveValue(style);
	}
	await clickShape(page, 70, 0);
	await expect(select).toHaveCount(0);
	await clickShape(page, -90, 0);
	await page.keyboard.down("Shift");
	await clickShape(page, -50, 0);
	await clickShape(page, 70, 0);
	await page.keyboard.up("Shift");
	await expect(select).toHaveValue("");
	await select.selectOption("dotted");
	await expect.poll(async () => (await documentShapes(page)).map((shape: { lineStyle?: string }) => shape.lineStyle)).toEqual(["dotted", "dotted", "dash-dot", "dash-dot-dot", undefined]);
	await (await toolbarButton(page, "Undo")).click();
	await expect.poll(async () => (await documentShapes(page)).map((shape: { lineStyle?: string }) => shape.lineStyle)).toEqual(["dashed", "dotted", "dash-dot", "dash-dot-dot", undefined]);
	await clickShape(page, 30, 0);
	await expect(select).toHaveValue("dash-dot-dot");
	if (captureArtifacts) await page.screenshot({ path: "perf-artifacts/line-styles.png" });
});
