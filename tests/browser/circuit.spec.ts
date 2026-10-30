import { captureArtifacts } from "./artifacts";
import { expect, test, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { closeProjectFiles, openProjectFiles } from "./project-files";

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
	await expect(page.getByLabel("Workspace instructions", { exact: true })).toBeVisible();
	await expect((await openProjectFiles(page)).getByRole("button", { name: "Add file", exact: true })).toBeEnabled();
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
	await expect(page.locator(".circuit-editor")).toHaveAttribute("data-pending-changes", "false");
	const initial = await state(page);
	await dragPins(page, "R1.1", "R2.1");
	await expect(page.locator("[data-connection-preview]")).toBeVisible();
	await expect(
		page.getByRole("button", { name: "Pin R2.1", exact: true }).locator(".."),
	).toHaveClass(/is-target/);
	expect(await state(page)).toEqual(initial);
	await mkdir(resolve("/tmp/ecad-shared-schematic"), { recursive: true });
	if (captureArtifacts)
		await page.screenshot({
			path: resolve("/tmp/ecad-shared-schematic/circuit-pin-drag-preview.png"),
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
	await expect(page.locator(".circuit-editor")).toHaveAttribute("data-pending-changes", "false");
	const saved = await state(page);
	expect(saved.circuit.nets).toEqual(merged.circuit.nets);
	if (captureArtifacts)
		await page.screenshot({
			path: resolve("/tmp/ecad-shared-schematic/circuit-pin-drag-connected.png"),
			fullPage: true,
		});
	await page.reload();
	await (await openProjectFiles(page))
		.getByRole("link", { name: "Open LED driver.ecaddraw in circuit view", exact: true })
		.click();
	expect((await state(page)).circuit).toEqual(saved.circuit);
});

test("an autosave completing during a pin drag preserves the connection gesture", async ({page}) => {
	await createCircuit(page);
	await placeComponent(page, "Resistor", {x:300,y:230});
	await expect.poll(async () => (await state(page)).circuit.components[0]?.schematicShapeId).toBeGreaterThan(0);
	await expect(page.locator(".circuit-editor")).toHaveAttribute("data-pending-changes", "false");
	await page.evaluate(() => {
		const state = window as typeof window & {savePending?: boolean; releaseSave?: () => void};
		const original = FileSystemFileHandle.prototype.createWritable;
		let hold = true;
		FileSystemFileHandle.prototype.createWritable = async function(options) {
			const writable = await original.call(this, options);
			if (this.name === ".ecadprj" && hold) {
				hold = false;
				state.savePending = true;
				await new Promise<void>(resolve => {state.releaseSave = () => {FileSystemFileHandle.prototype.createWritable = original; resolve();};});
			}
			return writable;
		};
	});
	await placeComponent(page, "Resistor", {x:650,y:400});
	await page.waitForFunction(() => (window as typeof window & {savePending?: boolean}).savePending);
	await dragPins(page, "R1.1", "R2.1");
	await expect(page.locator("[data-connection-preview]")).toBeVisible();
	await page.evaluate(() => (window as typeof window & {releaseSave: () => void}).releaseSave());
	await expect(page.locator(".circuit-editor")).toHaveAttribute("data-pending-changes", "false");
	await expect(page.locator("[data-connection-preview]")).toBeVisible();
	await page.mouse.up();
	await expect.poll(async () => (await state(page)).circuit.nets.length).toBe(1);
	await dragPins(page, "R1.2", "R2.2");
	await page.mouse.up();
	await expect.poll(async () => (await state(page)).circuit.nets.length).toBe(2);
	await expect(page.locator(".circuit-editor")).toHaveAttribute("data-pending-changes", "false");
	const saved = (await state(page)).circuit;
	if (process.env.ECAD_SCREENSHOT_PATH) await page.screenshot({path:process.env.ECAD_SCREENSHOT_PATH});
	await page.reload();
	await (await openProjectFiles(page)).getByRole("link", {name:"Open LED driver.ecaddraw in circuit view",exact:true}).click();
	expect((await state(page)).circuit).toEqual(saved);
});

test("component picker excludes net symbols while retaining ordinary components", async ({ page }) => {
 await createCircuit(page);
 await page.getByRole("button", { name: "Components", exact: true }).click();
 const search = page.getByRole("searchbox", { name: "Search components", exact: true });
 for (const name of ["Ground", "VDD", "VCC"]) {
  await search.fill(name);
  await expect(page.getByRole("button", { name: `Place ${name}`, exact: true })).toHaveCount(0);
  if (captureArtifacts && name === "Ground") await page.screenshot({ path: resolve("/tmp/ecad-browser-artifacts", test.info().testId, "circuit-net-symbol-filter.png") });
 }
 await search.fill("Resistor");
 await expect(page.getByRole("button", { name: "Place Resistor", exact: true })).toBeVisible();
});
