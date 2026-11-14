import assert from "node:assert/strict";
import { test } from "node:test";
import { createDrawingStore } from "@ecad/drawing-core/commands/drawing-store.ts";
import { editorShapeSchema } from "@ecad/drawing-core/drawing/schema.ts";
import {
	drawShape,
	type EditorShape,
	editShapeAttribute,
	resizeHandles,
	resizeShape,
	shapeAt,
	snappedMoveDelta,
} from "@ecad/drawing-core/drawing/shapes.ts";
import type { FootprintLayer } from "@ecad/drawing-core/footprint/layers.ts";
import {
	createPad,
	editPad,
	footprintFitBounds,
	footprintLayerView,
	isPad,
	nextPadNumber,
	onFootprintLayer,
	setShapeLayer,
} from "@ecad/drawing-core/footprint/shapes.ts";
import { canvasDragStep } from "#/components/editor/canvasDrag.ts";
import { createEditorSession } from "#/components/editor/editorSession.ts";
import { pasteSelection } from "#/drawing/clipboard.ts";
import { buildDrawingDisplay } from "#/drawing/display.ts";
import { exportDrawingSvg } from "#/drawing/export.ts";
import { applySelectionEdit } from "#/drawing/selection-edit.ts";
import { createTextShape } from "#/drawing/text.ts";
import { defaultSheet } from "#/drawing/worksheet.ts";
import { compilePlanarGeometry } from "#/engine/planar-geometry.ts";
import {
	BOARD_LAYER_ID,
	boardEdgeBounds,
	boardObjectVisible,
	DRILL_LAYER_ID,
	footprintBoard,
} from "#/footprint/board.ts";
import {
	createEmptyFootprintFile,
	footprintFileSchema,
	footprintFileWithShapes,
} from "#/footprint/format.ts";
import { classifyGerberLayer } from "#/formats/gerber/layer-order.ts";
import { projectFileSelections } from "#/projects/file-url.ts";
import type { ProjectSnapshot } from "#/projects/format.ts";
import { createProjectSession } from "#/projects/ProjectSession.ts";
import { projectIndex } from "#/projects/project-index.ts";
import {
	type ProjectDirectory,
	ProjectRepository,
} from "#/projects/repository.ts";
import type { ProjectStorage } from "#/projects/storage.ts";
import type { SymbolLibraryStorage } from "#/symbol-library/storage.tsx";
import { required } from "./helpers/required.ts";

const measure = (text: string) => text.length * 57.6;
const noLayers = new Set<FootprintLayer>();
const ids = (shapes: readonly EditorShape[]) => shapes.map((shape) => shape.id);
const silkLine = (id: number, y = 1) =>
	onFootprintLayer(drawShape(id, "line", { x: -1, y }, { x: 1, y }), "F.SilkS");
const courtyard = (id: number, filled = false): EditorShape => ({
	id,
	kind: "rectangle",
	layer: "F.CrtYd",
	x: 0,
	y: 0,
	width: 4,
	height: 2,
	rotation: 0,
	lineWidth: 0.15,
	filled,
});
const silkText = (id: number) =>
	onFootprintLayer(createTextShape(id, { x: 0, y: 2 }, measure), "F.SilkS");
const editContext = (selection: EditorShape[]) => ({
	selection,
	shapes: selection,
	nextId: 99,
	allowLocked: false,
	measureText: measure,
});

function twoPadsWireCourtyardAndThroughHole(): EditorShape[] {
	return [
		createPad(1, { x: -0.9, y: 0 }, "smd", "1", "F.Cu"),
		createPad(2, { x: 0.9, y: 0 }, "smd", "2", "F.Cu"),
		silkLine(3),
		courtyard(4),
		createPad(5, { x: 0, y: 3 }, "through-hole", "3", "F.Cu"),
	];
}

test("shapes take a board layer, and only rectangles and circles become valid pads", () => {
	const pad = createPad(1, { x: 0, y: 0 }, "smd", "1", "F.Cu");
	const through = createPad(3, { x: 0, y: 0 }, "through-hole", "2", "F.Cu");
	for (const valid of [pad, through, silkLine(2)])
		assert.equal(editorShapeSchema.safeParse(valid).success, true);
	for (const invalid of [
		{ ...silkLine(2), layer: "F.Gold" },
		{ ...pad, pad: { ...pad.pad, drill: 0.4 } },
		{ ...through, pad: { ...through.pad, drill: through.width } },
		{ ...through, pad: { number: "2", type: "through-hole" } },
		{ ...pad, kind: "triangle" },
	])
		assert.equal(editorShapeSchema.safeParse(invalid).success, false);
});

test("new footprint items take the active layer, a 0.15 mm stroke and 1 mm text", () => {
	const line = silkLine(1);
	assert.deepEqual([line.layer, line.lineWidth], ["F.SilkS", 0.15]);
	const text = silkText(2);
	assert.deepEqual([text.layer, text.fontSize], ["F.SilkS", 1]);
	assert.ok(Math.abs(text.height - 1.5) < 1e-9);
});

test("a pad tool numbers pads from the highest whole number and keeps pads on copper", () => {
	assert.equal(nextPadNumber([]), "1");
	assert.equal(
		nextPadNumber([
			createPad(1, { x: 0, y: 0 }, "smd", "7", "F.Cu"),
			createPad(2, { x: 1, y: 0 }, "smd", "A1", "F.Cu"),
			silkLine(3),
		]),
		"8",
	);
	const at = { x: 0, y: 0 };
	assert.equal(createPad(4, at, "smd", "8", "F.SilkS").layer, "F.Cu");
	assert.equal(createPad(4, at, "smd", "8", "B.Cu").layer, "B.Cu");
	const through = createPad(5, at, "through-hole", "9", "B.Cu");
	assert.deepEqual(
		[through.layer, through.kind, through.pad.drill],
		["F.Cu", "circle", 1],
	);
});

test("pad edits keep the pad valid and on its side of the board", () => {
	const back = createPad(1, { x: 0, y: 0 }, "smd", "1", "B.Cu");
	const through = editPad(back, { attribute: "type", value: "through-hole" });
	assert.equal(through.pad.drill, 0.6);
	assert.equal(editorShapeSchema.safeParse(through).success, true);
	const surface = editPad(through, { attribute: "type", value: "smd" });
	assert.deepEqual(surface, back);
	const round = editPad(through, { attribute: "shape", value: "circle" });
	assert.deepEqual([round.kind, round.width, round.height], ["circle", 1, 1]);
	assert.equal(editorShapeSchema.safeParse(round).success, true);
	assert.equal(editPad(through, { attribute: "drill", value: 5 }), through);
	assert.equal(
		editPad(through, { attribute: "drill", value: 0.3 }).pad.drill,
		0.3,
	);
	assert.equal(
		editPad(back, { attribute: "number", value: "GND" }).pad.number,
		"GND",
	);
});

test("shrinking a through-hole pad below its drill shrinks the drill with it", () => {
	const pad = createPad(2, { x: 0, y: 0 }, "through-hole", "2", "F.Cu");
	const byAttribute = editShapeAttribute(pad, "radius", 0.4);
	const byHandle = resizeShape(pad, required(resizeHandles(pad)[0]), {
		x: 0.6,
		y: 0,
	});
	for (const shrunk of [byAttribute, byHandle]) {
		assert.equal(editorShapeSchema.safeParse(shrunk).success, true);
		assert.ok(isPad(shrunk) && required(shrunk.pad.drill) < shrunk.width);
	}
});

test("layer changes move graphics freely and pads only between copper sides", () => {
	const line = silkLine(1);
	const smd = createPad(2, { x: 0, y: 0 }, "smd", "1", "F.Cu");
	const through = createPad(3, { x: 0, y: 0 }, "through-hole", "2", "F.Cu");
	assert.equal(setShapeLayer(line, "F.Fab").layer, "F.Fab");
	assert.equal(setShapeLayer(smd, "B.Cu").layer, "B.Cu");
	assert.equal(setShapeLayer(smd, "F.SilkS"), smd);
	assert.equal(setShapeLayer(through, "B.Cu"), through);
	const moved = required(
		applySelectionEdit(
			{ kind: "layer", layer: "B.SilkS" },
			editContext([line, smd]),
		),
	);
	assert.deepEqual(
		moved.replacements.map((shape) => shape.layer),
		["B.SilkS", "F.Cu"],
	);
});

test("filling a selection fills its hollow graphics and leaves pads and lines alone", () => {
	const filled = required(
		applySelectionEdit(
			{ kind: "fill", filled: true },
			editContext(twoPadsWireCourtyardAndThroughHole()),
		),
	);
	assert.deepEqual(ids(filled.replacements), [4]);
});

test("the layer view hides layers and draws the active layer last", () => {
	const shapes = twoPadsWireCourtyardAndThroughHole();
	assert.deepEqual(
		ids(footprintLayerView(shapes, noLayers, "F.Cu")),
		[3, 4, 1, 2, 5],
	);
	assert.deepEqual(
		ids(footprintLayerView(shapes, noLayers, "F.SilkS")),
		[1, 2, 5, 4, 3],
	);
});

test("without an active layer the view keeps board order, as export does", () => {
	assert.deepEqual(
		ids(footprintLayerView(twoPadsWireCourtyardAndThroughHole(), noLayers)),
		[1, 2, 5, 3, 4],
	);
});

test("a through-hole pad shows until both copper layers are hidden", () => {
	const shapes = twoPadsWireCourtyardAndThroughHole();
	assert.deepEqual(
		ids(footprintLayerView(shapes, new Set(["F.Cu"]), "F.SilkS")),
		[5, 4, 3],
	);
	assert.deepEqual(
		ids(footprintLayerView(shapes, new Set(["F.Cu", "B.Cu"]), "F.SilkS")),
		[4, 3],
	);
});

test("the editor session edits visible shapes without touching hidden ones", () => {
	const hidden = new Set<FootprintLayer>(["F.Cu"]);
	const session = createEditorSession(
		createDrawingStore(
			twoPadsWireCourtyardAndThroughHole().filter((shape) => shape.id !== 5),
		),
		(shapes) => footprintLayerView(shapes, hidden, "F.SilkS"),
	);
	assert.deepEqual(ids(session.shapes()), [4, 3]);
	session.select(new Set([1, 3]));
	assert.deepEqual([...session.getState().selection], [3]);
	session.replace(
		[{ ...required(session.shapes()[1]), y: 2 }],
		"Move selection",
	);
	const saved = session.drawing().shapes;
	assert.equal(saved.length, 4);
	assert.equal(required(saved.find((shape) => shape.id === 3)).y, 2);
	assert.ok(saved.some((shape) => shape.id === 1 && isPad(shape)));
});

test("a click inside a hollow outline picks the pad under it, and a click on the outline picks the outline", () => {
	const pad = createPad(1, { x: -0.9, y: 0 }, "smd", "1", "F.Cu");
	const outlineOnTop = [pad, silkText(2), courtyard(3)];
	assert.equal(shapeAt(outlineOnTop, { x: -0.9, y: 0 }, 0.05)?.id, 1);
	assert.equal(shapeAt(outlineOnTop, { x: 0, y: 2 }, 0.05)?.id, 2);
	const innerHalfOfStroke = { x: 1.95, y: 0.3 };
	const outerHalfOfStroke = { x: 2.06, y: 0.3 };
	const pastTheStroke = { x: 2.2, y: 0.3 };
	assert.equal(shapeAt(outlineOnTop, innerHalfOfStroke, 0.01)?.id, 3);
	assert.equal(shapeAt(outlineOnTop, outerHalfOfStroke, 0.01)?.id, 3);
	assert.equal(shapeAt(outlineOnTop, pastTheStroke, 0.01), undefined);
	const squareOuterCorner = { x: 2.06, y: 1.06 };
	assert.equal(shapeAt(outlineOnTop, squareOuterCorner, 0.01)?.id, 3);
	assert.equal(shapeAt(outlineOnTop, { x: 0.2, y: -0.8 }, 0.05)?.id, 3);
	const filledOnTop = [pad, courtyard(3, true)];
	assert.equal(shapeAt(filledOnTop, { x: -0.9, y: 0 }, 0.05)?.id, 3);
	const schematic = [
		drawShape(1, "line", { x: -1, y: 0 }, { x: 1, y: 0 }),
		drawShape(2, "rectangle", { x: -2, y: -1 }, { x: 2, y: 1 }),
	];
	assert.equal(shapeAt(schematic, { x: 0, y: 0 }, 0.05)?.id, 2);
});

test("every side of a hollow triangle picks it across the whole stroke", () => {
	const triangle: EditorShape = {
		id: 1,
		kind: "triangle",
		layer: "F.CrtYd",
		x: 0,
		y: 0,
		width: 4,
		height: 4,
		rotation: 0,
		lineWidth: 0.15,
	};
	const slantLength = Math.hypot(2, 4);
	const outwardFromRightEdge = (distance: number) => ({
		x: 1 + (distance * 4) / slantLength,
		y: (distance * 2) / slantLength,
	});
	for (const distance of [-0.06, 0, 0.06])
		assert.equal(
			shapeAt([triangle], outwardFromRightEdge(distance), 0.01)?.id,
			1,
		);
	assert.equal(shapeAt([triangle], outwardFromRightEdge(0.2), 0.01), undefined);
	const mitredTipAboveTheApex = { x: 0, y: 2.1 };
	const pastTheTip = { x: 0, y: 2.3 };
	assert.equal(shapeAt([triangle], mitredTipAboveTheApex, 0.01)?.id, 1);
	assert.equal(shapeAt([triangle], pastTheTip, 0.01), undefined);
	const pad = createPad(2, { x: 0, y: -1 }, "smd", "1", "F.Cu");
	assert.equal(shapeAt([pad, triangle], { x: 0, y: -1 }, 0.01)?.id, 2);
});

test("a click inside nested outlines picks the smallest one, whichever was drawn last", () => {
	const inner = courtyard(1);
	const outer: EditorShape = { ...courtyard(2), width: 8, height: 6 };
	const insideBoth = { x: 1, y: 0.5 };
	assert.equal(shapeAt([inner, outer], insideBoth, 0.01)?.id, 1);
	assert.equal(shapeAt([outer, inner], insideBoth, 0.01)?.id, 1);
	assert.equal(shapeAt([inner, outer], { x: 3, y: 0.5 }, 0.01)?.id, 2);
});

test("a dragged pad keeps its centre on the grid, and a dragged graphic keeps its corner there", () => {
	const pad = createPad(1, { x: 0, y: 0 }, "smd", "1", "F.Cu");
	assert.deepEqual(snappedMoveDelta(pad, { x: 1.02, y: -0.98 }, 0.1), {
		x: 1,
		y: -1,
	});
	const graphic: EditorShape = { ...courtyard(2), width: 1, height: 1.5 };
	const corner = snappedMoveDelta(graphic, { x: 1.02, y: -0.98 }, 0.1);
	assert.ok(Math.abs(corner.x - 1) < 1e-9);
	assert.ok(Math.abs(corner.y - -0.95) < 1e-9);
});

test("dragging out a shape keeps the layer and stroke it started with", () => {
	const start = {
		...drawShape(9, "rectangle", { x: 0, y: 0 }, { x: 0, y: 0 }),
		layer: "F.CrtYd" as const,
		lineWidth: 0.05,
	};
	const { effect } = canvasDragStep(
		{
			pointerId: 1,
			canvas: {} as HTMLCanvasElement,
			start: { x: 0, y: 0 },
			startScreen: { x: 0, y: 0 },
			plane: 0,
			previousSelection: new Set(),
			mode: "draw",
			previousChild: null,
			gridStep: 0.1,
			moved: false,
			originals: [start],
			initialShapes: [],
			created: true,
			valid: false,
			selectionMode: "replace",
		},
		{ x: 2, y: 1 },
		{ x: 200, y: 100 },
		{
			shapes: [],
			allowLocked: false,
			cameraScale: () => 100,
			nextId: () => 10,
		},
	);
	assert.equal(effect.kind, "preview");
	const draft = required(
		effect.kind === "preview" ? effect.replacements[0] : undefined,
	);
	assert.deepEqual(
		[draft.layer, draft.lineWidth, draft.width, draft.height],
		["F.CrtYd", 0.05, 2, 1],
	);
});

test("pasting into a footprint works beside text, puts layerless items on the active layer and drops their page", () => {
	const existing = [
		silkText(1),
		createPad(2, { x: 0, y: 0 }, "smd", "1", "F.Cu"),
	];
	const fromSchematic = {
		...drawShape(7, "rectangle", { x: 0, y: 0 }, { x: 2, y: 1 }),
		page: 2,
	};
	const pasted = pasteSelection(
		[required(existing[1]), fromSchematic],
		existing,
		3,
		{ x: 0.5, y: -0.5 },
		{ footprintLayer: "F.Fab" },
	);
	assert.deepEqual(
		pasted.map((shape) => [shape.id, shape.layer, isPad(shape)]),
		[
			[3, "F.Cu", true],
			[4, "F.Fab", false],
		],
	);
	const session = createEditorSession(createDrawingStore(existing));
	session.place(pasted, "Paste selection");
	const saved = footprintFileWithShapes(
		createEmptyFootprintFile("Pasted", []),
		session.drawing().shapes,
	);
	assert.equal(saved.shapes.length, 4);
	assert.ok(saved.shapes.every((shape) => shape.page === undefined));
});

test("a footprint refuses pasted pins, schematic wires, net labels and symbols", () => {
	for (const shape of [
		drawShape(1, "pin", { x: 0, y: 0 }, { x: 0, y: 0 }),
		drawShape(1, "wire", { x: 0, y: 0 }, { x: 2, y: 0 }),
		{ ...createTextShape(1, { x: 0, y: 0 }, measure), electrical: "net" },
	] as EditorShape[])
		assert.throws(
			() =>
				pasteSelection(
					[shape],
					[],
					1,
					{ x: 0, y: 0 },
					{ footprintLayer: "F.Cu" },
				),
			/cannot be pasted into it/,
		);
});

test("footprint items pasted into a schematic or symbol lose their layer and pad", () => {
	const source = [
		createPad(1, { x: 0, y: 0 }, "smd", "1", "F.Cu"),
		silkText(2),
	];
	for (const destination of ["drawing", "symbol"] as const) {
		const pasted = pasteSelection(source, [], 1, { x: 0, y: 0 }, destination);
		assert.deepEqual(
			pasted.map((shape) => [
				shape.kind,
				shape.layer,
				"pad" in shape,
				"filled" in shape,
			]),
			[
				["rectangle", undefined, false, false],
				["text", undefined, false, false],
			],
		);
	}
});

test("the display colours items by layer and draws a pad as solid copper with its hole and number", () => {
	const shapes = twoPadsWireCourtyardAndThroughHole();
	const display = buildDrawingDisplay(shapes, new Set([2]), [], measure);
	assert.deepEqual(
		display.shapes.map((shape) => shape.appearance),
		["F.Cu", "selected", "F.SilkS", "F.CrtYd", "pad-through"],
	);
	const [smd, , , , through] = display.shapes;
	assert.deepEqual(smd.geometry, {
		kind: "rectangle",
		width: 1,
		height: 1.5,
		lineWidth: 0,
		filled: true,
	});
	assert.deepEqual(
		smd.children?.map((child) => [child.name, child.text, child.appearance]),
		[["pad number 1", "1", "pad-number"]],
	);
	assert.deepEqual(
		through.children?.map((child) => [child.name, child.appearance]),
		[
			["pad hole 5", "pad-hole"],
			["pad number 5", "pad-number"],
		],
	);
	const hole = required(through.children?.[0]);
	assert.ok(Math.abs(hole.width * through.width - 1) < 1e-9);
});

test("a filled footprint graphic is solid in its layer's colour, and a rotated pad keeps its number level", () => {
	const filled = buildDrawingDisplay([courtyard(1, true)], new Set());
	assert.equal(filled.shapes[0].children?.[0].appearance, "F.CrtYd");
	const rotated = buildDrawingDisplay(
		[
			{
				...createPad(1, { x: 0, y: 0 }, "smd", "1", "F.Cu"),
				rotation: Math.PI / 2,
			},
		],
		new Set(),
		[],
		measure,
	);
	assert.equal(rotated.shapes[0].children?.[0].rotation, -Math.PI / 2);
});

test("an exported footprint keeps its layer colours and pad holes", () => {
	const svg = exportDrawingSvg(twoPadsWireCourtyardAndThroughHole(), {
		width: 400,
		height: 300,
		area: "drawing",
		background: "dark",
		sheet: defaultSheet,
		measureText: measure,
	});
	assert.match(svg, /fill="#c83434"/);
	assert.match(svg, /data-name="pad hole 5"/);
});

test("an exported rotated pad draws its number upright and unsheared", () => {
	const svg = exportDrawingSvg(
		[
			{
				...createPad(1, { x: 0, y: 0 }, "smd", "1", "F.Cu"),
				rotation: Math.PI / 2,
			},
		],
		{
			width: 400,
			height: 300,
			area: "drawing",
			background: "dark",
			sheet: defaultSheet,
			measureText: measure,
		},
	);
	const [, matrix] = required(
		/data-name="pad number 1"><g transform="matrix\(([^)]+)\)"/.exec(svg),
	);
	const [scaleX, skewY, skewX, scaleY] = matrix.split(" ").map(Number);
	assert.ok(Math.abs(skewY) < 1e-9 && Math.abs(skewX) < 1e-9);
	assert.ok(scaleX > 0 && Math.abs(scaleX - scaleY) < 1e-9);
});

test("footprint files keep layers and pads and get an ID from their name", () => {
	const empty = createEmptyFootprintFile("R 0805", []);
	assert.deepEqual(
		[empty.id, empty.name, empty.shapes],
		["r-0805", "R 0805", []],
	);
	assert.equal(createEmptyFootprintFile("R 0805", [empty]).id, "r-0805-2");
	assert.equal(createEmptyFootprintFile("§§", []).id, "footprint");
	const file = footprintFileWithShapes(
		empty,
		twoPadsWireCourtyardAndThroughHole(),
	);
	assert.deepEqual(footprintFileSchema.parse(structuredClone(file)), file);
	assert.deepEqual(file.shapes, twoPadsWireCourtyardAndThroughHole());
	assert.throws(() => footprintFileSchema.parse({ ...file, id: "R" }));
});

test("a footprint item saved without a layer is read as front silkscreen", () => {
	const empty = createEmptyFootprintFile("R 0805", []);
	const layerless = drawShape(1, "rectangle", { x: -1, y: -1 }, { x: 1, y: 1 });
	assert.equal(
		footprintFileWithShapes(empty, [layerless]).shapes[0].layer,
		"F.SilkS",
	);
});

test("footprint files reject schematic items, pages and duplicate IDs", () => {
	const empty = createEmptyFootprintFile("R 0805", []);
	const rejected: [EditorShape[], RegExp][] = [
		[
			[drawShape(1, "pin", { x: 0, y: 0 }, { x: 0, y: 0 })],
			/cannot contain a pin/,
		],
		[
			[drawShape(1, "wire", { x: 0, y: 0 }, { x: 2, y: 0 })],
			/cannot contain a wire/,
		],
		[
			[{ ...createTextShape(1, { x: 0, y: 0 }, measure), electrical: "net" }],
			/net labels/,
		],
		[[{ ...silkLine(1), page: 2 }], /no page/],
		[[silkLine(1), silkLine(1)], /Duplicate shape ID 1/],
	];
	for (const [shapes, message] of rejected)
		assert.throws(() => footprintFileWithShapes(empty, shapes), message);
});

test("the board has one object per stack layer, drills for through-hole pads and an edge 1 mm outside them", () => {
	const board = footprintBoard([
		...twoPadsWireCourtyardAndThroughHole(),
		silkText(9),
	]);
	assert.deepEqual(
		board.map((layer) => [layer.id, layer.objects.length]),
		[
			[BOARD_LAYER_ID, 1],
			["footprint:F.Cu", 3],
			["footprint:B.Cu", 1],
			["footprint:F.SilkS", 1],
			[DRILL_LAYER_ID, 1],
		],
	);
	const profileTopCopperBottomCopperTopLegendDrill = [9, 3, 5, 0, 10];
	assert.deepEqual(
		board.map(
			(layer) =>
				classifyGerberLayer(
					layer.name,
					layer.metadata[".FileFunction"]?.join(","),
				)[0],
		),
		profileTopCopperBottomCopperTopLegendDrill,
	);
	const edge = required(board[0]).bounds;
	assert.deepEqual(
		boardEdgeBounds([...twoPadsWireCourtyardAndThroughHole(), silkText(9)]),
		edge,
	);
	const courtyardStrokeEdge = -2.075;
	const throughHolePadTop = 3.85;
	assert.ok(Math.abs(edge.minX - (courtyardStrokeEdge - 1)) < 1e-9);
	assert.ok(Math.abs(edge.maxY - (throughHolePadTop + 1)) < 1e-9);
	for (const layer of board)
		assert.ok(compilePlanarGeometry(layer.objects).positions.length > 0);
});

test("an empty footprint has no board, and one with only text has just an edge", () => {
	assert.deepEqual(footprintBoard([]), []);
	assert.deepEqual(
		footprintBoard([silkText(1)]).map((layer) => layer.id),
		[BOARD_LAYER_ID],
	);
});

test("a rotated pad's copper turns with it on the board", () => {
	const board = footprintBoard([
		{
			...createPad(1, { x: 0, y: 0 }, "smd", "1", "F.Cu"),
			rotation: Math.PI / 2,
		},
	]);
	const { positions } = compilePlanarGeometry(required(board[1]).objects);
	const xs = [...positions].filter((_, index) => index % 3 === 0);
	const ys = [...positions].filter((_, index) => index % 3 === 1);
	assert.ok(Math.abs(Math.max(...xs) - 0.75) < 1e-6);
	assert.ok(Math.abs(Math.max(...ys) - 0.5) < 1e-6);
});

test("hiding a layer hides its board object, and drills hide with the last copper layer", () => {
	const frontCopperHidden = new Set<FootprintLayer>(["F.Cu"]);
	assert.equal(boardObjectVisible("footprint:F.Cu", frontCopperHidden), false);
	assert.equal(boardObjectVisible("footprint:B.Cu", frontCopperHidden), true);
	assert.equal(boardObjectVisible(DRILL_LAYER_ID, frontCopperHidden), true);
	assert.equal(boardObjectVisible(BOARD_LAYER_ID, frontCopperHidden), true);
	assert.equal(
		boardObjectVisible(DRILL_LAYER_ID, new Set(["F.Cu", "B.Cu"])),
		false,
	);
});

test("the view fits the footprint exactly, or 4 by 3 mm around the origin while it is empty", () => {
	assert.deepEqual(footprintFitBounds([]), {
		minX: -2,
		minY: -1.5,
		maxX: 2,
		maxY: 1.5,
	});
	const tinyPad = (x: number): EditorShape => ({
		...createPad(1, { x, y: 0 }, "smd", "1", "F.Cu"),
		width: 0.3,
		height: 0.3,
	});
	const small = footprintFitBounds([tinyPad(-0.3), tinyPad(0.3)]);
	assert.ok(Math.abs(small.minX - -0.45) < 1e-9);
	assert.ok(Math.abs(small.maxX - 0.45) < 1e-9);
	assert.ok(Math.abs(small.maxY - 0.15) < 1e-9);
	const mixed = footprintFitBounds(twoPadsWireCourtyardAndThroughHole());
	assert.ok(Math.abs(mixed.minX - -2) < 1e-9);
	assert.ok(Math.abs(mixed.maxY - 3.85) < 1e-9);
});

function memoryDirectory(): ProjectDirectory & {
	files: Map<string, Uint8Array>;
} {
	const files = new Map<string, Uint8Array>();
	return {
		name: "memory",
		files,
		async read(path) {
			const bytes = files.get(path);
			if (!bytes) throw Object.assign(new Error("missing"), { code: "ENOENT" });
			return bytes;
		},
		async write(path, bytes) {
			files.set(path, bytes);
		},
		async remove(path) {
			for (const name of [...files.keys()])
				if (name === path || name.startsWith(`${path}/`)) files.delete(name);
		},
	};
}

for (const layout of ["files", "revisions"] as const)
	test(`a project saves footprints as .ecadfp files and reads them back (${layout})`, async () => {
		const directory = memoryDirectory();
		const repository = new ProjectRepository(directory, { layout });
		const created = await repository.create("Board");
		assert.equal(created.manifest.footprints, undefined);
		const footprint = footprintFileWithShapes(
			createEmptyFootprintFile("R 0805", []),
			twoPadsWireCourtyardAndThroughHole(),
		);
		const saved = await repository.save({
			shapes: [],
			symbols: [],
			footprints: [footprint],
		});
		const path = required(saved.manifest.footprints?.[0]);
		assert.match(path, /footprints\/r-0805\.ecadfp$/);
		assert.deepEqual(
			JSON.parse(new TextDecoder().decode(required(directory.files.get(path)))),
			footprint,
		);
		assert.equal(projectIndex(saved).footprintsByPath.get(path)?.id, "r-0805");
		assert.ok(
			projectFileSelections(saved).some(
				(entry) => entry.id === "footprint:r-0805" && entry.path === path,
			),
		);
		const savedWithoutNamingFootprints = await repository.save({
			shapes: [],
			symbols: [],
		});
		assert.deepEqual(savedWithoutNamingFootprints.footprints, [footprint]);
		const reopened = await new ProjectRepository(directory, { layout }).load();
		assert.deepEqual(reopened.footprints, [footprint]);
		await assert.rejects(
			repository.save({
				shapes: [],
				symbols: [],
				footprints: [footprint, footprint],
			}),
			/duplicate footprint IDs/,
		);
		const removed = await repository.save({
			shapes: [],
			symbols: [],
			footprints: [],
		});
		assert.deepEqual(removed.manifest.footprints, []);
		if (layout === "files") assert.equal(directory.files.has(path), false);
	});

function memorySession() {
	let current: ProjectSnapshot = {
		directory: "test",
		manifest: {
			format: "ecad-project",
			version: 1,
			name: "Test",
			drawing: "main.ecaddraw",
			symbols: [],
			assets: [],
		},
		shapes: [],
		symbols: [],
	};
	const storage: ProjectStorage = {
		mode: "web",
		load: async () => current,
		list: async () => [],
		open: async () => current,
		create: async () => current,
		async save(_directory, document) {
			current = {
				...current,
				...document,
				manifest: {
					...current.manifest,
					footprints: (document.footprints ?? current.footprints ?? []).map(
						(file) => `footprints/${file.id}.ecadfp`,
					),
				},
			};
			return current;
		},
		importAssets: async () => current,
		readAsset: async () => new Uint8Array(),
	};
	const symbols: SymbolLibraryStorage = {
		mode: "memory",
		load: async () => ({ symbols: [] }),
		save: async () => "Saved",
	};
	return {
		session: createProjectSession(storage, symbols),
		saved: () => current,
	};
}

test("a project session creates a footprint, opens it and autosaves its edits", async () => {
	const { session, saved } = memorySession();
	const stop = session.connect();
	await new Promise<void>((resolve) => {
		const unsubscribe = session.subscribe(() => {
			if (!session.getSnapshot().busy) {
				unsubscribe();
				resolve();
			}
		});
	});
	const path = await session.getSnapshot().createFootprint("R 0805");
	assert.equal(path, "footprints/r-0805.ecadfp");
	assert.equal(await session.getSnapshot().selectEditorFile(path), true);
	const document = required(session.getSnapshot().editorFootprint);
	assert.equal(document.file.name, "R 0805");
	assert.equal(session.getSnapshot().editorSymbol, null);

	const editor = createEditorSession(document.store);
	const disconnect = editor.connect(document.store, () => undefined);
	editor.place(twoPadsWireCourtyardAndThroughHole(), "Place footprint");
	assert.equal(session.getSnapshot().dirty, true);
	await session.getSnapshot().save();
	assert.equal(session.getSnapshot().dirty, false);
	assert.deepEqual(
		required(saved().footprints?.[0]).shapes,
		twoPadsWireCourtyardAndThroughHole(),
	);

	await session.getSnapshot().selectEditorFile();
	assert.equal(session.getSnapshot().editorFootprint, null);
	await session.getSnapshot().selectEditorFile(path);
	assert.equal(session.getSnapshot().editorFootprint?.store, document.store);

	const sameName = await session.getSnapshot().createFootprint("R 0805");
	assert.equal(sameName, "footprints/r-0805-2.ecadfp");
	assert.equal(saved().footprints?.length, 2);
	assert.deepEqual(
		required(saved().footprints?.[0]).shapes,
		twoPadsWireCourtyardAndThroughHole(),
	);
	disconnect();
	stop();
});
