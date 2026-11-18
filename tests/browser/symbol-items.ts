import { isBoxSymbol } from "@ecad/drawing-core/drawing/shapes.ts";
import { expect, type Page } from "@playwright/test";
import { required } from "../helpers/required.ts";
import { closeProjectFiles } from "./project-files";

export async function selectDrawingShape(
	page: Page,
	id: number,
	modifiers?: ("Control" | "Meta" | "Shift" | "Alt")[],
) {
	await closeProjectFiles(page);
	await selectSymbolParent(page);
	const document = JSON.parse(
		required(
			await page.locator("#editor-document, #project-document").textContent(),
		),
	);
	const shape = document.shapes.find(
		(shape: { id: number }) => shape.id === id,
	);
	const point = await drawingPoint(
		page,
		isBoxSymbol(shape)
			? { x: shape.x + 1, y: shape.y - 1 }
			: { x: shape.x, y: shape.y },
	);
	const canvas = page.locator("canvas");
	const bounds = required(await canvas.boundingBox());
	const position = { x: point.x - bounds.x, y: point.y - bounds.y };
	if (modifiers?.length) await canvas.click({ position, modifiers });
	else await canvas.dblclick({ position });
	await expect(page.getByTestId("symbol-child-selection")).toHaveCount(0);
	if (shape.kind === "symbol" && !modifiers?.length)
		await expect(
			page.getByRole("textbox", { name: "Reference", exact: true }),
		).toHaveValue(shape.attributes.reference);
}

export async function openPlacedShape(page: Page) {
	const document = JSON.parse(
		required(
			await page.locator("#editor-document, #project-document").textContent(),
		),
	);
	await selectDrawingShape(page, required(document.shapes.at(-1)).id);
}

export async function drawingPoint(
	page: Page,
	point: { x: number; y: number },
) {
	return page
		.getByRole("img", { name: /^Drawing rulers in (mils|millimetres)$/ })
		.evaluate((rulers, point) => {
			const coordinate = (axis: "x" | "y", value: number) => {
				const ticks = Array.from(
					rulers.querySelectorAll(`[data-axis="${axis}"]`),
				).slice(0, 2);
				const values = ticks.map((tick) =>
					Number(tick.getAttribute("data-value")),
				);
				// Rendered positions, since the tick layer may be offset while panning.
				const positions = ticks.map((tick) => {
					const line = (
						tick.querySelector("line") ??
						(() => {
							throw new Error("Expected a value");
						})()
					).getBoundingClientRect();
					return axis === "x" ? line.x : line.y;
				});
				return (
					positions[0] +
					((value - values[0]) * (positions[1] - positions[0])) /
						(values[1] - values[0])
				);
			};
			return { x: coordinate("x", point.x), y: coordinate("y", point.y) };
		}, point);
}

export async function selectSymbolParent(page: Page) {
	if (await page.getByTestId("symbol-child-selection").count()) {
		const expanded = page
			.getByRole("toolbar", { name: /^(Schematic|Symbol) tools$/ })
			.getByRole("button", { expanded: true });
		if (await expanded.count()) await expanded.click();
		await page.locator("canvas").focus();
		await page.keyboard.press("Escape");
		await expect(page.getByTestId("symbol-child-selection")).toHaveCount(0);
	}
}

export async function selectSymbolAttribute(page: Page, attribute: string) {
	await selectSymbolParent(page);
	const marker = await page
		.locator(
			`[data-testid="text-anchor"][data-anchor-id$=":label:${attribute === "reference" ? 0 : 1}"]`,
		)
		.boundingBox();
	await page.mouse.click(
		required(marker).x + required(marker).width / 2,
		required(marker).y + required(marker).height / 2,
	);
	await expect(page.getByTestId("symbol-child-selection")).toBeVisible();
}

export async function drawingGridStep(page: Page) {
	return page
		.getByRole("img", { name: /^Drawing rulers in (mils|millimetres)$/ })
		.evaluate((rulers) => {
			// Ruler ticks are labelled every ten grid steps.
			const ticks = Array.from(
				rulers.querySelectorAll('[data-axis="x"]'),
			).slice(0, 2);
			return (
				(Number(ticks[1].getAttribute("data-value")) -
					Number(ticks[0].getAttribute("data-value"))) /
				10
			);
		});
}
