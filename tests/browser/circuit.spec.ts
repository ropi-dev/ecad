import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import type { Page } from "@playwright/test";
import { captureArtifacts } from "./artifacts";
import {
	closeProjectFiles,
	openProjectFiles,
	projectRail,
} from "./project-files";
import { expect, test } from "./seeded-project";

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
	await expect(
		page.getByLabel("Workspace instructions", { exact: true }),
	).toBeVisible();
	const add = projectRail(page).getByRole("button", {
		name: "Add file",
		exact: true,
	});
	await expect(add).toBeEnabled();
	await add.click();
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
	await expect(page.locator(".circuit-editor")).toHaveAttribute(
		"data-pending-changes",
		"false",
	);
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
	await expect(page.locator(".circuit-editor")).toHaveAttribute(
		"data-pending-changes",
		"false",
	);
	const saved = await state(page);
	expect(saved.circuit.nets).toEqual(merged.circuit.nets);
	if (captureArtifacts)
		await page.screenshot({
			path: resolve(
				"/tmp/ecad-shared-schematic/circuit-pin-drag-connected.png",
			),
			fullPage: true,
		});
	await page.reload();
	await (await openProjectFiles(page))
		.getByRole("link", {
			name: "Open LED driver.ecaddraw in circuit view",
			exact: true,
		})
		.click();
	expect((await state(page)).circuit).toEqual(saved.circuit);
});

test("middle-drag pans the view while the component tool is placing", async ({
	page,
}) => {
	await createCircuit(page);
	const canvas = page.getByLabel("Circuit connections graph", {
		exact: true,
	});
	await page.getByRole("button", { name: "Components", exact: true }).click();
	await page
		.getByRole("searchbox", { name: "Search components", exact: true })
		.fill("Resistor");
	await page
		.getByRole("button", { name: "Place Resistor", exact: true })
		.click();
	await expect(page.locator(".circuit-canvas")).toHaveClass(/is-placing/);
	const preview = page.locator(".circuit-placement-preview");
	const viewBox = async () =>
		((await canvas.getAttribute("viewBox")) ?? "").split(" ").map(Number);
	const previewAt = async () => {
		const match = /translate\(([^,]+),([^)]+)\)/.exec(
			(await preview.getAttribute("transform")) ?? "",
		);
		if (!match) throw new Error("Missing placement preview.");
		return { x: Number(match[1]), y: Number(match[2]) };
	};
	const box = await canvas.boundingBox();
	if (!box) throw new Error("Missing circuit canvas.");
	const start = { x: box.x + box.width * 0.4, y: box.y + box.height * 0.45 };
	const end = { x: start.x + 160, y: start.y + 90 };
	await page.mouse.move(start.x - 20, start.y - 20);
	await page.mouse.move(start.x, start.y);
	await expect(preview).toBeVisible();
	const placed = await previewAt();
	const before = await viewBox();
	const scale = Math.min(box.width / before[2], box.height / before[3]);

	await page.mouse.down({ button: "middle" });
	await page.mouse.move(end.x, end.y, { steps: 8 });
	await page.mouse.up({ button: "middle" });

	const after = await viewBox();
	expect(after[0]).toBeCloseTo(before[0] - 160 / scale, 3);
	expect(after[1]).toBeCloseTo(before[1] - 90 / scale, 3);
	expect(after.slice(2)).toEqual(before.slice(2));
	// Panning keeps the cursor over the same graph point, so the preview
	// stays put during the pan and the next move does not make it jump.
	await expect(page.locator(".circuit-canvas")).toHaveClass(/is-placing/);
	expect(await previewAt()).toEqual(placed);
	await page.mouse.move(end.x + 30, end.y + 20, { steps: 2 });
	await page.mouse.move(end.x, end.y, { steps: 2 });
	const gridStep =
		Number.parseFloat(
			await page
				.locator(".circuit-grid")
				.evaluate((element) => getComputedStyle(element).backgroundSize),
		) / scale;
	const moved = await previewAt();
	expect(Math.abs(moved.x - placed.x)).toBeLessThanOrEqual(gridStep);
	expect(Math.abs(moved.y - placed.y)).toBeLessThanOrEqual(gridStep);
	if (captureArtifacts)
		await page.screenshot({
			path: resolve(
				"/tmp/ecad-browser-artifacts",
				test.info().testId,
				"circuit-component-pan-while-placing.png",
			),
		});

	await page.mouse.click(end.x, end.y);
	const positions = (await state(page)).graph.positions;
	expect(positions).toHaveLength(1);
	expect(positions[0]).toMatchObject({ kind: "component", ...moved });
});
