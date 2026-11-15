import assert from "node:assert/strict";
import { test } from "node:test";
import { generateDefaultFootprints } from "@ecad/default-footprints";
import { autoroute } from "@ecad/drawing-core/board/autoroute.ts";
import {
	analyzeConnectivity,
	copperItems,
} from "@ecad/drawing-core/board/connectivity.ts";
import { checkBoard } from "@ecad/drawing-core/board/drc.ts";
import {
	boardPads,
	type FootprintSource,
	flipBoardFootprint,
	isBoardFootprint,
} from "@ecad/drawing-core/board/footprints.ts";
import { negotiatedRoute } from "@ecad/drawing-core/board/negotiated-route.ts";
import { boardNetlist } from "@ecad/drawing-core/board/netlist.ts";
import { defaultBoardRules } from "@ecad/drawing-core/board/rules.ts";
import { synchronizeBoard } from "@ecad/drawing-core/board/sync.ts";
import {
	type Circuit,
	createCircuit,
} from "@ecad/drawing-core/circuit/model.ts";
import type { EditorShape } from "@ecad/drawing-core/drawing/shapes.ts";
import type { FootprintReference } from "@ecad/drawing-core/footprint/reference.ts";
import { isPad } from "@ecad/drawing-core/footprint/shapes.ts";
import { fillReach, fillZones } from "#/board/fill.ts";
import { createBoardFile } from "#/board/format.ts";
import { exportFabrication } from "#/board/gerber.ts";
import { trackPath, trackSegment, trackSegments } from "#/board/routing.ts";
import { boardDisplay, boardLayerView } from "#/board/view.ts";
import { projectFileSelections } from "#/projects/file-url.ts";
import { projectIndex } from "#/projects/project-index.ts";
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
const resistor = { library: "builtin", id: "r_0805_2012metric" } as const;

function twoResistors(): Circuit {
	const circuit = createCircuit("Divider", "pcb-main").circuit;
	const pin = (component: string, number: string) => ({
		id: `${component}.${number}`,
		name: "",
		number,
		electricalType: "passive" as const,
	});
	return {
		...circuit,
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

function placed(circuit: Circuit, shapes: EditorShape[] = []) {
	const result = synchronizeBoard({
		shapes,
		circuit,
		footprintOf: () => resistor,
		source,
		nextId: 1,
	});
	return [...shapes, ...result.place];
}

test("syncing a board places one footprint per component and keeps placed ones", () => {
	const circuit = twoResistors();
	const shapes = placed(circuit);
	assert.equal(shapes.length, 2);
	assert.ok(shapes.every(isBoardFootprint));
	assert.deepEqual(
		shapes.map(
			(shape) => shape.kind === "symbol" && shape.attributes.reference,
		),
		["R1", "R2"],
	);
	const moved = shapes.map((shape) => ({ ...shape, x: shape.x + 10 }));
	const again = synchronizeBoard({
		shapes: moved,
		circuit,
		footprintOf: () => resistor,
		source,
		nextId: 3,
	});
	assert.deepEqual(again.place, []);
	assert.deepEqual(again.remove, []);
	const fewer = synchronizeBoard({
		shapes: moved,
		circuit: {
			...circuit,
			components: circuit.components.slice(0, 1),
			nets: [],
		},
		footprintOf: () => resistor,
		source,
		nextId: 3,
	});
	assert.deepEqual(fewer.remove, [moved[1].id]);
});

test("pads take nets from the circuit and the ratsnest joins unrouted pads", () => {
	const circuit = twoResistors();
	const shapes = placed(circuit);
	const netlist = boardNetlist(circuit);
	const pads = boardPads(shapes);
	assert.equal(pads.length, 4);
	const items = copperItems(shapes, netlist);
	assert.deepEqual(items.map((item) => item.net).sort(), [
		"gnd",
		"gnd",
		"mid",
		"mid",
	]);
	const { ratsnest } = analyzeConnectivity(items);
	assert.equal(ratsnest.length, 2);
	const mid = required(ratsnest.find((line) => line.net === "mid"));
	const track = trackSegments(
		100,
		trackPath(mid.from, mid.to),
		"F.Cu",
		0.25,
		"mid",
	);
	const routed = [...shapes, ...track];
	const after = analyzeConnectivity(copperItems(routed, netlist));
	assert.deepEqual(
		after.ratsnest.map((line) => line.net),
		["gnd"],
	);
});

test("DRC reports a track that passes too close to another net", () => {
	const circuit = twoResistors();
	const shapes = placed(circuit);
	const netlist = boardNetlist(circuit);
	const gndPad = required(
		boardPads(shapes).find(
			(pad) => netlist.padNet(pad.component, pad.number) === "gnd",
		),
	);
	const near = trackSegments(
		200,
		[
			{
				x: gndPad.shape.x - 3,
				y: gndPad.shape.y + gndPad.shape.height / 2 + 0.2,
			},
			{
				x: gndPad.shape.x + 3,
				y: gndPad.shape.y + gndPad.shape.height / 2 + 0.2,
			},
		],
		"F.Cu",
		0.25,
		"mid",
	);
	const findings = checkBoard([...shapes, ...near], netlist, defaultBoardRules);
	assert.ok(findings.some((finding) => finding.kind === "clearance"));
	assert.ok(findings.some((finding) => finding.kind === "outline"));
});

test("a zone fills around other nets, connects its own and leaves islands out", () => {
	const circuit = twoResistors();
	const shapes = placed(circuit);
	const netlist = boardNetlist(circuit);
	const bounds = shapes.map((shape) => ({ x: shape.x, y: shape.y }));
	const centerX = (bounds[0].x + bounds[1].x) / 2;
	const centerY = bounds[0].y;
	const outline: EditorShape = {
		id: 50,
		kind: "rectangle",
		layer: "Edge.Cuts",
		x: centerX,
		y: centerY,
		width: 30,
		height: 20,
		rotation: 0,
		lineWidth: 0.1,
	};
	const zone: EditorShape = {
		id: 51,
		kind: "rectangle",
		layer: "F.Cu",
		x: centerX,
		y: centerY,
		width: 28,
		height: 18,
		rotation: 0,
		lineWidth: 0.1,
		zone: {},
		net: "gnd",
	};
	const board = [...shapes, outline, zone];
	const fills = fillZones(board, netlist, defaultBoardRules);
	assert.equal(fills.length, 1);
	assert.ok(fills[0].polygons.length >= 1);
	const { ratsnest } = analyzeConnectivity(
		copperItems(board, netlist),
		fillReach(fills),
	);
	assert.deepEqual(
		ratsnest.map((line) => line.net),
		["mid"],
	);
	const files = exportFabrication("divider", board, fills);
	const copper = required(files.find((file) => file.name.endsWith("F_Cu.gtl")));
	assert.match(copper.content, /G36\*/);
	assert.match(copper.content, /%TF\.FileFunction,Copper,L1,Top\*%/);
	assert.ok(files.some((file) => file.name.endsWith(".drl")));
});

test("flipping a footprint mirrors it onto the back layers", () => {
	const shapes = placed(twoResistors());
	const footprint = shapes[0];
	assert.ok(isBoardFootprint(footprint));
	const flipped = flipBoardFootprint(footprint);
	assert.equal(flipped.flipped, true);
	assert.ok(
		flipped.children
			.filter((child) => child.layer?.endsWith("Cu"))
			.every((child) => child.layer === "B.Cu"),
	);
	const pads = boardPads([flipped]);
	const original = boardPads([footprint]);
	assert.ok(
		Math.abs(
			pads[0].shape.x - footprint.x + (original[0].shape.x - footprint.x),
		) < 1e-9,
	);
	assert.equal(flipBoardFootprint(flipped).flipped, undefined);
});

test("the flat view draws each footprint item in its layer and hides hidden layers", () => {
	const shapes = placed(twoResistors());
	const view = boardLayerView(shapes, new Set(), "F.Cu");
	const display = boardDisplay(
		view,
		new Set([shapes[0].id]),
		new Set(["F.SilkS"]),
		"F.Cu",
	);
	assert.ok(display.shapes.every((shape) => shape.layer !== "F.SilkS"));
	assert.ok(display.shapes.some((shape) => shape.layer === "F.Cu"));
	assert.ok(display.selected.size > 1);
});

test("the autorouter connects every pad inside the outline without breaking clearances", () => {
	const circuit = twoResistors();
	const shapes = placed(circuit);
	const netlist = boardNetlist(circuit);
	const outline: EditorShape = {
		id: 60,
		kind: "rectangle",
		layer: "Edge.Cuts",
		x: (shapes[0].x + shapes[1].x) / 2,
		y: shapes[0].y,
		width: 20,
		height: 12,
		rotation: 0,
		lineWidth: 0.1,
	};
	const board = [...shapes, outline];
	const routed = autoroute(board, netlist, 100, { rules: defaultBoardRules });
	assert.deepEqual(routed.failed, []);
	assert.ok(routed.shapes.length > 0);
	assert.ok(routed.shapes.every((shape) => shape.id >= 100));
	assert.deepEqual(
		checkBoard([...board, ...routed.shapes], netlist, defaultBoardRules),
		[],
	);
});

test("negotiated routing finishes every net it is given and leaves excluded nets alone", () => {
	const circuit = twoResistors();
	const shapes = placed(circuit);
	const netlist = boardNetlist(circuit);
	const outline: EditorShape = {
		id: 60,
		kind: "rectangle",
		layer: "Edge.Cuts",
		x: (shapes[0].x + shapes[1].x) / 2,
		y: shapes[0].y,
		width: 20,
		height: 12,
		rotation: 0,
		lineWidth: 0.1,
	};
	const board = [...shapes, outline];
	const routed = negotiatedRoute(board, netlist, 100, {
		rules: defaultBoardRules,
		exclude: new Set(["gnd"]),
	});
	assert.deepEqual(routed.failed, []);
	assert.ok(
		routed.shapes.every((shape) => "net" in shape && shape.net === "mid"),
	);
	const findings = checkBoard(
		[...board, ...routed.shapes],
		netlist,
		defaultBoardRules,
	);
	assert.deepEqual(
		findings.map((finding) => finding.kind),
		["unconnected"],
	);
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

const decode = (bytes: Uint8Array | undefined) =>
	JSON.parse(new TextDecoder().decode(required(bytes)));

for (const layout of ["files", "revisions"] as const)
	test(`a board is saved in its drawing file next to the schematic and circuit (${layout})`, async () => {
		const directory = memoryDirectory();
		const repository = new ProjectRepository(directory, { layout });
		await repository.create("Divider");
		const circuit = twoResistors();
		const board = {
			...createBoardFile("Divider", circuit.id),
			shapes: placed(circuit),
		};
		const saved = await repository.save({
			shapes: [],
			symbols: [],
			circuits: [{ ...createCircuit("Divider", circuit.id), circuit }],
			boards: [board],
		});
		const path = required(saved.manifest.drawing);
		assert.match(path, /Divider\.ecaddraw$/);
		assert.deepEqual(
			[...directory.files.keys()].filter((name) => name.endsWith(".ecadpcb")),
			[],
		);
		const file = decode(directory.files.get(path));
		assert.equal(file.circuit.id, circuit.id);
		assert.deepEqual(file.board, {
			units: "mm",
			rules: board.rules,
			shapes: board.shapes,
		});
		assert.equal(
			projectIndex(saved).boardsByPath.get(path)?.circuitId,
			"pcb-main",
		);
		assert.deepEqual(
			projectFileSelections(saved)
				.filter((entry) => entry.path === path)
				.map((entry) => [entry.id, entry.view]),
			[
				["drawing", undefined],
				["circuit:pcb-main", "circuit"],
				["board:pcb-main", "pcb"],
			],
		);
		const reopened = await new ProjectRepository(directory, { layout }).load();
		assert.deepEqual(reopened.boards, [board]);
	});

function dividerBoard(zones: EditorShape[], outline?: EditorShape[]) {
	const circuit = twoResistors();
	const shapes = placed(circuit);
	const centerX = (shapes[0].x + shapes[1].x) / 2;
	const centerY = shapes[0].y;
	const edge: EditorShape[] = outline ?? [
		{
			id: 50,
			kind: "rectangle",
			layer: "Edge.Cuts",
			x: centerX,
			y: centerY,
			width: 30,
			height: 20,
			rotation: 0,
			lineWidth: 0.1,
		},
	];
	return {
		circuit,
		netlist: boardNetlist(circuit),
		centerX,
		centerY,
		board: [
			...shapes,
			...edge,
			...zones.map((zone) => ({
				...zone,
				x: zone.x + centerX,
				y: zone.y + centerY,
			})),
		],
	};
}

const zoneAt = (
	id: number,
	net: string,
	x: number,
	width: number,
): EditorShape => ({
	id,
	kind: "rectangle",
	layer: "F.Cu",
	x,
	y: 0,
	width,
	height: 18,
	rotation: 0,
	lineWidth: 0.1,
	zone: {},
	net,
});

test("a zone cut in two by another net keeps a ratsnest line between its islands", () => {
	const { board, netlist, centerX, centerY } = dividerBoard([
		zoneAt(51, "gnd", 0, 28),
	]);
	const cut = trackSegments(
		60,
		[
			{ x: centerX, y: centerY - 9.5 },
			{ x: centerX, y: centerY + 9.5 },
		],
		"F.Cu",
		0.25,
		"mid",
	);
	const shapes = [...board, ...cut];
	const fills = fillZones(shapes, netlist, defaultBoardRules);
	assert.equal(fills[0].polygons.length, 2);
	const { ratsnest } = analyzeConnectivity(
		copperItems(shapes, netlist),
		fillReach(fills),
	);
	assert.ok(ratsnest.some((line) => line.net === "gnd"));
});

test("a later zone on another net keeps the clearance from an earlier one", () => {
	const { board, netlist } = dividerBoard([
		zoneAt(51, "gnd", -6, 16),
		zoneAt(52, "mid", 6, 16),
	]);
	const fills = fillZones(board, netlist, defaultBoardRules);
	assert.ok(fills.every((fill) => fill.polygons.length > 0));
	const zoneFindings = checkBoard(board, netlist, defaultBoardRules, {
		zoneReach: fillReach(fills),
	}).filter(
		(finding) => finding.shapeIds.includes(51) && finding.shapeIds.includes(52),
	);
	assert.deepEqual(zoneFindings, []);
	assert.ok(
		checkBoard(board, netlist, defaultBoardRules).some(
			(finding) =>
				finding.kind === "short" &&
				finding.shapeIds.includes(51) &&
				finding.shapeIds.includes(52),
		),
	);
});

test("overlapping zones on one net join their islands", () => {
	const { board, netlist } = dividerBoard([
		zoneAt(51, "gnd", -6, 16),
		zoneAt(52, "gnd", 6, 16),
	]);
	const fills = fillZones(board, netlist, defaultBoardRules);
	const { ratsnest } = analyzeConnectivity(
		copperItems(board, netlist),
		fillReach(fills),
	);
	assert.ok(!ratsnest.some((line) => line.net === "gnd"));
});

test("DRC reports pads of one footprint that short and copper on a missing net", () => {
	const circuit = twoResistors();
	const [first, second] = placed(circuit);
	assert.ok(isBoardFootprint(first));
	const shorted = {
		...first,
		children: first.children.map((child) =>
			isPad(child as EditorShape) ? { ...child, x: 0, y: 0 } : child,
		),
	};
	const stale = trackSegments(
		300,
		[
			{ x: 40, y: 40 },
			{ x: 41, y: 40 },
		],
		"F.Cu",
		0.25,
		"gone",
	);
	const findings = checkBoard(
		[shorted, second, ...stale],
		boardNetlist(circuit),
		defaultBoardRules,
	);
	assert.ok(
		findings.some(
			(finding) => finding.kind === "short" && finding.message.includes("R1."),
		),
	);
	assert.ok(findings.some((finding) => finding.kind === "net"));
});

test("a zone stays empty and DRC reports it while the outline is open", () => {
	const line = (id: number, x1: number, y1: number, x2: number, y2: number) =>
		({
			...trackSegment(
				id,
				{ x: x1, y: y1 },
				{ x: x2, y: y2 },
				"F.Cu",
				0.1,
				undefined,
			),
			layer: "Edge.Cuts",
		}) as EditorShape;
	const probe = dividerBoard([]);
	const { board, netlist } = dividerBoard(
		[zoneAt(51, "gnd", 0, 28)],
		[
			line(
				40,
				probe.centerX - 15,
				probe.centerY - 10,
				probe.centerX + 15,
				probe.centerY - 10,
			),
			line(
				41,
				probe.centerX + 15,
				probe.centerY - 10,
				probe.centerX + 15,
				probe.centerY + 10,
			),
			line(
				42,
				probe.centerX + 15,
				probe.centerY + 10,
				probe.centerX - 15,
				probe.centerY + 10,
			),
		],
	);
	const fills = fillZones(board, netlist, defaultBoardRules);
	assert.deepEqual(fills[0].polygons, []);
	assert.ok(
		checkBoard(board, netlist, defaultBoardRules).some(
			(finding) => finding.id === "outline-open",
		),
	);
});

test("sync keeps a footprint whose footprint is missing and detaches a second copy", () => {
	const circuit = twoResistors();
	const shapes = placed(circuit);
	const copy = { ...shapes[0], id: 9, x: shapes[0].x + 20 };
	const result = synchronizeBoard({
		shapes: [...shapes, copy],
		circuit,
		footprintOf: (component) =>
			component.reference === "R2" ? undefined : resistor,
		source,
		nextId: 10,
	});
	assert.deepEqual(result.remove, []);
	assert.deepEqual(
		result.missing.map((entry) => entry.reference),
		["R2"],
	);
	assert.equal(result.replace.length, 1);
	const detached = result.replace[0];
	assert.equal(detached.id, 9);
	assert.equal(detached.kind === "symbol" && detached.component, undefined);
});

test("a via inside a footprint takes its pad's net and counts as copper", () => {
	const circuit = twoResistors();
	const file = required(library.get(resistor.id));
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
	const shapes = synchronizeBoard({
		shapes: [],
		circuit,
		footprintOf: () => resistor,
		source: (reference) => ({
			reference,
			name: file.name,
			shapes: [...file.shapes, via],
		}),
		nextId: 1,
	}).place;
	const vias = copperItems(shapes, boardNetlist(circuit)).filter(
		(item) => item.kind === "via",
	);
	assert.equal(vias.length, 2);
	assert.ok(vias.every((item) => item.net === "gnd" || item.net === "mid"));
});

test("sync moves tracks and zones from a net the circuit renamed to the net of their pads", () => {
	const circuit = twoResistors();
	const shapes = placed(circuit);
	const netlist = boardNetlist(circuit);
	const mid = required(
		analyzeConnectivity(copperItems(shapes, netlist)).ratsnest.find(
			(line) => line.net === "mid",
		),
	);
	const track = trackSegments(
		100,
		trackPath(mid.from, mid.to),
		"F.Cu",
		0.25,
		"mid",
	);
	const zone = { ...zoneAt(120, "mid", 0, 4), x: mid.from.x, y: mid.from.y };
	const renamed: Circuit = {
		...circuit,
		nets: circuit.nets.map((net) =>
			net.id === "mid" ? { ...net, id: "mid-2" } : net,
		),
	};
	const result = synchronizeBoard({
		shapes: [...shapes, ...track, zone],
		circuit: renamed,
		footprintOf: () => resistor,
		source,
		nextId: 200,
	});
	assert.deepEqual(
		result.replace.map((shape) => [shape.id, "net" in shape && shape.net]),
		[...track, zone].map((shape) => [shape.id, "mid-2"]),
	);
});

test("DRC reports a component without a footprint and a netted pin without a pad", () => {
	const circuit = twoResistors();
	const [first] = placed(circuit);
	const netlist = boardNetlist({
		...circuit,
		components: circuit.components.map((component) =>
			component.id === "R1"
				? {
						...component,
						pins: [
							...component.pins,
							{
								id: "R1.3",
								name: "",
								number: "3",
								electricalType: "passive" as const,
							},
						],
					}
				: component,
		),
		nets: circuit.nets.map((net) =>
			net.id === "gnd" ? { ...net, pinIds: [...net.pinIds, "R1.3"] } : net,
		),
	});
	const messages = checkBoard([first], netlist, defaultBoardRules)
		.filter((finding) => finding.kind === "footprint")
		.map((finding) => finding.message);
	assert.deepEqual(messages, [
		"R1 pin 3 on GND has no pad",
		"R2 has no footprint on the board",
	]);
});

test("sync leaves copper on a dropped net when its pads now disagree", () => {
	const circuit = twoResistors();
	const shapes = placed(circuit);
	const netlist = boardNetlist(circuit);
	const mid = required(
		analyzeConnectivity(copperItems(shapes, netlist)).ratsnest.find(
			(line) => line.net === "mid",
		),
	);
	const track = trackSegments(
		100,
		trackPath(mid.from, mid.to),
		"F.Cu",
		0.25,
		"mid",
	);
	const split: Circuit = {
		...circuit,
		nets: [
			...circuit.nets.filter((net) => net.id !== "mid"),
			{ id: "left", names: ["LEFT"], pinIds: ["R1.2"] },
			{ id: "right", names: ["RIGHT"], pinIds: ["R2.1"] },
		],
	};
	const result = synchronizeBoard({
		shapes: [...shapes, ...track],
		circuit: split,
		footprintOf: () => resistor,
		source,
		nextId: 200,
	});
	assert.deepEqual(result.replace, []);
});

test("fills keep the full clearance from large round copper and from a zone with a raised clearance", () => {
	const { board, netlist, centerX, centerY } = dividerBoard([
		{ ...zoneAt(51, "mid", -9, 8), zone: { clearance: 1.5 } } as EditorShape,
		zoneAt(52, "gnd", 3, 20),
	]);
	const big: EditorShape = {
		id: 60,
		kind: "circle",
		layer: "F.Cu",
		x: centerX + 6,
		y: centerY + 4,
		width: 3,
		height: 3,
		rotation: 0,
		lineWidth: 0.15,
		filled: true,
		via: { drill: 1 },
		net: "mid",
	};
	const shapes = [...board, big];
	const rules = { ...defaultBoardRules, clearance: 1.2 };
	const fills = fillZones(shapes, netlist, rules);
	const findings = checkBoard(shapes, netlist, rules, {
		zoneReach: fillReach(fills),
	}).filter(
		(finding) => finding.kind === "short" || finding.kind === "clearance",
	);
	assert.deepEqual(
		findings.filter(
			(finding) =>
				finding.shapeIds.includes(52) &&
				(finding.shapeIds.includes(51) || finding.shapeIds.includes(60)),
		),
		[],
	);
});
