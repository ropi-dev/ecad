import type { Page } from "@playwright/test";
import { required } from "../helpers/required.ts";
import {
	closeProjectFiles,
	openProjectFiles,
	projectRail,
} from "./project-files";
import { screenPointOfMillimetres } from "./rulers";
import { expect, test } from "./seeded-project";
import { toolbarButton } from "./toolbar";

const documentState = async (page: Page) =>
	JSON.parse((await page.locator("#project-document").textContent()) ?? "{}");

async function drag(
	page: Page,
	from: { x: number; y: number },
	to: { x: number; y: number },
) {
	const start = await screenPointOfMillimetres(page, from.x, from.y);
	const end = await screenPointOfMillimetres(page, to.x, to.y);
	await page.mouse.move(start.x, start.y);
	await page.mouse.down();
	await page.mouse.move((start.x + end.x) / 2, (start.y + end.y) / 2, {
		steps: 3,
	});
	await page.mouse.move(end.x, end.y, { steps: 3 });
	await page.mouse.up();
}

async function orbitUntilAboveHorizon(
	page: Page,
	pivot: { x: number; y: number },
	point: { x: number; y: number },
) {
	const readout = page.getByTestId("cursor-readout");
	await page.keyboard.down("Shift");
	for (let turn = 0; turn < 40; turn++) {
		await page.mouse.move(point.x, point.y - 1);
		await page.mouse.move(point.x, point.y);
		if (!/\d/.test((await readout.textContent()) ?? "")) break;
		await page.mouse.move(pivot.x, pivot.y);
		await page.mouse.down();
		await page.mouse.move(pivot.x, pivot.y - 6, { steps: 2 });
		await page.mouse.up();
	}
	await page.keyboard.up("Shift");
	await expect(readout).not.toContainText(/\d/);
}

async function boardSelection(page: Page) {
	return page.evaluate(() => {
		const area = (
			document.querySelector("[data-view]") as HTMLElement
		).getBoundingClientRect();
		return Object.fromEntries(
			[
				...document.querySelectorAll<SVGPolygonElement>(
					'[data-testid="board-selection"]',
				),
			].map((outline) => {
				const corners = (outline.getAttribute("points") ?? "")
					.split(" ")
					.map((corner) => corner.split(",").map(Number));
				return [
					Number(outline.dataset.shapeId),
					{
						x:
							area.left +
							corners.reduce((sum, [x]) => sum + x, 0) / corners.length,
						y:
							area.top +
							corners.reduce((sum, [, y]) => sum + y, 0) / corners.length,
					},
				];
			}),
		);
	});
}

async function createFootprint(page: Page) {
	await page.goto("/tests/browser/projects.html");
	await (await openProjectFiles(page))
		.getByRole("link", { name: "Workspace home", exact: true })
		.click();
	await closeProjectFiles(page);
	await projectRail(page)
		.getByRole("button", { name: "Add file", exact: true })
		.click();
	await page
		.getByRole("menuitem", { name: "New footprint", exact: true })
		.click();
	await page.getByRole("dialog").getByRole("textbox").fill("Test part");
	await page
		.getByRole("button", { name: "Create footprint", exact: true })
		.click();
	await expect(page.getByRole("heading", { level: 1 })).toHaveText(
		"Footprint editor · Test part",
	);
	await expect(
		page
			.getByRole("application", { name: "Footprint editor" })
			.locator("canvas"),
	).toBeVisible();
}

test("a footprint takes pads and layer graphics, hides layers and is edited as a 3D board", async ({
	page,
}) => {
	await createFootprint(page);
	const flat = page.getByRole("button", { name: "2D", exact: true });
	await expect(flat).toBeEnabled();

	await (await toolbarButton(page, "Surface mount pad")).click();
	for (const x of [-1, 1]) {
		const point = await screenPointOfMillimetres(page, x, 0);
		await page.mouse.move(point.x, point.y);
		await page.mouse.click(point.x, point.y);
	}
	await page.keyboard.press("Escape");
	await expect
		.poll(async () =>
			(await documentState(page)).editorShapes.map(
				(shape: { pad?: { number: string }; layer?: string; x: number }) => [
					shape.pad?.number,
					shape.layer,
					shape.x,
				],
			),
		)
		.toEqual([
			["1", "F.Cu", -1],
			["2", "F.Cu", 1],
		]);

	await page.getByRole("button", { name: "Draw on Front silkscreen" }).click();
	await page.getByRole("button", { name: "Shapes", exact: true }).click();
	await page.getByRole("button", { name: "Wire", exact: true }).click();
	await drag(page, { x: -0.5, y: 1 }, { x: 0.5, y: 1 });
	await expect
		.poll(async () => {
			const wire = (await documentState(page)).editorShapes[2];
			return wire && [wire.kind, wire.layer, wire.width, wire.lineWidth];
		})
		.toEqual(["line", "F.SilkS", 1, 0.15]);

	await page.getByRole("button", { name: "Draw on Front courtyard" }).click();
	await page.getByRole("button", { name: "Shapes", exact: true }).click();
	await page.getByRole("button", { name: "Rectangle", exact: true }).click();
	await drag(page, { x: -1.8, y: -1.2 }, { x: 1.8, y: 1.2 });
	await expect
		.poll(async () => (await documentState(page)).editorShapes[3]?.layer)
		.toBe("F.CrtYd");
	await expect(
		page.getByRole("button", { name: "Hide Front courtyard" }),
	).toBeDisabled();

	const pad = await screenPointOfMillimetres(page, -1, 0);
	const attributes = page.getByRole("complementary", {
		name: "Selection attributes",
	});
	const showFrontPaste = page.getByRole("button", { name: "Show Front paste" });
	await expect(showFrontPaste).toBeVisible();
	await page.getByRole("button", { name: "Hide Front copper" }).click();
	await page.mouse.dblclick(pad.x, pad.y);
	await expect(attributes.getByLabel("Layer")).toHaveValue("F.CrtYd");
	await expect(attributes.getByLabel("Pad number")).toHaveCount(0);
	await showFrontPaste.click();
	await page.mouse.dblclick(pad.x, pad.y);
	await expect(attributes.getByLabel("Pad number")).toHaveValue("1");
	await expect(attributes.getByLabel("Solder paste")).toBeDisabled();
	await page.keyboard.press("Escape");
	await page.getByRole("button", { name: "Show Front copper" }).click();
	await page.mouse.dblclick(pad.x, pad.y);
	await expect(attributes.getByLabel("Pad number")).toHaveValue("1");
	await expect(attributes.getByLabel("Center X")).toHaveValue("-1");
	const paste = attributes.getByLabel("Solder paste");
	await expect(paste).toBeChecked();
	await paste.uncheck();
	await expect
		.poll(async () => (await documentState(page)).editorShapes[0].pad.paste)
		.toBe(false);
	await attributes.getByLabel("Pad type").selectOption("through-hole");
	await expect(paste).toHaveCount(0);
	await expect
		.poll(async () => (await documentState(page)).editorShapes[0].pad)
		.toEqual({ number: "1", type: "through-hole", drill: 0.6 });
	const drill = attributes.getByLabel("Drill");
	await drill.fill("3");
	await drill.press("Enter");
	await expect(drill).toHaveValue("0.6");
	await page.keyboard.press("Escape");

	await page.getByRole("button", { name: "Hide Back copper" }).click();
	const secondPad = await screenPointOfMillimetres(page, 1, 0);
	await page.mouse.dblclick(secondPad.x, secondPad.y);
	const backCopper = attributes.getByLabel("Layer").locator("option", {
		hasText: "Back copper",
	});
	await expect(backCopper).toHaveText("Back copper (hidden)");
	await expect(backCopper).toBeDisabled();
	await page.getByRole("button", { name: "Show Back copper" }).click();
	await page.mouse.dblclick(secondPad.x, secondPad.y);
	await attributes.getByLabel("Layer").selectOption("B.Cu");
	await expect
		.poll(async () => (await documentState(page)).editorShapes[1].layer)
		.toBe("B.Cu");
	await expect(attributes.getByLabel("Layer")).toHaveValue("B.Cu");
	await page.keyboard.press("Escape");

	await expect
		.poll(
			async () => (await documentState(page)).footprints?.[0]?.shapes.length,
		)
		.toBe(4);

	const area = page.locator("[data-view]");
	const flatCanvas = await area.locator("canvas").elementHandle();
	await page.keyboard.down("Alt");
	await page.keyboard.down("Shift");
	await page.mouse.move(secondPad.x, secondPad.y);
	await page.mouse.down();
	await page.mouse.move(secondPad.x, secondPad.y - 40, { steps: 4 });
	await page.mouse.up();
	await page.keyboard.up("Shift");
	await page.keyboard.up("Alt");
	await expect(area).toHaveAttribute("data-view", "3d");
	await expect(flat).toHaveAttribute("aria-pressed", "false");
	await expect(
		page.getByRole("img", { name: "Drawing rulers in millimetres" }),
	).toHaveCount(0);
	expect((await documentState(page)).editorShapes).toHaveLength(4);
	expect(
		await area
			.locator("canvas")
			.evaluate((canvas, before) => canvas === before, flatCanvas),
	).toBe(true);
	await flat.click();
	await expect(area).toHaveAttribute("data-view", "2d");
	await expect(flat).toHaveAttribute("aria-pressed", "true");
	await flat.click();
	await expect(area).toHaveAttribute("data-view", "3d");
	await expect(flat).toHaveAttribute("aria-pressed", "false");
	await expect(flat).toBeFocused();
	await expect(
		page.getByRole("application", { name: "Footprint editor" }),
	).toBeVisible();
	await expect(
		page.getByRole("img", { name: "Drawing rulers in millimetres" }),
	).toHaveCount(0);
	await expect(
		page.getByRole("button", { name: "Pads and vias", exact: true }),
	).toBeEnabled();
	const boardCanvas = await area.locator("canvas").elementHandle();
	const view = required(await area.boundingBox());

	await page.mouse.move(view.x + view.width - 80, view.y + 70);
	await page.mouse.down();
	await page.mouse.move(view.x + view.width / 2, view.y + view.height / 2, {
		steps: 3,
	});
	await page.mouse.move(view.x + 330, view.y + view.height - 110, { steps: 3 });
	await page.mouse.up();
	const selection = page.locator('[data-testid="board-selection"]');
	await expect(selection).toHaveCount(4);
	const [throughHole] = (await documentState(page)).editorShapes;
	const outlines = await boardSelection(page);
	const grip = required(outlines[throughHole.id]);

	await page.keyboard.down("ControlOrMeta");
	await page.keyboard.down("Shift");
	await page.mouse.click(grip.x, grip.y);
	await page.keyboard.up("Shift");
	await page.keyboard.up("ControlOrMeta");
	await expect(selection).toHaveCount(3);
	await page.keyboard.press("Escape");
	await expect(selection).toHaveCount(0);

	await page.mouse.click(grip.x, grip.y);
	await expect(selection).toHaveCount(1);
	await expect(selection).toHaveAttribute(
		"data-shape-id",
		String(throughHole.id),
	);
	await expect(page.getByTestId("resize-handle")).not.toHaveCount(0);
	const readout = page.getByTestId("cursor-readout");
	const pointer = async () =>
		((await readout.textContent()) ?? "")
			.match(/-?\d+(?:\.\d+)?/g)
			?.map(Number) ?? [];
	await page.mouse.move(grip.x, grip.y);
	await expect.poll(pointer).toHaveLength(2);
	const grabbed = await pointer();
	await page.mouse.down();
	await page.mouse.move(grip.x - 40, grip.y - 10, { steps: 3 });
	await page.mouse.move(grip.x - 90, grip.y - 30, { steps: 3 });
	await page.mouse.up();
	await expect(selection).toHaveAttribute(
		"data-shape-id",
		String(throughHole.id),
	);
	await expect
		.poll(async () => {
			const moved = (await documentState(page)).editorShapes[0];
			return moved.x !== throughHole.x || moved.y !== throughHole.y;
		})
		.toBe(true);
	await page.mouse.move(grip.x - 90, grip.y - 29);
	await page.mouse.move(grip.x - 90, grip.y - 30);
	await expect.poll(pointer).not.toEqual(grabbed);
	const released = await pointer();
	const moved = (await documentState(page)).editorShapes[0];
	const gridStep = 0.2;
	expect(
		Math.abs(moved.x - throughHole.x - (released[0] - grabbed[0])),
	).toBeLessThanOrEqual(gridStep);
	expect(
		Math.abs(moved.y - throughHole.y - (released[1] - grabbed[1])),
	).toBeLessThanOrEqual(gridStep);
	for (const coordinate of [moved.x, moved.y])
		expect(
			Math.abs(coordinate * 10 - Math.round(coordinate * 10)),
		).toBeLessThan(1e-6);

	await (await toolbarButton(page, "Surface mount pad")).click();
	await page.mouse.move(view.x + view.width - 200, view.y + view.height / 2);
	await expect(page.locator('[data-testid="board-placement"]')).toHaveCount(1);
	await page.mouse.click(view.x + view.width - 200, view.y + view.height / 2);
	await page.keyboard.press("Escape");
	await expect
		.poll(async () => (await documentState(page)).editorShapes.length)
		.toBe(5);
	expect((await documentState(page)).editorShapes[4].pad.type).toBe("smd");
	expect(
		await area
			.locator("canvas")
			.evaluate((canvas, before) => canvas === before, boardCanvas),
	).toBe(true);
	const centre = { x: view.x + view.width / 2, y: view.y + view.height / 2 };
	const sky = { x: view.x + view.width - 80, y: view.y + 40 };
	await orbitUntilAboveHorizon(page, centre, sky);
	await page.mouse.down();
	await page.mouse.move(centre.x, centre.y, { steps: 3 });
	await page.mouse.move(view.x + 330, view.y + view.height - 110, { steps: 3 });
	await expect(page.locator("[data-selection-mode]")).toHaveCount(1);
	await page.mouse.up();
	await expect(selection).not.toHaveCount(0);
	await page.mouse.click(sky.x, sky.y);
	await expect(selection).toHaveCount(0);
	await (await toolbarButton(page, "Surface mount pad")).click();
	await page.mouse.move(centre.x, centre.y + 150);
	await expect(page.locator('[data-testid="board-placement"]')).toHaveCount(1);
	await page.mouse.move(sky.x, sky.y);
	await expect(page.locator('[data-testid="board-placement"]')).toHaveCount(0);
	await page.mouse.click(sky.x, sky.y);
	await page.keyboard.press("Escape");
	expect((await documentState(page)).editorShapes).toHaveLength(5);
	await page.getByRole("button", { name: "Hide Front silkscreen" }).click();
	await expect(
		page.getByRole("button", { name: "Show Front silkscreen" }),
	).toBeVisible();
	expect(
		await area
			.locator("canvas")
			.evaluate((canvas, before) => canvas === before, boardCanvas),
	).toBe(true);
	await (await toolbarButton(page, "Through-hole pad")).click();
	await expect(area).toHaveAttribute("data-tool", "through-hole-pad");
	await flat.click();
	await expect(area).toHaveAttribute("data-view", "2d");
	await expect(flat).toHaveAttribute("aria-pressed", "true");
	await expect(flat).toBeFocused();
	await expect(page.getByTestId("cursor-readout")).toBeVisible();
	await expect(area).toHaveAttribute("data-tool", "through-hole-pad");
	await expect(
		page.getByRole("button", { name: "Pads and vias", exact: true }),
	).toBeEnabled();
	expect((await documentState(page)).editorShapes).toHaveLength(5);

	await flat.click();
	await expect(area).toHaveAttribute("data-view", "3d");
	await expect(
		page.getByRole("button", { name: "Pads and vias", exact: true }),
	).toBeEnabled();
	await area.locator("canvas").evaluate((canvas: HTMLCanvasElement) => {
		const context = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
		context?.getExtension("WEBGL_lose_context")?.loseContext();
	});
	await expect(area).toHaveAttribute("data-view", "2d");
	await expect(
		page.getByText("The 3D graphics context was lost"),
	).toBeVisible();
	await expect(flat).toBeEnabled();
	await expect(flat).toHaveAttribute("aria-pressed", "true");
	await page.keyboard.down("Alt");
	await page.keyboard.down("Shift");
	await page.mouse.move(centre.x, centre.y);
	await page.mouse.down();
	await page.mouse.move(centre.x, centre.y - 40, { steps: 4 });
	await page.mouse.up();
	await page.keyboard.up("Shift");
	await page.keyboard.up("Alt");
	await expect(area).toHaveAttribute("data-view", "3d");
	await expect(page.getByText("The 3D graphics context was lost")).toHaveCount(
		0,
	);
	await flat.click();
	await expect(area).toHaveAttribute("data-view", "2d");

	await page.setViewportSize({ width: 1400, height: 900 });
	await flat.click();
	await expect(area).toHaveAttribute("data-view", "3d");
	await expect(
		page.getByRole("button", { name: "Pads and vias", exact: true }),
	).toBeEnabled();
	await expect(page.getByTestId("cursor-readout")).toBeVisible();
});

test("the via tool places vias through both copper layers, and a via's drill is edited in Attributes", async ({
	page,
}) => {
	await createFootprint(page);
	await (await toolbarButton(page, "Via")).click();
	await expect(page.locator("[data-view]")).toHaveAttribute("data-tool", "via");
	for (const x of [-1, 1]) {
		const point = await screenPointOfMillimetres(page, x, 0);
		await page.mouse.move(point.x, point.y);
		await page.mouse.click(point.x, point.y);
	}
	await page.keyboard.press("Escape");
	await expect
		.poll(async () =>
			(await documentState(page)).editorShapes.map(
				(shape: {
					kind: string;
					x: number;
					width: number;
					via?: { drill: number };
				}) => [shape.kind, shape.x, shape.width, shape.via?.drill],
			),
		)
		.toEqual([
			["circle", -1, 0.6, 0.3],
			["circle", 1, 0.6, 0.3],
		]);

	const via = await screenPointOfMillimetres(page, -1, 0);
	const attributes = page.getByRole("complementary", {
		name: "Selection attributes",
	});
	await page.mouse.dblclick(via.x, via.y);
	await expect(attributes.getByText("Both copper layers")).toBeVisible();
	await expect(attributes.getByLabel("Pad number")).toHaveCount(0);
	const drill = attributes.getByLabel("Drill");
	await expect(drill).toHaveValue("0.3");
	await drill.fill("0.4");
	await drill.press("Enter");
	await expect
		.poll(async () => (await documentState(page)).editorShapes[0].via)
		.toEqual({ drill: 0.4 });
	await drill.fill("0.6");
	await drill.press("Enter");
	await expect(drill).toHaveValue("0.4");
});

test("a footprint links a built-in 3D model, which the realistic board draws until the cube button hides it", async ({
	page,
}) => {
	await createFootprint(page);
	const field = page.getByRole("combobox", { name: "3D model" });
	await expect(field).toHaveValue("");
	await field.selectOption({ label: "R_0805_2012Metric" });
	await expect
		.poll(async () =>
			(await documentState(page)).footprints.map(
				(footprint: { model?: unknown }) => footprint.model,
			),
		)
		.toEqual([{ library: "builtin", id: "r_0805_2012metric" }]);

	const models = page.getByRole("button", { name: "3D models" });
	await expect(models).toHaveCount(0);
	await page.getByRole("button", { name: "Realistic board" }).click();
	await expect(models).toHaveAttribute("aria-pressed", "true");
	const canvas = page
		.getByRole("application", { name: "Footprint editor" })
		.locator("canvas");
	const settled = async () => {
		let previous: Buffer | undefined;
		await expect
			.poll(async () => {
				const next = await canvas.screenshot();
				const same = previous?.equals(next) ?? false;
				previous = next;
				return same;
			})
			.toBe(true);
		return required(previous);
	};
	const differingShare = (first: Buffer, second: Buffer) =>
		page.evaluate(
			async ([first, second]) => {
				const pixels = async (png: string) => {
					const bitmap = await createImageBitmap(
						await (await fetch(`data:image/png;base64,${png}`)).blob(),
					);
					const context = new OffscreenCanvas(
						bitmap.width,
						bitmap.height,
					).getContext("2d");
					if (!context) throw new Error("No 2D context");
					context.drawImage(bitmap, 0, 0);
					return context.getImageData(0, 0, bitmap.width, bitmap.height).data;
				};
				const [a, b] = await Promise.all([pixels(first), pixels(second)]);
				if (a.length !== b.length) return 1;
				let differing = 0;
				for (let index = 0; index < a.length; index += 4)
					if (
						Math.abs(a[index] - b[index]) +
							Math.abs(a[index + 1] - b[index + 1]) +
							Math.abs(a[index + 2] - b[index + 2]) >
						24
					)
						differing++;
				return differing / (a.length / 4);
			},
			[first.toString("base64"), second.toString("base64")],
		);
	const shown = await settled();
	await models.click();
	await expect(models).toHaveAttribute("aria-pressed", "false");
	const hidden = await settled();
	await models.click();
	await expect(models).toHaveAttribute("aria-pressed", "true");
	const shownAgain = await settled();
	const hiddenShare = await differingShare(hidden, shown);
	expect(hiddenShare).toBeGreaterThan(0.01);
	expect(await differingShare(shownAgain, shown)).toBeLessThan(hiddenShare / 5);

	await field.selectOption("");
	await expect
		.poll(async () =>
			(await documentState(page)).footprints.map(
				(footprint: { model?: unknown }) => footprint.model,
			),
		)
		.toEqual([undefined]);
});

test("the unplated hole tool places mounting holes, and a hole's drill is edited in Attributes", async ({
	page,
}) => {
	await createFootprint(page);
	await (await toolbarButton(page, "Unplated hole")).click();
	await expect(page.locator("[data-view]")).toHaveAttribute(
		"data-tool",
		"hole",
	);
	const point = await screenPointOfMillimetres(page, 0, 0);
	await page.mouse.move(point.x, point.y);
	await page.mouse.click(point.x, point.y);
	await page.keyboard.press("Escape");
	const holes = async () =>
		(await documentState(page)).editorShapes.map(
			(shape: { kind: string; width: number; hole?: { drill: number } }) => [
				shape.kind,
				shape.width,
				shape.hole?.drill,
			],
		);
	await expect.poll(holes).toEqual([["circle", 3.2, 3.2]]);

	const attributes = page.getByRole("complementary", {
		name: "Selection attributes",
	});
	await page.mouse.dblclick(point.x, point.y);
	await expect(attributes.getByText("Through the board")).toBeVisible();
	await expect(attributes.getByLabel("Pad number")).toHaveCount(0);
	const drill = attributes.getByLabel("Drill");
	await expect(drill).toHaveValue("3.2");
	await drill.fill("2.75");
	await drill.press("Enter");
	await expect.poll(holes).toEqual([["circle", 3.2, 2.75]]);
	await drill.fill("4");
	await drill.press("Enter");
	await expect.poll(holes).toEqual([["circle", 4, 4]]);
});

test("a through-hole pad becomes an oval with a slot in Attributes", async ({
	page,
}) => {
	await createFootprint(page);
	await (await toolbarButton(page, "Through-hole pad")).click();
	const point = await screenPointOfMillimetres(page, 0, 0);
	await page.mouse.move(point.x, point.y);
	await page.mouse.click(point.x, point.y);
	await page.keyboard.press("Escape");
	const attributes = page.getByRole("complementary", {
		name: "Selection attributes",
	});
	await page.mouse.dblclick(point.x, point.y);
	await attributes.getByLabel("Pad shape").selectOption("oval");
	const height = attributes.getByLabel("Height");
	await height.fill("2.6");
	await height.press("Enter");
	await expect
		.poll(async () => {
			const [pad] = (await documentState(page)).editorShapes;
			return [pad.kind, pad.width, pad.height, pad.pad];
		})
		.toEqual([
			"rectangle",
			1.7,
			2.6,
			{ number: "1", type: "through-hole", drill: 1, cornerRatio: 0.5 },
		]);
	await attributes.getByLabel("Hole").selectOption("slot");
	await expect
		.poll(async () => {
			const [pad] = (await documentState(page)).editorShapes;
			return [pad.width, pad.height, pad.rotation, pad.pad.slot];
		})
		.toEqual([2.6, 1.7, Math.PI / 2, expect.closeTo(1.9)]);
	await expect(attributes.getByLabel("Width", { exact: true })).toHaveValue(
		"2.6",
	);
	const length = attributes.getByLabel("Slot length");
	for (const invalid of ["0.8", "2.6"]) {
		await length.fill(invalid);
		await length.press("Enter");
		await expect(length).toHaveValue("1.9");
	}
	await length.fill("1.6");
	await length.press("Enter");
	await expect
		.poll(async () => (await documentState(page)).editorShapes[0].pad.slot)
		.toBe(1.6);
	await expect(attributes.getByLabel("Slot width")).toHaveValue("1");
	await attributes.getByLabel("Hole").selectOption("round");
	await expect
		.poll(async () => (await documentState(page)).editorShapes[0].pad.slot)
		.toBeUndefined();
	await expect(attributes.getByLabel("Drill")).toHaveValue("1");
});
