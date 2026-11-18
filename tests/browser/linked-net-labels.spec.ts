import { createCircuit } from "@ecad/drawing-core/circuit/model.ts";
import type { EditorShape } from "@ecad/drawing-core/drawing/shapes.ts";
import { synchronizePcb } from "#/circuit/linked-schematic.ts";
import { componentFromSymbol } from "#/circuit/symbol-components.ts";
import { symbolDefinitions } from "#/drawing/symbols.ts";
import { required } from "../helpers/required.ts";
import { captureArtifacts } from "./artifacts";
import { closeProjectFiles, openProjectFiles } from "./project-files";
import { expect, test } from "./seeded-project";
import { drawingGridStep, drawingPoint } from "./symbol-items";

test("dragging a generated label adds wires and persists through autosave, undo and reload", async ({
	page,
}, testInfo) => {
	const original = createCircuit("Untitled", "pcb-main");
	const file = structuredClone(original);
	const resistor = componentFromSymbol(
		required(
			symbolDefinitions.find((definition) => definition.id === "resistor"),
		),
		[],
	);
	file.circuit.components = [resistor];
	file.circuit.nets = [
		{ id: "signal", names: ["SIGNAL"], pinIds: [resistor.pins[1].id] },
	];
	const linked = synchronizePcb(file, [], original, symbolDefinitions);
	const shapes = linked.shapes.map((shape) => ({
		...shape,
		x: shape.x - 30,
		y: shape.y + 30,
	}));
	const label = required(shapes.find((shape) => shape.kind === "text"));
	await page.goto("/tests/browser/projects.html");
	await expect(page.locator("#project-document")).toContainText(
		'"name":"Untitled"',
	);
	await page.evaluate(
		async ({ file, shapes }) => {
			const path = "/packages/web/src/projects/storage.ts";
			const { createWebProjectStorage } = await import(path);
			const storage = createWebProjectStorage();
			const project = await storage.load();
			await storage.save(project.directory, {
				shapes,
				symbols: [],
				circuits: [file],
			});
		},
		{ file: linked.file, shapes },
	);
	await page.reload();
	await (await openProjectFiles(page))
		.getByRole("link", { name: "Open Untitled.ecaddraw", exact: true })
		.click();
	await closeProjectFiles(page);
	await expect(page.locator("canvas")).toBeVisible();
	for (let index = 0; index < 7; index++)
		await page.getByRole("button", { name: "Zoom in", exact: true }).click();
	const { shapeBounds } = await import("@ecad/drawing-core/drawing/shapes.ts");
	const bounds = shapeBounds(label);
	const center = {
		x: (bounds.minX + bounds.maxX) / 2,
		y: (bounds.minY + bounds.maxY) / 2,
	};
	let from = await drawingPoint(page, center);
	await expect
		.poll(async () => {
			const previous = from;
			from = await drawingPoint(page, center);
			return previous.x === from.x && previous.y === from.y;
		})
		.toBe(true);
	const to = await drawingPoint(page, { x: center.x + 12, y: center.y - 10 });
	const document = async () =>
		JSON.parse(required(await page.locator("#project-document").textContent()));
	const step = await drawingGridStep(page);
	await page.mouse.move(from.x, from.y);
	await page.mouse.down();
	await page.mouse.move(to.x, to.y, { steps: 8 });
	await page.mouse.up();
	await expect
		.poll(async () =>
			Math.abs(
				(await document()).shapes.find(
					(shape: EditorShape) => shape.id === label.id,
				)?.x -
					(label.x + 12),
			),
		)
		.toBeLessThanOrEqual(step);
	await expect.poll(async () => (await document()).dirty).toBe(false);
	expect(
		(await document()).shapes.filter(
			(shape: EditorShape) => shape.kind === "wire",
		),
	).toHaveLength(2);
	const moved = (await document()).shapes;
	await page.mouse.move(1270, 20);
	if (captureArtifacts)
		await page.screenshot({ path: testInfo.outputPath("moved-net-label.png") });
	const { toolbarButton } = await import("./toolbar");
	await (await toolbarButton(page, "Undo")).click();
	await expect
		.poll(
			async () =>
				(await document()).shapes.find(
					(shape: EditorShape) => shape.id === label.id,
				)?.x,
		)
		.toBe(label.x);
	await (await toolbarButton(page, "Redo")).click();
	await expect.poll(async () => (await document()).shapes).toEqual(moved);
	await expect.poll(async () => (await document()).dirty).toBe(false);
	const component = required(
		moved.find((shape: EditorShape) => shape.kind === "symbol"),
	);
	const part = await drawingPoint(page, component);
	await page.mouse.click(part.x, part.y);
	await page.keyboard.press("r");
	await expect
		.poll(
			async () =>
				(await document()).shapes.find(
					(shape: EditorShape) => shape.id === component.id,
				)?.rotation,
		)
		.toBeCloseTo(Math.PI / 2, 6);
	await expect.poll(async () => (await document()).dirty).toBe(false);
	expect(
		(await document()).shapes.find(
			(shape: EditorShape) => shape.id === label.id,
		),
	).toEqual(moved.find((shape: EditorShape) => shape.id === label.id));
	const rotated = (await document()).shapes;
	await page.mouse.move(1270, 20);
	if (captureArtifacts)
		await page.screenshot({
			path: testInfo.outputPath("rotated-net-label.png"),
		});
	await (await toolbarButton(page, "Undo")).click();
	await expect.poll(async () => (await document()).shapes).toEqual(moved);
	await (await toolbarButton(page, "Redo")).click();
	await expect.poll(async () => (await document()).shapes).toEqual(rotated);
	await expect.poll(async () => (await document()).dirty).toBe(false);
	await page.reload();
	await expect
		.poll(async () =>
			(await document()).shapes.filter(
				(shape: EditorShape) => shape.kind !== "symbol",
			),
		)
		.toEqual(rotated.filter((shape: EditorShape) => shape.kind !== "symbol"));
	await (await openProjectFiles(page))
		.getByRole("link", {
			name: "Open Untitled.ecaddraw in circuit view",
			exact: true,
		})
		.click();
	await expect
		.poll(
			async () =>
				JSON.parse(
					required(await page.locator("#circuit-document").textContent()),
				).circuit.nets,
		)
		.toEqual(file.circuit.nets);
});
