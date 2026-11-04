import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { captureArtifacts } from "./artifacts";
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
	await expect(
		page.getByLabel("Workspace instructions", { exact: true }),
	).toBeVisible();
	await expect(
		(await openProjectFiles(page)).getByRole("button", {
			name: "Add file",
			exact: true,
		}),
	).toBeEnabled();
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

test("an autosave completing during a pin drag preserves the connection gesture", async ({
	page,
}) => {
	await createCircuit(page);
	await placeComponent(page, "Resistor", { x: 300, y: 230 });
	await expect
		.poll(
			async () => (await state(page)).circuit.components[0]?.schematicShapeId,
		)
		.toBeGreaterThan(0);
	await expect(page.locator(".circuit-editor")).toHaveAttribute(
		"data-pending-changes",
		"false",
	);
	await page.evaluate(() => {
		const state = window as typeof window & {
			savePending?: boolean;
			releaseSave?: () => void;
		};
		const original = FileSystemFileHandle.prototype.createWritable;
		let hold = true;
		FileSystemFileHandle.prototype.createWritable = async function (options) {
			const writable = await original.call(this, options);
			if (this.name === ".ecadprj" && hold) {
				hold = false;
				state.savePending = true;
				await new Promise<void>((resolve) => {
					state.releaseSave = () => {
						FileSystemFileHandle.prototype.createWritable = original;
						resolve();
					};
				});
			}
			return writable;
		};
	});
	await placeComponent(page, "Resistor", { x: 650, y: 400 });
	await page.waitForFunction(
		() => (window as typeof window & { savePending?: boolean }).savePending,
	);
	await dragPins(page, "R1.1", "R2.1");
	await expect(page.locator("[data-connection-preview]")).toBeVisible();
	await page.evaluate(() =>
		(window as typeof window & { releaseSave: () => void }).releaseSave(),
	);
	await expect(page.locator(".circuit-editor")).toHaveAttribute(
		"data-pending-changes",
		"false",
	);
	await expect(page.locator("[data-connection-preview]")).toBeVisible();
	await page.mouse.up();
	await expect
		.poll(async () => (await state(page)).circuit.nets.length)
		.toBe(1);
	await dragPins(page, "R1.2", "R2.2");
	await page.mouse.up();
	await expect
		.poll(async () => (await state(page)).circuit.nets.length)
		.toBe(2);
	await expect(page.locator(".circuit-editor")).toHaveAttribute(
		"data-pending-changes",
		"false",
	);
	const saved = (await state(page)).circuit;
	if (process.env.ECAD_SCREENSHOT_PATH)
		await page.screenshot({ path: process.env.ECAD_SCREENSHOT_PATH });
	await page.reload();
	await (await openProjectFiles(page))
		.getByRole("link", {
			name: "Open LED driver.ecaddraw in circuit view",
			exact: true,
		})
		.click();
	expect((await state(page)).circuit).toEqual(saved);
});

for (const tool of ["component", "net"] as const) {
	test(`middle-drag pans the view while the ${tool} tool is placing`, async ({
		page,
	}) => {
		await createCircuit(page);
		const canvas = page.getByLabel("Circuit connections graph", {
			exact: true,
		});
		if (tool === "component") {
			await page
				.getByRole("button", { name: "Components", exact: true })
				.click();
			await page
				.getByRole("searchbox", { name: "Search components", exact: true })
				.fill("Resistor");
			await page
				.getByRole("button", { name: "Place Resistor", exact: true })
				.click();
		} else {
			await page.getByRole("button", { name: "Add net", exact: true }).click();
		}
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
					.locator(".circuit-canvas")
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
					`circuit-${tool}-pan-while-placing.png`,
				),
			});

		await page.mouse.click(end.x, end.y);
		const positions = (await state(page)).graph.positions;
		expect(positions).toHaveLength(1);
		expect(positions[0]).toMatchObject({ kind: tool, ...moved });
	});
}

test("component picker excludes net symbols while retaining ordinary components", async ({
	page,
}) => {
	await createCircuit(page);
	await page.getByRole("button", { name: "Components", exact: true }).click();
	const search = page.getByRole("searchbox", {
		name: "Search components",
		exact: true,
	});
	for (const name of ["Ground", "VDD", "VCC"]) {
		await search.fill(name);
		await expect(
			page.getByRole("button", { name: `Place ${name}`, exact: true }),
		).toHaveCount(0);
		if (captureArtifacts && name === "Ground")
			await page.screenshot({
				path: resolve(
					"/tmp/ecad-browser-artifacts",
					test.info().testId,
					"circuit-net-symbol-filter.png",
				),
			});
	}
	await search.fill("Resistor");
	await expect(
		page.getByRole("button", { name: "Place Resistor", exact: true }),
	).toBeVisible();
});

test("net connections use a lighter highlight than the selected connection", async ({
	page,
}) => {
	await createCircuit(page);
	await placeComponent(page, "Resistor", { x: 280, y: 200 });
	await placeComponent(page, "Resistor", { x: 620, y: 350 });
	await placeComponent(page, "Resistor", { x: 900, y: 500 });
	await dragPins(page, "R1.1", "R2.1");
	await page.mouse.up();
	await dragPins(page, "R2.2", "R3.1");
	await page.mouse.up();
	await page.getByRole("button", { name: "Collapse R2", exact: true }).click();
	const circuit = (await state(page)).circuit;
	const netButton = (index: number) =>
		page.locator(`[data-circuit-net-id="${circuit.nets[index].id}"]`);
	const edge = (pin: string) =>
		page
			.getByRole("button", { name: `Connection ${pin}`, exact: true })
			.locator(".circuit-edge");
	await netButton(0).click();
	await expect(edge("R1.1")).toHaveCSS("stroke", "rgb(184, 220, 213)");
	await expect(edge("R2.1")).toHaveClass(/is-highlighted/);
	await expect(edge("R3.1")).not.toHaveClass(/is-highlighted/);
	await expect(
		page.locator(
			".circuit-component.is-selected, .circuit-component.is-highlighted",
		),
	).toHaveCount(0);
	await page
		.getByRole("button", { name: "Connection R1.1", exact: true })
		.focus();
	await page.keyboard.press("Space");
	await expect(edge("R1.1")).toHaveCSS("stroke", "rgb(232, 183, 126)");
	await expect(edge("R2.1")).toHaveCSS("stroke", "rgb(184, 220, 213)");
	if (process.env.ECAD_SCREENSHOT_PATH)
		await page.screenshot({ path: process.env.ECAD_SCREENSHOT_PATH });
	await netButton(1).click();
	await expect(edge("R1.1")).not.toHaveClass(/is-highlighted|is-selected/);
	await expect(edge("R2.2")).toHaveClass(/is-highlighted/);
	await expect(edge("R3.1")).toHaveClass(/is-highlighted/);
	await page.keyboard.press("Escape");
	await expect(
		page.locator(".circuit-edge.is-highlighted, .circuit-edge.is-selected"),
	).toHaveCount(0);
});

test("Ctrl+Y redoes circuit edits, and history keys typed into inputs stay with the input", async ({
	page,
}) => {
	await createCircuit(page);
	await placeComponent(page, "Resistor", { x: 300, y: 230 });
	await expect
		.poll(
			async () => (await state(page)).circuit.components[0]?.schematicShapeId,
		)
		.toBeGreaterThan(0);
	await expect(page.locator(".circuit-editor")).toHaveAttribute(
		"data-pending-changes",
		"false",
	);
	const placed = await state(page);
	const position = (document: typeof placed) =>
		document.graph.positions.find(
			(entry: { kind: string }) => entry.kind === "component",
		);
	const resistor = page.getByRole("button", {
		name: "Select component R1",
		exact: true,
	});
	await resistor.focus();
	await page.keyboard.press("ArrowRight");
	await page.keyboard.press("ArrowDown");
	const moved = await state(page);
	expect(position(moved).x).toBeGreaterThan(position(placed).x);
	expect(position(moved).y).toBeGreaterThan(position(placed).y);
	await page.keyboard.press("Control+z");
	await page.keyboard.press("Control+z");
	expect(await state(page)).toEqual(placed);
	await page.keyboard.press("Control+y");
	await page.keyboard.press("Control+y");
	expect(await state(page)).toEqual(moved);
	await page.keyboard.press("Control+z");
	await page.keyboard.press("Control+Shift+z");
	expect(await state(page)).toEqual(moved);
	await page.getByRole("button", { name: "Components", exact: true }).click();
	const search = page.getByRole("searchbox", {
		name: "Search components",
		exact: true,
	});
	await search.fill("Res");
	await search.press("Control+z");
	await search.press("Control+y");
	await search.press("ArrowLeft");
	expect(await state(page)).toEqual(moved);
});

test("fitting the circuit graph keeps a wide net label inside the fitted view", async ({
	page,
}) => {
	await createCircuit(page);
	await placeComponent(page, "Resistor", { x: 200, y: 230 });
	const canvas = page.getByLabel("Circuit connections graph", { exact: true });
	const initial = await canvas.boundingBox();
	if (!initial) throw new Error("Missing circuit canvas.");
	await page.getByRole("button", { name: "Add net", exact: true }).click();
	await canvas.click({ position: { x: initial.width - 160, y: 260 } });
	// Long enough to reach the 360-unit maximum net width.
	const name = "LONG_NET_LABEL_".repeat(3);
	await page.getByLabel("Net name", { exact: true }).fill(name);
	await page.keyboard.press("Enter");
	const net = page.getByRole("button", { name: `Net ${name}`, exact: true });
	await expect(net).toBeVisible();
	await expect(page.locator(".circuit-editor")).toHaveAttribute(
		"data-pending-changes",
		"false",
	);
	// The fitted viewBox, not just the canvas element, must hold the label:
	// letterboxing can leave spare room beside a view that is too narrow.
	const contained = async () => {
		const view = await canvas.evaluate((svg: SVGSVGElement) => {
			const box = svg.viewBox.baseVal;
			const matrix = svg.getScreenCTM();
			if (!matrix) throw new Error("Missing canvas transform.");
			const start = new DOMPoint(box.x, box.y).matrixTransform(matrix);
			const end = new DOMPoint(
				box.x + box.width,
				box.y + box.height,
			).matrixTransform(matrix);
			return { left: start.x, top: start.y, right: end.x, bottom: end.y };
		});
		const label = await net.boundingBox();
		if (!label) throw new Error("Missing net label.");
		return (
			label.x >= view.left - 0.5 &&
			label.y >= view.top - 0.5 &&
			label.x + label.width <= view.right + 0.5 &&
			label.y + label.height <= view.bottom + 0.5
		);
	};
	// Opening the circuit fits the whole graph, including the widest net label.
	await page.reload();
	await (await openProjectFiles(page))
		.getByRole("link", {
			name: "Open LED driver.ecaddraw in circuit view",
			exact: true,
		})
		.click();
	await closeProjectFiles(page);
	await expect(net).toBeVisible();
	expect(await contained()).toBe(true);
	if (captureArtifacts)
		await page.screenshot({
			path: "/tmp/ecad-shared-helpers/circuit-fit-wide-net.png",
		});
	await page.getByRole("button", { name: "Untangle", exact: true }).click();
	await expect.poll(contained).toBe(true);
});
