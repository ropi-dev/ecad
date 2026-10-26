import { openProjectFiles } from "./project-files";
import { expect, test, type Page } from "@playwright/test";
import type { EditorSymbol } from "#/drawing/shapes.ts";
import { toolbarButton } from "./toolbar";

test.use({ viewport: { width: 1440, height: 1000 } });

const state = async (page: Page) =>
	JSON.parse((await page.locator("#editor-document").textContent())!) as {
		shapes: EditorSymbol[];
		historySize: number;
	};
const scene = async (page: Page) =>
	JSON.parse((await page.locator("#editor-scene").textContent())!);

async function placeResistor(page: Page, x = 0.5) {
	await page.getByRole("button", { name: "Symbols", exact: true }).click();
	await page
		.getByRole("button", { name: "Insert Resistor", exact: true })
		.click();
	const canvas = page.locator("canvas");
	const box = (await canvas.boundingBox())!;
	await canvas.click({ position: { x: box.width * x, y: box.height * 0.5 } });
}

test("rotation buttons and shortcuts turn selected components, pins and labels with undo", async ({
	page,
}) => {
	await page.goto("/tests/browser/editor.html");
	await page.getByRole("button", { name: "Snap to grid", exact: true }).click();
	const clockwise = page.getByRole("button", {
		name: "Rotate clockwise",
		exact: true,
	});
	const counterclockwise = page.getByRole("button", {
		name: "Rotate counterclockwise",
		exact: true,
	});
	await expect(clockwise).toBeDisabled();
	await placeResistor(page, 0.4);
	await placeResistor(page, 0.65);
	const before = await state(page);
	await expect(counterclockwise).toBeEnabled();
	await page.keyboard.press("r");
	await expect
		.poll(async () => (await state(page)).shapes[1].rotation)
		.toBe(Math.PI / 2);
	const rotated = await state(page);
	expect(rotated.historySize).toBe(before.historySize + 1);
	expect(rotated.shapes[0]).toEqual(before.shapes[0]);
	expect(rotated.shapes[1]).toEqual({
		...before.shapes[1],
		rotation: Math.PI / 2,
	});
	await expect
		.poll(
			async () =>
				(await scene(page)).shapes.find(
					(shape: { name: string }) => shape.name === "symbol 2",
				)?.rotation,
		)
		.toBeCloseTo(Math.PI / 2);
	const label = before.shapes[1].texts.find(
		(text) => text.attribute === "reference",
	)!;
	const position = before.shapes[1].textPositions?.reference ?? label;
	await expect
		.poll(
			async () =>
				(await scene(page)).symbolTexts.find(
					(text: { name: string }) => text.name === "reference 2",
				)?.x,
		)
		.toBeCloseTo(before.shapes[1].x - position.y);
	await (await toolbarButton(page, "Undo")).click();
	expect((await state(page)).shapes).toEqual(before.shapes);
	await (await toolbarButton(page, "Redo")).click();
	expect((await state(page)).shapes).toEqual(rotated.shapes);
	await clockwise.click();
	await expect.poll(async () => (await state(page)).shapes[1].rotation).toBe(0);
	await counterclockwise.click();
	await expect
		.poll(async () => (await state(page)).shapes[1].rotation)
		.toBe(Math.PI / 2);
	await page.keyboard.press("Shift+r");
	await expect.poll(async () => (await state(page)).shapes[1].rotation).toBe(0);
	const reference = page.getByRole("textbox", {
		name: "Reference",
		exact: true,
	});
	await reference.fill("R");
	await reference.press("r");
	await reference.press("Tab");
	expect((await state(page)).shapes[1].rotation).toBe(0);
	await counterclockwise.click();
	await expect
		.poll(async () => (await state(page)).shapes[1].rotation)
		.toBe(Math.PI / 2);
	const canvas = page.locator("canvas");
	const box = (await canvas.boundingBox())!;
	await canvas.click({
		position: { x: box.width * 0.4, y: box.height * 0.5 },
		modifiers: ["Shift"],
	});
	await page.keyboard.press("r");
	await expect
		.poll(async () => (await state(page)).shapes.map((shape) => shape.rotation))
		.toEqual([Math.PI / 2, Math.PI]);
	await expect(page.getByRole("alert")).toHaveCount(0);
	await page.keyboard.press("Escape");
	await expect(clockwise).toBeDisabled();
	const unchanged = await state(page);
	await page.keyboard.press("r");
	expect(await state(page)).toEqual(unchanged);
});

test("rotation cancels a stale drag before applying its command", async ({
	page,
}) => {
	await page.goto("/tests/browser/editor.html");
	await page.getByRole("button", { name: "Snap to grid", exact: true }).click();
	await placeResistor(page);
	const before = await state(page);
	const box = (await page.locator("canvas").boundingBox())!;
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	await page.mouse.down();
	await page.mouse.move(
		box.x + box.width / 2 + 80,
		box.y + box.height / 2 + 60,
		{ steps: 4 },
	);
	expect(await state(page)).toEqual(before);
	await page.keyboard.press("r");
	await page.mouse.up();
	await expect
		.poll(async () => (await state(page)).shapes[0].rotation)
		.toBe(Math.PI / 2);
	const after = await state(page);
	expect(after.historySize).toBe(before.historySize + 1);
	expect(after.shapes[0]).toEqual({
		...before.shapes[0],
		rotation: Math.PI / 2,
	});
});

test("rotated components survive project reload", async ({ page }) => {
	await page.goto("/tests/browser/projects.html");
	await page
		.getByLabel("Project name", { exact: true })
		.fill("Rotated components");
	await page
		.getByRole("button", { name: "Create project", exact: true })
		.click();
	await expect(page.getByLabel("Project save status")).toHaveText("Saved");
	await (await openProjectFiles(page))
		.getByRole("link", { name: "Schematic editor", exact: true })
		.click();
	await placeResistor(page);
	await page.keyboard.press("r");
	const projectState = async () =>
		JSON.parse((await page.locator("#project-document").textContent())!);
	await expect
		.poll(async () => (await projectState()).shapes[0]?.rotation)
		.toBe(Math.PI / 2);
	await expect.poll(async () => (await projectState()).dirty).toBe(false);
	await page.reload();
	await expect
		.poll(async () => (await projectState()).shapes[0]?.rotation)
		.toBe(Math.PI / 2);
	await (await openProjectFiles(page))
		.getByRole("link", { name: "Schematic editor", exact: true })
		.click();
	await page.getByRole("button", { name: "Fit drawing", exact: true }).click();
	const canvas = page.locator("canvas");
	const box = (await canvas.boundingBox())!;
	await canvas.click({ position: { x: box.width / 2, y: box.height / 2 } });
	await expect(
		page.getByRole("spinbutton", { name: "Angle", exact: true }),
	).toHaveValue("90");
	for (let repeat = 0; repeat < 8; repeat++)
		await page.getByRole("button", { name: "Zoom in", exact: true }).click();
	await page.screenshot({
		path: test.info().outputPath("component-rotation.png"),
	});
});
