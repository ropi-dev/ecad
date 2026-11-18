import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { generateDefaultFootprints } from "@ecad/default-footprints";
import { autoroute } from "@ecad/drawing-core/board/autoroute.ts";
import {
	analyzeConnectivity,
	boardHoles,
	copperAt,
	copperItems,
} from "@ecad/drawing-core/board/connectivity.ts";
import { checkBoard, type DrcKind } from "@ecad/drawing-core/board/drc.ts";
import {
	type BoardFootprint,
	boardPads,
	createBoardFootprint,
	type FootprintSource,
	flipBoardFootprint,
} from "@ecad/drawing-core/board/footprints.ts";
import {
	hullBounds,
	outlineEncloses,
	rectangleCorners,
	trackSegment,
} from "@ecad/drawing-core/board/geometry.ts";
import { negotiatedRoute } from "@ecad/drawing-core/board/negotiated-route.ts";
import {
	type BoardNetlist,
	boardNetlist,
} from "@ecad/drawing-core/board/netlist.ts";
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
import {
	containsSelection,
	type EditorShape,
	intersectsSelection,
	resizeHandles,
	resizeShape,
	type SymbolShape,
	shapeAt,
	symbolShapes,
} from "@ecad/drawing-core/drawing/shapes.ts";
import {
	replaceSymbolChild,
	symbolChildren,
} from "@ecad/drawing-core/drawing/symbol-instances.ts";
import type { Bounds, Point } from "@ecad/drawing-core/drawing/types.ts";
import {
	isPolygonZone,
	withZoneOutline,
	zoneOutlinePoints,
} from "@ecad/drawing-core/drawing/zone-outline.ts";
import type { FootprintReference } from "@ecad/drawing-core/footprint/reference.ts";
import {
	createHole,
	createPad,
	isPad,
} from "@ecad/drawing-core/footprint/shapes.ts";
import {
	fillReach,
	fillZones,
	layerFill,
	type ZoneFill,
} from "#/board/fill.ts";
import { boardFileSchema, createBoardFile } from "#/board/format.ts";
import { exportFabrication } from "#/board/gerber.ts";
import { maskOpenings } from "#/board/mask.ts";
import { trackAnchor, trackPath, trackSegments } from "#/board/routing.ts";
import { boardDisplay, boardLayerView, footprintItemId } from "#/board/view.ts";
import { containsPoint } from "#/engine/geometry.ts";
import { parseGerber } from "#/formats/gerber/index.ts";
import { projectFileSelections } from "#/projects/file-url.ts";
import {
	type ProjectDirectory,
	ProjectRepository,
} from "#/projects/repository.ts";
import { required } from "./helpers/required.ts";

const library = new Map(
	generateDefaultFootprints().map(({ file }) => [file.id, file]),
);
const source = (reference: FootprintReference): FootprintSource | undefined => {
	const file = library.get(reference.id);
	return file && { reference, name: file.name, shapes: file.shapes };
};
const r0805 = { library: "builtin", id: "r_0805_2012metric" } as const;
const r0603 = { library: "builtin", id: "r_0603_1608metric" } as const;

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

function updateFromSchematic(
	circuit: Circuit,
	shapes: readonly EditorShape[] = [],
	footprintOf: (reference: string) => FootprintReference | undefined = () =>
		r0805,
) {
	return synchronizeBoard({
		shapes,
		circuit,
		footprintOf: (component) => footprintOf(component.reference),
		source,
		nextId: 1000,
	});
}

let nextId = 500;
const rectangleOn = (
	layer: "Edge.Cuts" | "F.Cu",
	center: Point,
	width: number,
	height: number,
): EditorShape => ({
	id: nextId++,
	kind: "rectangle",
	layer,
	x: center.x,
	y: center.y,
	width,
	height,
	rotation: 0,
	lineWidth: 0.1,
});

function dividerBoard() {
	const circuit = dividerCircuit();
	const footprints = updateFromSchematic(circuit).place;
	const center = {
		x: (footprints[0].x + footprints[1].x) / 2,
		y: footprints[0].y,
	};
	const outline = rectangleOn("Edge.Cuts", center, 30, 20);
	const at = (dx: number, dy: number) => ({
		x: center.x + dx,
		y: center.y + dy,
	});
	const pour = (
		net: string,
		dx: number,
		width: number,
		extra: { clearance?: number; dy?: number; height?: number } = {},
	): EditorShape =>
		({
			...rectangleOn("F.Cu", at(dx, extra.dy ?? 0), width, extra.height ?? 18),
			zone: extra.clearance === undefined ? {} : { clearance: extra.clearance },
			net,
		}) as EditorShape;
	const polygonPour = (
		net: string,
		corners: readonly Point[],
		priority?: number,
	): EditorShape => {
		const base = rectangleOn("F.Cu", corners[0], 1, 1);
		if (base.kind !== "rectangle") throw new Error("Expected a rectangle.");
		return withZoneOutline(
			{ ...base, zone: priority ? { priority } : {}, net },
			corners,
		);
	};
	return {
		circuit,
		netlist: boardNetlist(circuit),
		footprints,
		outline,
		shapes: [...footprints, outline],
		at,
		pour,
		polygonPour,
	};
}

function routeMid(shapes: readonly EditorShape[], netlist: BoardNetlist) {
	const mid = required(
		ratsnest(shapes, netlist).find((line) => line.net === "mid"),
	);
	return trackSegments(
		nextId++ * 10,
		trackPath(mid.from, mid.to),
		"F.Cu",
		0.25,
		"mid",
	);
}

function ratsnest(
	shapes: readonly EditorShape[],
	netlist: BoardNetlist,
	rules: BoardRules = defaultBoardRules,
) {
	return analyzeConnectivity(
		copperItems(shapes, netlist),
		fillReach(fillZones(shapes, netlist, rules)),
	).ratsnest;
}

const unroutedNets = (
	shapes: readonly EditorShape[],
	netlist: BoardNetlist,
	rules?: BoardRules,
) =>
	[...new Set(ratsnest(shapes, netlist, rules).map((line) => line.net))].sort();

function designRulesCheck(
	shapes: readonly EditorShape[],
	netlist: BoardNetlist,
	rules: BoardRules = defaultBoardRules,
) {
	return checkBoard(shapes, netlist, rules, {
		zoneReach: fillReach(fillZones(shapes, netlist, rules)),
	});
}

const kinds = (findings: readonly { kind: DrcKind }[]) =>
	[...new Set(findings.map((finding) => finding.kind))].sort();

const spacingProblems = (
	findings: ReturnType<typeof checkBoard>,
	shape: EditorShape,
) =>
	findings.filter(
		(finding) =>
			(finding.kind === "short" || finding.kind === "clearance") &&
			finding.shapeIds.includes(shape.id),
	);

const pourCopper = (
	shapes: readonly EditorShape[],
	netlist: BoardNetlist,
	rules: BoardRules = defaultBoardRules,
) => layerFill(fillZones(shapes, netlist, rules), "F.Cu");

const padNets = (footprint: EditorShape, netlist: BoardNetlist) =>
	boardPads([footprint]).map((pad) =>
		netlist.padNet(pad.component, pad.number),
	);

describe("updating the board from the schematic", () => {
	test("places a footprint for every component and leaves the ones I moved where they are", () => {
		const circuit = dividerCircuit();
		const placed = updateFromSchematic(circuit).place;
		assert.deepEqual(
			placed.map(
				(shape) => shape.kind === "symbol" && shape.attributes.reference,
			),
			["R1", "R2"],
		);
		const moved = placed.map((shape) => ({ ...shape, x: shape.x + 10 }));
		const again = updateFromSchematic(circuit, moved);
		assert.deepEqual([again.place, again.replace, again.remove], [[], [], []]);
		const withoutR2 = updateFromSchematic(
			{ ...circuit, components: circuit.components.slice(0, 1), nets: [] },
			moved,
		);
		assert.deepEqual(withoutR2.remove, [moved[1].id]);
	});

	test("swaps a footprint the schematic changed without moving, turning or flipping it", () => {
		const circuit = dividerCircuit();
		const [r1, r2] = updateFromSchematic(circuit).place;
		const arranged = flipBoardFootprint({
			...(r1 as BoardFootprint),
			x: r1.x + 4,
			rotation: Math.PI / 2,
		});
		const result = updateFromSchematic(circuit, [arranged, r2], (reference) =>
			reference === "R1" ? r0603 : r0805,
		);
		const swapped = required(result.replace[0]) as BoardFootprint;
		assert.equal(swapped.footprint.id, r0603.id);
		assert.deepEqual(
			[swapped.x, swapped.y, swapped.rotation, swapped.flipped],
			[arranged.x, arranged.y, arranged.rotation, true],
		);
	});

	test("keeps a placed footprint whose footprint can no longer be found, and names it", () => {
		const circuit = dividerCircuit();
		const placed = updateFromSchematic(circuit).place;
		const result = updateFromSchematic(circuit, placed, (reference) =>
			reference === "R2" ? undefined : r0805,
		);
		assert.deepEqual(result.remove, []);
		assert.deepEqual(result.missing, ["R2"]);
	});

	test("keeps a copied footprint on the board, but without a component its pads have no nets", () => {
		const { circuit, netlist, footprints } = dividerBoard();
		const copy = { ...footprints[0], id: 900, x: footprints[0].x + 20 };
		const result = updateFromSchematic(circuit, [...footprints, copy]);
		assert.deepEqual(result.remove, []);
		const kept = required(result.replace.find((shape) => shape.id === copy.id));
		assert.deepEqual(padNets(kept, netlist), [undefined, undefined]);
		assert.deepEqual(padNets(footprints[0], netlist), ["gnd", "mid"]);
	});

	test("moves my tracks and pours to a net the schematic renamed", () => {
		const { circuit, shapes, netlist, pour } = dividerBoard();
		const track = routeMid(shapes, netlist);
		const midPour = pour("mid", 0, 4);
		const renamed: Circuit = {
			...circuit,
			nets: circuit.nets.map((net) =>
				net.id === "mid" ? { ...net, id: "mid-2" } : net,
			),
		};
		const board = [...shapes, ...track, midPour];
		const result = updateFromSchematic(renamed, board);
		assert.equal(result.stale, 0);
		const updated = board.map(
			(shape) => result.replace.find((next) => next.id === shape.id) ?? shape,
		);
		const findings = designRulesCheck(updated, boardNetlist(renamed));
		assert.ok(!findings.some((finding) => finding.kind === "net"));
		assert.deepEqual(unroutedNets(updated, boardNetlist(renamed)), ["gnd"]);
	});

	test("leaves copper on a net the schematic split in two, and the check reports it", () => {
		const { circuit, shapes, netlist } = dividerBoard();
		const board = [...shapes, ...routeMid(shapes, netlist)];
		const split: Circuit = {
			...circuit,
			nets: [
				...circuit.nets.filter((net) => net.id !== "mid"),
				{ id: "left", names: ["LEFT"], pinIds: ["R1.2"] },
				{ id: "right", names: ["RIGHT"], pinIds: ["R2.1"] },
			],
		};
		const result = updateFromSchematic(split, board);
		assert.deepEqual(result.replace, []);
		assert.ok(result.stale > 0);
		assert.ok(
			designRulesCheck(board, boardNetlist(split)).some(
				(finding) => finding.kind === "net",
			),
		);
	});
});

describe("routing and the ratsnest", () => {
	test("each pad takes its pin's net, and the ratsnest joins the pads still apart", () => {
		const { shapes, netlist, footprints } = dividerBoard();
		assert.deepEqual(padNets(footprints[0], netlist), ["gnd", "mid"]);
		assert.deepEqual(unroutedNets(shapes, netlist), ["gnd", "mid"]);
		assert.deepEqual(
			unroutedNets([...shapes, ...routeMid(shapes, netlist)], netlist),
			["gnd"],
		);
	});

	test("a track end snaps to the centre of a nearby pad on its net, never to another net's pad", () => {
		const { shapes, netlist } = dividerBoard();
		const items = copperItems(shapes, netlist);
		const mid = required(
			items.find((item) => item.kind === "pad" && item.net === "mid"),
		);
		const centre = { x: mid.shape.x, y: mid.shape.y };
		const beside = { x: mid.bounds.maxX + 0.3, y: centre.y };
		const reach = { padReach: 0.5, tolerance: 0.05 };
		assert.equal(
			trackAnchor(items, beside, { ...reach, padReach: 0.05 }),
			undefined,
		);
		assert.deepEqual(
			trackAnchor(items, beside, { ...reach, layer: "F.Cu", net: "mid" })
				?.point,
			centre,
		);
		assert.deepEqual(trackAnchor(items, beside, reach)?.point, centre);
		assert.equal(
			trackAnchor(items, beside, { ...reach, net: "gnd" }),
			undefined,
		);
		assert.equal(
			trackAnchor(items, beside, { ...reach, layer: "B.Cu" }),
			undefined,
		);
	});

	test("a track end snaps to the nearest via it may join, and stays put on the copper it started from", () => {
		const { shapes, netlist } = dividerBoard();
		const via = (id: number, x: number, net?: string): EditorShape => ({
			id,
			kind: "circle",
			layer: "F.Cu",
			x,
			y: 40,
			width: 0.6,
			height: 0.6,
			rotation: 0,
			lineWidth: 0.15,
			filled: true,
			via: { drill: 0.3 },
			...(net ? { net } : {}),
		});
		const items = copperItems(
			[...shapes, via(901, 100, "gnd"), via(902, 101.5), via(903, 103, "mid")],
			netlist,
		);
		const reach = { padReach: 0.6, tolerance: 0.2 };
		const at = (x: number) => ({ x, y: 40.1 });
		assert.deepEqual(trackAnchor(items, at(100.9), reach)?.point, {
			x: 101.5,
			y: 40,
		});
		assert.deepEqual(
			trackAnchor(items, at(102.4), { ...reach, net: "mid" })?.point,
			{ x: 103, y: 40 },
		);
		assert.deepEqual(
			trackAnchor(items, at(100.8), { ...reach, net: "mid" })?.point,
			{ x: 101.5, y: 40 },
		);
		const start = { x: 101.5, y: 40 };
		assert.deepEqual(
			trackAnchor(items, at(101.55), { ...reach, exclude: start })?.point,
			start,
		);
		assert.deepEqual(
			trackAnchor(items, at(101), {
				...reach,
				padReach: 0.8,
				exclude: start,
			})?.point,
			{ x: 100, y: 40 },
		);
	});

	test("a track under the cursor beats a nearby pad it may not share a net with", () => {
		const { shapes, netlist } = dividerBoard();
		const mid = required(
			copperItems(shapes, netlist).find(
				(item) => item.kind === "pad" && item.net === "mid",
			),
		);
		const y = mid.bounds.maxY + 0.3;
		const gnd = trackSegment(
			950,
			{ x: mid.shape.x - 3, y },
			{ x: mid.shape.x + 3, y },
			"F.Cu",
			0.25,
			"gnd",
		);
		const items = copperItems([...shapes, gnd], netlist);
		const onTrack = { x: mid.shape.x, y };
		const reach = { padReach: 0.5, tolerance: 0.05 };
		const hit = required(trackAnchor(items, onTrack, reach));
		assert.equal(hit.item.kind, "track");
		assert.equal(hit.item.net, "gnd");
		assert.ok(Math.hypot(hit.point.x - onTrack.x, hit.point.y - y) < 1e-9);
		assert.deepEqual(
			trackAnchor(items, onTrack, { ...reach, net: "mid" })?.point,
			{ x: mid.shape.x, y: mid.shape.y },
		);
	});

	test("a via placed on a footprint pad takes that pad's net", () => {
		const circuit = dividerCircuit();
		const file = required(library.get(r0805.id));
		const pad = required(
			file.shapes.find((shape) => isPad(shape as EditorShape)),
		);
		const via: EditorShape = {
			id: 999,
			kind: "circle",
			layer: "F.Cu",
			x: pad.x,
			y: pad.y,
			width: 0.6,
			height: 0.6,
			rotation: 0,
			lineWidth: 0.15,
			filled: true,
			via: { drill: 0.3 },
		};
		const [r1] = synchronizeBoard({
			shapes: [],
			circuit,
			footprintOf: () => r0805,
			source: (reference) => ({
				reference,
				name: file.name,
				shapes: [...file.shapes, via],
			}),
			nextId: 1,
		}).place;
		const netlist = boardNetlist(circuit);
		const items = copperItems([r1], netlist);
		const footprintVia = required(items.find((item) => item.kind === "via"));
		const padUnder = required(
			items.find(
				(item) =>
					item.kind === "pad" &&
					item.pad?.shape.x === footprintVia.shape.x &&
					item.pad?.shape.y === footprintVia.shape.y,
			),
		);
		assert.ok(padUnder.net);
		assert.equal(footprintVia.net, padUnder.net);
	});

	test("the autorouter connects every pad and the check comes back clean", () => {
		const { shapes, netlist } = dividerBoard();
		const routed = autoroute(shapes, netlist, 2000, {
			rules: defaultBoardRules,
		});
		assert.deepEqual(routed.failed, []);
		assert.deepEqual(
			designRulesCheck([...shapes, ...routed.shapes], netlist),
			[],
		);
	});

	test("negotiated routing routes the nets it is given and leaves excluded ones unrouted", () => {
		const { shapes, netlist } = dividerBoard();
		const routed = negotiatedRoute(shapes, netlist, 2000, {
			rules: defaultBoardRules,
			exclude: new Set(["gnd"]),
		});
		assert.deepEqual(routed.failed, []);
		assert.deepEqual(unroutedNets([...shapes, ...routed.shapes], netlist), [
			"gnd",
		]);
		assert.deepEqual(
			kinds(designRulesCheck([...shapes, ...routed.shapes], netlist)),
			["unconnected"],
		);
	});
});

describe("copper pours", () => {
	test("a GND pour connects the GND pads and keeps clear of MID", () => {
		const { shapes, netlist, pour } = dividerBoard();
		const board = [...shapes, pour("gnd", 0, 28)];
		assert.deepEqual(unroutedNets(board, netlist), ["mid"]);
		assert.deepEqual(kinds(designRulesCheck(board, netlist)), ["unconnected"]);
	});

	test("a track that cuts a GND pour in two leaves a ratsnest line across the cut", () => {
		const { shapes, netlist, pour, at } = dividerBoard();
		const cut = trackSegments(
			3000,
			[at(0, -9.5), at(0, 9.5)],
			"F.Cu",
			0.25,
			"mid",
		);
		const board = [...shapes, pour("gnd", 0, 28), ...cut];
		assert.ok(unroutedNets(board, netlist).includes("gnd"));
	});

	test("where pours on two nets overlap, the one drawn first keeps the copper and the other keeps clear", () => {
		const { shapes, netlist, pour, at } = dividerBoard();
		const gndPour = pour("gnd", -7, 16);
		const midPour = pour("mid", 5, 16);
		const board = [...shapes, gndPour, midPour];
		const overlap = at(0, -7);
		const copperAt = (zone: EditorShape) =>
			containsPoint(
				required(
					fillZones(board, netlist, defaultBoardRules).find(
						(fill) => fill.zone.shapeId === zone.id,
					),
				).polygons,
				overlap,
			);
		assert.deepEqual([copperAt(gndPour), copperAt(midPour)], [true, false]);
		assert.ok(
			fillZones(board, netlist, defaultBoardRules).every(
				(fill) => fill.polygons.length,
			),
		);
		assert.deepEqual(
			spacingProblems(designRulesCheck(board, netlist), midPour),
			[],
		);
	});

	test("a GND pour that only touches other GND pours keeps its copper and joins them", () => {
		const { shapes, netlist, footprints, pour, at } = dividerBoard();
		const center = at(0, 0);
		const [left, right] = boardPads(footprints)
			.filter((pad) => netlist.padNet(pad.component, pad.number) === "gnd")
			.map((pad) => pad.shape.x - center.x)
			.sort((a, b) => a - b);
		const sides = [pour("gnd", left, 5), pour("gnd", right, 5)];
		assert.ok(unroutedNets([...shapes, ...sides], netlist).includes("gnd"));
		const bridge = pour("gnd", 0, 14, { dy: 10, height: 6 });
		const board = [...shapes, ...sides, bridge];
		assert.ok(!unroutedNets(board, netlist).includes("gnd"));
		assert.equal(pourCopper(board, netlist).length, 1);
	});

	test("a GND pour keeps 1.5 mm from a pour that raised its clearance to that, and the full board clearance from a large mounting ring", () => {
		const { shapes, netlist, pour, at } = dividerBoard();
		const isolated = pour("mid", 0, 4, { clearance: 1.5 });
		const gndPour = pour("gnd", 0, 28);
		const mountingRing: EditorShape = {
			id: 4000,
			kind: "circle",
			layer: "F.Cu",
			...at(6, 4),
			width: 3,
			height: 3,
			rotation: 0,
			lineWidth: 0.15,
			filled: true,
			via: { drill: 1 },
			net: "mid",
		};
		const board = [...shapes, isolated, gndPour, mountingRing];
		const rules = { ...defaultBoardRules, clearance: 1.2 };
		assert.ok(
			Math.abs(mountingRing.x - gndPour.x) < gndPour.width / 2 - 3 &&
				Math.abs(mountingRing.y - gndPour.y) < gndPour.height / 2 - 3,
		);
		assert.ok(
			fillZones(board, netlist, rules).every((fill) => fill.polygons.length),
		);
		assert.deepEqual(
			spacingProblems(designRulesCheck(board, netlist, rules), gndPour),
			[],
		);
	});

	test("a pour clearance set below the board's uses the board's", () => {
		const { shapes, netlist, pour } = dividerBoard();
		const board = [...shapes, pour("gnd", 0, 28, { clearance: 0.05 })];
		const rules = { ...defaultBoardRules, clearance: 0.4 };
		assert.deepEqual(kinds(designRulesCheck(board, netlist, rules)), [
			"unconnected",
		]);
	});

	test("a polygon pour fills its polygon, not the rectangle around it", () => {
		const { shapes, netlist, polygonPour, at } = dividerBoard();
		const lShape = polygonPour("gnd", [
			at(-14, -9),
			at(14, -9),
			at(14, 3),
			at(4, 3),
			at(4, 9),
			at(-14, 9),
		]);
		const board = [...shapes, lShape];
		const copper = pourCopper(board, netlist);
		assert.ok(containsPoint(copper, at(-10, 6)));
		assert.ok(containsPoint(copper, at(10, -6)));
		assert.ok(!containsPoint(copper, at(9, 6)));
		assert.deepEqual(unroutedNets(board, netlist), ["mid"]);
		assert.deepEqual(kinds(designRulesCheck(board, netlist)), ["unconnected"]);
	});

	test("a turned polygon pour fills, connects and is picked where its turned polygon is", () => {
		const { shapes, netlist, polygonPour, at } = dividerBoard();
		const lShape = polygonPour("gnd", [
			at(-14, -9),
			at(14, -9),
			at(14, 3),
			at(4, 3),
			at(4, 9),
			at(-14, 9),
		]);
		const center = { x: lShape.x, y: lShape.y };
		const halfTurn = { ...lShape, rotation: Math.PI };
		const turned = (point: Point) => ({
			x: 2 * center.x - point.x,
			y: 2 * center.y - point.y,
		});
		const notch = turned(at(9, 6));
		const copper = pourCopper([...shapes, halfTurn], netlist);
		assert.ok(!containsPoint(copper, notch));
		assert.ok(containsPoint(copper, turned(at(-10, 6))));
		assert.equal(shapeAt([halfTurn], notch, 0.1), undefined);
		assert.equal(shapeAt([halfTurn], turned(at(-10, 6)), 0.1), halfTurn);
		assert.deepEqual(kinds(designRulesCheck([...shapes, halfTurn], netlist)), [
			"unconnected",
		]);
	});

	test("a polygon pour whose edges cross fills both of its lobes, as it is picked", () => {
		const { shapes, netlist, polygonPour, at } = dividerBoard();
		const bowtie = polygonPour("gnd", [
			at(-14, -9),
			at(14, 9),
			at(14, -9),
			at(-14, 9),
		]);
		const copper = pourCopper([...shapes, bowtie], netlist);
		const items = copperItems([...shapes, bowtie], netlist);
		for (const lobe of [at(-12, 0), at(12, 0)]) {
			assert.equal(shapeAt([bowtie], lobe, 0.1), bowtie);
			assert.ok(containsPoint(copper, lobe));
			assert.equal(copperAt(items, lobe, "F.Cu", 0.05)?.shapeId, bowtie.id);
		}
		assert.equal(copperAt(items, at(0, 7), "F.Cu", 0.05), undefined);
		assert.ok(!containsPoint(copper, at(0, 7)));
		const zone = required(
			copperItems([...shapes, bowtie], netlist).find(
				(item) => item.shapeId === bowtie.id,
			),
		);
		assert.ok(zone.hulls.every((hull) => hull.points.length === 2));
		const wrapped = polygonPour(
			"gnd",
			[
				[0, 0],
				[10, 0],
				[10, 10],
				[0, 10],
				[0, 5],
				[2, 5],
				[2, 2],
				[8, 2],
				[8, 8],
				[2, 8],
				[2, 5],
				[0, 5],
			].map(([x, y]) => at(x - 15, y - 9)),
		);
		const hole = at(-10, -4);
		assert.equal(shapeAt([wrapped], hole, 0.1), undefined);
		const wrappedZone = required(
			copperItems([...shapes, wrapped], netlist).find(
				(item) => item.shapeId === wrapped.id,
			),
		);
		assert.ok(wrappedZone.hulls.every((hull) => hull.points.length === 2));
		assert.deepEqual(
			[zone.bounds.minX, zone.bounds.maxX],
			[at(-14, 0).x, at(14, 0).x],
		);
	});

	test("a higher-priority pour keeps its copper inside a pour on another net drawn before it, which keeps clear of it", () => {
		const { shapes, netlist, footprints, pour, polygonPour } = dividerBoard();
		const midPad = required(
			boardPads(footprints).find(
				(pad) => netlist.padNet(pad.component, pad.number) === "mid",
			),
		).shape;
		const around = (dx: number, dy: number) => ({
			x: midPad.x + dx,
			y: midPad.y + dy,
		});
		const gndPour = pour("gnd", 0, 28);
		const island = polygonPour(
			"mid",
			[around(0, -3), around(3, 0), around(0, 3), around(-3, 0)],
			1,
		);
		const board = [...shapes, gndPour, island];
		const fills = fillZones(board, netlist, defaultBoardRules);
		const copperAt = (zone: EditorShape, point: Point) =>
			containsPoint(
				required(fills.find((fill) => fill.zone.shapeId === zone.id)).polygons,
				point,
			);
		const inside = around(0, 2);
		assert.deepEqual(
			[copperAt(island, inside), copperAt(gndPour, inside)],
			[true, false],
		);
		assert.ok(copperAt(gndPour, around(0, 5)));
		assert.deepEqual(
			[
				...spacingProblems(designRulesCheck(board, netlist), gndPour),
				...spacingProblems(designRulesCheck(board, netlist), island),
			],
			[],
		);
		const unprioritised = {
			...island,
			zone: { ...(island.kind === "rectangle" ? island.zone : {}) },
		} as EditorShape;
		if (unprioritised.kind === "rectangle" && unprioritised.zone)
			delete unprioritised.zone.priority;
		const listOrder = fillZones(
			[...shapes, gndPour, unprioritised],
			netlist,
			defaultBoardRules,
		);
		assert.ok(
			containsPoint(
				required(listOrder.find((fill) => fill.zone.shapeId === gndPour.id))
					.polygons,
				inside,
			),
		);
	});

	test("a pour stays empty until the board outline closes, and the check says the outline is open", () => {
		const { footprints, netlist, pour, at } = dividerBoard();
		const edge = (from: Point, to: Point) =>
			({
				...trackSegment(nextId++, from, to, "F.Cu", 0.1, undefined),
				layer: "Edge.Cuts",
			}) as EditorShape;
		const threeSides = [
			edge(at(-15, -10), at(15, -10)),
			edge(at(15, -10), at(15, 10)),
			edge(at(15, 10), at(-15, 10)),
		];
		const open = [...footprints, ...threeSides, pour("gnd", 0, 28)];
		assert.deepEqual(pourCopper(open, netlist), []);
		assert.ok(kinds(designRulesCheck(open, netlist)).includes("outline"));
		const closed = [...open, edge(at(-15, 10), at(-15, -10))];
		assert.equal(pourCopper(closed, netlist).length, 1);
		assert.ok(!kinds(designRulesCheck(closed, netlist)).includes("outline"));
	});
});

describe("thermal reliefs", () => {
	test("a spoke that runs along a neighbouring pad's gap keeps its full width", () => {
		const circuit = {
			...dividerCircuit(),
			nets: [
				{
					id: "gnd",
					names: ["GND"],
					pinIds: ["R1.1", "R1.2", "R2.1", "R2.2"],
				},
			],
		};
		const netlist = boardNetlist(circuit);
		const { outline, pour } = dividerBoard();
		const [r1, r2] = updateFromSchematic(circuit).place;
		const moved = { ...r2, x: r2.x - 3.25, y: r2.y - 1.25 } as EditorShape;
		const board = [r1, moved, outline, pour("gnd", 0, 28)];
		const pad = required(
			boardPads([moved]).find((pad) => pad.number === "1"),
		).shape;
		assert.deepEqual(
			[-0.2, 0.2].map((side) =>
				copperAt(board, netlist, {
					x: pad.x - pad.width / 2 - 0.25,
					y: pad.y + side,
				}),
			),
			[true, true],
		);
		assert.deepEqual(unroutedNets(board, netlist), []);
	});

	test("with a thermal gap below the clearance, a spoke may pass a same-net pad outside that pad's gap", () => {
		const circuit = {
			...dividerCircuit(),
			nets: [
				{
					id: "gnd",
					names: ["GND"],
					pinIds: ["R1.1", "R1.2", "R2.1", "R2.2"],
				},
			],
		};
		const netlist = boardNetlist(circuit);
		const { outline, pour } = dividerBoard();
		const [r1, r2] = updateFromSchematic(circuit).place;
		const moved = { ...r2, x: r2.x - 3.25, y: r2.y - 1.25 } as EditorShape;
		const board = [r1, moved, outline, pour("gnd", 0, 28)];
		const pad = required(
			boardPads([moved]).find((pad) => pad.number === "1"),
		).shape;
		const rules = { ...defaultBoardRules, clearance: 0.4, thermalGap: 0.2 };
		assert.ok(
			copperAt(
				board,
				netlist,
				{ x: pad.x - pad.width / 2 - 0.1, y: pad.y },
				rules,
			),
		);
	});

	const gndPour = () => {
		const { shapes, netlist, footprints, pour } = dividerBoard();
		const pads = boardPads(footprints).filter(
			(pad) => netlist.padNet(pad.component, pad.number) === "gnd",
		);
		const pad = required(pads[0]).shape;
		const zone = pour("gnd", 0, 28);
		const outward = Math.sign(pad.x - zone.x);
		const beside = (dx: number, dy: number) => ({
			x: pad.x + outward * (pad.width / 2 + dx),
			y: pad.y + Math.sign(dy) * (pad.height / 2 + Math.abs(dy)),
		});
		return { shapes, netlist, pad, zone, outward, beside };
	};
	const copperAt = (
		board: readonly EditorShape[],
		netlist: BoardNetlist,
		point: Point,
		rules: BoardRules = defaultBoardRules,
	) => containsPoint(pourCopper(board, netlist, rules), point);
	const via = (center: Point, net: string): EditorShape => ({
		id: nextId++,
		kind: "circle",
		layer: "F.Cu",
		...center,
		width: 0.3,
		height: 0.3,
		rotation: 0,
		lineWidth: 0.1,
		filled: true,
		via: { drill: 0.15 },
		net,
	});

	test("a GND pad in a GND pour gets a 0.5 mm gap with spokes across it and stays connected", () => {
		const { shapes, netlist, pad, zone, beside } = gndPour();
		const board = [...shapes, zone];
		const corner = beside(0.2, 0.2);
		const above = { x: pad.x, y: pad.y + pad.height / 2 + 0.25 };
		const outside = beside(0.25, 0);
		assert.deepEqual(
			[corner, above, outside, pad].map((point) =>
				copperAt(board, netlist, point),
			),
			[false, true, true, true],
		);
		assert.ok(copperAt(board, netlist, beside(0.6, 0.6)));
		assert.deepEqual(unroutedNets(board, netlist), ["mid"]);
		assert.deepEqual(kinds(designRulesCheck(board, netlist)), ["unconnected"]);
	});

	test("a zone set to solid pad connections fills right up to the pad", () => {
		const { shapes, netlist, zone, beside } = gndPour();
		const solid = { ...zone, zone: { padConnection: "solid" } } as EditorShape;
		assert.ok(copperAt([...shapes, solid], netlist, beside(0.2, 0.2)));
	});

	test("the zone's thermal gap overrides the board's, which sets the gap otherwise", () => {
		const { shapes, netlist, zone, beside } = gndPour();
		const corner = beside(0.3, 0.3);
		const narrow = { ...zone, zone: { thermalGap: 0.25 } } as EditorShape;
		const rules = { ...defaultBoardRules, thermalGap: 0.25 };
		assert.deepEqual(
			[
				copperAt([...shapes, zone], netlist, corner),
				copperAt([...shapes, narrow], netlist, corner),
				copperAt([...shapes, zone], netlist, corner, rules),
			],
			[false, true, true],
		);
	});

	test("spokes take the board's or the zone's width, and never get wider than the pad", () => {
		const { shapes, netlist, pad, zone } = gndPour();
		const above = (dx: number) => ({
			x: pad.x + dx,
			y: pad.y + pad.height / 2 + 0.25,
		});
		const narrow = { ...defaultBoardRules, thermalSpokeWidth: 0.2 };
		const wide = {
			...zone,
			zone: { thermalSpokeWidth: 3 },
		} as EditorShape;
		assert.deepEqual(
			[
				copperAt([...shapes, zone], netlist, above(0.15)),
				copperAt([...shapes, zone], netlist, above(0.15), narrow),
				copperAt([...shapes, wide], netlist, above(0.45)),
				copperAt([...shapes, wide], netlist, above(0.6)),
			],
			[true, false, true, false],
		);
	});

	test("when vias on another net block the spokes along the pad's axes, the spokes turn 45 degrees", () => {
		const { shapes, netlist, pad, zone, outward, beside } = gndPour();
		const blockers = [
			beside(0.45, 0),
			{ x: pad.x, y: pad.y + pad.height / 2 + 0.45 },
			{ x: pad.x, y: pad.y - pad.height / 2 - 0.45 },
		].map((center) => via(center, "mid"));
		const board = [...shapes, zone, ...blockers];
		const diagonal = (along: number) => ({
			x: pad.x + outward * along,
			y: pad.y + along,
		});
		const reach = (pad.width + pad.height) / 4;
		const betweenSpokes = {
			x: pad.x - outward * 0.4,
			y: pad.y + pad.height / 2 + 0.2,
		};
		assert.deepEqual(
			[diagonal(reach + 0.35), betweenSpokes, beside(0.2, 0)].map((point) =>
				copperAt(board, netlist, point),
			),
			[true, false, false],
		);
		assert.deepEqual(unroutedNets(board, netlist), ["mid"]);
		assert.deepEqual(kinds(designRulesCheck(board, netlist)), ["unconnected"]);
	});

	test("when each spoke set reaches only one spoke, the pad keeps both", () => {
		const { shapes, netlist, pad, zone, outward, beside } = gndPour();
		const reach = (pad.width + pad.height) / 4;
		const diagonal = (along: number, up: number) => ({
			x: pad.x + (outward * along) / Math.SQRT2,
			y: pad.y + (up * along) / Math.SQRT2,
		});
		const blockers = [
			beside(0.45, 0),
			{ x: pad.x, y: pad.y + pad.height / 2 + 0.45 },
			diagonal(reach + 0.35, -1),
		].map((center) => via(center, "mid"));
		const board = [...shapes, zone, ...blockers];
		assert.deepEqual(
			[
				{ x: pad.x, y: pad.y - pad.height / 2 - 0.25 },
				diagonal(reach + 0.35, 1),
			].map((point) => copperAt(board, netlist, point)),
			[true, true],
		);
		assert.deepEqual(unroutedNets(board, netlist), ["mid"]);
	});

	test("a via on the zone's net inside a pad's gap is not joined to the fill", () => {
		const { shapes, netlist, pad, zone } = gndPour();
		const inGap = via(
			{ x: pad.x + 0.45, y: pad.y + pad.height / 2 + 0.3 },
			"gnd",
		);
		assert.ok(unroutedNets([...shapes, zone, inGap], netlist).includes("gnd"));
	});

	test("a round pad's spokes run at 45 degrees to its axes", () => {
		const { netlist, outline, pour } = dividerBoard();
		const header = {
			library: "builtin",
			id: "pinheader_1x02_p2.54mm_vertical",
		} as const;
		const footprints = updateFromSchematic(dividerCircuit(), [], (reference) =>
			reference === "R2" ? header : r0805,
		).place;
		const pad = required(
			boardPads(footprints).find(
				(pad) => pad.component === "R2" && pad.number === "2",
			),
		).shape;
		assert.equal(pad.kind, "circle");
		const board = [...footprints, outline, pour("gnd", 0, 28)];
		const out = pad.width / 2 + 0.25;
		const diagonal = out / Math.SQRT2;
		assert.deepEqual(
			[
				{ x: pad.x + diagonal, y: pad.y + diagonal },
				{ x: pad.x - diagonal, y: pad.y - diagonal },
				{ x: pad.x + out, y: pad.y },
				{ x: pad.x, y: pad.y + out },
			].map((point) => copperAt(board, netlist, point)),
			[true, true, false, false],
		);
	});

	test("a zone edge through a pad clips the spokes that run along it instead of dropping them", () => {
		const { shapes, netlist, pad, zone, beside } = gndPour();
		for (const offset of [-0.15, 0.1]) {
			const top = pad.y + offset;
			const bottom = zone.y - zone.height / 2;
			const below = {
				...zone,
				y: (top + bottom) / 2,
				height: top - bottom,
			} as EditorShape;
			const board = [...shapes, below];
			const under = { x: pad.x, y: pad.y - pad.height / 2 - 0.25 };
			const outward = { ...beside(0.25, 0), y: pad.y - 0.1 };
			assert.deepEqual(
				[under, outward].map((point) => copperAt(board, netlist, point)),
				[true, offset > 0],
			);
			assert.deepEqual(unroutedNets(board, netlist), ["mid"]);
		}
	});

	test("a spoke crossing a neighbouring pad's gap opens it only where it crosses", () => {
		const { netlist, footprints, outline, pour } = dividerBoard();
		const [r1, r2] = footprints;
		const pads = boardPads(footprints);
		const below = required(
			pads.find((pad) => pad.component === "R1" && pad.number === "1"),
		).shape;
		const above = required(
			pads.find((pad) => pad.component === "R2" && pad.number === "2"),
		).shape;
		const rise = below.height + 0.5 + 0.125 + 0.51;
		const moved = {
			...r2,
			x: r2.x + below.x - above.x + 0.5,
			y: r2.y + below.y - above.y + rise,
		} as EditorShape;
		const board = [r1, moved, outline, pour("gnd", 0, 28)];
		const neighbour = { x: below.x + 0.5, y: below.y + rise };
		assert.deepEqual(
			[
				{ x: below.x + 0.1, y: below.y + below.height / 2 + 0.5 + 0.2 },
				{
					x: neighbour.x + above.width / 2 + 0.2,
					y: neighbour.y - above.height / 2 - 0.2,
				},
			].map((point) => copperAt(board, netlist, point)),
			[true, false],
		);
		assert.ok(
			copperAt(board, netlist, {
				x: below.x,
				y: below.y - below.height / 2 - 0.25,
			}),
		);
	});

	test("neighbouring pins on the zone's net closer than the thermal gap both get spokes", () => {
		const { netlist, footprints, outline, pour } = dividerBoard();
		const [r1, r2] = footprints as BoardFootprint[];
		const first = required(
			r1.children.find(
				(child) =>
					isPad(child as EditorShape) &&
					"pad" in child &&
					child.pad?.number === "1",
			),
		);
		const narrow = { ...first, height: 0.3 } as typeof first;
		const twin: BoardFootprint = {
			...r1,
			children: [
				...r1.children.map((child) => (child === first ? narrow : child)),
				{
					...narrow,
					id: Math.max(...r1.children.map((child) => child.id)) + 1,
					y: narrow.y + 0.65,
				} as BoardFootprint["children"][number],
			],
		};
		const pins = boardPads([twin])
			.filter((pad) => pad.number === "1")
			.map((pad) => pad.shape);
		assert.equal(pins.length, 2);
		const outward = Math.sign(required(pins[0]).x - r1.x);
		const board = [twin, r2, outline, pour("gnd", 0, 28)];
		assert.deepEqual(
			pins.map((pin) =>
				copperAt(board, netlist, {
					x: pin.x + outward * (pin.width / 2 + 0.25),
					y: pin.y,
				}),
			),
			[true, true],
		);
		assert.deepEqual(unroutedNets(board, netlist), ["mid"]);
	});

	test("pads stacked on one spot share a relief instead of blocking each other's spokes", () => {
		const { netlist, footprints, outline, pour } = dividerBoard();
		const [r1, r2] = footprints as BoardFootprint[];
		const smd = required(
			r1.children.find(
				(child) =>
					isPad(child as EditorShape) &&
					"pad" in child &&
					child.pad?.number === "1",
			),
		);
		const stacked: BoardFootprint = {
			...r1,
			children: [
				...r1.children,
				{
					...smd,
					id: Math.max(...r1.children.map((child) => child.id)) + 1,
					kind: "circle",
					width: 1,
					height: 1,
					pad: { number: "1", type: "through-hole", drill: 0.5 },
				} as BoardFootprint["children"][number],
			],
		};
		const pad = required(
			boardPads([stacked]).find(
				(pad) => pad.shape.kind === "rectangle" && pad.number === "1",
			),
		).shape;
		const board = [stacked, r2, outline, pour("gnd", 0, 28)];
		assert.ok(
			copperAt(board, netlist, { x: pad.x, y: pad.y + pad.height / 2 + 0.25 }),
		);
		assert.deepEqual(unroutedNets(board, netlist), ["mid"]);
	});

	test("a rounded pad's gap follows its rounded corners", () => {
		const { netlist, footprints, outline, pour } = dividerBoard();
		const [r1, r2] = footprints as BoardFootprint[];
		const rounded: BoardFootprint = {
			...r1,
			children: r1.children.map((child) =>
				"pad" in child && child.pad?.number === "1"
					? ({
							...child,
							pad: { ...child.pad, cornerRatio: 0.25 },
						} as BoardFootprint["children"][number])
					: child,
			),
		};
		const pad = required(
			boardPads([rounded]).find((pad) => pad.number === "1"),
		).shape;
		const outward = Math.sign(pad.x - r1.x);
		const pastCorner = {
			x: pad.x + outward * (pad.width / 2 + 0.3),
			y: pad.y + pad.height / 2 + 0.3,
		};
		const zone = pour("gnd", 0, 28);
		assert.deepEqual(
			[rounded, r1].map((footprint) =>
				copperAt([footprint, r2, outline, zone], netlist, pastCorner),
			),
			[true, false],
		);
		assert.deepEqual(unroutedNets([rounded, r2, outline, zone], netlist), [
			"mid",
		]);
	});

	test("an oval through-hole pad with a slot gets spokes along its axes and a gap that follows its round ends", () => {
		const { netlist, footprints, outline, pour } = dividerBoard();
		const [r1, r2] = footprints as BoardFootprint[];
		const oval: BoardFootprint = {
			...r1,
			children: r1.children.map((child) =>
				"pad" in child && child.pad?.number === "1"
					? ({
							...child,
							pad: {
								number: "1",
								type: "through-hole",
								drill: 0.3,
								slot: 0.7,
								cornerRatio: 0.5,
							},
						} as BoardFootprint["children"][number])
					: child,
			),
		};
		const pad = required(
			boardPads([oval]).find((pad) => pad.number === "1"),
		).shape;
		const outward = Math.sign(pad.x - r1.x);
		const board = [oval, r2, outline, pour("gnd", 0, 28)];
		assert.deepEqual(
			[
				{ x: pad.x, y: pad.y + pad.height / 2 + 0.25 },
				{ x: pad.x, y: pad.y - pad.height / 2 - 0.25 },
				{
					x: pad.x + outward * (pad.width / 2 + 0.3),
					y: pad.y + pad.height / 2 + 0.3,
				},
				{
					x: pad.x + outward * 0.35,
					y: pad.y + pad.height / 2 + 0.15,
				},
			].map((point) => copperAt(board, netlist, point)),
			[true, true, true, false],
		);
		assert.deepEqual(unroutedNets(board, netlist), ["mid"]);
	});

	test("a spoke keeps the board clearance from an unplated hole", () => {
		const { shapes, netlist, pad, zone } = gndPour();
		const hole = {
			...createHole(nextId++, { x: pad.x, y: pad.y + pad.height / 2 + 0.6 }),
			width: 0.3,
			height: 0.3,
			hole: { drill: 0.3 },
		} as EditorShape;
		const board = [...shapes, zone, hole];
		assert.ok(
			!copperAt(board, netlist, {
				x: pad.x,
				y: pad.y + pad.height / 2 + 0.25,
			}),
		);
		assert.deepEqual(unroutedNets(board, netlist), ["mid"]);
		assert.deepEqual(kinds(designRulesCheck(board, netlist)), ["unconnected"]);
	});

	test("a pad just outside the zone keeps its gap and leaves no spoke stubs in the fill", () => {
		const { shapes, netlist, pad, zone } = gndPour();
		const top = pad.y - pad.height / 2 - 0.2;
		const bottom = zone.y - zone.height / 2;
		const below = {
			...zone,
			y: (top + bottom) / 2,
			height: top - bottom,
		} as EditorShape;
		const anchor = via({ x: pad.x + 3, y: top - 3 }, "gnd");
		const board = [...shapes, below, anchor];
		const band = Array.from({ length: 17 }, (_, step) => ({
			x: pad.x - 0.8 + step * 0.1,
			y: top - 0.1,
		}));
		assert.ok(!band.some((point) => copperAt(board, netlist, point)));
		assert.ok(copperAt(board, netlist, { x: pad.x, y: top - 0.45 }));
	});

	test("a via on the zone's net in open fill joins it solid", () => {
		const { shapes, netlist, pad, zone } = gndPour();
		const center = { x: pad.x, y: pad.y + 4 };
		const board = [...shapes, zone, via(center, "gnd")];
		assert.ok(
			[0, 1, 2, 3, 4, 5, 6, 7].every((step) => {
				const angle = (step * Math.PI) / 4;
				return copperAt(board, netlist, {
					x: center.x + 0.2 * Math.cos(angle),
					y: center.y + 0.2 * Math.sin(angle),
				});
			}),
		);
	});

	test("a pad inside a polygon zone gets spokes into its fill", () => {
		const { shapes, netlist, pad, zone, beside } = gndPour();
		const diamond = {
			...zone,
			zone: {
				outline: [
					{ x: 0, y: -0.5 },
					{ x: 0.5, y: 0 },
					{ x: 0, y: 0.5 },
					{ x: -0.5, y: 0 },
				],
			},
		} as EditorShape;
		const board = [...shapes, diamond];
		assert.deepEqual(
			[
				{ x: pad.x, y: pad.y + pad.height / 2 + 0.25 },
				beside(0.2, 0.2),
				{
					x: zone.x + zone.width / 2 - 0.5,
					y: zone.y + zone.height / 2 - 0.5,
				},
			].map((point) => copperAt(board, netlist, point)),
			[true, false, false],
		);
		assert.deepEqual(unroutedNets(board, netlist), ["mid"]);
	});

	test("a spoke keeps clear of a higher-priority zone on another net, even one listed later", () => {
		const { shapes, netlist, pad, zone, outward } = gndPour();
		const island = {
			...zone,
			id: nextId++,
			net: "mid",
			x: pad.x + outward * (pad.width / 2 + 1.5),
			y: pad.y,
			width: 2,
			height: 1,
			zone: { priority: 1 },
		} as EditorShape;
		const board = [...shapes, zone, island];
		const outwardSpoke = {
			x: pad.x + outward * (pad.width / 2 + 0.25),
			y: pad.y,
		};
		assert.ok(!copperAt(board, netlist, outwardSpoke));
		assert.ok(
			copperAt(board, netlist, {
				x: pad.x,
				y: pad.y + pad.height / 2 + 0.25,
			}),
		);
		assert.ok(
			!kinds(designRulesCheck(board, netlist)).some(
				(kind) => kind === "short" || kind === "clearance",
			),
		);
	});

	test("a pad boxed in by another net gets no dangling spokes and shows as unconnected", () => {
		const { shapes, netlist, pad, zone } = gndPour();
		const x = pad.width / 2 + 0.35;
		const y = pad.height / 2 + 0.35;
		const corners = [
			{ x: pad.x - x, y: pad.y - y },
			{ x: pad.x + x, y: pad.y - y },
			{ x: pad.x + x, y: pad.y + y },
			{ x: pad.x - x, y: pad.y + y },
			{ x: pad.x - x, y: pad.y - y },
		];
		const box = trackSegments(6000, corners, "F.Cu", 0.1, "mid");
		const board = [...shapes, zone, ...box];
		const inside = { x: pad.x, y: pad.y + pad.height / 2 + 0.1 };
		assert.ok(!copperAt(board, netlist, inside));
		assert.ok(unroutedNets(board, netlist).includes("gnd"));
		assert.ok(
			!kinds(designRulesCheck(board, netlist)).some(
				(kind) => kind === "short" || kind === "clearance",
			),
		);
	});
});

describe("the design rules check", () => {
	test("a track run too close to another net is a clearance finding", () => {
		const { shapes, netlist, footprints } = dividerBoard();
		const gndPad = required(
			boardPads(footprints).find(
				(pad) => netlist.padNet(pad.component, pad.number) === "gnd",
			),
		);
		const edgeOfPad = gndPad.shape.y + gndPad.shape.height / 2 + 0.2;
		const tooClose = trackSegments(
			5000,
			[
				{ x: gndPad.shape.x - 3, y: edgeOfPad },
				{ x: gndPad.shape.x + 3, y: edgeOfPad },
			],
			"F.Cu",
			0.25,
			"mid",
		);
		assert.ok(
			kinds(designRulesCheck([...shapes, ...tooClose], netlist)).includes(
				"clearance",
			),
		);
	});

	test("copper too close to the board edge is an edge finding", () => {
		const { shapes, netlist, outline } = dividerBoard();
		const alongEdge = trackSegments(
			5100,
			[
				{ x: outline.x - 10, y: outline.y - 9.8 },
				{ x: outline.x + 10, y: outline.y - 9.8 },
			],
			"F.Cu",
			0.25,
			"mid",
		);
		assert.ok(
			kinds(designRulesCheck([...shapes, ...alongEdge], netlist)).includes(
				"edge",
			),
		);
	});

	test("two pads of one footprint touching each other is a short", () => {
		const { netlist, footprints, outline } = dividerBoard();
		const [r1, r2] = footprints as BoardFootprint[];
		const shorted = {
			...r1,
			children: r1.children.map((child) =>
				isPad(child as EditorShape) ? { ...child, x: 0, y: 0 } : child,
			),
		};
		assert.ok(
			kinds(designRulesCheck([shorted, r2, outline], netlist)).includes(
				"short",
			),
		);
	});

	test("copper on a net the circuit no longer has is reported", () => {
		const { shapes, netlist, at } = dividerBoard();
		const orphan = trackSegments(
			5200,
			[at(-5, 5), at(-3, 5)],
			"F.Cu",
			0.25,
			"gone",
		);
		assert.ok(
			kinds(designRulesCheck([...shapes, ...orphan], netlist)).includes("net"),
		);
	});

	test("names a component with no footprint and a connected pin with no pad", () => {
		const { circuit, footprints, outline } = dividerBoard();
		const threePinR1: Circuit = {
			...circuit,
			components: circuit.components.map((component) =>
				component.id === "R1"
					? { ...component, pins: [...component.pins, pin("R1", "3")] }
					: component,
			),
			nets: circuit.nets.map((net) =>
				net.id === "gnd" ? { ...net, pinIds: [...net.pinIds, "R1.3"] } : net,
			),
		};
		const messages = designRulesCheck(
			[footprints[0], outline],
			boardNetlist(threePinR1),
		)
			.filter((finding) => finding.kind === "footprint")
			.map((finding) => finding.message);
		assert.equal(messages.length, 2);
		assert.ok(messages.some((message) => /R1\b.*\b3\b/.test(message)));
		assert.ok(messages.some((message) => /\bR2\b/.test(message)));
	});
});

describe("fabrication files", () => {
	test("copper inside a hole in a pour is drawn after the hole is cleared, so it reaches the fab", () => {
		const square = (size: number): [number, number][] => [
			[-size / 2, -size / 2],
			[size / 2, -size / 2],
			[size / 2, size / 2],
			[-size / 2, size / 2],
		];
		const fill = (polygons: [number, number][][][]) =>
			({ layer: "F.Cu", net: "gnd", polygons }) as unknown as ZoneFill;
		const island = fill([[square(6)]]);
		const ring = fill([[square(20), square(10).reverse()]]);
		const copper = required(
			exportFabrication("nested", [], [island, ring], 0.05).find((file) =>
				file.name.endsWith("F_Cu.gtl"),
			),
		);
		const objects = parseGerber(copper.content, copper.name).object.objects;
		const width = (object: (typeof objects)[number]) =>
			Math.round(object.bounds.maxX - object.bounds.minX);
		const hole = objects.findIndex(
			(object) => object.polarity === "clear" && width(object) === 10,
		);
		const drawnIsland = Math.max(
			...objects.map((object, index) =>
				object.polarity === "dark" && width(object) === 6 ? index : -1,
			),
		);
		assert.ok(hole >= 0 && drawnIsland > hole);
	});

	test("pads and vias are flashed as pads, with the copper and mask openings they had as regions", () => {
		const smd = (x: number, rotation: number): EditorShape => ({
			id: nextId++,
			kind: "rectangle",
			layer: "F.Cu",
			x,
			y: 5,
			width: 2,
			height: 1,
			rotation,
			lineWidth: 0,
			filled: true,
			pad: { number: "1", type: "smd", paste: true },
		});
		const tilted = smd(10, Math.PI / 6);
		const upright = smd(20, -Math.PI / 2);
		const shapes: EditorShape[] = [
			tilted,
			upright,
			{
				id: nextId++,
				kind: "circle",
				layer: "F.Cu",
				x: 30,
				y: 5,
				width: 1.7,
				height: 1.7,
				rotation: 0,
				lineWidth: 0,
				filled: true,
				pad: { number: "2", type: "through-hole", drill: 1 },
			},
			{
				id: nextId++,
				kind: "circle",
				layer: "F.Cu",
				x: 40,
				y: 5,
				width: 0.6,
				height: 0.6,
				rotation: 0,
				lineWidth: 0,
				filled: true,
				via: { drill: 0.3 },
			},
			{
				id: nextId++,
				kind: "line",
				layer: "F.Cu",
				x: 15,
				y: 5,
				width: 10,
				height: 0,
				rotation: 0,
				lineWidth: 0.25,
			},
		];
		const files = exportFabrication("pads", shapes, [], 0.05);
		const layer = (suffix: string) => {
			const file = required(files.find((file) => file.name.endsWith(suffix)));
			assert.doesNotMatch(file.content, /G36/);
			const parsed = parseGerber(file.content, file.name);
			assert.deepEqual(parsed.diagnostics, []);
			return parsed.object.objects;
		};
		const near = (a: Bounds, b: Bounds) =>
			(["minX", "minY", "maxX", "maxY"] as const).every(
				(side) => Math.abs(a[side] - b[side]) < 1e-6,
			);
		const corners = (shape: EditorShape, grow = 0) => {
			const bounds = hullBounds({ points: rectangleCorners(shape), radius: 0 });
			return {
				minX: bounds.minX - grow,
				minY: bounds.minY - grow,
				maxX: bounds.maxX + grow,
				maxY: bounds.maxY + grow,
			};
		};

		const copper = layer("F_Cu.gtl");
		assert.deepEqual(
			copper.map((object) => object.attributes[".AperFunction"]?.join(",")),
			["SMDPad,CuDef", "SMDPad,CuDef", "ComponentPad", "ViaPad", "Conductor"],
		);
		assert.ok(near(copper[0].bounds, corners(tilted)));
		assert.ok(near(copper[1].bounds, corners(upright)));
		const outline = JSON.stringify(copper[0].geometry)
			.match(/-?\d+\.\d+ -?\d+\.\d+/g)
			?.map((pair) => pair.split(" ").map(Number));
		assert.ok(
			rectangleCorners(tilted).every((corner) =>
				outline?.some(
					([x, y]) => Math.hypot(x + 10 - corner.x, y + 5 - corner.y) < 1e-6,
				),
			),
		);

		const mask = layer("F_Mask.gts");
		assert.equal(mask.length, 3);
		assert.ok(near(mask[0].bounds, corners(tilted, 0.05)));
		assert.ok(near(mask[1].bounds, corners(upright, 0.05)));
		const opening = mask[0].geometry;
		const roundedCorners =
			opening.type === "group"
				? opening.children.flatMap(({ geometry }) =>
						geometry.type === "circle" ? [geometry] : [],
					)
				: [];
		assert.ok(
			roundedCorners.length === 4 &&
				rectangleCorners(tilted).every((corner) =>
					roundedCorners.some(
						(circle) =>
							Math.abs(circle.radius - 0.05) < 1e-9 &&
							Math.hypot(circle.x + 10 - corner.x, circle.y + 5 - corner.y) <
								1e-6,
					),
				),
		);
		const paste = layer("F_Paste.gtp");
		assert.equal(paste.length, 2);
		assert.ok(near(paste[1].bounds, corners(upright)));
	});
});

describe("solder mask margin", () => {
	const qfnPad = {
		...createPad(1, { x: 0, y: 0 }, "smd", "1", "F.Cu"),
		width: 0.23,
		height: 0.8,
	};
	const throughHole = createPad(2, { x: 5, y: 0 }, "through-hole", "2", "F.Cu");
	const mm = (value: number) => Number(value.toFixed(6));
	const sizes = (margin: number) => [
		[mm(0.23 + 2 * margin), mm(0.8 + 2 * margin)],
		[mm(throughHole.width + 2 * margin), mm(throughHole.width + 2 * margin)],
	];
	const exportedOpenings = (margin: number) => {
		const mask = required(
			exportFabrication("mask", [qfnPad, throughHole], [], margin).find(
				(file) => file.name.endsWith("F_Mask.gts"),
			),
		);
		return parseGerber(mask.content, mask.name).object.objects.map(
			({ bounds }) => [
				mm(bounds.maxX - bounds.minX),
				mm(bounds.maxY - bounds.minY),
			],
		);
	};

	test("boards saved before the setting existed keep the 0.05 mm margin", () => {
		const board = boardFileSchema.parse({
			...createBoardFile("Old", "circuit"),
			rules: {
				clearance: 0.2,
				trackWidth: 0.25,
				viaDiameter: 0.6,
				viaDrill: 0.3,
				edgeClearance: 0.3,
			},
		});
		assert.equal(board.rules.solderMaskMargin, 0.05);
	});

	test("the mask Gerber opens each pad by the margin, including none and a negative one", () => {
		for (const margin of [0.05, 0, 0.1, -0.05])
			assert.deepEqual(exportedOpenings(margin), sizes(margin), `${margin}`);
	});

	test("a negative margin shrinks a rotated pad about its centre", () => {
		const tilted = { ...qfnPad, rotation: Math.PI / 4 };
		const mask = required(
			exportFabrication("mask", [tilted], [], -0.05).find((file) =>
				file.name.endsWith("F_Mask.gts"),
			),
		);
		const [opening] = parseGerber(mask.content, mask.name).object.objects;
		const expected = hullBounds({
			points: rectangleCorners({ ...tilted, width: 0.13, height: 0.7 }),
			radius: 0,
		});
		for (const side of ["minX", "minY", "maxX", "maxY"] as const)
			assert.ok(Math.abs(opening.bounds[side] - expected[side]) < 1e-6, side);
	});

	test("a margin that shrinks a pad away leaves it covered", () => {
		assert.deepEqual(exportedOpenings(-0.2), [sizes(-0.2)[1]]);
		assert.deepEqual(exportedOpenings(-throughHole.width / 2), []);
	});

	test("the rules accept margins from -0.5 mm to 0.5 mm", () => {
		const rules = (solderMaskMargin: number) =>
			boardRulesSchema.safeParse({ ...defaultBoardRules, solderMaskMargin })
				.success;
		assert.deepEqual([-0.6, -0.5, 0, 0.5, 0.6].map(rules), [
			false,
			true,
			true,
			true,
			false,
		]);
	});
});

describe("unplated holes", () => {
	const mountingHole = (at: Point) =>
		createBoardFootprint(
			nextId++,
			required(source({ library: "builtin", id: "mountinghole_3.2mm_m3" })),
			{ reference: "H1", value: "MountingHole" },
			at,
		);
	const boardHole = (at: Point, drill: number): EditorShape => ({
		...createHole(nextId++, at),
		width: drill,
		height: drill,
		hole: { drill },
	});
	const fabricationFile = (
		shapes: readonly EditorShape[],
		suffix: string,
		maskMargin = defaultBoardRules.solderMaskMargin,
	) =>
		exportFabrication("board", shapes, [], maskMargin).find((file) =>
			file.name.endsWith(suffix),
		);
	const objectsAt = (content: string, name: string, point: Point) =>
		parseGerber(content, name).object.objects.filter(
			({ bounds }) =>
				bounds.minX <= point.x &&
				point.x <= bounds.maxX &&
				bounds.minY <= point.y &&
				point.y <= bounds.maxY,
		);

	test("a mounting hole goes in its own NPTH drill file with a mask opening on both sides and no copper", () => {
		const { shapes, at } = dividerBoard();
		const hole = at(6, 4);
		const small = at(-6, 4);
		const board = [
			...shapes,
			mountingHole(hole),
			{ ...boardHole(small, 1.2), hole: { drill: 1 } },
		];
		const drill = required(fabricationFile(board, "-NPTH.drl")).content;
		assert.match(drill, /^; #@! TF\.FileFunction,NonPlated,1,2,NPTH$/m);
		assert.deepEqual(
			drill.split("\n").filter((line) => /^(T\d|X)/.test(line)),
			[
				"T1C1.000",
				"T2C3.200",
				"T1",
				`X${small.x.toFixed(3)}Y${small.y.toFixed(3)}`,
				"T2",
				`X${hole.x.toFixed(3)}Y${hole.y.toFixed(3)}`,
				"T0",
			],
		);
		assert.equal(
			required(fabricationFile(board, "-PTH.drl")).content,
			required(fabricationFile(shapes, "-PTH.drl")).content,
		);
		assert.equal(fabricationFile(shapes, "-NPTH.drl"), undefined);
		for (const suffix of ["F_Mask.gts", "B_Mask.gbs"]) {
			const mask = required(fabricationFile(board, suffix));
			for (const [center, width] of [
				[hole, 3.3],
				[small, 1.3],
			] as const) {
				const [opening] = objectsAt(mask.content, mask.name, center);
				assert.ok(
					Math.abs(opening.bounds.maxX - opening.bounds.minX - width) < 1e-6,
					suffix,
				);
			}
		}
		for (const suffix of ["F_Cu.gtl", "B_Cu.gbl", "F_Paste.gtp"]) {
			const file = required(fabricationFile(board, suffix));
			assert.deepEqual(objectsAt(file.content, file.name, hole), [], suffix);
		}
	});

	test("a hole's mask opening follows the board's mask margin like a pad's", () => {
		const { at } = dividerBoard();
		const center = at(6, 4);
		const board = [{ ...boardHole(center, 3.15), hole: { drill: 2.75 } }];
		const openings = (maskMargin: number) =>
			["F_Mask.gts", "B_Mask.gbs"].map((suffix) => {
				const mask = required(fabricationFile(board, suffix, maskMargin));
				return objectsAt(mask.content, mask.name, center).map(({ bounds }) =>
					Number((bounds.maxX - bounds.minX).toFixed(6)),
				);
			});
		assert.deepEqual(openings(0), [[3.15], [3.15]]);
		assert.deepEqual(openings(0.1), [[3.35], [3.35]]);
		assert.deepEqual(openings(-0.2), [[2.75], [2.75]]);
		assert.deepEqual(openings(-1.6), [[], []]);
		const [top] = maskOpenings(board, 0).top;
		const radius = Math.max(
			...top.map(([x, y]) => Math.hypot(x - center.x, y - center.y)),
		);
		assert.ok(Math.abs(radius - 3.15 / 2) < 0.01);
	});

	test("a GND pour keeps the board clearance from a mounting hole without a keepout zone", () => {
		const { shapes, netlist, pour, at } = dividerBoard();
		const center = at(6, 4);
		const gndPour = pour("gnd", 0, 28);
		const board = [...shapes, gndPour, mountingHole(center)];
		const fill = pourCopper(board, netlist);
		const ring = (radius: number) =>
			Array.from({ length: 32 }, (_, index) => ({
				x: center.x + radius * Math.cos((index * Math.PI) / 16),
				y: center.y + radius * Math.sin((index * Math.PI) / 16),
			}));
		const keepout = 1.6 + defaultBoardRules.clearance;
		assert.ok(
			ring(keepout - 0.01).every((point) => !containsPoint(fill, point)),
		);
		assert.ok(ring(keepout + 0.1).every((point) => containsPoint(fill, point)));
		assert.deepEqual(
			spacingProblems(designRulesCheck(board, netlist), gndPour),
			[],
		);
	});

	test("a priority polygon pour around an unplated hole keeps the board clearance from it, as does the pour under it", () => {
		const { shapes, netlist, pour, polygonPour, at } = dividerBoard();
		const center = at(-9, 5);
		const midPour = pour("mid", 0, 28);
		const gndPolygon = polygonPour(
			"gnd",
			[at(-14, -9), at(14, -9), at(14, 3), at(4, 3), at(4, 9), at(-14, 9)],
			2,
		);
		const board = [...shapes, midPour, gndPolygon, boardHole(center, 3)];
		const fills = fillZones(board, netlist, defaultBoardRules);
		const copperOf = (zone: EditorShape) =>
			required(fills.find((fill) => fill.zone.shapeId === zone.id)).polygons;
		const ring = (radius: number) =>
			Array.from({ length: 32 }, (_, index) => ({
				x: center.x + radius * Math.cos((index * Math.PI) / 16),
				y: center.y + radius * Math.sin((index * Math.PI) / 16),
			}));
		const keepout = 1.5 + defaultBoardRules.clearance;
		for (const zone of [gndPolygon, midPour])
			assert.ok(
				ring(keepout - 0.01).every(
					(point) => !containsPoint(copperOf(zone), point),
				),
			);
		assert.ok(
			ring(keepout + 0.1).every((point) =>
				containsPoint(copperOf(gndPolygon), point),
			),
		);
		const findings = designRulesCheck(board, netlist);
		assert.deepEqual(
			[
				...spacingProblems(findings, gndPolygon),
				...spacingProblems(findings, midPour),
			],
			[],
		);
	});

	test("copper run into or too close to an unplated hole is a clearance finding", () => {
		const { shapes, netlist, at } = dividerBoard();
		const center = at(6, 4);
		const footprint = mountingHole(center);
		const across = (y: number) =>
			trackSegments(
				nextId++ * 10,
				[
					{ x: center.x - 3, y },
					{ x: center.x + 3, y },
				],
				"B.Cu",
				0.2,
				"mid",
			);
		const findings = (y: number) =>
			spacingProblems(
				designRulesCheck([...shapes, footprint, ...across(y)], netlist),
				footprint,
			).map((finding) => [finding.kind, finding.message]);
		assert.deepEqual(findings(center.y), [
			["clearance", "track on MID overlaps an unplated hole"],
		]);
		assert.deepEqual(findings(center.y + 1.6 + 0.1 + 0.15), [
			[
				"clearance",
				"Clearance 0.150 mm between track on MID and an unplated hole, needs 0.2 mm",
			],
		]);
		assert.deepEqual(
			spacingProblems(
				checkBoard(
					[...shapes, footprint, ...across(center.y + 1.6 + 0.1 + 0.15)],
					netlist,
					defaultBoardRules,
					{ unit: "mil" },
				),
				footprint,
			).map((finding) => finding.message),
			[
				"Clearance 5.91 mil between track on MID and an unplated hole, needs 7.87 mil",
			],
		);
		assert.deepEqual(findings(center.y + 1.6 + 0.1 + 0.25), []);
	});

	test("a flipped mounting hole still drills through, opens both masks and keeps the pour clear", () => {
		const { shapes, netlist, pour, at } = dividerBoard();
		const center = at(6, 4);
		const flipped = flipBoardFootprint(mountingHole(center));
		const board = [...shapes, pour("gnd", 0, 28), flipped];
		assert.match(
			required(fabricationFile(board, "-NPTH.drl")).content,
			new RegExp(`^X${center.x.toFixed(3)}Y${center.y.toFixed(3)}$`, "m"),
		);
		for (const suffix of ["F_Mask.gts", "B_Mask.gbs"]) {
			const mask = required(fabricationFile(board, suffix));
			assert.equal(objectsAt(mask.content, mask.name, center).length, 1);
		}
		assert.equal(containsPoint(pourCopper(board, netlist), center), false);
	});

	test("a hole is never copper, whatever layer a file gives it", () => {
		const { shapes, netlist, at } = dividerBoard();
		const onCopper = { ...boardHole(at(6, 4), 1), layer: "F.Cu" as const };
		assert.deepEqual(
			copperItems([...shapes, onCopper], netlist).filter(
				(item) => item.shape === onCopper,
			),
			[],
		);
		assert.equal(boardHoles([...shapes, onCopper]).length, 1);
	});

	test("holes that overlap each other or the board edge are findings", () => {
		const { shapes, netlist, outline, at } = dividerBoard();
		const holeFindings = (holes: EditorShape[]) =>
			designRulesCheck([...shapes, ...holes], netlist)
				.filter((finding) => /unplated hole/i.test(finding.message))
				.map((finding) => [finding.kind, finding.message]);
		assert.deepEqual(holeFindings([boardHole(at(6, 4), 2)]), []);
		assert.deepEqual(
			holeFindings([boardHole(at(6, 4), 2), boardHole(at(7.5, 4), 2)]),
			[["clearance", "Two unplated holes overlap"]],
		);
		assert.deepEqual(
			holeFindings([
				boardHole({ x: outline.x + 14.5, y: outline.y }, 2),
				boardHole({ x: outline.x + 15.5, y: outline.y + 5 }, 2),
				boardHole({ x: outline.x + 20, y: outline.y }, 2),
			]),
			[
				["edge", "An unplated hole crosses the board edge"],
				["edge", "An unplated hole crosses the board edge"],
				["edge", "An unplated hole is outside the board outline"],
			],
		);
	});

	test("the autorouter routes around an unplated hole in its way", () => {
		const { shapes, netlist, at } = dividerBoard();
		const board = [...shapes, boardHole(at(0, 0), 1)];
		const routed = autoroute(board, netlist, 2000, {
			rules: defaultBoardRules,
		});
		assert.deepEqual(routed.failed, []);
		assert.deepEqual(
			designRulesCheck([...board, ...routed.shapes], netlist),
			[],
		);
	});
});

describe("the board view", () => {
	test("flipping a footprint puts its copper on the back, mirrored, and flipping again restores it", () => {
		const { footprints } = dividerBoard();
		const r1 = footprints[0] as BoardFootprint;
		const flipped = flipBoardFootprint(r1);
		const front = boardPads([r1]);
		const back = boardPads([flipped]);
		assert.ok(back.every((pad) => pad.shape.layer === "B.Cu"));
		assert.ok(
			Math.abs(back[0].shape.x - r1.x + (front[0].shape.x - r1.x)) < 1e-9,
		);
		assert.deepEqual(boardPads([flipBoardFootprint(flipped)]), front);
	});

	test("hiding a layer takes its items off the board, and selecting a footprint highlights all its items", () => {
		const { footprints } = dividerBoard();
		const r1 = footprints[0] as BoardFootprint;
		const display = boardDisplay(
			boardLayerView(footprints, new Set(), "F.Cu"),
			new Set([r1.id]),
			new Set(["F.SilkS"]),
			"F.Cu",
		);
		assert.ok(display.shapes.every((shape) => shape.layer !== "F.SilkS"));
		assert.ok(display.shapes.some((shape) => shape.layer === "F.Cu"));
		assert.ok(
			r1.children.every((_, index) =>
				display.selected.has(footprintItemId(r1.id, index)),
			),
		);
	});

	test("footprint text shows the component's reference, value and footprint name, and follows schematic edits", () => {
		const labelled = (
			text: string,
			y: number,
			layer: "F.Fab" | "F.SilkS" = "F.Fab",
		): EditorShape => ({
			id: y + 1,
			kind: "text",
			layer,
			x: 0,
			y,
			width: 2,
			height: 1.5,
			rotation: 0,
			lineWidth: 0.15,
			fontSize: 1,
			text,
		});
		const fab: FootprintSource = {
			reference: { library: "project", id: "fab" },
			name: "Fab resistor",
			shapes: [
				...required(source(r0805)).shapes,
				labelled(`\${REFERENCE}`, 0, "F.SilkS"),
				labelled(`\${VALUE} \${OTHER}`, 2),
				labelled(`\${FOOTPRINT_NAME}`, 4),
			],
		};
		const circuit = dividerCircuit();
		const sync = (shapes: readonly EditorShape[], value: string) =>
			synchronizeBoard({
				shapes,
				circuit: {
					...circuit,
					components: circuit.components.map((component) => ({
						...component,
						value,
					})),
				},
				footprintOf: () => fab.reference,
				source: () => fab,
				nextId: 1000,
			});
		const texts = (footprint: EditorShape) =>
			symbolShapes(footprint as BoardFootprint).flatMap((shape) =>
				shape.kind === "text" ? [shape] : [],
			);
		const placed = sync([], "10k").place;
		assert.deepEqual(
			texts(placed[0]).map((shape) => shape.text),
			["R1", `10k \${OTHER}`, "Fab resistor"],
		);
		const [reference] = texts(placed[0]);
		assert.ok(reference.width < 2 / 3);
		assert.deepEqual((placed[0] as BoardFootprint).texts, []);
		assert.equal(
			(updateFromSchematic(circuit).place[0] as BoardFootprint).texts.length,
			1,
		);
		const onFab = {
			...fab,
			shapes: [...fab.shapes.slice(0, -3), labelled(`\${REFERENCE}`, 0)],
		};
		assert.equal(
			(
				synchronizeBoard({
					shapes: [],
					circuit,
					footprintOf: () => onFab.reference,
					source: () => onFab,
					nextId: 1000,
				}).place[0] as BoardFootprint
			).texts.length,
			1,
		);
		assert.ok(
			boardDisplay(placed, new Set(), new Set(), "F.Cu").shapes.some(
				(shape) => shape.kind === "text" && shape.text === "R2",
			),
		);
		const edited = sync(placed, "4k7").replace;
		assert.equal(texts(edited[0])[1].text, `4k7 \${OTHER}`);
		assert.deepEqual(
			(edited[0] as BoardFootprint).children.flatMap((child) =>
				child.kind === "text" ? [child.text] : [],
			),
			[`\${REFERENCE}`, `\${VALUE} \${OTHER}`, `\${FOOTPRINT_NAME}`],
		);
	});

	test("resizing a footprint's reference text on the board keeps it following the reference", () => {
		const fab: FootprintSource = {
			reference: { library: "project", id: "fab" },
			name: "Fab",
			shapes: [
				{
					id: 1,
					kind: "text",
					layer: "F.Fab",
					x: 0,
					y: 0,
					width: 7.5,
					height: 1.5,
					rotation: 0,
					lineWidth: 0.15,
					fontSize: 1,
					text: `\${REFERENCE}`,
				},
			],
		};
		const [footprint] = synchronizeBoard({
			shapes: [],
			circuit: dividerCircuit(),
			footprintOf: () => fab.reference,
			source: () => fab,
			nextId: 1,
		}).place as BoardFootprint[];
		const child = required(
			symbolChildren(footprint).find((item) => item.shape.kind === "text"),
		);
		assert.equal(child.shape.kind === "text" && child.shape.text, "R1");
		const bigger = replaceSymbolChild(footprint, child.key, {
			...child.shape,
			fontSize: 2,
			width: child.shape.width * 2,
			height: child.shape.height * 2,
		} as SymbolShape);
		assert.deepEqual(bigger.childOverrides?.[child.key], {
			fontSize: 2,
			width: 15,
			height: 3,
		});
		const renamed = {
			...bigger,
			attributes: { ...bigger.attributes, reference: "R10" },
		};
		const [text] = symbolShapes(renamed);
		assert.equal(text.kind === "text" && text.text, "R10");
		const valued = {
			...footprint,
			children: [
				{ ...footprint.children[0], text: `\${VALUE}`, width: 3.7 },
			] as SymbolShape[],
			attributes: { ...footprint.attributes, value: "4.7uF" },
		};
		const label = required(
			symbolChildren(valued).find((item) => item.shape.kind === "text"),
		);
		const moved = replaceSymbolChild(valued, label.key, {
			...label.shape,
			x: label.shape.x + 1,
		} as SymbolShape);
		assert.deepEqual(moved.childOverrides?.[label.key], {
			x: label.shape.x + 1,
		});
	});
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

test("corners close into a zone once they enclose an area or their edges cross", () => {
	const points = (corners: [number, number][]) =>
		corners.map(([x, y]) => ({ x, y }));
	assert.equal(
		outlineEncloses(
			points([
				[0, 0],
				[4, 0],
			]),
			1,
		),
		false,
	);
	assert.equal(
		outlineEncloses(
			points([
				[0, 0],
				[4, 0],
				[8, 0],
			]),
			1,
		),
		false,
	);
	assert.equal(
		outlineEncloses(
			points([
				[0, 0],
				[4, 0],
				[0, 4],
			]),
			1,
		),
		true,
	);
	assert.equal(
		outlineEncloses(
			points([
				[0, 0],
				[4, 0],
				[0, 4],
			]),
			9,
		),
		false,
	);
	assert.equal(
		outlineEncloses(
			points([
				[0, 0],
				[4, 4],
				[4, 0],
				[0, 4],
			]),
			1,
		),
		true,
	);
	const collinear = points([
		[0, 0],
		[2, 0],
		[1, 0],
		[3, 0],
	]);
	assert.equal(outlineEncloses(collinear, 1), false);
	const diagonal = points([
		[0, 0],
		[10, 10],
		[5, 5],
		[8, 8],
	]);
	assert.equal(outlineEncloses(diagonal, 1), false);
	const backOnFirst = points([
		[0, 0],
		[0.1, 0],
		[0, 0],
		[0, 0.1],
	]);
	assert.equal(outlineEncloses(backOnFirst, 1), false);
});

describe("editing a polygon pour", () => {
	const { polygonPour, at } = dividerBoard();
	const triangle = polygonPour("gnd", [at(0, 0), at(10, 0), at(0, 10)]);
	const corners = (shape: EditorShape) =>
		isPolygonZone(shape)
			? zoneOutlinePoints(shape).map(({ x, y }) => ({
					x: Number((x - at(0, 0).x).toFixed(6)),
					y: Number((y - at(0, 0).y).toFixed(6)),
				}))
			: [];
	const handle = (id: string) =>
		required(resizeHandles(triangle).find((item) => item.id === id));

	test("dragging a corner moves it, and the pour's box follows", () => {
		const moved = resizeShape(triangle, handle("corner:1"), { x: 5, y: 2 });
		assert.deepEqual(corners(moved), [
			{ x: 0, y: 0 },
			{ x: 15, y: 2 },
			{ x: 0, y: 10 },
		]);
		assert.deepEqual([moved.width, moved.height], [15, 10]);
	});

	test("dragging an edge's midpoint adds a corner, and dropping a corner on its neighbour removes it", () => {
		const added = resizeShape(triangle, handle("edge:0"), { x: 0, y: -3 });
		assert.deepEqual(corners(added), [
			{ x: 0, y: 0 },
			{ x: 5, y: -3 },
			{ x: 10, y: 0 },
			{ x: 0, y: 10 },
		]);
		const removed = resizeShape(
			added,
			required(resizeHandles(added).find((item) => item.id === "corner:1")),
			{ x: 5, y: 3 },
		);
		assert.deepEqual(corners(removed), corners(triangle));
		assert.deepEqual(
			corners(resizeShape(triangle, handle("edge:0"), { x: 5, y: 0 })),
			corners(triangle),
		);
		assert.deepEqual(
			corners(resizeShape(triangle, handle("corner:1"), { x: -10, y: 0 })),
			corners(triangle),
		);
	});

	test("a corner of a turned pour, off the grid, is removed when dropped next to its neighbour", () => {
		const square = polygonPour("gnd", [at(0, 0), at(4, 0), at(4, 4), at(0, 4)]);
		const turned = { ...square, rotation: Math.PI / 6 };
		const [first, second] = isPolygonZone(turned)
			? zoneOutlinePoints(turned)
			: [];
		const corner = required(
			resizeHandles(turned).find((item) => item.id === "corner:1"),
		);
		const dropped = resizeShape(
			turned,
			corner,
			{ x: first.x - second.x, y: first.y - second.y },
			1,
		);
		assert.equal(corners(dropped).length, 3);
		const kept = resizeShape(
			turned,
			corner,
			{ x: first.x - second.x + 2, y: first.y - second.y },
			1,
		);
		assert.equal(corners(kept).length, 4);
	});

	test("a marquee selects the pour by its polygon, not the rectangle around it", () => {
		const lShape = polygonPour("gnd", [
			at(0, 0),
			at(10, 0),
			at(10, 4),
			at(4, 4),
			at(4, 10),
			at(0, 10),
		]);
		const box = (from: Point, to: Point) => ({
			minX: Math.min(from.x, to.x),
			maxX: Math.max(from.x, to.x),
			minY: Math.min(from.y, to.y),
			maxY: Math.max(from.y, to.y),
		});
		assert.equal(intersectsSelection(lShape, box(at(6, 6), at(9, 9))), false);
		assert.equal(intersectsSelection(lShape, box(at(1, 1), at(2, 2))), true);
		assert.equal(intersectsSelection(lShape, box(at(3, 6), at(5, 7))), true);
		const turned = { ...lShape, rotation: Math.PI / 4 };
		const [minX, maxX, minY, maxY] = isPolygonZone(turned)
			? (() => {
					const points = zoneOutlinePoints(turned);
					const xs = points.map((point) => point.x);
					const ys = points.map((point) => point.y);
					return [
						Math.min(...xs),
						Math.max(...xs),
						Math.min(...ys),
						Math.max(...ys),
					];
				})()
			: [0, 0, 0, 0];
		assert.equal(
			containsSelection(turned, {
				minX: minX - 0.01,
				maxX: maxX + 0.01,
				minY: minY - 0.01,
				maxY: maxY + 0.01,
			}),
			true,
		);
	});

	test("clicking outside the polygon but inside its box does not select it", () => {
		assert.equal(shapeAt([triangle], at(8, 8), 0.1), undefined);
		assert.equal(shapeAt([triangle], at(2, 2), 0.1), triangle);
		assert.equal(shapeAt([triangle], at(5, 5), 0.1), triangle);
	});
});

describe("saving a board", () => {
	for (const layout of ["files", "revisions"] as const)
		test(`the board is saved inside its drawing's .ecaddraw file and reopens unchanged (${layout} layout)`, async () => {
			const directory = memoryDirectory();
			const repository = new ProjectRepository(directory, { layout });
			await repository.create("Divider");
			const { circuit, shapes, pour, polygonPour, at } = dividerBoard();
			const board = {
				...createBoardFile("Divider", circuit.id),
				shapes: [
					...shapes,
					pour("gnd", 0, 28),
					polygonPour("mid", [at(0, 0), at(4, 0), at(0, 4)], 2),
				],
			};
			const saved = await repository.save({
				shapes: [],
				symbols: [],
				circuits: [{ ...createCircuit("Divider", circuit.id), circuit }],
				boards: [board],
			});
			const path = required(saved.manifest.drawing);
			assert.match(path, /Divider\.ecaddraw$/);
			const file = JSON.parse(
				new TextDecoder().decode(required(directory.files.get(path))),
			);
			assert.equal(file.circuit.id, circuit.id);
			assert.deepEqual(file.board, {
				units: "mm",
				rules: board.rules,
				shapes: board.shapes,
			});
			assert.deepEqual(
				projectFileSelections(saved)
					.filter((entry) => entry.path === path)
					.map((entry) => entry.view),
				[undefined, "circuit", "pcb"],
			);
			const reopened = await new ProjectRepository(directory, {
				layout,
			}).load();
			assert.deepEqual(reopened.boards, [board]);
		});

	test("a zone corner outside its rectangle or a fractional priority is refused", () => {
		const { circuit, polygonPour, at } = dividerBoard();
		const zone = polygonPour("mid", [at(0, 0), at(4, 0), at(0, 4)]);
		if (zone.kind !== "rectangle" || !zone.zone?.outline)
			throw new Error("Expected a polygon zone.");
		const file = (shape: EditorShape) =>
			boardFileSchema.safeParse({
				...createBoardFile("Divider", circuit.id),
				shapes: [shape],
			}).success;
		assert.ok(file(zone));
		assert.ok(
			!file({
				...zone,
				zone: { outline: [...zone.zone.outline.slice(1), { x: 0.7, y: 0 }] },
			}),
		);
		assert.ok(!file({ ...zone, zone: { ...zone.zone, priority: 1.5 } }));
		assert.ok(!file({ ...zone, zone: { ...zone.zone, priority: 1001 } }));
		assert.ok(
			!file({ ...zone, zone: { outline: zone.zone.outline.slice(0, 2) } }),
		);
	});
});
