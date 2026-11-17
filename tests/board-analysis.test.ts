import assert from "node:assert/strict";
import { test } from "node:test";
import { generateDefaultFootprints } from "@ecad/default-footprints";
import {
	analyzeConnectivity,
	copperItems,
} from "@ecad/drawing-core/board/connectivity.ts";
import { checkBoard } from "@ecad/drawing-core/board/drc.ts";
import type { FootprintSource } from "@ecad/drawing-core/board/footprints.ts";
import { boardNetlist } from "@ecad/drawing-core/board/netlist.ts";
import { defaultBoardRules } from "@ecad/drawing-core/board/rules.ts";
import { synchronizeBoard } from "@ecad/drawing-core/board/sync.ts";
import {
	type Circuit,
	createCircuit,
} from "@ecad/drawing-core/circuit/model.ts";
import type { EditorShape } from "@ecad/drawing-core/drawing/shapes.ts";
import type { FootprintReference } from "@ecad/drawing-core/footprint/reference.ts";
import { strFromU8, unzipSync } from "fflate";
import {
	type AnalysisReply,
	type AnalysisRequest,
	createBoardAnalysis,
	createShapesSender,
	type Fabricate,
	FabricationUnavailable,
} from "#/board/analysis.ts";
import {
	type BoardAnalysisClient,
	createBoardAnalysisClient,
} from "#/board/analysis-client.ts";
import { fabricationArchive } from "#/board/fabrication.ts";
import { fillReach, fillZones } from "#/board/fill.ts";
import { exportFabrication } from "#/board/gerber.ts";
import { required } from "./helpers/required.ts";

const library = new Map(
	generateDefaultFootprints().map(({ file }) => [file.id, file]),
);
const source = (reference: FootprintReference): FootprintSource | undefined => {
	const file = library.get(reference.id);
	return file && { reference, name: file.name, shapes: file.shapes };
};
const pin = (component: string, number: string) => ({
	id: `${component}.${number}`,
	name: "",
	number,
	electricalType: "passive" as const,
});

function dividerWithGroundPour() {
	const circuit: Circuit = {
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
	const footprints = synchronizeBoard({
		shapes: [],
		circuit,
		footprintOf: () => ({ library: "builtin", id: "r_0805_2012metric" }),
		source,
		nextId: 1000,
	}).place;
	const center = {
		x: (footprints[0].x + footprints[1].x) / 2,
		y: footprints[0].y,
	};
	const rectangle = (id: number, layer: "Edge.Cuts" | "F.Cu", size: number) =>
		({
			id,
			kind: "rectangle",
			layer,
			...center,
			width: size,
			height: size * 0.6,
			rotation: 0,
			lineWidth: 0.1,
		}) as EditorShape;
	const pour = { ...rectangle(2, "F.Cu", 28), zone: {}, net: "gnd" };
	return {
		circuit,
		netlist: boardNetlist(circuit),
		shapes: [...footprints, rectangle(1, "Edge.Cuts", 30), pour as EditorShape],
	};
}

const ratsnestOf = (
	shapes: readonly EditorShape[],
	netlist: ReturnType<typeof boardNetlist>,
) =>
	analyzeConnectivity(
		copperItems(shapes, netlist),
		fillReach(fillZones(shapes, netlist, defaultBoardRules)),
	).ratsnest;

const moved = (shapes: readonly EditorShape[], index: number, by: number) =>
	shapes.map((shape, at) =>
		at === index ? { ...shape, y: shape.y + by } : shape,
	);

const until = async (done: () => boolean) => {
	for (let turn = 0; turn < 200 && !done(); turn++)
		await new Promise((resolve) => setTimeout(resolve, 1));
	assert.ok(done());
};

class FakeWorker {
	requests: AnalysisRequest[] = [];
	terminated = false;
	onmessage: ((event: MessageEvent<AnalysisReply>) => void) | null = null;
	onerror: (() => void) | null = null;
	onmessageerror: (() => void) | null = null;
	private analyse: ReturnType<typeof createBoardAnalysis>;
	private answered = 0;
	constructor(fabricate?: Fabricate) {
		this.analyse = createBoardAnalysis(fabricate);
	}
	postMessage(request: AnalysisRequest) {
		this.requests.push(structuredClone(request));
	}
	terminate() {
		this.terminated = true;
	}
	answerNext() {
		while (this.answered < this.requests.length) {
			const reply = this.analyse(this.requests[this.answered++]);
			if (!reply) continue;
			const deliver = (data: AnalysisReply) =>
				this.onmessage?.({ data } as MessageEvent<AnalysisReply>);
			if (reply instanceof Promise) void reply.then(deliver);
			else deliver(reply);
			return;
		}
	}
	asked(type: AnalysisRequest["type"]) {
		return this.requests.filter((request) => request.type === type);
	}
}

const withWorker = (fabricate?: Fabricate) => {
	const worker = new FakeWorker(fabricate);
	const client = createBoardAnalysisClient(() => worker as unknown as Worker);
	return { worker, client };
};

async function opened(client: BoardAnalysisClient, worker?: FakeWorker) {
	const board = dividerWithGroundPour();
	client.configure(board.circuit, defaultBoardRules);
	client.show(board.shapes, board.shapes);
	if (worker) {
		worker.answerNext();
		worker.answerNext();
	}
	await until(() => client.getState().ratsnest !== undefined);
	return board;
}

test("opening a board brings its zone fills, unrouted connections and design rules check from the analysis", async () => {
	const client = createBoardAnalysisClient(undefined);
	assert.deepEqual(client.getState(), {
		fills: [],
		ratsnest: undefined,
		error: "",
	});
	let published = 0;
	client.subscribe(() => published++);
	const { shapes, netlist } = await opened(client);
	const expected = fillZones(shapes, netlist, defaultBoardRules);
	const { fills, ratsnest } = client.getState();
	assert.deepEqual(
		fills.map((fill) => [fill.shapeId, fill.layer, fill.net, fill.polygons]),
		expected.map((fill) => [
			fill.zone.shapeId,
			fill.layer,
			fill.net,
			fill.polygons,
		]),
	);
	assert.ok(required(fills[0]).triangles.length > 0);
	assert.equal(required(fills[0]).triangles.length % 6, 0);
	assert.deepEqual(ratsnest, ratsnestOf(shapes, netlist));
	assert.deepEqual(
		ratsnest?.map((line) => line.net),
		["mid"],
	);
	assert.equal(published, 2);
	assert.deepEqual(
		await client.check(shapes),
		checkBoard(shapes, netlist, defaultBoardRules, {
			zoneReach: fillReach(expected),
		}),
	);
	client.dispose();
});

const filesIn = (archive: Uint8Array) =>
	Object.entries(unzipSync(archive)).map(([name, content]) => ({
		name,
		content: strFromU8(content),
	}));

test("the worker fills the pour and packs the Gerber and drill files without the page sending the board again", async () => {
	const { worker, client } = withWorker();
	const { shapes, netlist } = await opened(client, worker);
	const exported = client.fabricate("divider", shapes);
	worker.answerNext();
	const { archive, files } = await exported;
	const expected = exportFabrication(
		"divider",
		shapes,
		fillZones(shapes, netlist, defaultBoardRules),
		defaultBoardRules.solderMaskMargin,
	);
	assert.deepEqual(filesIn(archive), expected);
	assert.equal(files, expected.length);
	assert.ok(
		expected.some((file) => file.name.endsWith(".drl")) &&
			expected.some((file) => /%TF\.FileFunction,Copper/.test(file.content)),
	);
	assert.deepEqual(worker.asked("fabrication"), [
		{ type: "fabrication", id: 3, shapes: {}, name: "divider" },
	]);
	client.dispose();
});

test("an export in the air when the worker crashes is packed in the page", async () => {
	const { worker, client } = withWorker();
	const { shapes, netlist } = await opened(client, worker);
	const exported = client.fabricate("divider", shapes);
	worker.onerror?.();
	assert.equal(worker.terminated, true);
	const { archive, files } = await exported;
	const expected = exportFabrication(
		"divider",
		shapes,
		fillZones(shapes, netlist, defaultBoardRules),
		defaultBoardRules.solderMaskMargin,
	);
	assert.deepEqual(filesIn(archive), expected);
	assert.equal(files, expected.length);
	client.dispose();
});

test("an export whose worker cannot load the Gerber writer is packed in the page, and so are later ones", async () => {
	const { worker, client } = withWorker(async () => {
		throw new FabricationUnavailable("Failed to fetch the Gerber writer.");
	});
	const { shapes, netlist } = await opened(client, worker);
	const exported = client.fabricate("divider", shapes);
	worker.answerNext();
	const expected = exportFabrication(
		"divider",
		shapes,
		fillZones(shapes, netlist, defaultBoardRules),
		defaultBoardRules.solderMaskMargin,
	);
	assert.deepEqual(filesIn((await exported).archive), expected);
	assert.equal(worker.terminated, true);
	assert.deepEqual(
		filesIn((await client.fabricate("divider", shapes)).archive),
		expected,
	);
	client.dispose();
});

test("without a worker the page loads the exporter and packs the same archive", async () => {
	const client = createBoardAnalysisClient(undefined);
	const { shapes, netlist } = await opened(client);
	const moved = shapes.map((shape, at) =>
		at === 0 ? { ...shape, x: shape.x - 2 } : shape,
	);
	const { archive } = await client.fabricate("divider", moved);
	assert.deepEqual(
		filesIn(archive),
		exportFabrication(
			"divider",
			moved,
			fillZones(moved, netlist, defaultBoardRules),
			defaultBoardRules.solderMaskMargin,
		),
	);
	assert.notDeepEqual(
		filesIn(archive),
		filesIn((await client.fabricate("divider", shapes)).archive),
	);
	client.dispose();
	await assert.rejects(client.fabricate("divider", shapes));
});

test("dragging a footprint sends the worker only that footprint, whatever order the editor lists the board in", () => {
	const { shapes } = dividerWithGroundPour();
	const sender = createShapesSender();
	const first = sender.patch(shapes);
	assert.deepEqual(
		first.ids,
		shapes.map((shape) => shape.id),
	);
	assert.equal(first.changed?.length, shapes.length);
	assert.deepEqual(sender.patch(shapes), {});
	const dragged = moved(shapes, 0, 1).reverse();
	const drag = sender.patch(dragged);
	assert.deepEqual(drag.changed, [dragged.at(-1)]);
	assert.deepEqual(
		drag.ids,
		dragged.map((shape) => shape.id),
	);
	assert.deepEqual(sender.patch(shapes).changed, [shapes[0]]);
	sender.reset();
	assert.equal(sender.patch(shapes).changed?.length, shapes.length);
});

test("the worker follows a drag from patches and keeps the pour of the saved board", () => {
	const { circuit, netlist, shapes } = dividerWithGroundPour();
	const analyse = createBoardAnalysis(fabricationArchive);
	const sender = createShapesSender();
	assert.equal(
		analyse({ type: "board", circuit, rules: defaultBoardRules }),
		undefined,
	);
	const filled = analyse({
		type: "fills",
		id: 1,
		shapes: sender.patch(shapes),
	});
	assert.equal(filled?.type, "fills");
	const dragged = moved(shapes, 0, 30);
	const reply = analyse({
		type: "connectivity",
		id: 2,
		shapes: sender.patch(dragged),
	});
	assert.deepEqual(reply, {
		type: "connectivity",
		id: 2,
		ratsnest: [
			...analyzeConnectivity(
				copperItems(dragged, netlist),
				fillReach(fillZones(shapes, netlist, defaultBoardRules)),
			).ratsnest,
		],
	});
	assert.deepEqual(
		reply?.type === "connectivity" &&
			reply.ratsnest.map((line) => line.net).sort(),
		["gnd", "mid"],
	);
});

test("a fast drag keeps one analysis in the air and ends on the pointer's last position", async () => {
	const { worker, client } = withWorker();
	const { shapes, netlist } = await opened(client, worker);
	const asked = worker.asked("connectivity").length;
	const positions = [1, 2, 3].map((by) => moved(shapes, 0, 10 * by));
	for (const live of positions) client.show(shapes, live);
	assert.equal(worker.asked("connectivity").length, asked + 1);
	assert.equal(worker.asked("fills").length, 1);
	worker.answerNext();
	await until(() => worker.asked("connectivity").length === asked + 2);
	worker.answerNext();
	await until(() => client.getState().ratsnest?.length === 2);
	assert.deepEqual(
		client.getState().ratsnest,
		analyzeConnectivity(
			copperItems(required(positions.at(-1)), netlist),
			fillReach(fillZones(shapes, netlist, defaultBoardRules)),
		).ratsnest,
	);
	await new Promise((resolve) => setTimeout(resolve, 5));
	assert.equal(worker.asked("connectivity").length, asked + 2);
	const last = required(worker.asked("connectivity").at(-1));
	assert.equal(last.type === "connectivity" && last.shapes.changed?.length, 1);
	client.dispose();
	assert.equal(worker.terminated, true);
});

test("dropping a footprint refills the pour and reconnects the board against the new copper", async () => {
	const { worker, client } = withWorker();
	const { shapes, netlist } = await opened(client, worker);
	const before = client.getState().fills;
	const dropped = moved(shapes, 0, 3);
	client.show(dropped, dropped);
	assert.equal(worker.asked("fills").length, 2);
	worker.answerNext();
	worker.answerNext();
	await until(() => client.getState().fills !== before);
	await until(() => worker.asked("connectivity").length >= 2);
	worker.answerNext();
	const expected = fillZones(dropped, netlist, defaultBoardRules);
	assert.deepEqual(
		client.getState().fills.map((fill) => fill.polygons),
		expected.map((fill) => fill.polygons),
	);
	await until(
		() =>
			JSON.stringify(client.getState().ratsnest) ===
			JSON.stringify(ratsnestOf(dropped, netlist)),
	);
	client.dispose();
});

test("when the analysis worker crashes the board is analysed in the page instead", async () => {
	const { worker, client } = withWorker();
	const board = dividerWithGroundPour();
	client.configure(board.circuit, defaultBoardRules);
	client.show(board.shapes, board.shapes);
	const check = client.check(board.shapes);
	worker.onerror?.();
	assert.equal(worker.terminated, true);
	await until(() => client.getState().ratsnest !== undefined);
	assert.deepEqual(
		client.getState().ratsnest,
		ratsnestOf(board.shapes, board.netlist),
	);
	assert.deepEqual(
		await check,
		checkBoard(board.shapes, board.netlist, defaultBoardRules, {
			zoneReach: fillReach(
				fillZones(board.shapes, board.netlist, defaultBoardRules),
			),
		}),
	);
	client.dispose();
	await assert.rejects(client.check(board.shapes));
});

test("a board the analysis cannot read says so instead of checking forever, and recovers with the next edit", async () => {
	const client = createBoardAnalysisClient(undefined);
	const { circuit, shapes, netlist } = dividerWithGroundPour();
	const broken = [
		...shapes,
		{ ...shapes[0], id: 99, children: undefined } as unknown as EditorShape,
	];
	client.configure(circuit, defaultBoardRules);
	client.show(broken, broken);
	await until(() => client.getState().error !== "");
	assert.equal(client.getState().ratsnest, undefined);
	assert.deepEqual(client.getState().fills, []);
	await assert.rejects(client.check(broken));
	await assert.rejects(client.fabricate("divider", broken));
	await new Promise((resolve) => setTimeout(resolve, 5));
	assert.equal(client.getState().ratsnest, undefined);

	client.show(shapes, shapes);
	await until(() => client.getState().ratsnest !== undefined);
	assert.equal(client.getState().error, "");
	assert.deepEqual(client.getState().ratsnest, ratsnestOf(shapes, netlist));
	client.dispose();
});

test("a saved edit asks for the pour once and the connections once", async () => {
	const { worker, client } = withWorker();
	const { shapes } = await opened(client, worker);
	await new Promise((resolve) => setTimeout(resolve, 5));
	assert.deepEqual(
		[worker.asked("fills").length, worker.asked("connectivity").length],
		[1, 1],
	);
	const dropped = moved(shapes, 0, 3);
	client.show(dropped, dropped);
	worker.answerNext();
	worker.answerNext();
	await new Promise((resolve) => setTimeout(resolve, 5));
	assert.deepEqual(
		[worker.asked("fills").length, worker.asked("connectivity").length],
		[2, 2],
	);

	const dragged = moved(dropped, 1, 5);
	client.show(dropped, dragged);
	const saved = moved(dropped, 1, 5);
	client.show(saved, saved);
	worker.answerNext();
	worker.answerNext();
	await until(() => worker.asked("connectivity").length === 4);
	worker.answerNext();
	await new Promise((resolve) => setTimeout(resolve, 5));
	assert.deepEqual(
		[worker.asked("fills").length, worker.asked("connectivity").length],
		[3, 4],
	);
	client.dispose();
});

test("the export opens the mask by the board's solder mask margin", async () => {
	const client = createBoardAnalysisClient(undefined);
	const { circuit, shapes, netlist } = await opened(client);
	const rules = { ...defaultBoardRules, solderMaskMargin: 0 };
	client.configure(circuit, rules);
	const { archive } = await client.fabricate("divider", shapes);
	const fills = fillZones(shapes, netlist, rules);
	assert.deepEqual(
		filesIn(archive),
		exportFabrication("divider", shapes, fills, 0),
	);
	assert.notDeepEqual(
		filesIn(archive),
		exportFabrication("divider", shapes, fills, 0.05),
	);
	client.dispose();
});

test("design rules changed while the pour is being filled refill it with the new rules", async () => {
	const { worker, client } = withWorker();
	const { circuit, shapes, netlist } = await opened(client, worker);
	const dropped = moved(shapes, 0, 3);
	client.show(dropped, dropped);
	const wider = { ...defaultBoardRules, clearance: 0.8 };
	client.configure(circuit, wider);
	for (let turn = 0; turn < 8; turn++) {
		worker.answerNext();
		await new Promise((resolve) => setTimeout(resolve, 2));
	}
	const filled = (rules: typeof wider) =>
		fillZones(dropped, netlist, rules).map((fill) => fill.polygons);
	assert.notDeepEqual(filled(wider), filled(defaultBoardRules));
	assert.deepEqual(
		client.getState().fills.map((fill) => fill.polygons),
		filled(wider),
	);
	assert.equal(worker.asked("fills").length, 3);
	assert.deepEqual(
		client.getState().ratsnest,
		analyzeConnectivity(
			copperItems(dropped, netlist),
			fillReach(fillZones(dropped, netlist, wider)),
		).ratsnest,
	);
	client.dispose();
});

test("after the worker crashes the page fills the pour again before it reconnects the board", async () => {
	const { worker, client } = withWorker();
	const { shapes, netlist } = await opened(client, worker);
	const before = client.getState().fills;
	worker.onerror?.();
	await until(() => client.getState().fills !== before);
	assert.deepEqual(
		client.getState().fills.map((fill) => fill.polygons),
		before.map((fill) => fill.polygons),
	);
	const dragged = moved(shapes, 0, 30);
	client.show(shapes, dragged);
	await until(() => client.getState().ratsnest?.length === 2);
	assert.deepEqual(
		client.getState().ratsnest,
		analyzeConnectivity(
			copperItems(dragged, netlist),
			fillReach(fillZones(shapes, netlist, defaultBoardRules)),
		).ratsnest,
	);
	client.dispose();
});
