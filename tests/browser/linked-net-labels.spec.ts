import { createCircuit } from "@ecad/drawing-core/circuit/model.ts";
import type { EditorShape } from "@ecad/drawing-core/drawing/shapes.ts";
import { synchronizePcb } from "#/circuit/linked-schematic.ts";
import { componentFromSymbol } from "#/circuit/symbol-components.ts";
import { symbolDefinitions } from "#/drawing/symbols.ts";
import { rulerSpacing } from "#/engine/ruler.ts";
import { required } from "../helpers/required.ts";
import { captureArtifacts } from "./artifacts";
import { closeProjectFiles, openProjectFiles } from "./project-files";
import { expect, test } from "./seeded-project";

type LabelView = { x: number; y: number; scale: number };
type LabelWindow = typeof window & { labelView: LabelView };

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
	await page.evaluate(async () => {
		const path = "/node_modules/.vite-browser-tests/deps/three.js";
		const { Scene, Vector3 } = (await import(path)) as typeof import("three");
		const previous = Scene.prototype.onAfterRender;
		Scene.prototype.onAfterRender = function (...args) {
			previous.apply(this, args);
			const camera = args[2];
			const origin = new Vector3(0, 0, 0).project(camera);
			const corner = new Vector3(1, 1, 0).project(camera);
			(window as LabelWindow).labelView = {
				x: origin.x,
				y: origin.y,
				scale: corner.x - origin.x,
			};
		};
	});
	for (let index = 0; index < 7; index++)
		await page.getByRole("button", { name: "Zoom in", exact: true }).click();
	await page.evaluate(
		() =>
			new Promise((resolve) =>
				requestAnimationFrame(() => requestAnimationFrame(resolve)),
			),
	);
	await page.waitForFunction(() => (window as LabelWindow).labelView);
	const view = await page.evaluate(() => (window as LabelWindow).labelView);
	const { shapeBounds } = await import("@ecad/drawing-core/drawing/shapes.ts");
	const bounds = shapeBounds(label);
	const canvas = required(await page.locator("canvas").boundingBox());
	const scale = (view.scale * canvas.width) / 2;
	const x =
		canvas.x +
		((1 + view.x) * canvas.width) / 2 +
		((bounds.minX + bounds.maxX) / 2) * scale;
	const y =
		canvas.y +
		((1 - view.y) * canvas.height) / 2 -
		((bounds.minY + bounds.maxY) / 2) * scale;
	const document = async () =>
		JSON.parse(required(await page.locator("#project-document").textContent()));
	const step = rulerSpacing(scale, "mil").minor;
	await page.mouse.move(x, y);
	await page.mouse.down();
	await page.mouse.move(x + 12 * scale, y + 10 * scale, { steps: 8 });
	await page.mouse.up();
	await expect
		.poll(
			async () =>
				(await document()).shapes.find(
					(shape: EditorShape) => shape.id === label.id,
				)?.x,
		)
		.toBeCloseTo(Math.round((label.x + 12) / step) * step, 4);
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
	await page.mouse.click(
		canvas.x + ((1 + view.x) * canvas.width) / 2 + component.x * scale,
		canvas.y + ((1 - view.y) * canvas.height) / 2 - component.y * scale,
	);
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
