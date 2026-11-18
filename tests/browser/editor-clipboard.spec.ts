import type { EditorShape } from "@ecad/drawing-core/drawing/shapes.ts";
import { expect, test } from "@playwright/test";
import { required } from "../helpers/required.ts";
import { openPlacedShape, selectSymbolAttribute } from "./symbol-items";

test.describe.configure({ mode: "serial" });

test.use({
	viewport: { width: 1440, height: 900 },
	permissions: ["clipboard-read", "clipboard-write"],
});

const documentState = async (
	page: import("@playwright/test").Page,
): Promise<{ shapes: EditorShape[] }> =>
	JSON.parse(required(await page.locator("#editor-document").textContent()));

async function lastReference(page: import("@playwright/test").Page) {
	const shape = (await documentState(page)).shapes.at(-1);
	return shape?.kind === "symbol" ? shape.attributes.reference : undefined;
}

async function copiedSelection(page: import("@playwright/test").Page) {
	await expect
		.poll(() =>
			page.evaluate(async () =>
				(await navigator.clipboard.read())[0]?.types.includes("image/png"),
			),
		)
		.toBe(true);
	return page.evaluate(async () => {
		const [item] = await navigator.clipboard.read();
		return JSON.parse(
			await (await item.getType("web application/x-ecad-shapes+json")).text(),
		);
	});
}

test.beforeEach(async ({ page }) => {
	await page.goto("/tests/browser/editor.html");
	await expect(
		page.getByRole("button", { name: "Select", exact: true }),
	).toBeEnabled();
	await page.getByRole("button", { name: "Symbols", exact: true }).click();
	await page
		.getByRole("button", { name: "Insert Resistor", exact: true })
		.click();
	const box = required(await page.locator("canvas").boundingBox());
	await page
		.locator("canvas")
		.click({ position: { x: box.width / 2, y: box.height / 2 } });
	await openPlacedShape(page);
	await expect(
		page.getByRole("textbox", { name: "Reference", exact: true }),
	).toHaveValue("R1");
});

test("native copy, repeated paste, undo, redo and cut preserve the clipboard snapshot", async ({
	page,
}) => {
	await selectSymbolAttribute(page, "reference");
	await page.keyboard.press("Control+c");
	const copied = await copiedSelection(page);
	expect(copied.format).toBe("ecad-selection");
	await page.keyboard.press("Control+v");
	await expect.poll(() => lastReference(page)).toBe("R2");
	await page.keyboard.press("Control+v");
	await expect.poll(() => lastReference(page)).toBe("R3");
	const pasted = await documentState(page);
	expect(pasted.shapes).toHaveLength(3);
	expect(pasted.shapes[1].x).not.toBe(pasted.shapes[2].x);
	await page.keyboard.press("Control+z");
	await expect
		.poll(async () => (await documentState(page)).shapes.length)
		.toBe(2);
	await page.keyboard.press("Control+Shift+z");
	await expect
		.poll(async () => (await documentState(page)).shapes.length)
		.toBe(3);
	await page.keyboard.press("Control+x");
	await copiedSelection(page);
	await expect
		.poll(async () => (await documentState(page)).shapes.length)
		.toBe(2);
	await page.keyboard.press("Control+z");
	await expect
		.poll(async () => (await documentState(page)).shapes.length)
		.toBe(3);
	await page.keyboard.press("Control+v");
	await expect
		.poll(async () => (await documentState(page)).shapes.length)
		.toBe(4);
	await page.screenshot({ path: "/tmp/ecad-copy-paste.png" });
});

test("one copy offers a vector image, a PNG, editable data and importable save-file text", async ({
	page,
}) => {
	await page.keyboard.press("Control+c");
	await copiedSelection(page);
	const representations = await page.evaluate(async () => {
		const [item] = await navigator.clipboard.read();
		const html = await (await item.getType("text/html")).text();
		const file = await (await item.getType("text/plain")).text();
		const image =
			new DOMParser().parseFromString(html, "text/html").querySelector("img") ??
			(() => {
				throw new Error("Expected a value");
			})();
		const svg = decodeURIComponent(
			(
				image.getAttribute("src") ??
				(() => {
					throw new Error("Expected a value");
				})()
			)
				.split(",")
				.slice(1)
				.join(","),
		);
		const png = await item.getType("image/png");
		const bitmap = await createImageBitmap(png);
		return {
			types: item.types,
			svg,
			file: JSON.parse(file),
			width: bitmap.width,
			height: bitmap.height,
			pngBytes: png.size,
		};
	});
	expect(representations.types).toEqual(
		expect.arrayContaining([
			"text/plain",
			"text/html",
			"image/png",
			"web application/x-ecad-shapes+json",
		]),
	);
	expect(representations.svg).toContain(
		'<svg xmlns="http://www.w3.org/2000/svg"',
	);
	expect(representations.svg).toContain("R1");
	expect(representations.file.format).toBe("ecad-symbol");
	expect(representations.pngBytes).toBeGreaterThan(100);
	expect(representations.width).toBeGreaterThan(20);
	expect(representations.height).toBeGreaterThan(20);
	await page.screenshot({ path: "/tmp/ecad-rich-clipboard.png" });
});
