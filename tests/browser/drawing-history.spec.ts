import { expect, type Page, test } from "@playwright/test";
import { toolbarButton } from "./toolbar.ts";

const shapeX = async (page: Page) =>
	JSON.parse((await page.locator("#editor-document").textContent()) || "{}")
		.shapes[0]?.x;

async function moveShape(page: Page, x: number) {
	await page.evaluate(async (x) => {
		const fixturePath = "/tests/browser/editor.tsx";
		const { replaceShapes, drawingStore } = await import(fixturePath);
		replaceShapes([{ ...drawingStore.getSnapshot().shapes[0], x }]);
	}, x);
}

test("the history panel jumps to a chosen step on either branch", async ({
	page,
}) => {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	await page.goto("/tests/browser/editor.html");
	await expect(await toolbarButton(page, "History")).toBeEnabled();
	await page.evaluate(async () => {
		const fixturePath = "/tests/browser/editor.tsx";
		const { placeRectangle } = await import(fixturePath);
		placeRectangle({
			x: 1,
			y: 1,
			width: 10,
			height: 8,
			rotation: 0,
			lineWidth: 0.2,
		});
	});
	for (const x of [2, 3]) await moveShape(page, x);
	await (await toolbarButton(page, "History")).click();
	const panel = page.getByRole("region", {
		name: "Drawing history",
		exact: true,
	});
	const step = (id: number) => panel.locator(`[data-history-node-id="${id}"]`);
	await expect(step(3)).toHaveAttribute("aria-current", "step");

	await step(1).click();
	await expect(step(1)).toHaveAttribute("aria-current", "step");
	await expect.poll(() => shapeX(page)).toBe(1);

	await moveShape(page, 9);
	await expect(step(4)).toHaveAttribute("aria-current", "step");
	await step(3).click();
	await expect(step(3)).toHaveAttribute("aria-current", "step");
	await expect.poll(() => shapeX(page)).toBe(3);
	await step(4).click();
	await expect(step(4)).toHaveAttribute("aria-current", "step");
	await expect.poll(() => shapeX(page)).toBe(9);
	expect(errors).toEqual([]);
});
