import { captureArtifacts } from "./artifacts";
import { expect, test, type Page } from "@playwright/test";
import { selectSymbolItem, selectSymbolParent } from "./symbol-items";
import { toolbarButton } from "./toolbar";

test.use({ viewport: { width: 1440, height: 1000 } });
const state = async (page: Page) =>
	JSON.parse((await page.locator("#editor-document").textContent())!);
async function screen(page: Page, x: number, y: number) {
	const scene = JSON.parse(
		(await page.locator("#editor-scene").textContent())!,
	);
	const box = (await page.locator("canvas").boundingBox())!;
	const scale = (((scene.corner[0] - scene.origin[0]) / 420) * box.width) / 2;
	return {
		x: box.x + ((scene.origin[0] + 1) * box.width) / 2 + x * scale,
		y: box.y + ((1 - scene.origin[1]) * box.height) / 2 - y * scale,
	};
}
async function drag(
	page: Page,
	point: { x: number; y: number },
	dx: number,
	dy: number,
) {
	await page.mouse.move(point.x, point.y);
	await page.mouse.down();
	await page.mouse.move(point.x + dx, point.y + dy, { steps: 5 });
	await page.mouse.up();
}

test("an unselected label moves its symbol and selected children customize only their instance", async ({
	page,
}) => {
	await page.goto("/tests/browser/editor.html");
	await page.getByRole("button", { name: "Symbols", exact: true }).click();
	await page
		.getByRole("button", { name: "Insert Resistor", exact: true })
		.click();
	await page.locator("canvas").click({ position: { x: 560, y: 470 } });
	await page.getByRole("button", { name: "Snap to grid", exact: true }).click();
	await page
		.getByRole("button", { name: "Clear selection", exact: true })
		.click();
	const before = await state(page);
	const symbol = before.shapes[0];
	const label = symbol.textPositions.reference;
	await drag(
		page,
		await screen(page, symbol.x + label.x, symbol.y + label.y),
		80,
		-50,
	);
	const moved = await state(page);
	expect(moved.shapes[0].x).not.toBe(symbol.x);
	expect(moved.shapes[0].y).not.toBe(symbol.y);
	expect(moved.shapes[0].textPositions).toEqual(symbol.textPositions);
	expect(moved.historySize).toBe(before.historySize + 1);
	const parent = moved.shapes[0];
	await drag(
		page,
		await screen(page, parent.x + label.x, parent.y + label.y),
		40,
		-30,
	);
	const edited = await state(page);
	expect(edited.shapes[0].x).toBe(parent.x);
	expect(edited.shapes[0].y).toBe(parent.y);
	expect(edited.shapes[0].textPositions.reference).not.toEqual(label);
	await expect(page.getByTestId("symbol-child-selection")).toBeVisible();
	await page
		.getByRole("spinbutton", { name: "Anchor X", exact: true })
		.fill("0");
	await page
		.getByRole("spinbutton", { name: "Anchor X", exact: true })
		.press("Tab");
	await page
		.getByRole("spinbutton", { name: "Anchor Y", exact: true })
		.fill("0");
	await page
		.getByRole("spinbutton", { name: "Anchor Y", exact: true })
		.press("Tab");
	expect((await state(page)).shapes[0].textPositions.reference).toEqual({
		x: 0,
		y: 0,
	});
	await selectSymbolParent(page);
	const body = parent.children.find(
		(child: { kind: string }) => child.kind === "rectangle",
	);
	await drag(
		page,
		await screen(
			page,
			parent.x + body.x + body.width * 0.4,
			parent.y + body.y + body.height * 0.35,
		),
		-35,
		25,
	);
	const bodyEdit = await state(page);
	expect(bodyEdit.shapes[0].x).not.toBe(parent.x);
	expect(
		bodyEdit.shapes[0].childOverrides?.[`shape:${body.id}`],
	).toBeUndefined();
	expect(bodyEdit.shapes[0].textPositions.reference).toEqual({ x: 0, y: 0 });
	await (await toolbarButton(page, "Undo")).click();
	expect(
		(await state(page)).shapes[0].childOverrides?.[`shape:${body.id}`],
	).toBeUndefined();
	await (await toolbarButton(page, "Redo")).click();
	expect((await state(page)).shapes).toEqual(bodyEdit.shapes);
	await expect(page.getByRole("alert")).toHaveCount(0);
	for (const [name, value] of [
		["Center X", "0"],
		["Center Y", "0"],
	]) {
		const input = page.getByRole("spinbutton", { name, exact: true });
		await input.fill(value);
		await input.press("Tab");
	}
	await selectSymbolItem(page, "");
	for (const [name, value] of [
		["Center X", "-10"],
		["Center Y", "0"],
	]) {
		const input = page.getByRole("spinbutton", { name, exact: true });
		await input.fill(value);
		await input.press("Tab");
	}
	await selectSymbolItem(page, "attribute:reference");
	for (const [name, value] of [
		["Anchor X", "-4"],
		["Anchor Y", "4"],
	]) {
		const input = page.getByRole("spinbutton", { name, exact: true });
		await input.fill(value);
		await input.press("Tab");
	}
	const textAngle = page.getByRole("spinbutton", {
		name: "Angle",
		exact: true,
	});
	await textAngle.fill("45");
	await textAngle.press("Tab");
	await expect
		.poll(async () => {
			const scene = JSON.parse(
				(await page.locator("#editor-scene").textContent())!,
			);
			const corners = scene.symbolTexts.find(
				(text: { name: string }) => text.name === "reference 1",
			).corners;
			return Math.atan2(
				corners[1][1] - corners[0][1],
				corners[1][0] - corners[0][0],
			);
		})
		.toBeCloseTo(Math.PI / 4, 4);
	for (let i = 0; i < 7; i++)
		await page.getByRole("button", { name: "Zoom in", exact: true }).click();
	if (captureArtifacts)
		await page.screenshot({
			path: test.info().outputPath("symbol-hierarchy.png"),
		});
});
