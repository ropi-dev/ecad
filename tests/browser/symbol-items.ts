import { expect, type Page } from "@playwright/test";
import { type EditorSymbol, shapeBounds, symbolChildren, symbolChildWorld } from "#/drawing/shapes.ts";

export async function drawingPoint(page: Page, point: { x: number; y: number }) {
	return page.getByRole("img", { name: "Drawing rulers in millimetres" }).evaluate((rulers, point) => {
		const bounds = rulers.getBoundingClientRect();
		const coordinate = (axis: "x" | "y", value: number) => {
			const ticks = Array.from(rulers.querySelectorAll(`[data-axis="${axis}"]`)).slice(0, 2);
			const values = ticks.map(tick => Number(tick.getAttribute("data-value")));
			const positions = ticks.map(tick => Number(tick.querySelector("line")!.getAttribute(`${axis}1`)));
			return positions[0] + (value - values[0]) * (positions[1] - positions[0]) / (values[1] - values[0]);
		};
		return { x: bounds.x + coordinate("x", point.x), y: bounds.y + coordinate("y", point.y) };
	}, point);
}

export async function selectSymbolParent(page: Page) {
	if (await page.getByTestId("symbol-child-selection").count()) {
		const expanded = page.getByRole("toolbar", { name: "View controls" }).getByRole("button", { expanded: true });
		if (await expanded.count()) await expanded.click();
		await page.locator("canvas").focus();
		await page.keyboard.press("Escape");
		await expect(page.getByTestId("symbol-child-selection")).toHaveCount(0);
	}
}

export async function selectSymbolAttribute(page: Page, attribute: string) {
	await selectSymbolParent(page);
	const marker = await page.locator(`[data-testid="text-anchor"][data-anchor-id$=":label:${attribute === "reference" ? 0 : 1}"]`).boundingBox();
	await page.mouse.click(marker!.x + marker!.width / 2, marker!.y + marker!.height / 2);
	await expect(page.getByTestId("symbol-child-selection")).toBeVisible();
}

export async function symbolItemPoint(page: Page, key: string) {
	const anchor = await page.getByTestId("text-anchor").first().getAttribute("data-anchor-id");
	const id = Number(anchor!.split(":")[0]);
	const document = JSON.parse((await page.locator("#editor-document, #project-document").textContent())!);
	const symbol = document.shapes.find((shape: EditorSymbol) => shape.id === id) as EditorSymbol;
	const child = symbolChildren(symbol).find(child => child.key === key)!;
	const bounds = shapeBounds(symbolChildWorld(symbol, child.shape));
	const point = await drawingPoint(page, { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 });
	return { ...point, kind: child.shape.kind };
}

export async function selectSymbolItem(page: Page, key: string) {
	await selectSymbolParent(page);
	if (!key) return;
	const point = await symbolItemPoint(page, key);
	await page.mouse.move(point.x, point.y);
	await page.mouse.down();
	if (point.kind === "pin") {
		await page.mouse.move(point.x + 4, point.y);
		await page.mouse.move(point.x, point.y);
	}
	await page.mouse.up();
	await expect(page.getByTestId("symbol-child-selection")).toBeVisible();
}
