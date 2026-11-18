import { generateDefaultFootprints } from "@ecad/default-footprints";
import { autoroute } from "@ecad/drawing-core/board/autoroute.ts";
import {
	analyzeConnectivity,
	copperItems,
} from "@ecad/drawing-core/board/connectivity.ts";
import {
	type BoardFootprint,
	boardPads,
	createBoardFootprint,
	type FootprintSource,
} from "@ecad/drawing-core/board/footprints.ts";
import {
	hullDistance,
	shapeHulls,
	trackSegment,
} from "@ecad/drawing-core/board/geometry.ts";
import { negotiatedRoute } from "@ecad/drawing-core/board/negotiated-route.ts";
import type { BoardNetlist } from "@ecad/drawing-core/board/netlist.ts";
import { boardNetlist } from "@ecad/drawing-core/board/netlist.ts";
import { ruleVia } from "@ecad/drawing-core/board/routing-grid.ts";
import type { BoardRules } from "@ecad/drawing-core/board/rules.ts";
import {
	schematicFootprints,
	synchronizeBoard,
} from "@ecad/drawing-core/board/sync.ts";
import {
	type CircuitFile,
	createCircuit,
} from "@ecad/drawing-core/circuit/model.ts";
import type { EditorShape } from "@ecad/drawing-core/drawing/shapes.ts";
import type { SheetSettings } from "@ecad/drawing-core/drawing/sheet.ts";
import { symbolReferenceKey } from "@ecad/drawing-core/drawing/symbol-reference.ts";
import type { Point } from "@ecad/drawing-core/drawing/types.ts";
import type { FootprintReference } from "@ecad/drawing-core/footprint/reference.ts";
import { fillReach, fillZones } from "#/board/fill.ts";
import { type BoardFile, createBoardFile } from "#/board/format.ts";
import {
	estimateLabelTextWidth,
	synchronizePcb,
} from "#/circuit/linked-schematic.ts";
import { resolveDrawingSymbols } from "#/drawing/symbol-persistence.ts";
import { symbolDefinitions } from "#/drawing/symbols.ts";
import { containsPoint, type MultiPolygon } from "#/engine/geometry.ts";
import { importKiCadSchematic } from "#/formats/kicad/import.ts";

/** The built-in footprint for each footprint the source schematic names. */
const footprintIds: Record<string, string> = {
	"RPI_COMPILED:rpi_rp2350a": "qfn-60-1ep_7x7mm_p0.4mm_ep3.4x3.4mm",
	"RPI_COMPILED:rpi_rp2350a_vias": "qfn-60-1ep_7x7mm_p0.4mm_ep3.4x3.4mm",
	"RPI_COMPILED:generic_capc2012x125": "c_0805_2012metric",
	"RPI_COMPILED:generic_capc1005x50": "c_0402_1005metric",
	"RPI_COMPILED:generic_capc1005x50_wide": "c_0402_1005metric",
	"RPI_COMPILED:generic_resc1005x35": "r_0402_1005metric",
	"RPI_COMPILED:generic_soic127p790x195-8": "soic-8_5.23x5.23mm_p1.27mm",
	"RPI_COMPILED:generic_xtalcc320x250x80-4": "crystal_smd_3225-4pin_3.2x2.5mm",
	"RPI_COMPILED:amphenol_10103594-0001lf":
		"usb_micro-b_amphenol_10103594-0001lf",
	"RPI_COMPILED:samtec_tsw-118-07-l-d": "pinheader_2x18_samtec_tsw-118-07-l-d",
	"RPI_COMPILED:jst_sm03b-srss-tb-lf--sn-":
		"jst_sh_sm03b-srss-tb_1x03-1mp_p1.00mm_horizontal",
	"RPI_COMPILED:wurthelek_434133025816": "sw_push_1p1t_no_wuerth_434133025816",
	"RPI_COMPILED:onsemi_ncp1117st33t3g": "sot-223-3_tabpin4",
	"RPI_COMPILED:abracon_aota-b201610s3r3-101-t": "l_abracon_aota-b201610",
};

/**
 * Footprint placements on Raspberry Pi's RPI-RP2350A-MINIMAL R4 board, in
 * the source's coordinates: millimetres, Y down, angles in degrees.
 */
const placements: Record<string, [x: number, y: number, angle: number]> = {
	U1: [100, 100, 0],
	U2: [108, 82.85, 180],
	U3: [93.05, 87.275, 0],
	J1: [100, 71.7, 180],
	J2: [77.14, 95.59, -90],
	J3: [122.86, 95.59, -90],
	J4: [107.6, 115.375, 0],
	X1: [100, 112.4, 0],
	L1: [102, 92.8, 0],
	SW1: [91.2, 75.2, -90],
	SW2: [111.8, 107.475, 180],
	R1: [93, 82.2, -90],
	R2: [99.6, 106.9, -90],
	R3: [104.2, 93.1, -90],
	R4: [115.4, 109.1, -90],
	R6: [88.9, 81.3, 0],
	R7: [98.9, 92.6, -90],
	R8: [99.9, 92.6, -90],
	R9: [91.3, 82.2, -90],
	R10: [88.9, 82.7, 0],
	C1: [107.9375, 76.5, 0],
	C2: [96.185, 82.83, 180],
	C3: [98.6, 109, 180],
	C4: [101.58, 109, 0],
	C5: [109.025, 89, 0],
	C6: [102, 95.39, 0],
	C7: [102, 94.45, 0],
	C8: [93.52, 99, 180],
	C9: [104.2, 94.95, -90],
	C10: [100.8, 106.88, -90],
	C11: [107.08, 99.4, 0],
	C12: [97.9, 92.6, 90],
	C13: [93.515, 96.6, 180],
	C14: [107.085, 100.4, 0],
	C15: [93.515, 101.4, 180],
	C16: [105.685, 104, 0],
	C17: [106.485, 97, 0],
	C18: [98.2, 106.08, -90],
	C19: [85.115, 78, 0],
};

/** Raspberry Pi's ground vias, in the source's coordinates. */
const groundVias: [x: number, y: number][] = [
	[97.4, 111.5],
	[103.1, 95.1],
	[107.6, 112.1],
	[94.9, 82.8],
	[97.9, 91.4],
	[98.2, 107.3],
	[110, 78],
	[116.4, 109.6],
	[107.6, 114.7],
	[101.6, 107.4],
	[86.14, 79.25],
	[90.8, 89.2],
	[92.3, 99],
	[111.1, 89],
	[102.8, 109],
	[103.85, 96.15],
	[106.9, 104],
	[108.3, 100.4],
	[98.7, 76],
	[107.6, 96.5],
	[102.7, 113.2],
	[108.3, 99.4],
	[92.3, 96.6],
	[103.1, 94.5],
	[97.4, 109],
	[92.3, 101.4],
	[92.275, 75.075],
];

/** The source board's centre: board coordinates have it as their origin, Y up. */
const sourceCentre = { x: 100, y: 95.5 };

const rp2350aRules: BoardRules = {
	copperLayers: 2,
	clearance: 0.15,
	trackWidth: 0.15,
	viaDiameter: 0.6,
	viaDrill: 0.3,
	edgeClearance: 0.3,
	solderMaskMargin: 0,
	thermalGap: 0.5,
	thermalSpokeWidth: 0.5,
};

const rp2350aCircuitId = "rp2350a";

const outlineSize = { width: 52, height: 51 };

export const rp2350aSheet: SheetSettings = {
	title: "RP2350A QFN-60 Minimal Design Example",
	date: "2026-07-03",
	revision: "S1",
	company: "Raspberry Pi Ltd",
	comments: [
		"Imported from RPI-RP2350A-MINIMAL_R4-S1",
		"Design copyright 2026 Raspberry Pi Ltd, MIT license",
	],
};

const schematicGrid = 1.27;

const onGrid = (value: number) =>
	Math.round(Math.round(value / schematicGrid) * schematicGrid * 1e4) / 1e4;

/** A shape moved onto the schematic grid; a wire moves by its two ends. */
function snapToGrid(shape: EditorShape): EditorShape {
	if (shape.kind !== "wire")
		return { ...shape, x: onGrid(shape.x), y: onGrid(shape.y) };
	const half = shape.width / 2;
	const dx = Math.cos(shape.rotation) * half;
	const dy = Math.sin(shape.rotation) * half;
	const start = { x: onGrid(shape.x - dx), y: onGrid(shape.y - dy) };
	const end = { x: onGrid(shape.x + dx), y: onGrid(shape.y + dy) };
	return {
		...shape,
		x: (start.x + end.x) / 2,
		y: (start.y + end.y) / 2,
		width: Math.hypot(end.x - start.x, end.y - start.y),
		rotation: Math.atan2(end.y - start.y, end.x - start.x),
	};
}

/**
 * Raspberry Pi's PCB revision, schematic revision and variant boxes sit in
 * the corner the sheet's title block takes, so they move up above it.
 */
const revisionBoxes = new Set(["PCB1", "SBREV1", "VARIANT1"]);

function clearTitleBlock(shape: EditorShape): EditorShape {
	return shape.kind === "symbol" &&
		revisionBoxes.has(shape.attributes.reference)
		? { ...shape, y: onGrid(shape.y + 25 * schematicGrid) }
		: shape;
}

/**
 * The schematic: Raspberry Pi's RPI-RP2350A-MINIMAL R4 schematic as the
 * KiCad import converts it, wires, junctions and labels as drawn, with each
 * component's footprint set to the built-in one for its source footprint.
 * The import centres the A3 sheet on the origin, which leaves the source's
 * 50 mil grid 0.45 mm and 0.09 mm off ours, and one ground symbol in the
 * source sits half a step off it, so every item moves onto the grid.
 */
export function rp2350aSchematic(source: string): EditorShape[] {
	const { shapes, report } = importKiCadSchematic(source);
	let index = 0;
	return shapes.map((shape) => {
		const moved = clearTitleBlock(snapToGrid(shape));
		if (moved.kind !== "symbol") return moved;
		const sourceFootprint = report.components[index++]?.properties.Footprint;
		const id = sourceFootprint ? footprintIds[sourceFootprint] : undefined;
		if (
			sourceFootprint &&
			!id &&
			moved.children.some((child) => child.kind === "pin") &&
			!moved.netSymbol
		)
			throw new Error(`No built-in footprint for ${sourceFootprint}.`);
		return id ? { ...moved, footprint: { library: "builtin", id } } : moved;
	});
}

/** The circuit the schematic describes, and the schematic as the sync saves it. */
export function rp2350aCircuit(schematic: EditorShape[]): {
	shapes: EditorShape[];
	file: CircuitFile;
} {
	const resolved = resolveDrawingSymbols(
		schematic,
		symbolDefinitions,
		new Map(
			symbolDefinitions.flatMap((entry) =>
				entry.library
					? [[symbolReferenceKey(entry.library, entry.id), entry] as const]
					: [],
			),
		),
	).shapes;
	let counter = 0;
	const linked = synchronizePcb(
		createCircuit("RP2350A", rp2350aCircuitId),
		resolved,
		undefined,
		symbolDefinitions,
		{
			measureText: estimateLabelTextWidth,
			newId: () => `rp2350a-${++counter}`,
		},
	);
	return { shapes: linked.shapes, file: linked.file };
}

const footprintLibrary = () =>
	new Map(generateDefaultFootprints().map(({ file }) => [file.id, file]));

function footprintSource(
	library: ReturnType<typeof footprintLibrary>,
	reference: FootprintReference,
): FootprintSource | undefined {
	const file = library.get(reference.id);
	return file && { reference, name: file.name, shapes: file.shapes };
}

const degrees = (angle = 0) => (angle * Math.PI) / 180;

/**
 * Short straight tracks from each signal pad of the chip outward, past the
 * pad row, as a hand layout starts. Later routes then keep clear of the row.
 * A pad whose stub would pass too close to another part's pad gets none.
 */
function fanout(
	footprints: readonly BoardFootprint[],
	netlist: BoardNetlist,
	firstId: number,
	ground: string | undefined,
): EditorShape[] {
	const chip = footprints.find(
		(footprint) => footprint.attributes.reference === "U1",
	);
	if (!chip) return [];
	const others = boardPads(
		footprints.filter((footprint) => footprint !== chip),
	).flatMap((pad) => shapeHulls(pad.shape));
	const gap = rp2350aRules.clearance + rp2350aRules.trackWidth / 2;
	const stubs: EditorShape[] = [];
	let id = firstId;
	for (const pad of boardPads([chip])) {
		const net = netlist.padNet(pad.component, pad.number);
		if (!net || net === ground) continue;
		const dx = pad.shape.x - chip.x;
		const dy = pad.shape.y - chip.y;
		const length = Math.hypot(dx, dy);
		if (length < 3) continue;
		const outward =
			Math.abs(dx) > Math.abs(dy)
				? { x: Math.sign(dx), y: 0 }
				: { x: 0, y: Math.sign(dy) };
		const from = { x: pad.shape.x, y: pad.shape.y };
		const to = {
			x: Number((from.x + outward.x * 1.2).toFixed(4)),
			y: Number((from.y + outward.y * 1.2).toFixed(4)),
		};
		const reach = { points: [from, to], radius: 0 };
		if (others.some((hull) => hullDistance(reach, hull) < gap)) continue;
		stubs.push(
			trackSegment(id++, from, to, "F.Cu", rp2350aRules.trackWidth, net),
		);
	}
	return stubs;
}

/**
 * A 3 x 3 grid of ground vias in the chip's exposed pad, as on Raspberry
 * Pi's board. The pad ring walls the exposed pad in on the top layer, so it
 * reaches ground through the bottom zone.
 */
function exposedPadVias(
	footprints: readonly BoardFootprint[],
	firstId: number,
	ground: string | undefined,
): EditorShape[] {
	const chip = footprints.find(
		(footprint) => footprint.attributes.reference === "U1",
	);
	if (!chip || !ground) return [];
	let id = firstId;
	return [-1.1, 0, 1.1].flatMap((dx) =>
		[-1.1, 0, 1.1].map((dy) =>
			ruleVia(id++, { x: chip.x + dx, y: chip.y + dy }, rp2350aRules, ground),
		),
	);
}

/**
 * Raspberry Pi's ground vias, left out where one would come within the
 * clearance of another net's pad.
 */
function sourceGroundVias(
	footprints: readonly BoardFootprint[],
	netlist: BoardNetlist,
	firstId: number,
	ground: string | undefined,
): EditorShape[] {
	if (!ground) return [];
	const others = boardPads(footprints)
		.filter((pad) => netlist.padNet(pad.component, pad.number) !== ground)
		.flatMap((pad) => shapeHulls(pad.shape));
	let id = firstId;
	return groundVias.flatMap(([x, y]) => {
		const at = { x: x - sourceCentre.x, y: sourceCentre.y - y };
		const hull = { points: [at], radius: rp2350aRules.viaDiameter / 2 };
		return others.some(
			(other) => hullDistance(hull, other) < rp2350aRules.clearance,
		)
			? []
			: [ruleVia(id++, at, rp2350aRules, ground)];
	});
}

/**
 * Routes each connection still open again, after ripping up the tracks and
 * vias within a growing distance of it, until every connection is routed. Zone
 * reach comes from the fill with the ripped routes still in place, so a
 * ground pad the new routes would cut off again still counts as open.
 * @return The routes, with the repaired ones in place of those ripped up.
 */
function repairLocally(
	fixed: readonly EditorShape[],
	routes: readonly EditorShape[],
	netlist: BoardNetlist,
	firstId: number,
): { routes: EditorShape[]; failed: number } {
	let current = [...routes];
	let id = firstId;
	const open = () => {
		const shapes = [...fixed, ...current];
		return analyzeConnectivity(
			copperItems(shapes, netlist),
			fillReach(fillZones(shapes, netlist, rp2350aRules)),
		).ratsnest;
	};
	for (const radius of [2, 3, 4, 6]) {
		const ratsnest = open();
		if (!ratsnest.length) break;
		const lines = ratsnest.map((line) => ({
			points: [line.from, line.to],
			radius,
		}));
		const near = new Set(
			current.filter((shape) =>
				shapeHulls(shape).some((hull) =>
					lines.some((line) => hullDistance(hull, line) <= 0),
				),
			),
		);
		const kept = current.filter((shape) => !near.has(shape));
		const repaired = autoroute([...fixed, ...kept], netlist, id, {
			rules: rp2350aRules,
			rippable: [...near],
			zoneReach: fillReach(
				fillZones([...fixed, ...current], netlist, rp2350aRules),
			),
		});
		id += repaired.shapes.length;
		current = [...kept, ...repaired.shapes];
	}
	return { routes: current, failed: open().length };
}

/**
 * The board: an outline, each footprint at its place, every connection
 * routed, and ground zones on both sides.
 */
export function rp2350aBoard(
	circuit: CircuitFile,
	schematic: EditorShape[],
	trace?: (message: string) => void,
): { board: BoardFile; failed: number } {
	const library = footprintLibrary();
	const synced = synchronizeBoard({
		shapes: [],
		circuit: circuit.circuit,
		footprintOf: schematicFootprints(schematic),
		source: (reference) => footprintSource(library, reference),
		nextId: 1,
	});
	if (synced.missing.length)
		throw new Error(`No footprint for ${synced.missing.join(", ")}.`);
	const footprints = synced.place.map((shape) => {
		const footprint = shape as BoardFootprint;
		const placement = placements[footprint.attributes.reference];
		const source = footprintSource(library, footprint.footprint);
		if (!placement || !source)
			throw new Error(`No placement for ${footprint.attributes.reference}.`);
		const [x, y, angle] = placement;
		return createBoardFootprint(
			footprint.id,
			source,
			{
				component: footprint.component,
				reference: footprint.attributes.reference,
				value: footprint.attributes.value,
			},
			{ x: x - sourceCentre.x, y: sourceCentre.y - y },
			{ rotation: degrees(angle) },
		);
	});
	let nextId = footprints.length + 1;
	const outline: EditorShape = {
		id: nextId++,
		kind: "rectangle",
		layer: "Edge.Cuts",
		x: 0,
		y: 0,
		...outlineSize,
		rotation: 0,
		lineWidth: 0.1,
	};
	const netlist = boardNetlist(circuit.circuit);
	const ground = [...netlist.nets.values()].find((net) => net.name === "GND");
	const stubs = fanout(footprints, netlist, nextId, ground?.id);
	nextId += stubs.length;
	const padVias = exposedPadVias(footprints, nextId, ground?.id);
	nextId += padVias.length;
	const besideVias = sourceGroundVias(footprints, netlist, nextId, ground?.id);
	nextId += besideVias.length;
	const thermal = [...padVias, ...besideVias];
	const board = [...footprints, outline, ...stubs, ...thermal];
	const negotiated = negotiatedRoute(board, netlist, nextId, {
		rules: rp2350aRules,
		exclude: new Set(ground ? [ground.id] : []),
		rounds: 60,
		patience: 10,
		progress: trace
			? (round, overlapping) =>
					trace(`round ${round}: ${overlapping} nets overlap`)
			: undefined,
	});
	nextId += negotiated.shapes.length;
	const zones: EditorShape[] = (["F.Cu", "B.Cu"] as const).map((layer) => ({
		id: nextId++,
		kind: "rectangle",
		layer,
		x: 0,
		y: 0,
		width: outlineSize.width - 0.2,
		height: outlineSize.height - 0.2,
		rotation: 0,
		lineWidth: 0.1,
		zone: {},
		...(ground ? { net: ground.id } : {}),
	}));
	const poured = [...board, ...zones];
	const finished = autoroute(poured, netlist, nextId, {
		rules: rp2350aRules,
		rippable: negotiated.shapes,
		zoneReach: fillReach(
			fillZones([...poured, ...negotiated.shapes], netlist, rp2350aRules),
		),
		trace: trace
			? (event, line) => trace(`${netlist.nets.get(line.net)?.name}: ${event}`)
			: undefined,
	});
	nextId += finished.shapes.length;
	const stitches = stitchZones(
		[...poured, ...finished.shapes],
		netlist,
		rp2350aRules,
		nextId,
	);
	nextId += stitches.length;
	const fixed = [...poured, ...stitches];
	const repaired = autoroute(fixed, netlist, nextId, {
		rules: rp2350aRules,
		rippable: finished.shapes,
		zoneReach: fillReach(
			fillZones([...fixed, ...finished.shapes], netlist, rp2350aRules),
		),
	});
	nextId += repaired.shapes.length;
	const routed = [...fixed, ...repaired.shapes];
	const pockets = stitchZones(routed, netlist, rp2350aRules, nextId, true);
	nextId += pockets.length;
	const final = pockets.length
		? autoroute([...fixed, ...pockets], netlist, nextId, {
				rules: rp2350aRules,
				rippable: repaired.shapes,
				zoneReach: fillReach(
					fillZones([...routed, ...pockets], netlist, rp2350aRules),
				),
			})
		: repaired;
	nextId += final.shapes.length;
	const local = repairLocally(
		[...footprints, outline, ...padVias, ...zones],
		[...stubs, ...besideVias, ...stitches, ...pockets, ...final.shapes],
		netlist,
		nextId,
	);
	const shapes = [
		...footprints,
		outline,
		...padVias,
		...zones,
		...local.routes,
	];
	const file = createBoardFile("RP2350A", circuit.circuit.id);
	return {
		board: { ...file, rules: rp2350aRules, shapes },
		failed: local.failed,
	};
}

function insideBy(
	polygon: MultiPolygon[number],
	point: Point,
	margin: number,
): boolean {
	if (!containsPoint([polygon], point)) return false;
	const probe = { points: [point], radius: 0 };
	return polygon.every((path) =>
		path.every(
			([x, y], index) =>
				hullDistance(probe, {
					points: [
						{ x, y },
						{
							x: path[(index + 1) % path.length][0],
							y: path[(index + 1) % path.length][1],
						},
					],
					radius: 0,
				}) >= margin,
		),
	);
}

/**
 * @param unstitched Only islands that hold no via of their net yet.
 * @return One via per zone island, where it also lies inside the other side's fill.
 */
function stitchZones(
	shapes: readonly EditorShape[],
	netlist: BoardNetlist,
	rules: BoardRules,
	nextId: number,
	unstitched = false,
): EditorShape[] {
	const fills = fillZones(shapes, netlist, rules);
	const existing = shapes.flatMap((shape) =>
		shape.kind === "circle" && shape.via !== undefined ? [shape] : [],
	);
	const vias: EditorShape[] = [];
	const margin = rules.viaDiameter / 2 + 0.01;
	for (const fill of fills) {
		if (!fill.net) continue;
		const others = fills.filter(
			(other) => other.net === fill.net && other.layer !== fill.layer,
		);
		for (const island of fill.polygons) {
			if (
				unstitched &&
				existing.some(
					(via) => via.net === fill.net && containsPoint([island], via),
				)
			)
				continue;
			const xs = island[0].map(([x]) => x);
			const ys = island[0].map(([, y]) => y);
			const center = {
				x: (Math.min(...xs) + Math.max(...xs)) / 2,
				y: (Math.min(...ys) + Math.max(...ys)) / 2,
			};
			const candidates: { point: Point; distance: number }[] = [];
			const [minX, maxX] = [Math.min(...xs), Math.max(...xs)];
			const [minY, maxY] = [Math.min(...ys), Math.max(...ys)];
			for (let x = minX; x <= maxX; x += 0.1)
				for (let y = minY; y <= maxY; y += 0.1) {
					const point = {
						x: Math.round(x * 20) / 20,
						y: Math.round(y * 20) / 20,
					};
					candidates.push({
						point,
						distance: Math.hypot(point.x - center.x, point.y - center.y),
					});
				}
			candidates.sort((a, b) => a.distance - b.distance);
			const best = candidates.find(
				({ point }) =>
					insideBy(island, point, margin) &&
					others.some((other) =>
						other.polygons.some((polygon) => insideBy(polygon, point, margin)),
					),
			)?.point;
			const at = best;
			if (
				!at ||
				vias.some((via) => Math.hypot(via.x - at.x, via.y - at.y) < 1e-6)
			)
				continue;
			vias.push(ruleVia(nextId++, at, rules, fill.net));
		}
	}
	return vias;
}
