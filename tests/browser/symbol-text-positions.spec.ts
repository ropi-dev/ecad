import { captureArtifacts } from "./artifacts";
import { expect, test, type Page } from "@playwright/test";
import type { EditorSymbol } from "#/drawing/shapes.ts";
import { selectSymbolItem } from "./symbol-items";
import { toolbarButton } from "./toolbar";

test.use({ viewport: { width: 1440, height: 1000 } });
const state = async (page: Page) =>
	JSON.parse((await page.locator("#editor-document").textContent())!) as {
		shapes: EditorSymbol[];
		historySize: number;
	};

async function labelScreen(
	page: Page,
	symbolId: number,
	attribute = "reference",
) {
	const scene = JSON.parse(
		(await page.locator("#editor-scene").textContent())!,
	);
	const text = scene.symbolTexts.find(
		(text: { name: string }) => text.name === `${attribute} ${symbolId}`,
	);
	const box = (await page.locator("canvas").boundingBox())!;
	const scale = (((scene.corner[0] - scene.origin[0]) / 420) * box.width) / 2;
	return {
		x: box.x + ((scene.origin[0] + 1) * box.width) / 2 + text.x * scale,
		y: box.y + ((1 - scene.origin[1]) * box.height) / 2 - text.y * scale,
	};
}

test("dragging symbol labels edits only that instance, supports cancel and undo, and follows rotation", async ({
	page,
}) => {
	await page.goto("/tests/browser/editor.html");
	for (const x of [0.4, 0.65]) {
		await page.getByRole("button", { name: "Symbols", exact: true }).click();
		await page
			.getByRole("button", { name: "Insert Resistor", exact: true })
			.click();
		const box = (await page.locator("canvas").boundingBox())!;
		await page
			.locator("canvas")
			.click({ position: { x: box.width * x, y: box.height * 0.5 } });
	}
	await (await toolbarButton(page, "Snap to grid")).click();
	const before = await state(page);
	const first = await labelScreen(page, 1);
	await page.mouse.click(first.x, first.y);
	const start = await labelScreen(page, 1);
	await page.mouse.move(start.x, start.y);
	await page.mouse.down();
	await page.mouse.move(start.x + 70, start.y - 55, { steps: 8 });
	// Draft movement does not create history until release.
	expect(await state(page)).toEqual(before);
	await page.mouse.up();
	const moved = await state(page);
	expect(moved.historySize).toBe(before.historySize + 1);
	expect(moved.shapes[1]).toEqual(before.shapes[1]);
	const { textPositions: beforePositions, ...beforeBody } = before.shapes[0];
	const { textPositions: afterPositions, ...afterBody } = moved.shapes[0];
	expect(afterBody).toEqual(beforeBody);
	expect(afterPositions!.reference).not.toEqual(beforePositions!.reference);
	expect(afterPositions!.value).toEqual(beforePositions!.value);
	await expect
		.poll(async () => (await labelScreen(page, 1)).x)
		.toBeCloseTo(start.x + 70, 2);
	await expect
		.poll(async () => (await labelScreen(page, 1)).y)
		.toBeCloseTo(start.y - 55, 2);
	await (await toolbarButton(page, "Undo")).click();
	expect((await state(page)).shapes).toEqual(before.shapes);
	await (await toolbarButton(page, "Redo")).click();
	expect((await state(page)).shapes).toEqual(moved.shapes);
	const cancel = await labelScreen(page, 1);
	await page.mouse.move(cancel.x, cancel.y);
	await page.mouse.down();
	await page.mouse.move(cancel.x + 30, cancel.y + 30, { steps: 4 });
	await page.keyboard.press("Escape");
	await page.mouse.up();
	expect(await state(page)).toEqual(moved);
	await selectSymbolItem(page, "");
	const angle = page.getByRole("spinbutton", { name: "Angle", exact: true });
	await angle.fill("90");
	await angle.press("Tab");
	await expect
		.poll(
			async () =>
				JSON.parse(
					(await page.locator("#editor-scene").textContent())!,
				).shapes.find((shape: { name: string }) => shape.name === "symbol 1")
					?.rotation,
		)
		.toBeCloseTo(Math.PI / 2);
	const rotated = await labelScreen(page, 1);
	await page.mouse.move(rotated.x, rotated.y);
	await page.mouse.down();
	await page.mouse.move(rotated.x - 45, rotated.y + 35, { steps: 5 });
	await page.mouse.up();
	await expect
		.poll(async () => (await labelScreen(page, 1)).x)
		.toBeCloseTo(rotated.x - 45, 2);
	await expect
		.poll(async () => (await labelScreen(page, 1)).y)
		.toBeCloseTo(rotated.y + 35, 2);
	const xInput = page.getByRole("spinbutton", {
		name: "Anchor X",
		exact: true,
	});
	const committedX = await xInput.getAttribute("data-committed-value");
	await xInput.fill("12");
	await expect(xInput).toHaveAttribute("data-committed-value", committedX!);
	await xInput.press("Tab");
	await expect(xInput).toHaveAttribute("data-committed-value", "12");
	expect((await state(page)).shapes[0].textPositions!.reference!.x).toBe(12);
	await expect(page.getByRole("alert")).toHaveCount(0);
	// Arrange a close view of the edited and untouched instances for visual review.
	for (const [name, value] of [
		["Anchor X", "-3"],
		["Anchor Y", "5"],
	]) {
		const input = page.getByRole("spinbutton", { name, exact: true });
		await input.fill(value);
		await input.press("Tab");
	}
	await selectSymbolItem(page, "");
	for (const [name, value] of [
		["Angle", "0"],
		["Center X", "-6"],
		["Center Y", "0"],
	]) {
		const input = page.getByRole("spinbutton", { name, exact: true });
		await input.fill(value);
		await input.press("Tab");
	}
	const secondLabel = await labelScreen(page, 2);
	await page.mouse.click(secondLabel.x, secondLabel.y);
	const secondCenter = page.getByRole("spinbutton", {
		name: "Center X",
		exact: true,
	});
	await secondCenter.fill("6");
	await secondCenter.press("Tab");
	await expect
		.poll(
			async () =>
				JSON.parse(
					(await page.locator("#editor-scene").textContent())!,
				).shapes.find((shape: { name: string }) => shape.name === "symbol 1")
					?.x,
		)
		.toBe(-6);
	const reviewLabel = await labelScreen(page, 1);
	await page.mouse.click(reviewLabel.x, reviewLabel.y);
	await selectSymbolItem(page, "attribute:reference");
	await expect(xInput).toHaveValue("-3");
	for (let repeat = 0; repeat < 10; repeat++)
		await page.getByRole("button", { name: "Zoom in", exact: true }).click();
	if (captureArtifacts)
		await page.screenshot({
			path: test.info().outputPath("symbol-text-positions.png"),
		});
});
