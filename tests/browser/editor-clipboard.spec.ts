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
): Promise<{ shapes: EditorShape[]; historyId: number; historySize: number }> =>
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
	const initial = await documentState(page);
	await selectSymbolAttribute(page, "reference");
	await page.keyboard.press("Control+c");
	expect((await documentState(page)).historyId).toBe(initial.historyId);
	const copied = await copiedSelection(page);
	expect(copied.format).toBe("ecad-selection");
	await page.keyboard.press("Control+v");
	await expect.poll(() => lastReference(page)).toBe("R2");
	await page.keyboard.press("Control+v");
	await expect.poll(() => lastReference(page)).toBe("R3");
	const pasted = await documentState(page);
	expect(pasted.shapes).toHaveLength(3);
	expect(pasted.shapes[1].x).not.toBe(pasted.shapes[2].x);
	expect(pasted.historySize).toBe(initial.historySize + 2);
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
	await page.evaluate(() => {
		const destination = document.createElement("section");
		destination.style.cssText =
			"position:fixed;left:40px;top:110px;z-index:50;background:#fff;color:#17232b;padding:24px;border-radius:12px;width:480px;font:15px sans-serif;box-shadow:0 10px 40px #0006";
		destination.innerHTML =
			'<h2 style="margin:0 0 16px">Paste into different destinations</h2><label>Plain text destination<textarea aria-label="Plain text destination" style="display:block;width:100%;height:130px;margin:12px 0 20px;font:12px monospace"></textarea></label><label>Image destination<div role="textbox" contenteditable="true" aria-label="Image destination" style="min-height:140px;margin-top:12px;border:1px solid #bbc;padding:12px"></div></label>';
		const imageTarget =
			destination.querySelector<HTMLElement>(
				'[aria-label="Image destination"]',
			) ??
			(() => {
				throw new Error("Expected a value");
			})();
		imageTarget.addEventListener("paste", (event) => {
			const file = (
				(event as ClipboardEvent).clipboardData ??
				(() => {
					throw new Error("Expected a value");
				})()
			).files[0];
			if (!file) return;
			event.preventDefault();
			const image = new Image();
			image.alt = "Pasted resistor";
			image.style.cssText =
				"max-width:100%;max-height:240px;object-fit:contain";
			image.src = URL.createObjectURL(file);
			imageTarget.replaceChildren(image);
		});
		document.body.append(destination);
	});
	await page
		.getByRole("textbox", { name: "Plain text destination", exact: true })
		.focus();
	await page.keyboard.press("Control+v");
	expect(
		JSON.parse(
			await page
				.getByRole("textbox", { name: "Plain text destination", exact: true })
				.inputValue(),
		).format,
	).toBe("ecad-symbol");
	await page
		.getByRole("textbox", { name: "Image destination", exact: true })
		.focus();
	await page.keyboard.press("Control+v");
	await expect(page.getByAltText("Pasted resistor")).toBeVisible();
	await page
		.getByRole("textbox", { name: "Plain text destination", exact: true })
		.evaluate((node) => {
			node.scrollTop = 0;
		});
	await page.screenshot({ path: "/tmp/ecad-rich-clipboard.png" });
});

test("HTML preserves editable geometry when custom types are stripped", async ({
	page,
}) => {
	const original = await documentState(page);
	await page.keyboard.press("Control+c");
	await copiedSelection(page);
	await page.evaluate(async () => {
		const [item] = await navigator.clipboard.read();
		await navigator.clipboard.write([
			new ClipboardItem({
				"text/html": await item.getType("text/html"),
				"text/plain": await item.getType("text/plain"),
			}),
		]);
	});
	await page.keyboard.press("Control+v");
	await expect.poll(() => lastReference(page)).toBe("R2");
	const pasted = (await documentState(page)).shapes[1];
	expect(pasted.kind).toBe("symbol");
	expect(pasted.width).toBe(original.shapes[0].width);
	expect(pasted.rotation).toBe(original.shapes[0].rotation);
});

test("text fields keep native clipboard behavior and cancel unfinished image copies", async ({
	page,
}) => {
	await page.evaluate(() => {
		const encode = HTMLCanvasElement.prototype.toBlob;
		HTMLCanvasElement.prototype.toBlob = function (callback, ...args) {
			setTimeout(() => encode.call(this, callback, ...args), 500);
		};
	});
	await page.keyboard.press("Control+c");
	const reference = page.getByRole("textbox", {
		name: "Reference",
		exact: true,
	});
	await reference.selectText();
	await reference.press("Control+c");
	await page.waitForTimeout(750);
	expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("R1");
	const before = await documentState(page);
	await reference.press("Control+v");
	await expect(reference).toHaveValue("R1");
	expect(await documentState(page)).toEqual(before);
	await page.locator("canvas").focus();
	await page.keyboard.press("Control+v");
	expect(await documentState(page)).toEqual(before);
});

test("unavailable and denied image writes preserve native data and save-file fallback", async ({
	page,
}) => {
	await page.evaluate(() =>
		Object.defineProperty(navigator.clipboard, "write", {
			configurable: true,
			value: () =>
				Promise.reject(new DOMException("Denied", "NotAllowedError")),
		}),
	);
	await page.keyboard.press("Control+x");
	await expect
		.poll(async () => (await documentState(page)).shapes.length)
		.toBe(0);
	expect(
		JSON.parse(await page.evaluate(() => navigator.clipboard.readText()))
			.format,
	).toBe("ecad-symbol");
	await expect(page.getByRole("alert")).toContainText(
		"Editable data and save-file text are still available",
	);
	await page.keyboard.press("Control+v");
	await expect
		.poll(async () => (await documentState(page)).shapes.length)
		.toBe(1);
	await page.evaluate(() =>
		Object.defineProperty(navigator.clipboard, "write", {
			configurable: true,
			value: undefined,
		}),
	);
	await page.keyboard.press("Control+c");
	const file = await page.evaluate(() => navigator.clipboard.readText());
	expect(JSON.parse(file).format).toBe("ecad-symbol");
	await page.evaluate((text) => navigator.clipboard.writeText(text), file);
	await page.keyboard.press("Control+v");
	await expect
		.poll(async () => (await documentState(page)).shapes.length)
		.toBe(2);
});
