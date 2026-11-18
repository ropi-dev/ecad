import assert from "node:assert/strict";
import test from "node:test";
import { generateDefaultFootprints } from "@ecad/default-footprints";
import {
	analyzeConnectivity,
	copperItems,
} from "@ecad/drawing-core/board/connectivity.ts";
import { checkBoard } from "@ecad/drawing-core/board/drc.ts";
import {
	boardPads,
	type FootprintSource,
} from "@ecad/drawing-core/board/footprints.ts";
import { trackSegment } from "@ecad/drawing-core/board/geometry.ts";
import { boardNetlist } from "@ecad/drawing-core/board/netlist.ts";
import {
	free,
	routingGrid,
	ruleVia,
} from "@ecad/drawing-core/board/routing-grid.ts";
import {
	type BoardRules,
	boardRulesSchema,
	defaultBoardRules,
} from "@ecad/drawing-core/board/rules.ts";
import { synchronizeBoard } from "@ecad/drawing-core/board/sync.ts";
import {
	type Circuit,
	createCircuit,
} from "@ecad/drawing-core/circuit/model.ts";
import { editorShapeSchema } from "@ecad/drawing-core/drawing/schema.ts";
import type { EditorShape } from "@ecad/drawing-core/drawing/shapes.ts";
import type { Point } from "@ecad/drawing-core/drawing/types.ts";
import {
	boardCopperLayers,
	boardLayers,
	type CopperLayer,
	copperLayerCounts,
	type FootprintLayer,
} from "@ecad/drawing-core/footprint/layers.ts";
import {
	createPad,
	createVia,
	footprintLayerView,
	stackDrawOrder,
} from "@ecad/drawing-core/footprint/shapes.ts";
import { fillZones, layerFill } from "#/board/fill.ts";
import {
	boardCopperLayersInUse,
	boardFileSchema,
	createBoardFile,
} from "#/board/format.ts";
import { exportFabrication } from "#/board/gerber.ts";
import { trackAnchor } from "#/board/routing.ts";
import { pasteSelection } from "#/drawing/clipboard.ts";
import {
	BOARD_SURFACE_Z,
	boardObjectVisible,
	DRILL_LAYER_ID,
	footprintBoardPlacer,
	layerSurfaceZ,
	planFootprintBoard,
} from "#/footprint/board.ts";
import { footprintFileSchema } from "#/footprint/format.ts";
import { parseGerber } from "#/formats/gerber/index.ts";
import { required } from "./helpers/required.ts";

const library = new Map(
	generateDefaultFootprints().map(({ file }) => [file.id, file]),
);
const r0805 = { library: "builtin", id: "r_0805_2012metric" } as const;
const source = (): FootprintSource | undefined => {
	const file = library.get(r0805.id);
	return file && { reference: r0805, name: file.name, shapes: file.shapes };
};
const pin = (component: string, number: string) => ({
	id: `${component}.${number}`,
	name: "",
	number,
	electricalType: "passive" as const,
});

function dividerCircuit(): Circuit {
	return {
		...createCircuit("Divider", "pcb-main").circuit,
		components: ["R1", "R2"].map((reference) => ({
			id: reference,
			reference,
			value: "10k",
			part: { id: "resistor", name: "Resistor" },
			pins: [pin(reference, "1"), pin(reference, "2")],
		})),
		nets: [
			{ id: "mid", names: ["MID"], pinIds: ["R1.2", "R2.1"] },
			{ id: "gnd", names: ["GND"], pinIds: ["R1.1", "R2.2"] },
		],
	};
}

let nextId = 5000;

const track = (
	from: Point,
	to: Point,
	layer: CopperLayer,
	net: string,
): EditorShape => trackSegment(nextId++, from, to, layer, 0.25, net);

const fourLayers: BoardRules = { ...defaultBoardRules, copperLayers: 4 };

function dividerBoard() {
	const circuit = dividerCircuit();
	const footprints = synchronizeBoard({
		shapes: [],
		circuit,
		footprintOf: () => r0805,
		source,
		nextId: 1000,
	}).place;
	const netlist = boardNetlist(circuit);
	const midPads = boardPads(footprints)
		.filter((pad) => netlist.padNet(pad.component, pad.number) === "mid")
		.map((pad) => ({ x: pad.shape.x, y: pad.shape.y }));
	const [from, to] = midPads;
	const center = { x: (from.x + to.x) / 2, y: from.y };
	const outline: EditorShape = {
		id: nextId++,
		kind: "rectangle",
		layer: "Edge.Cuts",
		x: center.x,
		y: center.y,
		width: 30,
		height: 20,
		rotation: 0,
		lineWidth: 0.1,
	};
	return { netlist, footprints, outline, from, to, center };
}

const unrouted = (
	shapes: readonly EditorShape[],
	netlist: ReturnType<typeof boardNetlist>,
) =>
	[
		...new Set(
			analyzeConnectivity(copperItems(shapes, netlist)).ratsnest.map(
				(line) => line.net,
			),
		),
	].sort();

test("a board stacks its inner copper layers between front and back copper", () => {
	assert.deepEqual(boardCopperLayers(2), ["F.Cu", "B.Cu"]);
	assert.deepEqual(boardCopperLayers(6), [
		"F.Cu",
		"In1.Cu",
		"In2.Cu",
		"In3.Cu",
		"In4.Cu",
		"B.Cu",
	]);
	assert.deepEqual(boardLayers(4).slice(0, 5), [
		"F.Cu",
		"In1.Cu",
		"In2.Cu",
		"B.Cu",
		"F.SilkS",
	]);
	assert.equal(copperLayerCounts.at(-1), 32);
	assert.equal(boardCopperLayers(32).at(-2), "In30.Cu");
});

test("board rules take an even copper layer count from 2 to 32, and boards saved before it have 2", () => {
	assert.equal(
		boardRulesSchema.parse({ ...defaultBoardRules }).copperLayers,
		2,
	);
	const { copperLayers: _count, ...older } = defaultBoardRules;
	assert.equal(boardRulesSchema.parse(older).copperLayers, 2);
	for (const count of [4, 32])
		assert.equal(
			boardRulesSchema.safeParse({ ...defaultBoardRules, copperLayers: count })
				.success,
			true,
		);
	for (const count of [0, 3, 34, 2.5])
		assert.equal(
			boardRulesSchema.safeParse({ ...defaultBoardRules, copperLayers: count })
				.success,
			false,
		);
});

test("a board file keeps items only on the inner layers its count includes", () => {
	const board = createBoardFile("Four", "circuit");
	const on = (layer: FootprintLayer): EditorShape => ({
		...track({ x: 0, y: 0 }, { x: 5, y: 0 }, "F.Cu", "mid"),
		layer,
	});
	const accepted = boardFileSchema.safeParse({
		...board,
		rules: fourLayers,
		shapes: [on("In2.Cu")],
	});
	assert.equal(accepted.success, true);
	const rejected = boardFileSchema.safeParse({
		...board,
		rules: fourLayers,
		shapes: [on("In3.Cu")],
	});
	assert.equal(rejected.success, false);
	assert.match(
		rejected.error?.issues[0]?.message ?? "",
		/In3\.Cu is not one of the board's 4 copper layers/,
	);
	assert.equal(
		boardFileSchema.safeParse({ ...board, shapes: [on("In1.Cu")] }).success,
		false,
	);
});

test("pads stay on the outer layers and footprints have no inner copper", () => {
	const pad = createPad(1, { x: 0, y: 0 }, "smd", "1", "F.Cu");
	assert.equal(editorShapeSchema.safeParse(pad).success, true);
	assert.equal(
		editorShapeSchema.safeParse({ ...pad, layer: "In1.Cu" }).success,
		false,
	);
	assert.equal(
		editorShapeSchema.safeParse(
			track({ x: 0, y: 0 }, { x: 1, y: 0 }, "In1.Cu", "mid"),
		).success,
		true,
	);
	const footprint = footprintFileSchema.safeParse({
		format: "ecad-footprint",
		version: 1,
		units: "mm",
		id: "inner",
		name: "Inner",
		shapes: [
			{
				id: 1,
				kind: "line",
				layer: "In1.Cu",
				x: 0,
				y: 0,
				width: 1,
				height: 0,
				rotation: 0,
				lineWidth: 0.2,
			},
		],
	});
	assert.equal(footprint.success, false);
});

test("an inner layer track joins pads through vias, and not without them", () => {
	const { netlist, footprints, outline, from, to } = dividerBoard();
	const low = (point: Point) => ({ x: point.x, y: point.y - 4 });
	const inner = track(low(from), low(to), "In1.Cu", "mid");
	const vias = [low(from), low(to)].map((point) =>
		ruleVia(nextId++, point, fourLayers, "mid"),
	);
	const stubs = [
		track(from, low(from), "F.Cu", "mid"),
		track(to, low(to), "F.Cu", "mid"),
	];
	const base = [...footprints, outline];
	assert.deepEqual(unrouted([...base, ...stubs, inner], netlist), [
		"gnd",
		"mid",
	]);
	assert.deepEqual(unrouted([...base, ...stubs, inner, ...vias], netlist), [
		"gnd",
	]);
	assert.deepEqual(
		unrouted([...base, track(from, to, "In1.Cu", "mid")], netlist),
		["gnd", "mid"],
	);
});

test("copper on different inner layers may cross, and copper on the same one may not", () => {
	const { netlist, footprints, outline, center } = dividerBoard();
	const across = (layer: CopperLayer, net: string, vertical: boolean) =>
		track(
			vertical
				? { x: center.x, y: center.y - 6 }
				: { x: center.x - 3, y: center.y - 3 },
			vertical
				? { x: center.x, y: center.y }
				: { x: center.x + 3, y: center.y - 3 },
			layer,
			net,
		);
	const shorts = (shapes: EditorShape[]) =>
		checkBoard(shapes, netlist, fourLayers).filter(
			(finding) => finding.kind === "short",
		).length;
	const base = [...footprints, outline];
	assert.equal(
		shorts([
			...base,
			across("In1.Cu", "mid", true),
			across("In2.Cu", "gnd", false),
		]),
		0,
	);
	assert.equal(
		shorts([
			...base,
			across("In1.Cu", "mid", true),
			across("In1.Cu", "gnd", false),
		]),
		1,
	);
	const via = ruleVia(nextId++, { x: center.x, y: center.y - 3 }, fourLayers);
	assert.equal(
		shorts([...base, across("In2.Cu", "gnd", false), { ...via, net: "mid" }]),
		1,
	);
});

test("a zone fills an inner layer and connects the vias on its net", () => {
	const { netlist, footprints, outline, center } = dividerBoard();
	const zone: EditorShape = {
		id: nextId++,
		kind: "rectangle",
		layer: "In2.Cu",
		x: center.x,
		y: center.y,
		width: 26,
		height: 16,
		rotation: 0,
		lineWidth: 0.1,
		zone: {},
		net: "gnd",
	};
	const via = ruleVia(
		nextId++,
		{ x: center.x, y: center.y + 5 },
		fourLayers,
		"gnd",
	);
	const shapes = [...footprints, outline, zone, via];
	const fills = fillZones(shapes, netlist, fourLayers);
	assert.ok(layerFill(fills, "In2.Cu").length > 0);
	assert.deepEqual(layerFill(fills, "F.Cu"), []);
	assert.deepEqual(layerFill(fills, "In1.Cu"), []);
});

test("the Gerber export writes each inner layer as KiCad names and numbers it", () => {
	const via = { ...createVia(1, { x: 2, y: 3 }), net: "gnd" };
	const inner = track({ x: 0, y: 0 }, { x: 4, y: 0 }, "In2.Cu", "gnd");
	const files = exportFabrication("stack", [via, inner], [], 0.05, 4);
	const names = files.map((file) => file.name);
	assert.deepEqual(names.slice(0, 4), [
		"stack-F_Cu.gtl",
		"stack-In1_Cu.g1",
		"stack-In2_Cu.g2",
		"stack-B_Cu.gbl",
	]);
	const content = (name: string) =>
		required(files.find((file) => file.name === name)).content;
	assert.match(
		content("stack-In1_Cu.g1"),
		/%TF\.FileFunction,Copper,L2,Inr\*%/,
	);
	assert.match(
		content("stack-In2_Cu.g2"),
		/%TF\.FileFunction,Copper,L3,Inr\*%/,
	);
	assert.match(content("stack-B_Cu.gbl"), /%TF\.FileFunction,Copper,L4,Bot\*%/);
	assert.match(content("stack-PTH.drl"), /TF\.FileFunction,Plated,1,4,PTH/);
	const objects = (name: string) =>
		parseGerber(content(name), name).object.objects.length;
	assert.equal(objects("stack-In1_Cu.g1"), 1);
	assert.equal(objects("stack-In2_Cu.g2"), 2);
	assert.match(content("stack-In1_Cu.g1"), /ViaPad/);
	const twoLayer = exportFabrication("stack", [via], [], 0.05).map(
		(file) => file.name,
	);
	assert.equal(
		twoLayer.some((name) => name.includes("In1")),
		false,
	);
});

test("vias and through-hole pads show while any copper layer of the board does", () => {
	const via = createVia(1, { x: 0, y: 0 });
	const outer = new Set<FootprintLayer>(["F.Cu", "B.Cu"]);
	assert.deepEqual(footprintLayerView([via], outer), []);
	assert.deepEqual(
		footprintLayerView([via], outer, undefined, stackDrawOrder),
		[via],
	);
	const inner = track({ x: 0, y: 0 }, { x: 1, y: 0 }, "In1.Cu", "gnd");
	assert.deepEqual(footprintLayerView([inner], new Set()), []);
	assert.deepEqual(
		footprintLayerView([inner], new Set(), undefined, stackDrawOrder),
		[inner],
	);
	assert.equal(boardObjectVisible(DRILL_LAYER_ID, outer), false);
	assert.equal(boardObjectVisible(DRILL_LAYER_ID, outer, 4), true);
});

test("the 3D board places inner copper inside the board, front to back", () => {
	const via = createVia(1, { x: 0, y: 0 });
	const inner = track({ x: 0, y: 0 }, { x: 1, y: 0 }, "In1.Cu", "gnd");
	const plans = planFootprintBoard([via, inner], { copperLayers: 4 });
	const names = plans.map((plan) => plan.build().name);
	for (const layer of ["F.Cu", "In1.Cu", "In2.Cu", "B.Cu"])
		assert.ok(names.includes(layer), layer);
	assert.equal(
		planFootprintBoard([via]).some((plan) => plan.build().name === "In1.Cu"),
		false,
	);
	const place = footprintBoardPlacer(4);
	const z = (name: string) => required(place([{ name, metadata: {} }])[0]).z;
	assert.ok(z("F.Cu") > z("In1.Cu"));
	assert.ok(z("In1.Cu") > z("In2.Cu"));
	assert.ok(z("In2.Cu") > z("B.Cu"));
	assert.ok(z("In1.Cu") > 0 && z("In2.Cu") < 0);
	const hidden = new Set<FootprintLayer>(["F.Cu", "B.Cu"]);
	assert.equal(
		layerSurfaceZ(["F.Cu", "In1.Cu", "In2.Cu", "B.Cu"], hidden, 10, 4),
		z("In1.Cu") - BOARD_SURFACE_Z,
	);
});

test("a board needs enough copper layers for the inner layers its items use", () => {
	const fewestCopperLayers = boardCopperLayersInUse;
	assert.equal(fewestCopperLayers([]), 2);
	const on = (layer: CopperLayer) =>
		track({ x: 0, y: 0 }, { x: 1, y: 0 }, layer, "gnd");
	assert.equal(fewestCopperLayers([on("F.Cu"), on("B.Cu")]), 2);
	assert.equal(fewestCopperLayers([on("In1.Cu")]), 4);
	assert.equal(fewestCopperLayers([on("In2.Cu")]), 4);
	assert.equal(fewestCopperLayers([on("In1.Cu"), on("In3.Cu")]), 6);
});

test("pasting refuses items on a layer the board or footprint does not have", () => {
	const inner = track({ x: 0, y: 0 }, { x: 4, y: 0 }, "In1.Cu", "gnd");
	assert.throws(
		() =>
			pasteSelection(
				[inner],
				[],
				10,
				{ x: 0, y: 0 },
				{
					footprintLayer: "F.Cu",
					layers: boardLayers(2),
				},
			),
		/In1\.Cu, which is not one of the layers here/,
	);
	const [pasted] = pasteSelection(
		[inner],
		[],
		10,
		{ x: 1, y: 0 },
		{
			footprintLayer: "F.Cu",
			layers: boardLayers(4),
		},
	);
	assert.equal(pasted.layer, "In1.Cu");
});

test("the routers keep vias clear of inner copper on other nets but route tracks over it", () => {
	const { netlist, footprints, outline, center } = dividerBoard();
	const owned = (grid: Int32Array) =>
		grid.reduce((count, cell) => count + (cell === free ? 0 : 1), 0);
	const base = [...footprints, outline];
	const without = required(routingGrid(base, netlist, fourLayers)).base;
	const inner = track(
		{ x: center.x - 4, y: center.y - 5 },
		{ x: center.x + 4, y: center.y - 5 },
		"In1.Cu",
		"gnd",
	);
	const withInner = required(
		routingGrid([...base, inner], netlist, fourLayers),
	).base;
	for (const z of [0, 1]) {
		assert.ok(owned(withInner.via[z]) > owned(without.via[z]));
		assert.equal(owned(withInner.track[z]), owned(without.track[z]));
	}
});

test("a track started where tracks on two layers meet starts on the active layer", () => {
	const { netlist, footprints, outline, center } = dividerBoard();
	const end = { x: center.x, y: center.y - 5 };
	const front = track({ x: center.x - 4, y: end.y }, end, "F.Cu", "gnd");
	const inner = track(end, { x: center.x + 4, y: end.y }, "In2.Cu", "mid");
	const items = copperItems([...footprints, outline, front, inner], netlist);
	const options = { padReach: 0.5, tolerance: 0.05 };
	assert.equal(
		trackAnchor(items, end, { ...options, layer: "In2.Cu" })?.item.net,
		"mid",
	);
	assert.equal(
		trackAnchor(items, end, { ...options, layer: "F.Cu" })?.item.net,
		"gnd",
	);
});
