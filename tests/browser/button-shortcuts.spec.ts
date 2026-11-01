import { expect, test } from "@playwright/test";

const hints = '[data-slot="button-shortcut"]';

test.beforeEach(async ({ page }) => {
	await page.goto("/tests/browser/editor.html");
	await expect(page.getByRole("button", { name: "Shapes", exact: true })).toBeEnabled();
});

test("Ctrl shows separate hints for every visible button and activates a group", async ({ page }) => {
	await expect(page.locator(hints)).toHaveCount(0);
	await page.keyboard.down("Control");
	await expect(page.locator(hints).first()).toBeVisible();
	const buttons = await page.locator("button:visible").count();
	await expect(page.locator(hints)).toHaveCount(buttons);
	const shapes = page.getByRole("button", { name: "Shapes", exact: true });
	const key = await page.locator(`${hints}[title="Shapes"]`).getAttribute("data-shortcut");
	expect(key).toBeTruthy();
	await page.keyboard.press(key!);
	await expect(shapes).toHaveAttribute("aria-expanded", "true");
	await expect(page.locator(`${hints}[title="Rectangle"]`)).toBeVisible();
	await page.keyboard.press(key!);
	await expect(page.locator(`${hints}[title="Rectangle"]`)).toHaveCount(0);
	await page.keyboard.press(key!);
	await expect(page.locator(`${hints}[title="Rectangle"]`)).toHaveAttribute("data-shortcut", "R");
	await page.keyboard.up("Control");
	await expect(page.locator(hints)).toHaveCount(0);
});

test("hints reset on blur and disabled buttons cannot activate", async ({ page }) => {
	await page.keyboard.down("Control");
	await expect(page.locator(hints).first()).toBeVisible();
	const disabled = page.locator(`${hints}[data-disabled="true"]`).first();
	await expect(disabled).toBeVisible();
	const key = await disabled.getAttribute("data-shortcut");
	const before = await page.locator("#editor-document").textContent();
	await page.keyboard.press(key!);
	expect(await page.locator("#editor-document").textContent()).toBe(before);
	await page.evaluate(() => window.dispatchEvent(new Event("blur")));
	await expect(page.locator(hints)).toHaveCount(0);
	await page.keyboard.up("Control");
	await page.keyboard.down("Control");
	await expect(page.locator(hints).first()).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(page.locator(hints)).toHaveCount(0);
	await page.keyboard.up("Control");
});

test("sidebar needs Ctrl+Shift while Ctrl reveals both scopes", async ({ page }) => {
	await page.goto("/tests/browser/projects.html");
	const { openProjectFiles } = await import("./project-files");
	const sidebar = await openProjectFiles(page);
	await sidebar.getByRole("button", { name: "Pin sidebar", exact: true }).click();
	await page.keyboard.down("Control");
	const hint = page.locator(`${hints}[title="Compact sidebar"]`);
	await expect(hint).toBeVisible();
	await expect(hint.locator('[data-slot="shift-icon"]')).toBeVisible();
	await expect(hint.locator('[data-slot="modifier-icon"]')).toBeVisible();
	await expect(hint.locator('[data-slot="modifier-icon"]')).toHaveClass(/lucide-chevron-up/);
	await expect(hint.locator('[data-slot="shift-icon"]')).toHaveClass(/lucide-arrow-big-up/);
	const centers = await hint.locator("svg path").evaluateAll((paths) => paths.map((path) => {
		const shape = path as SVGPathElement;
		const bounds = shape.getBBox();
		return new DOMPoint(bounds.x, bounds.y + bounds.height / 2).matrixTransform(shape.getScreenCTM()!).y;
	}));
	expect(Math.abs(centers[0] - centers[1])).toBeLessThan(0.1);
	const middle = await hint.evaluate((element) => {
		const bounds = element.getBoundingClientRect();
		return bounds.top + bounds.height / 2;
	});
	for (const center of centers) expect(Math.abs(center - middle)).toBeLessThan(0.1);
	const letterMiddle = await hint.locator(":scope > span").evaluate((element) => {
		const bounds = element.getBoundingClientRect();
		return bounds.top + bounds.height / 2;
	});
	expect(Math.abs(letterMiddle - middle)).toBeLessThan(0.1);
	const key = await hint.getAttribute("data-shortcut");
	await page.keyboard.press(key!);
	await expect(sidebar).toHaveAttribute("data-pinned", "true");
	await page.keyboard.down("Shift");
	await page.keyboard.press(key!);
	await expect(sidebar).toHaveAttribute("data-pinned", "false");
	await page.keyboard.up("Shift");
	await expect(page.locator(hints).first()).toBeVisible();
	await page.keyboard.up("Control");
	await expect(page.locator(hints)).toHaveCount(0);
});


test("single-key hints fit beside each other and stay aligned with each toolbar row", async ({ page }) => {
	await page.setViewportSize({ width: 1440, height: 950 });
	await page.goto("/tests/browser/projects.html");
	const { openProjectFiles } = await import("./project-files");
	const sidebar = await openProjectFiles(page);
	await sidebar.getByRole("button", { name: "Pin sidebar", exact: true }).click();
	await sidebar.getByRole("link", { name: "Open Untitled.ecaddraw", exact: true }).click();
	await page.getByRole("button", { name: "Shapes", exact: true }).click();
	await page.mouse.move(600, 300);
	await page.keyboard.down("Control");
	await expect(page.locator(`${hints}[title="Rectangle"]`)).toHaveAttribute("data-shortcut", "R");
	const layout = await page.locator(hints).evaluateAll((elements) => {
		const boxes = elements.map((element) => element.getBoundingClientRect());
		const overlaps = [];
		for (let i = 0; i < boxes.length; i++) {
			for (let j = i + 1; j < boxes.length; j++) {
				const a = boxes[i], b = boxes[j];
				if (a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top) overlaps.push([elements[i].getAttribute("title"), elements[j].getAttribute("title")]);
			}
		}
		return { overlaps, keys: elements.map((element) => element.getAttribute("data-shortcut")), text: elements.map((element) => element.textContent) };
	});
	expect(layout.overlaps).toEqual([]);
	expect(layout.keys.every((key) => key?.length === 1)).toBe(true);
	expect(layout.text.every((text) => !text?.includes("Ctrl"))).toBe(true);
	await page.keyboard.up("Control");
});
