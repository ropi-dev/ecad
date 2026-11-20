import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { generateDefaultFootprints } from "@ecad/default-footprints";
import { autoroute } from "@ecad/drawing-core/board/autoroute.ts";
import {
	analyzeConnectivity,
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
	hullDistance,
	lineEnds,
	outlineEncloses,
	rectangleCorners,
	shapeHulls,
	trackSegment,
} from "@ecad/drawing-core/board/geometry.ts";
import { negotiatedRoute } from "@ecad/drawing-core/board/negotiated-route.ts";
import {
	type BoardNetlist,
	boardNetlist,
} from "@ecad/drawing-core/board/netlist.ts";
import {
	type BoardRules,
	defaultBoardRules,
} from "@ecad/drawing-core/board/rules.ts";
import { synchronizeBoard } from "@ecad/drawing-core/board/sync.ts";
import { dragTrackEnd } from "@ecad/drawing-core/board/track-drag.ts";
import { trackPath } from "@ecad/drawing-core/board/track-router.ts";
import {
	type Circuit,
	createCircuit,
} from "@ecad/drawing-core/circuit/model.ts";
import {
	type EditorShape,
	isUnsafeMove,
	moveShapes,
	resizeHandles,
	resizeShape,
	symbolShapes,
} from "@ecad/drawing-core/drawing/shapes.ts";
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
	createVia,
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
import { trackAnchor, trackSegments } from "#/board/routing.ts";
import { boardDisplay, boardLayerView, footprintItemId } from "#/board/view.ts";
import { containsPoint } from "#/engine/geometry.ts";
import exampleDesign from "#/examples/rp2350a-design.json" with {
	type: "json",
};
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

function applyMove(
	shapes: readonly EditorShape[],
	replacements: readonly EditorShape[],
) {
	const byId = new Map(replacements.map((shape) => [shape.id, shape]));
	const known = new Set(shapes.map((shape) => shape.id));
	return [
		...shapes.map((shape) => byId.get(shape.id) ?? shape),
		...replacements.filter((shape) => !known.has(shape.id)),
	];
}

const trackRouting = (
	shapes: readonly EditorShape[],
	netlist = boardNetlist(undefined),
	clearance = 0.2,
) => ({ items: copperItems(shapes, netlist), clearance });

const onOctant = (shape: EditorShape) =>
	Math.abs(Math.sin(4 * shape.rotation)) < 1e-6;

function touching(tracks: readonly EditorShape[]) {
	const reached = new Set([tracks[0]]);
	for (let grown = true; grown; ) {
		grown = false;
		for (const track of tracks)
			if (
				!reached.has(track) &&
				[...reached].some((other) =>
					shapeHulls(track).some((own) =>
						shapeHulls(other).some((hull) => hullDistance(own, hull) <= 1e-6),
					),
				)
			) {
				reached.add(track);
				grown = true;
			}
	}
	return reached.size === tracks.length;
}

function joins(tracks: readonly EditorShape[], from: Point, to: Point) {
	const key = (point: Point) =>
		`${Math.round(point.x * 1000)},${Math.round(point.y * 1000)}`;
	const reached = new Set([key(from)]);
	for (let grown = true; grown; ) {
		grown = false;
		for (const track of tracks) {
			const [a, b] = lineEnds(track).map(key);
			if (reached.has(a) !== reached.has(b)) {
				reached.add(a);
				reached.add(b);
				grown = true;
			}
		}
	}
	return reached.has(key(to));
}

const roundedEnds = (shape: EditorShape) =>
	lineEnds(shape).map((point) => ({
		x: Math.round(point.x * 1000) / 1000 || 0,
		y: Math.round(point.y * 1000) / 1000 || 0,
	}));

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

	test("dragging a track slides it along the tracks at its ends, which keep their angles", () => {
		const across = trackSegment(
			1,
			{ x: 0, y: 0 },
			{ x: 2, y: 0 },
			"F.Cu",
			0.25,
			"mid",
		);
		const bend = trackSegment(
			2,
			{ x: 2, y: 0 },
			{ x: 4, y: 2 },
			"F.Cu",
			0.25,
			"mid",
		);
		const down = trackSegment(
			3,
			{ x: 4, y: 2 },
			{ x: 4, y: 5 },
			"F.Cu",
			0.25,
			"mid",
		);
		const shapes = [across, bend, down];
		const moved = applyMove(
			shapes,
			moveShapes(
				[bend],
				{ x: 0.5, y: -0.5 },
				0,
				bend,
				shapes,
				4,
				false,
				trackRouting(shapes),
			),
		);
		assert.deepEqual(moved.map(roundedEnds), [
			[
				{ x: 0, y: 0 },
				{ x: 3, y: 0 },
			],
			[
				{ x: 3, y: 0 },
				{ x: 4, y: 1 },
			],
			[
				{ x: 4, y: 1 },
				{ x: 4, y: 5 },
			],
		]);
	});

	test("dragging a track's end off a via reroutes it and the track joined there in 45 degree steps, keeping both on the via", () => {
		const via = { ...createVia(1, { x: -6, y: 3 }), net: "a" };
		const track = trackSegment(
			2,
			{ x: 0, y: 0 },
			{ x: -6, y: 3 },
			"F.Cu",
			0.25,
			"a",
		);
		const joined = trackSegment(
			3,
			{ x: -6, y: 3 },
			{ x: -3, y: 9 },
			"F.Cu",
			0.25,
			"a",
		);
		const shapes = [via, track, joined];
		const moved = applyMove(
			shapes,
			dragTrackEnd(
				track,
				1,
				{ x: -3, y: 1.5 },
				shapes,
				4,
				0.1,
				trackRouting(shapes),
			),
		);
		const copper = moved.filter((shape) => shape.kind === "line");
		assert.ok(copper.every(onOctant));
		assert.ok(joins(copper, { x: 0, y: 0 }, { x: -3, y: 9 }));
		assert.ok(joins(copper, { x: 0, y: 0 }, { x: -6, y: 3 }));
		assert.ok(joins(copper, { x: 0, y: 0 }, { x: -3, y: 1.5 }));
	});

	test("a rerouted track goes around another net's copper", () => {
		const track = trackSegment(
			1,
			{ x: 0, y: 0 },
			{ x: 4, y: 0 },
			"F.Cu",
			0.25,
			"a",
		);
		const joined = trackSegment(
			2,
			{ x: 4, y: 0 },
			{ x: 4, y: 4 },
			"F.Cu",
			0.25,
			"a",
		);
		const wall = trackSegment(
			3,
			{ x: 5, y: -3 },
			{ x: 5, y: 2.5 },
			"F.Cu",
			0.25,
			"b",
		);
		const shapes = [track, joined, wall];
		const moved = applyMove(
			shapes,
			dragTrackEnd(
				track,
				1,
				{ x: 6, y: 2 },
				shapes,
				4,
				0.1,
				trackRouting(shapes),
			),
		);
		const net = moved.filter(
			(shape) => shape.kind === "line" && shape.net === "a",
		);
		assert.ok(net.every(onOctant));
		assert.ok(joins(net, { x: 0, y: 0 }, { x: 4, y: 4 }));
		assert.ok(joins(net, { x: 0, y: 0 }, { x: 6, y: 2 }));
		for (const shape of net)
			assert.ok(
				Math.min(
					...shapeHulls(shape).flatMap((own) =>
						shapeHulls(wall).map((other) => hullDistance(own, other)),
					),
				) >=
					0.2 - 1e-6,
			);
	});

	test("dropping a track's end, a track or a via on another net's copper is refused", () => {
		const track = trackSegment(
			1,
			{ x: 0, y: 0 },
			{ x: 4, y: 0 },
			"F.Cu",
			0.25,
			"a",
		);
		const wall = trackSegment(
			2,
			{ x: 5, y: -3 },
			{ x: 5, y: 3 },
			"F.Cu",
			0.25,
			"b",
		);
		const via = { ...createVia(3, { x: 2, y: -2 }), net: "a" };
		const shapes = [track, wall, via];
		const routing = trackRouting(shapes);
		const move = (shape: EditorShape, delta: Point) =>
			moveShapes([shape], delta, 0, shape, shapes, 4, false, routing);
		assert.ok(
			isUnsafeMove(
				dragTrackEnd(track, 1, { x: 5, y: 1 }, shapes, 4, 0.1, routing),
			),
		);
		assert.ok(isUnsafeMove(move(track, { x: 3, y: 0 })));
		assert.ok(isUnsafeMove(move(via, { x: 3, y: 0 })));
		assert.ok(!isUnsafeMove(move(via, { x: 1, y: 0 })));
	});

	test("a track with no net can be dragged onto a netted track, but not across two nets", () => {
		const netted = trackSegment(
			1,
			{ x: 0, y: 0 },
			{ x: 4, y: 0 },
			"F.Cu",
			0.25,
			"a",
		);
		const loose = trackSegment(
			2,
			{ x: 0, y: 2 },
			{ x: 3, y: 2 },
			"F.Cu",
			0.25,
			undefined,
		);
		const shapes = [netted, loose];
		const result = dragTrackEnd(
			loose,
			1,
			{ x: 3, y: 0 },
			shapes,
			3,
			0.1,
			trackRouting(shapes),
		);
		assert.ok(!isUnsafeMove(result));
		const joined = applyMove(shapes, result).filter((item) => item.width > 0);
		assert.ok(touching(joined));
		const other = trackSegment(
			9,
			{ x: -2, y: 4 },
			{ x: 4, y: 4 },
			"F.Cu",
			0.25,
			"b",
		);
		const board = [...joined, other];
		const bridge = required(joined.find((item) => item.id === loose.id));
		assert.ok(
			isUnsafeMove(
				dragTrackEnd(
					bridge,
					0,
					{ x: 0, y: 4 },
					board,
					10,
					0.1,
					trackRouting(board),
				),
			),
		);
	});

	test("a moved via stays joined to every track it rested on, and a track ending beside the moved copper keeps its end", () => {
		const via = { ...createVia(1, { x: 2, y: 0.2 }), net: "a" };
		const pair = [
			via,
			trackSegment(2, { x: 0, y: 0 }, { x: 6, y: 0 }, "F.Cu", 0.25, "a"),
			trackSegment(3, { x: 0, y: 0.4 }, { x: 6, y: 0.4 }, "F.Cu", 0.25, "a"),
		];
		assert.ok(
			touching(
				applyMove(
					pair,
					moveShapes(
						[via],
						{ x: 2, y: -2 },
						0,
						via,
						pair,
						4,
						false,
						trackRouting(pair),
					),
				).filter((item) => item.width > 0),
			),
		);
		const wide = trackSegment(
			6,
			{ x: 0, y: 0 },
			{ x: 5, y: 0 },
			"F.Cu",
			0.5,
			"a",
		);
		const branch = trackSegment(
			7,
			{ x: 0.35, y: 0 },
			{ x: 0.35, y: 3 },
			"F.Cu",
			0.25,
			"a",
		);
		const tapped = [
			trackSegment(5, { x: -5, y: 0 }, { x: 0, y: 0 }, "F.Cu", 0.25, "a"),
			wide,
			branch,
		];
		const moved = applyMove(
			tapped,
			moveShapes(
				[branch],
				{ x: 2, y: 0 },
				0,
				branch,
				tapped,
				8,
				false,
				trackRouting(tapped),
			),
		).filter((item) => item.width > 0);
		assert.ok(touching(moved));
		assert.deepEqual(
			roundedEnds(required(moved.find((item) => item.id === wide.id))),
			roundedEnds(wide),
		);
	});

	test("a track ending on another track's middle stays joined when either one moves", () => {
		const trunk = trackSegment(
			1,
			{ x: 0, y: 0 },
			{ x: 4, y: 0 },
			"F.Cu",
			0.25,
			"a",
		);
		const branch = trackSegment(
			2,
			{ x: 2, y: 0 },
			{ x: 2, y: 3 },
			"F.Cu",
			0.25,
			"a",
		);
		const shapes = [trunk, branch];
		const routing = trackRouting(shapes);
		for (const [shape, delta] of [
			[trunk, { x: 0, y: -1 }],
			[branch, { x: 1, y: 0 }],
		] as const) {
			const moved = applyMove(
				shapes,
				moveShapes([shape], delta, 0, shape, shapes, 3, false, routing),
			).filter((item) => item.width > 0);
			assert.ok(moved.every(onOctant));
			assert.ok(touching(moved));
		}
		const level = trackSegment(
			4,
			{ x: 0, y: 0 },
			{ x: 10, y: 0 },
			"F.Cu",
			0.25,
			"a",
		);
		const slope = trackSegment(
			5,
			{ x: 2, y: 2 },
			{ x: 10, y: 10 },
			"F.Cu",
			0.25,
			"a",
		);
		const rung = trackSegment(
			6,
			{ x: 5, y: 0 },
			{ x: 5, y: 5 },
			"F.Cu",
			0.25,
			"a",
		);
		const ladder = [level, slope, rung];
		const moved = applyMove(
			ladder,
			moveShapes(
				[level, slope],
				{ x: 0, y: 1 },
				0,
				level,
				ladder,
				7,
				false,
				trackRouting(ladder),
			),
		).filter((item) => item.width > 0);
		assert.ok(moved.every(onOctant));
		assert.ok(touching(moved));
	});

	test("tracks that end up in one straight line after a drag merge into one", () => {
		const before = trackSegment(
			1,
			{ x: 0, y: 0 },
			{ x: 2, y: 0 },
			"F.Cu",
			0.25,
			"a",
		);
		const track = trackSegment(
			2,
			{ x: 2, y: 0 },
			{ x: 3, y: 1 },
			"F.Cu",
			0.25,
			"a",
		);
		const shapes = [before, track];
		const moved = applyMove(
			shapes,
			dragTrackEnd(
				track,
				1,
				{ x: 4, y: 0 },
				shapes,
				3,
				0.1,
				trackRouting(shapes),
			),
		).filter((shape) => shape.width > 0);
		assert.deepEqual(moved.map(roundedEnds), [
			[
				{ x: 0, y: 0 },
				{ x: 4, y: 0 },
			],
		]);
	});

	test("a dragged track moves only in 45 degree steps", () => {
		const track = trackSegment(
			1,
			{ x: 0, y: 0 },
			{ x: 4, y: 0 },
			"F.Cu",
			0.25,
			"a",
		);
		const [moved] = moveShapes(
			[track],
			{ x: 0.4, y: 1.7 },
			0.1,
			track,
			[track],
			2,
			false,
			trackRouting([track]),
		);
		assert.deepEqual(roundedEnds(moved), [
			{ x: 0, y: 1.7 },
			{ x: 4, y: 1.7 },
		]);
	});

	test("moving a routed track or via keeps its net joined", () => {
		const { shapes, netlist } = dividerBoard();
		const [from, to] = lineEnds(required(routeMid(shapes, netlist)[0]));
		const middle = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
		const id = nextId++ * 10;
		const halves = [
			trackSegment(id, from, middle, "F.Cu", 0.25, "mid"),
			trackSegment(id + 1, middle, to, "F.Cu", 0.25, "mid"),
		];
		const via = { ...createVia(id + 2, middle), net: "mid" };
		const routed = [...shapes, ...halves, via];
		assert.deepEqual(unroutedNets(routed, netlist), ["gnd"]);
		for (const selection of [[halves[0]], [via], halves]) {
			const moved = applyMove(
				routed,
				moveShapes(
					selection,
					{ x: 0.3, y: -0.4 },
					0,
					selection[0],
					routed,
					id + 3,
					false,
					trackRouting(routed, netlist),
				),
			);
			assert.deepEqual(unroutedNets(moved, netlist), ["gnd"]);
		}
	});

	test("moving tracks and vias on the example board keeps every net routed", () => {
		const shapes = exampleDesign.board as unknown as EditorShape[];
		const netlist = boardNetlist(exampleDesign.circuit as never);
		const routing = trackRouting(
			shapes,
			netlist,
			exampleDesign.rules.clearance,
		);
		const unrouted = (list: readonly EditorShape[]) =>
			analyzeConnectivity(copperItems(list, netlist)).ratsnest.length;
		const before = unrouted(shapes);
		for (const [id, delta] of [
			[41, { x: 0.5, y: 0 }],
			[2466, { x: 0, y: -0.5 }],
			[2257, { x: 0, y: 0.5 }],
			[55, { x: 0, y: -0.5 }],
		] as const) {
			const shape = required(shapes.find((item) => item.id === id));
			const moved = moveShapes(
				[shape],
				delta,
				0,
				shape,
				shapes,
				9000,
				false,
				routing,
			);
			assert.ok(!isUnsafeMove(moved));
			assert.equal(
				unrouted(applyMove(shapes, moved).filter((item) => item.width > 0)),
				before,
			);
			for (const item of moved) {
				const original = shapes.find((other) => other.id === item.id);
				if (item.kind !== "line" || item.width === 0) continue;
				if (original && original.rotation === item.rotation) continue;
				assert.ok(onOctant(item));
			}
		}
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

	test("a pour fills its whole shape until the board outline closes, then stays inside it", () => {
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
		const beyondLeftEdge = at(-18, 0);
		const bare = [...footprints, pour("gnd", 0, 40)];
		assert.ok(containsPoint(pourCopper(bare, netlist), beyondLeftEdge));
		const open = [...bare, ...threeSides];
		assert.ok(containsPoint(pourCopper(open, netlist), beyondLeftEdge));
		assert.ok(kinds(designRulesCheck(open, netlist)).includes("outline"));
		const closed = [...open, edge(at(-15, 10), at(-15, -10))];
		assert.ok(!containsPoint(pourCopper(closed, netlist), beyondLeftEdge));
		assert.equal(pourCopper(closed, netlist).length, 1);
		assert.ok(!kinds(designRulesCheck(closed, netlist)).includes("outline"));
	});
});

describe("thermal reliefs", () => {
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
			);
		assert.deepEqual(
			findings(center.y).map((finding) => finding.kind),
			["clearance"],
		);
		const near = findings(center.y + 1.6 + 0.1 + 0.15);
		assert.deepEqual(
			near.map((finding) => finding.kind),
			["clearance"],
		);
		assert.match(near[0].message, /\b0\.150?\b/);
		assert.match(
			spacingProblems(
				checkBoard(
					[...shapes, footprint, ...across(center.y + 1.6 + 0.1 + 0.15)],
					netlist,
					defaultBoardRules,
					{ unit: "mil" },
				),
				footprint,
			)[0].message,
			/\b5\.91 mil\b/,
		);
		assert.deepEqual(findings(center.y + 1.6 + 0.1 + 0.25), []);
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
});
