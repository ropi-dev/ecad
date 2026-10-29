import { captureArtifacts } from "./artifacts";
import { expect, test, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { closeProjectFiles, openProjectFiles } from "./project-files";
import { toolbarButton } from "./toolbar";

const state = async (page: Page) =>
	JSON.parse((await page.locator("#circuit-document").textContent()) ?? "{}");
async function placeComponent(
	page: Page,
	name: string,
	position = { x: 350, y: 250 },
) {
	await page.getByRole("button", { name: "Components", exact: true }).click();
	await page
		.getByRole("searchbox", { name: "Search components", exact: true })
		.fill(name);
	await page
		.getByRole("button", { name: `Place ${name}`, exact: true })
		.click();
	await page
		.getByLabel("Circuit connections graph", { exact: true })
		.click({ position });
}
async function createCircuit(page: Page) {
	await page.goto("/tests/browser/projects.html");
	await closeProjectFiles(page);
	await page.getByLabel("Project name", { exact: true }).fill("Graph project");
	await page
		.getByRole("button", { name: "Create project", exact: true })
		.click();
	await expect(page.getByLabel("Project save status")).toHaveText("Saved");
	await openProjectFiles(page);
	await page.getByRole("button", { name: "Add file", exact: true }).click();
	await page
		.getByRole("menuitem", { name: "New circuit", exact: true })
		.click();
	await page.getByLabel("Circuit name", { exact: true }).fill("LED driver");
	await page
		.getByRole("button", { name: "Create circuit", exact: true })
		.click();
	await expect(
		page.getByRole("heading", { name: "LED driver", exact: true }),
	).toBeAttached();
	await closeProjectFiles(page);
}

test("circuit graph edits connectivity, preserves it through layout moves, and reloads electrical data", async ({
	page,
}) => {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	await createCircuit(page);
	await page
		.getByRole("button", { name: "Add LED example", exact: true })
		.click();
	await expect(
		page.getByRole("button", { name: "Net GND", exact: true }),
	).toBeVisible();
	await expect(
		page.getByRole("button", { name: "Select component D2", exact: true }),
	).toBeVisible();
	await expect(
		page.getByRole("button", { name: "Net LED2_DRIVE", exact: true }),
	).toBeVisible();
	const canvas = page.getByLabel("Circuit connections graph", { exact: true });
	const canvasBox = await canvas.boundingBox();
	const editorBox = await page
		.getByRole("region", { name: "Circuit editor", exact: true })
		.boundingBox();
	expect(canvasBox?.y).toBe(editorBox?.y);
	expect(canvasBox?.width).toBe(editorBox?.width);
	expect(canvasBox?.height).toBe(editorBox?.height);
	await expect(page.locator(".circuit-header, .circuit-toolbar")).toHaveCount(
		0,
	);
	const original = await state(page);
	const initialView = await canvas.getAttribute("viewBox");
	await page.getByRole("button", { name: "Pan", exact: true }).click();
	await page.mouse.move(canvasBox!.x + 20, canvasBox!.y + 20);
	await page.mouse.down();
	await page.mouse.move(canvasBox!.x + 80, canvasBox!.y + 60, { steps: 4 });
	await page.mouse.up();
	await expect(canvas).not.toHaveAttribute("viewBox", initialView!);
	expect(await state(page)).toEqual(original);
	await page.mouse.move(canvasBox!.x + 80, canvasBox!.y + 60);
	await page.mouse.down();
	await page.mouse.move(canvasBox!.x + 20, canvasBox!.y + 20, { steps: 4 });
	await page.mouse.up();
	await page.getByRole("button", { name: "Select", exact: true }).click();
	const component = page.getByRole("button", {
		name: "Select component R1",
		exact: true,
	});
	await component.focus();
	await component.press("ArrowDown");
	await expect
		.poll(async () => (await state(page)).graph)
		.not.toEqual(original.graph);
	expect((await state(page)).circuit).toEqual(original.circuit);
	await (await toolbarButton(page, "Undo")).click();
	expect((await state(page)).graph).toEqual(original.graph);
	await (await toolbarButton(page, "Redo")).click();
	const box = await component.boundingBox();
	if (!box) throw new Error("Missing component bounds.");
	await page.mouse.move(box.x + box.width / 2, box.y + 12);
	await page.mouse.down();
	await page.mouse.move(box.x + box.width / 2 + 35, box.y + 42, { steps: 4 });
	await page.mouse.up();
	expect((await state(page)).circuit).toEqual(original.circuit);
	await expect(
		page.getByRole("complementary", { name: "Circuit inspector" }),
	).toHaveCount(0);
	await page.getByRole("button", { name: "Net GND", exact: true }).dblclick();
	await page
		.getByRole("textbox", { name: "Net name", exact: true })
		.fill("GROUND");
	await page.getByRole("button", { name: "Add alias", exact: true }).click();
	await page
		.getByRole("textbox", { name: "Net alias 1", exact: true })
		.fill("GND");
	await page
		.getByRole("textbox", { name: "Net name", exact: true })
		.press("Enter");
	await expect(
		page.getByRole("button", { name: "Net GROUND", exact: true }),
	).toBeVisible();
	await expect(page.getByLabel("Circuit save status")).toHaveText("Saved");
	const saved = await state(page);
	await mkdir(resolve("test-results/screenshots"), { recursive: true });
	if (captureArtifacts)
		await page.screenshot({
			path: resolve("test-results/screenshots/circuit-editor.png"),
			fullPage: true,
		});
	await page.reload();
	await (await openProjectFiles(page))
		.getByRole("link", { name: "Open LED driver", exact: true })
		.click();
	await expect(
		page.getByRole("button", { name: "Net GROUND", exact: true }),
	).toBeVisible();
	expect((await state(page)).circuit).toEqual(saved.circuit);
	expect(errors).toEqual([]);
});

async function pinCenter(page: Page, name: string) {
	const box = await page
		.getByRole("button", { name: `Pin ${name}`, exact: true })
		.locator("circle")
		.boundingBox();
	if (!box) throw new Error(`Missing pin ${name}.`);
	return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function dragPins(page: Page, source: string, target: string) {
	const from = await pinCenter(page, source);
	const to = await pinCenter(page, target);
	await page.mouse.move(from.x, from.y);
	await page.mouse.down();
	await page.mouse.move(to.x, to.y, { steps: 6 });
}

test("dragging between pins creates and merges nets with preview, undo, and autosave", async ({
	page,
}) => {
	await createCircuit(page);
	await placeComponent(page, "Resistor", { x: 300, y: 230 });
	await placeComponent(page, "Resistor", { x: 650, y: 400 });
	const initial = await state(page);
	await dragPins(page, "R1.1", "R2.1");
	await expect(page.locator("[data-connection-preview]")).toBeVisible();
	await expect(
		page.getByRole("button", { name: "Pin R2.1", exact: true }).locator(".."),
	).toHaveClass(/is-target/);
	expect(await state(page)).toEqual(initial);
	await mkdir(resolve("test-results/screenshots"), { recursive: true });
	if (captureArtifacts)
		await page.screenshot({
			path: resolve("test-results/screenshots/circuit-pin-drag-preview.png"),
			fullPage: true,
		});
	await page.mouse.up();
	await expect(page.locator("[data-connection-preview]")).toHaveCount(0);
	const first = await state(page);
	expect(first.circuit.nets).toHaveLength(1);
	expect(first.circuit.nets[0].pinIds).toEqual(
		expect.arrayContaining([
			initial.circuit.components[0].pins[0].id,
			initial.circuit.components[1].pins[0].id,
		]),
	);
	expect(first.graph).toEqual(initial.graph);
	await page.keyboard.press("Control+z");
	expect(await state(page)).toEqual(initial);
	await page.keyboard.press("Control+Shift+z");
	expect(await state(page)).toEqual(first);
	await dragPins(page, "R1.2", "R2.2");
	await page.mouse.up();
	const separate = await state(page);
	expect(separate.circuit.nets).toHaveLength(2);
	await page.getByRole("button", { name: "Zoom in", exact: true }).click();
	await dragPins(page, "R1.1", "R2.2");
	await page.mouse.up();
	const merged = await state(page);
	expect(merged.circuit.nets).toHaveLength(1);
	expect(merged.circuit.nets[0].pinIds).toHaveLength(4);
	await page.keyboard.press("Control+z");
	expect(await state(page)).toEqual(separate);
	await page.keyboard.press("Control+Shift+z");
	expect(await state(page)).toEqual(merged);
	await dragPins(page, "R1.1", "R2.1");
	await page.mouse.up();
	expect(await state(page)).toEqual(merged);
	await expect(page.getByLabel("Circuit save status")).toHaveText("Saved");
	if (captureArtifacts)
		await page.screenshot({
			path: resolve("test-results/screenshots/circuit-pin-drag-connected.png"),
			fullPage: true,
		});
	await page.reload();
	await (await openProjectFiles(page))
		.getByRole("link", { name: "Open LED driver", exact: true })
		.click();
	expect((await state(page)).circuit).toEqual(merged.circuit);
});

test("pin connection drags cancel on empty space, the source pin, Escape, or pointer cancellation", async ({
	page,
}) => {
	await createCircuit(page);
	await page
		.getByRole("button", { name: "Add LED example", exact: true })
		.click();
	const original = await state(page);
	const canvas = page.getByLabel("Circuit connections graph", { exact: true });
	const box = await canvas.boundingBox();
	if (!box) throw new Error("Missing graph bounds.");
	for (const cancellation of ["empty", "source", "escape", "pointercancel"]) {
		const from = await pinCenter(page, "J1.1");
		await page.mouse.move(from.x, from.y);
		await page.mouse.down();
		await page.mouse.move(box.x + 30, box.y + 30, { steps: 5 });
		await expect(page.locator("[data-connection-preview]")).toBeVisible();
		if (cancellation === "source") await page.mouse.move(from.x, from.y);
		if (cancellation === "escape") await page.keyboard.press("Escape");
		if (cancellation === "pointercancel")
			await canvas.dispatchEvent("pointercancel", { pointerId: 1 });
		await page.mouse.up();
		await expect(page.locator("[data-connection-preview]")).toHaveCount(0);
		expect(await state(page)).toEqual(original);
	}
	await page.getByRole("button", { name: "Pin J1.1", exact: true }).click();
	await expect(
		page.getByRole("button", { name: "Pin J1.1", exact: true }).locator(".."),
	).toHaveClass(/is-selected/);
});

test("a delayed circuit open cannot override a later drawing or circuit selection", async ({
	page,
}) => {
	await createCircuit(page);
	await openProjectFiles(page);
	await page.getByRole("button", { name: "Add file", exact: true }).click();
	await page
		.getByRole("menuitem", { name: "New circuit", exact: true })
		.click();
	await page.getByLabel("Circuit name", { exact: true }).fill("Second circuit");
	await page
		.getByRole("button", { name: "Create circuit", exact: true })
		.click();
	await expect(
		page.getByRole("heading", { name: "Second circuit", exact: true }),
	).toBeAttached();
	await expect(page.getByLabel("Circuit save status")).toHaveText("Saved");
	await page.reload();
	await openProjectFiles(page);
	let release = () => {};
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	await page.route("**/circuit/store.ts*", async (route) => {
		await gate;
		await route.continue();
	});
	const requested = page.waitForRequest((request) =>
		request.url().includes("/circuit/store.ts"),
	);
	await page
		.getByRole("link", { name: "Open LED driver", exact: true })
		.click();
	const request = await requested;
	await page.getByRole("link", { name: "Open Drawing", exact: true }).click();
	release();
	await request.response();
	await page.waitForLoadState("networkidle");
	await expect(
		page.getByLabel("Circuit connections graph", { exact: true }),
	).toHaveCount(0);
	await page.evaluate(() => {
		(
			document.querySelector(
				'a[aria-label="Open LED driver"]',
			) as HTMLAnchorElement
		).click();
		(
			document.querySelector(
				'a[aria-label="Open Second circuit"]',
			) as HTMLAnchorElement
		).click();
	});
	await expect(
		page.getByRole("heading", { name: "Second circuit", exact: true }),
	).toBeAttached();
	expect((await state(page)).circuit.name).toBe("Second circuit");
});

test("keyboard-only component and net placement supports snapping, cancellation, undo, and reload", async ({
	page,
}) => {
	await createCircuit(page);
	const canvas = page.getByLabel("Circuit connections graph", { exact: true });
	await page.getByRole("button", { name: "Components", exact: true }).focus();
	await page.keyboard.press("Enter");
	await page
		.getByRole("searchbox", { name: "Search components", exact: true })
		.fill("Resistor");
	await page.keyboard.press("Tab");
	await expect(
		page.getByRole("button", { name: "Place Resistor", exact: true }),
	).toBeFocused();
	await page.keyboard.press("Enter");
	await expect(canvas).toBeFocused();
	const before = await page
		.locator("[data-component-preview]")
		.getAttribute("transform");
	await page.keyboard.press("ArrowRight");
	await page.keyboard.press("ArrowDown");
	const preview = await page
		.locator("[data-component-preview]")
		.getAttribute("transform");
	expect(preview).not.toBe(before);
	await page.keyboard.press("Enter");
	expect((await state(page)).circuit.components).toHaveLength(1);
	await page.keyboard.press("Control+z");
	expect((await state(page)).circuit.components).toHaveLength(0);
	await page.keyboard.press("Control+Shift+z");
	expect((await state(page)).circuit.components).toHaveLength(1);
	const add = page.getByRole("button", { name: "Add net", exact: true });
	await add.focus();
	await page.keyboard.press("Enter");
	await expect(canvas).toBeFocused();
	await page.keyboard.press("Escape");
	expect((await state(page)).circuit.nets).toHaveLength(0);
	await add.focus();
	await page.keyboard.press("Enter");
	await expect(canvas).toBeFocused();
	await page.keyboard.press("Shift+ArrowLeft");
	await page.keyboard.press("Shift+ArrowLeft");
	await page.keyboard.press("Enter");
	await expect(
		page.getByRole("textbox", { name: "Net name", exact: true }),
	).toBeFocused();
	await page.keyboard.press("Escape");
	expect((await state(page)).circuit.nets).toHaveLength(1);
	await page.keyboard.press("Control+z");
	expect((await state(page)).circuit.nets).toHaveLength(0);
	await page.keyboard.press("Control+Shift+z");
	expect((await state(page)).circuit.nets).toHaveLength(1);
	await expect(page.getByLabel("Circuit save status")).toHaveText("Saved");
	const saved = await state(page);
	await page.reload();
	await (await openProjectFiles(page))
		.getByRole("link", { name: "Open LED driver", exact: true })
		.click();
	expect((await state(page)).circuit).toEqual(saved.circuit);
});
