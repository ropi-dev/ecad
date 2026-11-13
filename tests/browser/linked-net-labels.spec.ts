import { createCircuit } from "@ecad/drawing-core/circuit/model.ts";
import type { EditorShape } from "@ecad/drawing-core/drawing/shapes.ts";
import { expect, test } from "@playwright/test";
import { synchronizePcb } from "#/circuit/linked-schematic.ts";
import { componentFromSymbol } from "#/circuit/symbol-components.ts";
import { symbolDefinitions } from "#/drawing/symbols.ts";
import { rulerSpacing } from "#/engine/ruler.ts";
import { required } from "../helpers/required.ts";
import { captureArtifacts } from "./artifacts";
import { closeProjectFiles, openProjectFiles } from "./project-files";

type LabelView = { x: number; y: number; scale: number };
type LabelWindow = typeof window & { labelView: LabelView };

test("pending autosaves preserve generated net bindings and schematic undo", async ({
	page,
}) => {
	const original = createCircuit("Untitled", "pcb-main");
	const file = structuredClone(original);
	const resistor = componentFromSymbol(
		required(
			symbolDefinitions.find((definition) => definition.id === "resistor"),
		),
		[],
	);
	const capacitor = componentFromSymbol(
		required(
			symbolDefinitions.find((definition) => definition.id === "capacitor"),
		),
		[resistor],
	);
	file.circuit.components = [resistor, capacitor];
	file.circuit.nets = [
		{
			id: "signal",
			names: [],
			pinIds: [resistor.pins[1].id, capacitor.pins[0].id],
		},
	];
	const linked = synchronizePcb(file, [], original, symbolDefinitions);
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
		{
			file: linked.file,
			shapes: linked.shapes.map((shape) => ({
				...shape,
				x: shape.x - 45,
				y: shape.y + 30,
			})),
		},
	);
	await page.reload();
	await (await openProjectFiles(page))
		.getByRole("link", { name: "Open Untitled.ecaddraw", exact: true })
		.click();
	await closeProjectFiles(page);
	for (let index = 0; index < 10; index++)
		await page.getByRole("button", { name: "Zoom in", exact: true }).click();
	await page.locator("canvas").dblclick({ position: { x: 384, y: 360 } });
	const reference = page.getByRole("textbox", {
		name: "Reference",
		exact: true,
	});
	await expect(reference).toHaveValue("R1");
	await page.evaluate(() => {
		const state = window as typeof window & {
			qaSavePending?: boolean;
			releaseQaSave?: () => void;
		};
		const original = FileSystemFileHandle.prototype.createWritable;
		let hold = true;
		FileSystemFileHandle.prototype.createWritable = async function (options) {
			const writable = await original.call(this, options);
			if (this.name === ".ecadprj" && hold) {
				hold = false;
				state.qaSavePending = true;
				await new Promise<void>((resolve) => {
					state.releaseQaSave = () => {
						FileSystemFileHandle.prototype.createWritable = original;
						resolve();
					};
				});
			}
			return writable;
		};
	});
	await reference.fill("R9");
	await reference.press("Tab");
	await page.waitForFunction(
		() => (window as typeof window & { qaSavePending?: boolean }).qaSavePending,
	);
	const value = page.getByRole("textbox", { name: "Value", exact: true });
	await value.fill("22k");
	await value.press("Tab");
	await page.evaluate(() =>
		(window as typeof window & { releaseQaSave: () => void }).releaseQaSave(),
	);
	const doc = async () =>
		JSON.parse(required(await page.locator("#project-document").textContent()));
	await expect.poll(async () => (await doc()).dirty).toBe(false);
	await expect
		.poll(
			async () =>
				(await doc()).shapes.filter(
					(shape: { kind: string; text?: string }) =>
						shape.kind === "text" && shape.text === "C1.1 / R9.2",
				).length,
		)
		.toBe(2);
	const { toolbarButton } = await import("./toolbar");
	await (await toolbarButton(page, "Undo")).click();
	await expect
		.poll(
			async () =>
				(await doc()).shapes.find(
					(shape: { kind: string; attributes?: { reference: string } }) =>
						shape.kind === "symbol" && shape.attributes?.reference === "R9",
				)?.attributes.value,
		)
		.toBe(resistor.value);
	await (await toolbarButton(page, "Undo")).click();
	await expect
		.poll(async () =>
			(await doc()).shapes.some(
				(shape: { kind: string; attributes?: { reference: string } }) =>
					shape.kind === "symbol" && shape.attributes?.reference === "R1",
			),
		)
		.toBe(true);
	await expect.poll(async () => (await doc()).dirty).toBe(false);
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
				).circuit.nets[0].names,
		)
		.toEqual([]);
});

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

test("electrical labels use the normal grid for dragging and keyboard movement", async ({
	page,
}, testInfo) => {
	await page.goto("/tests/browser/editor.html");
	await expect(page.locator("canvas")).toBeVisible();
	const { rulerSpacing } = await import("#/engine/ruler.ts");
	const box = required(await page.locator("canvas").boundingBox());
	const view = JSON.parse(
		required(await page.locator("#editor-scene").textContent()),
	);
	const scale = ((view.corner[0] - view.origin[0]) * box.width) / 840;
	const step = rulerSpacing(scale, "mil").minor;
	const screen = (x: number, y: number) => ({
		x: box.x + ((1 + view.origin[0]) * box.width) / 2 + x * scale,
		y: box.y + ((1 - view.origin[1]) * box.height) / 2 - y * scale,
	});
	// "SIGNAL" at 2 mm measures about 7.7 mm wide; the editor refits stored
	// text boxes to the drawing font, so grab the label at that box's center.
	const center = 3.85;
	const document = async () =>
		JSON.parse(required(await page.locator("#editor-document").textContent()));
	for (const electrical of ["net", "supply", undefined]) {
		await page.evaluate(async (electrical) => {
			const path = "/tests/browser/editor.tsx";
			const { replaceShapes, placeRectangle, drawingStore } = await import(
				path
			);
			if (!drawingStore.getSnapshot().shapes.length)
				placeRectangle({
					x: 0,
					y: 0,
					width: 10,
					height: 3,
					rotation: 0,
					lineWidth: 0.2,
				});
			replaceShapes([
				{
					id: 1,
					kind: "text",
					x: 0,
					y: 0,
					width: 7.7,
					height: 3,
					rotation: 0,
					lineWidth: 0.2,
					fontSize: 2,
					text: "SIGNAL",
					horizontalAlign: "left",
					verticalAlign: "bottom",
					electrical,
				},
			]);
		}, electrical);
		const source = screen(center, 1.5);
		await page.mouse.dblclick(source.x, source.y);
		await page.locator("canvas").focus();
		await page.keyboard.press("ArrowRight");
		await expect(page.getByTestId("resize-handle")).toHaveCount(
			electrical ? 0 : 4,
		);
		await expect(
			page.getByRole("spinbutton", { name: "Width", exact: true }),
		).toHaveCount(0);
		await expect(
			page.getByRole("spinbutton", { name: "Height", exact: true }),
		).toHaveCount(0);
		await expect(
			page.getByRole("spinbutton", { name: "Font size", exact: true }),
		).toHaveCount(1);
		const snapStep = electrical ? step : step / 10;
		await expect
			.poll(async () => (await document()).shapes[0].x)
			.toBeCloseTo(snapStep, 6);
		const start = screen(snapStep + center, 1.5);
		await page.mouse.move(start.x, start.y);
		await page.mouse.down();
		await page.mouse.move(
			start.x + step * 1.4 * scale,
			start.y + step * 1.4 * scale,
			{ steps: 6 },
		);
		await page.mouse.up();
		await expect
			.poll(async () => (await document()).shapes[0].x)
			.toBeCloseTo(electrical ? step * 2 : step * 1.5, 6);
		await expect
			.poll(async () => (await document()).shapes[0].y)
			.toBeCloseTo(electrical ? -step : -step * 1.4, 6);
		if (captureArtifacts && electrical === "net")
			await page.screenshot({
				path: testInfo.outputPath("net-label-no-resize.png"),
			});
	}
});
