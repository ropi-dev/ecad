import { expect, test } from "@playwright/test";
import { required } from "../helpers/required.ts";
import { toolbarButton } from "./toolbar";

const hints = '[data-slot="button-shortcut"]';

test.beforeEach(async ({ page }) => {
	await page.goto("/tests/browser/editor.html");
	await expect(
		page.getByRole("button", { name: "Shapes", exact: true }),
	).toBeEnabled();
});

test("Ctrl shows separate hints for every visible button and activates a group", async ({
	page,
}) => {
	await expect(page.locator(hints)).toHaveCount(0);
	await page.keyboard.down("Control");
	await expect(page.locator(hints).first()).toBeVisible();
	const buttons = await page.locator("button:visible").count();
	await expect(page.locator(hints)).toHaveCount(buttons);
	const shapes = page.getByRole("button", { name: "Shapes", exact: true });
	const key = await page
		.locator(`${hints}[title="Shapes"]`)
		.getAttribute("data-shortcut");
	expect(key).toBeTruthy();
	await page.keyboard.press(required(key));
	await expect(shapes).toHaveAttribute("aria-expanded", "true");
	await expect(page.locator(`${hints}[title="Rectangle"]`)).toBeVisible();
	await page.keyboard.press(required(key));
	await expect(page.locator(`${hints}[title="Rectangle"]`)).toHaveCount(0);
	await page.keyboard.press(required(key));
	await expect(page.locator(`${hints}[title="Rectangle"]`)).toHaveAttribute(
		"data-shortcut",
		"R",
	);
	await page.keyboard.up("Control");
	await expect(page.locator(hints)).toHaveCount(0);
});

test("hints reset on blur and disabled buttons cannot activate", async ({
	page,
}) => {
	await page.keyboard.down("Control");
	await expect(page.locator(hints).first()).toBeVisible();
	const disabled = page.locator(`${hints}[data-disabled="true"]`).first();
	await expect(disabled).toBeVisible();
	const key = await disabled.getAttribute("data-shortcut");
	const before = await page.locator("#editor-document").textContent();
	await page.keyboard.press(required(key));
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

test("sidebar needs Ctrl+Shift while Ctrl reveals both scopes", async ({
	page,
}) => {
	await page.goto("/tests/browser/projects.html");
	const { openProjectFiles } = await import("./project-files");
	const sidebar = await openProjectFiles(page);
	await sidebar
		.getByRole("button", { name: "Pin sidebar", exact: true })
		.click();
	await page.keyboard.down("Control");
	const hint = page.locator(`${hints}[title="Compact sidebar"]`);
	await expect(hint).toBeVisible();
	await expect(hint.locator('[data-slot="shift-icon"]')).toBeVisible();
	await expect(hint.locator('[data-slot="modifier-icon"]')).toBeVisible();
	await expect(hint.locator('[data-slot="modifier-icon"]')).toHaveClass(
		/lucide-chevron-up/,
	);
	await expect(hint.locator('[data-slot="shift-icon"]')).toHaveClass(
		/lucide-arrow-big-up/,
	);
	const centers = await hint.locator("svg path").evaluateAll((paths) =>
		paths.map((path) => {
			const shape = path as SVGPathElement;
			const bounds = shape.getBBox();
			return new DOMPoint(
				bounds.x,
				bounds.y + bounds.height / 2,
			).matrixTransform(
				shape.getScreenCTM() ??
					(() => {
						throw new Error("Expected a value");
					})(),
			).y;
		}),
	);
	expect(Math.abs(centers[0] - centers[1])).toBeLessThan(0.1);
	const middle = await hint.evaluate((element) => {
		const bounds = element.getBoundingClientRect();
		return bounds.top + bounds.height / 2;
	});
	for (const center of centers)
		expect(Math.abs(center - middle)).toBeLessThan(0.1);
	const letterMiddle = await hint
		.locator(":scope > span")
		.evaluate((element) => {
			const bounds = element.getBoundingClientRect();
			return bounds.top + bounds.height / 2;
		});
	expect(Math.abs(letterMiddle - middle)).toBeLessThan(0.1);
	const key = await hint.getAttribute("data-shortcut");
	await page.keyboard.press(required(key));
	await expect(sidebar).toHaveAttribute("data-pinned", "true");
	await page.keyboard.down("Shift");
	await page.keyboard.press(required(key));
	await expect(sidebar).toHaveAttribute("data-pinned", "false");
	await page.keyboard.up("Shift");
	await expect(page.locator(hints).first()).toBeVisible();
	await page.keyboard.up("Control");
	await expect(page.locator(hints)).toHaveCount(0);
});

test("single-key hints fit beside each other and stay aligned with each toolbar row", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1440, height: 950 });
	await page.goto("/tests/browser/projects.html");
	const { openProjectFiles } = await import("./project-files");
	const sidebar = await openProjectFiles(page);
	await sidebar
		.getByRole("button", { name: "Pin sidebar", exact: true })
		.click();
	await sidebar
		.getByRole("link", { name: "Open Untitled.ecaddraw", exact: true })
		.click();
	await page.getByRole("button", { name: "Shapes", exact: true }).click();
	await page.mouse.move(600, 300);
	await page.keyboard.down("Control");
	await expect(page.locator(`${hints}[title="Rectangle"]`)).toHaveAttribute(
		"data-shortcut",
		"R",
	);
	const layout = await page.locator(hints).evaluateAll((elements) => {
		const boxes = elements.map((element) => element.getBoundingClientRect());
		const overlaps = [];
		for (let i = 0; i < boxes.length; i++) {
			for (let j = i + 1; j < boxes.length; j++) {
				const a = boxes[i],
					b = boxes[j];
				if (
					a.left < b.right &&
					a.right > b.left &&
					a.top < b.bottom &&
					a.bottom > b.top
				)
					overlaps.push([
						elements[i].getAttribute("title"),
						elements[j].getAttribute("title"),
					]);
			}
		}
		return {
			overlaps,
			keys: elements.map((element) => element.getAttribute("data-shortcut")),
			text: elements.map((element) => element.textContent),
		};
	});
	expect(layout.overlaps).toEqual([]);
	expect(layout.keys.every((key) => key?.length === 1)).toBe(true);
	expect(layout.text.every((text) => !text?.includes("Ctrl"))).toBe(true);
	await page.keyboard.up("Control");
});

test("Ctrl+Plus zooms the editor when Shift produces the plus character", async ({
	page,
}) => {
	const fit = page.getByRole("button", { name: "Fit drawing", exact: true });
	const before = await fit.textContent();
	await page.keyboard.press("Control+Shift+Equal");
	await expect(fit).not.toHaveText(required(before));
});

test("Undo and Redo follow the key labels on a QWERTZ layout", async ({
	page,
}) => {
	await (await toolbarButton(page, "Rectangle")).click();
	await page.mouse.move(600, 300);
	await page.mouse.down();
	await page.mouse.move(710, 400);
	await page.mouse.up();
	await page.keyboard.press("Escape");
	const shapes = async () =>
		JSON.parse(required(await page.locator("#editor-document").textContent()))
			.shapes;
	await expect.poll(async () => (await shapes()).length).toBe(1);
	await expect(
		page.getByRole("button", { name: "Undo", exact: true }),
	).toBeEnabled();
	await page.keyboard.down("Control");
	await page
		.locator("body")
		.dispatchEvent("keydown", { key: "z", code: "KeyY", ctrlKey: true });
	await expect.poll(async () => (await shapes()).length).toBe(0);
	await page
		.locator("body")
		.dispatchEvent("keydown", { key: "y", code: "KeyZ", ctrlKey: true });
	await expect.poll(async () => (await shapes()).length).toBe(1);
	await page.keyboard.up("Control");
});

test("Radix dialogs hide background hints and block background Delete", async ({
	page,
}) => {
	await page.goto("/tests/browser/projects.html");
	const { openProjectFiles } = await import("./project-files");
	const sidebar = await openProjectFiles(page);
	await sidebar
		.getByRole("button", { name: "Pin sidebar", exact: true })
		.click();
	await sidebar
		.getByRole("link", { name: "Open Untitled.ecaddraw", exact: true })
		.click();
	await (await toolbarButton(page, "Rectangle")).click();
	await page.mouse.move(600, 300);
	await page.mouse.down();
	await page.mouse.move(710, 400);
	await page.mouse.up();
	await expect(
		page.getByRole("button", { name: "Delete", exact: true }),
	).toBeEnabled();
	const shapes = async () =>
		JSON.parse(required(await page.locator("#project-document").textContent()))
			.editorShapes;
	const before = await shapes();
	expect(before).toHaveLength(1);
	await sidebar.getByRole("button", { name: "Add file", exact: true }).click();
	await page
		.getByRole("menuitem", { name: "New drawing", exact: true })
		.click();
	const dialog = page.getByRole("dialog");
	await expect(dialog).toBeVisible();
	await expect(dialog).not.toHaveAttribute("aria-modal");
	await page.keyboard.down("Control");
	await expect(page.locator(hints).first()).toBeVisible();
	await expect(page.locator(`${hints}[title="Delete"]`)).toHaveCount(0);
	await expect(page.locator(hints)).toHaveCount(
		await dialog.getByRole("button").count(),
	);
	await page
		.locator("body")
		.dispatchEvent("keydown", { key: "d", code: "KeyD", ctrlKey: true });
	expect(await shapes()).toEqual(before);
	await page.keyboard.up("Control");
});

for (const label of ["Add file", "Project actions"]) {
	test(`sidebar shortcut opens the ${label} dropdown`, async ({ page }) => {
		await page.goto("/tests/browser/projects.html");
		const { openProjectFiles } = await import("./project-files");
		const sidebar = await openProjectFiles(page);
		await sidebar
			.getByRole("button", { name: "Pin sidebar", exact: true })
			.click();
		await page.keyboard.down("Control");
		const hint = page.locator(`${hints}[title="${label}"]`);
		await expect(hint).toBeVisible();
		const key = await hint.getAttribute("data-shortcut");
		await page.keyboard.down("Shift");
		await page.keyboard.press(required(key));
		await expect(
			page.getByRole("menu", { name: label, exact: true }),
		).toBeVisible();
		await expect(
			sidebar.getByRole("button", {
				name: label,
				exact: true,
				includeHidden: true,
			}),
		).toHaveAttribute("aria-expanded", "true");
		await page.keyboard.up("Shift");
		await page.keyboard.up("Control");
	});
}

for (const platform of ["MacIntel", "Win32", "Linux x86_64"]) {
	test(`${platform} uses its primary modifier for hints and actions`, async ({
		page,
	}) => {
		await page.addInitScript((platform) => {
			Object.defineProperty(navigator, "platform", { value: platform });
		}, platform);
		await page.reload();
		const mac = platform === "MacIntel";
		const modifier = mac ? "Meta" : "Control";
		const other = mac ? "Control" : "Meta";
		await expect(
			page.getByRole("button", { name: "Shapes", exact: true }),
		).toBeEnabled();
		await page.keyboard.down(other);
		await expect(page.locator(hints)).toHaveCount(0);
		await page.keyboard.up(other);
		await page.keyboard.down(modifier);
		const shapes = page.locator(`${hints}[title="Shapes"]`);
		await expect(shapes).toHaveAttribute("aria-label", `${modifier}+S`);
		await expect(shapes.locator('[data-slot="modifier-icon"]')).toHaveClass(
			mac ? /lucide-command/ : /lucide-chevron-up/,
		);
		await page.keyboard.press("s");
		await expect(
			page.getByRole("toolbar", { name: "Shapes toolbar", exact: true }),
		).toBeVisible();
		await expect(page.locator(`${hints}[title="Rectangle"]`)).toBeVisible();
		await page.screenshot({
			path: `/tmp/ecad-shortcuts-${platform.split(" ")[0]}.png`,
		});
		await page.keyboard.up(modifier);
		await expect(page.locator(hints)).toHaveCount(0);
		await page.keyboard.down(modifier);
		await expect(shapes).toBeVisible();
		await page.evaluate(() => window.dispatchEvent(new Event("blur")));
		await expect(page.locator(hints)).toHaveCount(0);
		await page.keyboard.up(modifier);

		await page.goto("/tests/browser/projects.html");
		await expect(
			page.getByLabel("Workspace instructions", { exact: true }),
		).toContainText(mac ? "⌘+Shift+S" : "Ctrl+Shift+S");
		const sidebar = page.getByRole("complementary", {
			name: "Project files",
			exact: true,
			includeHidden: true,
		});
		await page.keyboard.press(`${other}+Shift+s`);
		await expect(sidebar).toHaveAttribute("data-pinned", "false");
		await page.keyboard.press(`${modifier}+Shift+s`);
		await expect(sidebar).toHaveAttribute("data-pinned", "true");
		await expect(
			sidebar.getByRole("button", { name: "Compact sidebar", exact: true }),
		).toHaveAttribute("aria-keyshortcuts", `${modifier}+Shift+S`);
		await sidebar.getByLabel("Search project files").focus();
		await page.keyboard.press(`${modifier}+Shift+s`);
		await expect(sidebar).toHaveAttribute("data-pinned", "false");
	});
}

test("macOS reserves Quit, Hide and Minimize in preferred and fallback assignments", async ({
	page,
}) => {
	await page.addInitScript(() => {
		Object.defineProperty(navigator, "platform", { value: "MacIntel" });
	});
	await page.reload();
	await expect(
		page.getByRole("button", { name: "Shapes", exact: true }),
	).toBeEnabled();
	await page.getByRole("button", { name: "Pan", exact: true }).click();
	await page.keyboard.down("Meta");
	await expect(page.locator(`${hints}[title="Select"]`)).toHaveAttribute(
		"data-shortcut",
		"2",
	);
	await expect(page.locator(`${hints}[title="Export"]`)).toHaveAttribute(
		"data-shortcut",
		"B",
	);
	await page.keyboard.press("b");
	await expect(
		page.getByRole("toolbar", { name: "Export toolbar", exact: true }),
	).toBeVisible();
	await page.keyboard.press("2");
	await expect(
		page.getByRole("button", { name: "Select", exact: true }),
	).toHaveAttribute("aria-pressed", "true");
	await expect(
		page.locator(
			`${hints}[data-shortcut="Q"], ${hints}[data-shortcut="H"], ${hints}[data-shortcut="M"]`,
		),
	).toHaveCount(0);
	await page.screenshot({ path: "/tmp/ecad-shortcuts-macos-reserved.png" });
	await page.keyboard.up("Meta");
	await page.evaluate(() => {
		const dialog = document.createElement("dialog");
		for (const scope of ["editor", "sidebar"]) {
			const group = document.createElement("div");
			group.dataset.shortcutScope = scope;
			for (const label of ["Q", "H", "M"]) {
				const button = document.createElement("button");
				button.textContent = label;
				group.append(button);
			}
			dialog.append(group);
		}
		document.body.append(dialog);
		dialog.showModal();
	});
	await page.keyboard.down("Meta");
	await expect(page.locator(hints)).toHaveCount(6);
	await expect(
		page.locator(
			`${hints}[data-shortcut="Q"], ${hints}[data-shortcut="H"], ${hints}[data-shortcut="M"]`,
		),
	).toHaveCount(0);
	const nativeEvents = await page.evaluate(() =>
		[false, true].flatMap((shiftKey) =>
			["q", "h", "m"].map((key) => {
				const event = new KeyboardEvent("keydown", {
					key,
					metaKey: true,
					shiftKey,
					bubbles: true,
					cancelable: true,
				});
				window.dispatchEvent(event);
				return event.defaultPrevented;
			}),
		),
	);
	expect(nativeEvents).toEqual([false, false, false, false, false, false]);
	await page.keyboard.up("Meta");
});
