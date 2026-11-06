import type { EditorShape } from "@ecad/drawing-core/drawing/shapes.ts";
import { expect, type Page, test } from "@playwright/test";
import { required } from "../helpers/required.ts";

test.use({ viewport: { width: 1440, height: 900 } });

const documentShapes = async (page: Page): Promise<EditorShape[]> =>
	JSON.parse(required(await page.locator("#editor-document").textContent()))
		.shapes;

const wireSpans = (shapes: EditorShape[]) =>
	shapes
		.filter((shape) => shape.kind === "wire")
		.map((wire) => {
			const dx = (Math.cos(wire.rotation) * wire.width) / 2;
			const dy = (Math.sin(wire.rotation) * wire.width) / 2;
			return [wire.x - dx, wire.x + dx]
				.map((x) => Number(x.toFixed(4)))
				.sort((a, b) => a - b)
				.concat(Number((wire.y - dy).toFixed(4)));
		})
		.sort((a, b) => a[0] - b[0]);

async function insertResistorAtCenter(page: Page) {
	await page.getByRole("button", { name: "Symbols", exact: true }).click();
	await page
		.getByRole("button", { name: "Insert Resistor", exact: true })
		.click();
	const box = required(await page.locator("canvas").boundingBox());
	await page
		.locator("canvas")
		.click({ position: { x: box.width / 2, y: box.height / 2 } });
}

test("a resistor placed on a wire splits it and removes the part under the resistor", async ({
	page,
}) => {
	await page.goto("/tests/browser/editor.html");
	await expect(
		page.getByRole("button", { name: "Select", exact: true }),
	).toBeEnabled();
	await insertResistorAtCenter(page);
	const resistor = required(
		(await documentShapes(page)).find((shape) => shape.kind === "symbol"),
	);
	await page.keyboard.press("Control+z");
	await expect.poll(async () => (await documentShapes(page)).length).toBe(0);

	await page.evaluate(
		async ({ x, y }) => {
			const fixturePath = "/tests/browser/editor.tsx";
			const { placeShapes } = await import(fixturePath);
			placeShapes([
				{
					kind: "wire",
					x,
					y,
					width: 40,
					height: 0.25,
					rotation: 0,
					lineWidth: 0.25,
				},
			]);
		},
		{ x: resistor.x, y: resistor.y },
	);
	await expect.poll(async () => (await documentShapes(page)).length).toBe(1);
	for (let step = 0; step < 6; step++)
		await page.getByRole("button", { name: "Zoom in", exact: true }).click();
	await page.screenshot({ path: "/tmp/ecad-wire-insert-before.png" });

	await insertResistorAtCenter(page);
	await expect
		.poll(async () => wireSpans(await documentShapes(page)))
		.toEqual([
			[resistor.x - 20, resistor.x - 3.81, resistor.y].map((value) =>
				Number(value.toFixed(4)),
			),
			[resistor.x + 3.81, resistor.x + 20, resistor.y].map((value) =>
				Number(value.toFixed(4)),
			),
		]);
	await page.keyboard.press("Escape");
	await page.screenshot({ path: "/tmp/ecad-wire-insert-after.png" });

	await page.keyboard.press("Control+z");
	await expect
		.poll(async () => wireSpans(await documentShapes(page)))
		.toEqual([
			[resistor.x - 20, resistor.x + 20, resistor.y].map((value) =>
				Number(value.toFixed(4)),
			),
		]);
});
