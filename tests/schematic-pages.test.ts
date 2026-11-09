import assert from "node:assert/strict";
import test from "node:test";
import {
	moveShapesToPageEffect,
	placeShapesEffect,
	replaceAndPlaceShapesEffect,
	rotateShapesEffect,
	setPagesEffect,
	undoEffect,
} from "@ecad/drawing-core/commands/drawing-commands.ts";
import { drawingSnapshotSchema } from "@ecad/drawing-core/commands/drawing-snapshot.ts";
import {
	createDrawingStore,
	DrawingStore,
} from "@ecad/drawing-core/commands/drawing-store.ts";
import { electricalNets } from "@ecad/drawing-core/drawing/named-nets.ts";
import type { DrawingPage } from "@ecad/drawing-core/drawing/pages.ts";
import {
	drawShape,
	type EditorShape,
	pinTerminals,
	type TextShape,
} from "@ecad/drawing-core/drawing/shapes.ts";
import { executeDrawingOperation } from "@ecad/drawing-core/mcp/drawing-protocol.ts";
import { Effect, Either } from "effect";
import { schematicCircuit } from "#/circuit/linked-schematic.ts";
import { createEditorSession } from "#/components/editor/editorSession.ts";
import { rerouteLegacyWires } from "#/drawing/diagonal-wires.ts";
import { createSymbol, symbolDefinitions } from "#/drawing/symbols.ts";
import { replaceDrawingShapes } from "#/projects/drawing-refresh.ts";
import { validateProjectDocument } from "#/projects/format.ts";
import { required } from "./helpers/required.ts";

const wire = (
	id: number,
	x: number,
	y: number,
	endX: number,
	page?: number,
): EditorShape => ({
	...drawShape(id, "wire", { x, y }, { x: endX, y }),
	...(page === undefined ? {} : { page }),
});
const label = (
	id: number,
	text: string,
	x: number,
	y: number,
	page?: number,
): TextShape => ({
	id,
	kind: "text",
	text,
	electrical: "net",
	x,
	y,
	width: 8,
	height: 2,
	fontSize: 1.5,
	lineWidth: 0.2,
	rotation: 0,
	...(page === undefined ? {} : { page }),
});
const twoPages: DrawingPage[] = [
	{ id: 1, name: "Main" },
	{ id: 2, name: "Power" },
];
const run = <A>(
	store: ReturnType<typeof createDrawingStore>,
	program: Effect.Effect<A, unknown, DrawingStore>,
) =>
	Effect.runSync(
		program.pipe(Effect.provideService(DrawingStore, store), Effect.either),
	);
const netOf = (shapes: EditorShape[], id: number) =>
	electricalNets(shapes)
		.find((net) => net.wires.includes(id))
		?.wires.sort();

test("wires meet only on their own page, and net labels join pages by name", () => {
	const shapes = [
		wire(1, 0, 0, 10),
		// Same coordinates as wire 1, on another page.
		wire(2, 0, 0, 10, 2),
		wire(3, 30, 0, 40),
		wire(4, 30, 0, 40, 2),
		label(5, "SDA", 40, 0),
		label(6, "SDA", 40, 0, 2),
	];
	assert.deepEqual(netOf(shapes, 1), [1]);
	assert.deepEqual(netOf(shapes, 2), [2]);
	assert.deepEqual(netOf(shapes, 3), [3, 4]);
	const net = electricalNets(shapes).find((item) => item.wires.includes(3));
	assert.deepEqual(net?.labels.sort(), [5, 6]);
	assert.deepEqual(net?.names, ["SDA"]);
});

test("wire normalization keeps overlapping wires on different pages apart", () => {
	const store = createDrawingStore([], twoPages);
	run(store, placeShapesEffect([wire(0, 0, 0, 10)], "First"));
	const placed = run(
		store,
		placeShapesEffect([wire(0, 5, 0, 20, 2)], "Second"),
	);
	assert.ok(Either.isRight(placed));
	const { shapes } = store.getSnapshot();
	assert.equal(shapes.length, 2);
	assert.deepEqual(
		shapes.map((shape) => [shape.page, shape.x, shape.width]),
		[
			[undefined, 5, 10],
			[2, 12.5, 15],
		],
	);
});

test("pages are added, renamed, reordered and deleted as undoable edits", () => {
	const store = createDrawingStore([wire(1, 0, 0, 10)]);
	assert.equal(store.getSnapshot().pages, undefined);
	const added = run(store, setPagesEffect(twoPages, "Add page"));
	assert.ok(Either.isRight(added));
	assert.deepEqual(store.getSnapshot().pages, twoPages);
	run(store, placeShapesEffect([wire(0, 0, 10, 10, 2)], "Draw"));
	const before = store.getSnapshot().shapes;

	// Moving Power first moves the omitted page field to the other page.
	run(store, setPagesEffect([twoPages[1], twoPages[0]], "Move page"));
	assert.notEqual(store.getSnapshot().shapes, before);
	assert.deepEqual(
		store.getSnapshot().shapes.map((shape) => shape.page),
		[1, undefined],
	);

	run(store, setPagesEffect([twoPages[0]], "Delete page Power"));
	assert.deepEqual(
		store.getSnapshot().shapes.map((shape) => shape.id),
		[1],
	);
	assert.deepEqual(store.getSnapshot().pages, [{ id: 1, name: "Main" }]);

	run(store, undoEffect);
	assert.deepEqual(store.getSnapshot().pages, [twoPages[1], twoPages[0]]);
	assert.equal(store.getSnapshot().shapes.length, 2);
	assert.ok(drawingSnapshotSchema.safeParse(store.getSnapshot()).success);

	const empty = run(store, setPagesEffect([], "Delete all"));
	assert.ok(Either.isLeft(empty));
	const duplicate = run(
		store,
		setPagesEffect([twoPages[0], { ...twoPages[1], id: 1 }], "Duplicate"),
	);
	assert.ok(Either.isLeft(duplicate));
});

test("shapes must name an existing page, and the first page is implicit", () => {
	const store = createDrawingStore([], twoPages);
	const missing = run(store, placeShapesEffect([wire(0, 0, 0, 10, 9)], "Bad"));
	assert.ok(Either.isLeft(missing));
	run(store, placeShapesEffect([wire(0, 0, 0, 10, 1)], "Explicit first"));
	assert.equal(store.getSnapshot().shapes[0].page, undefined);
});

test("moving shapes to another page reconnects them there", () => {
	const store = createDrawingStore(
		[wire(1, 0, 0, 10), wire(2, 10, 0, 20, 2)],
		twoPages,
	);
	run(store, moveShapesToPageEffect([1], 2));
	const { shapes } = store.getSnapshot();
	// The moved wire merges with the collinear wire on its new page.
	assert.equal(shapes.length, 1);
	assert.equal(shapes[0].page, 2);
	assert.equal(shapes[0].width, 20);
	const rotated = run(store, rotateShapesEffect([shapes[0].id]));
	assert.ok(Either.isRight(rotated));
	assert.equal(store.getSnapshot().shapes[0].page, 2);
});

test("the editor session shows, selects and places on the current page only", () => {
	const store = createDrawingStore(
		[wire(1, 0, 0, 10), wire(2, 0, 10, 10, 2)],
		twoPages,
	);
	const session = createEditorSession(store);
	session.connect(store, () => undefined);
	assert.deepEqual(
		session.shapes().map((shape) => shape.id),
		[1],
	);
	session.select(new Set([1, 2]));
	assert.deepEqual([...session.getState().selection], [1]);

	session.setPage(2);
	assert.deepEqual([...session.getState().selection], []);
	assert.deepEqual(
		session.shapes().map((shape) => shape.id),
		[2],
	);
	// Pasted or placed shapes go to the current page, whatever page they name.
	session.place([wire(0, 0, 30, 10)], "Draw");
	const placed = store.getSnapshot().shapes.at(-1);
	assert.equal(placed?.page, 2);

	session.reveal(new Set([1]));
	assert.equal(session.getState().page, 1);
	assert.deepEqual([...session.getState().selection], [1]);

	// A deleted current page falls back to the first page.
	session.setPage(2);
	session.execute(setPagesEffect([twoPages[0]], "Delete page"));
	assert.equal(session.currentPage(), 1);
});

test("project drawings save pages and reject shapes on missing pages", () => {
	const document = validateProjectDocument({
		shapes: [wire(1, 0, 0, 10), wire(2, 0, 0, 10, 2)],
		pages: twoPages,
		symbols: [],
	});
	assert.deepEqual(document.pages, twoPages);
	assert.throws(
		() =>
			validateProjectDocument({
				shapes: [wire(1, 0, 0, 10, 3)],
				pages: twoPages,
				symbols: [],
			}),
		/page that the drawing does not have/,
	);
});

test("getDrawing lists pages, and setPages edits them over MCP", () => {
	const store = createDrawingStore([wire(1, 0, 0, 10)]);
	const read = () =>
		Effect.runSync(
			executeDrawingOperation({ type: "getDrawing" }).pipe(
				Effect.provideService(DrawingStore, store),
			),
		);
	const first = read();
	assert.ok(first.ok);
	assert.deepEqual(first.drawing?.pages, [{ id: 1, name: "Page 1" }]);
	const edited = Effect.runSync(
		executeDrawingOperation({ type: "setPages", pages: twoPages }).pipe(
			Effect.provideService(DrawingStore, store),
		),
	);
	assert.ok(edited.ok);
	const second = read();
	assert.ok(second.ok);
	assert.deepEqual(second.drawing?.pages, twoPages);
	assert.notEqual(second.revision, first.revision);
});

test("loading canonicalizes shapes that name the first page explicitly", () => {
	const store = createDrawingStore([wire(1, 0, 0, 10, 1), wire(2, 10, 0, 20)]);
	const session = createEditorSession(store);
	session.connect(store, () => undefined);
	assert.deepEqual(
		session.shapes().map((shape) => shape.page),
		[undefined, undefined],
	);
	assert.deepEqual(netOf(store.getSnapshot().shapes, 1), [1, 2]);

	// With Power first, a shape naming Power is on the first page.
	const reordered = createDrawingStore(
		[wire(1, 0, 0, 10, 2), wire(2, 0, 10, 10, 1)],
		[twoPages[1], twoPages[0]],
	);
	assert.deepEqual(
		reordered.getSnapshot().shapes.map((shape) => shape.page),
		[undefined, 1],
	);
	const replaced = createDrawingStore([], twoPages);
	replaceDrawingShapes(replaced, [wire(1, 0, 0, 10, 1)], true, twoPages);
	assert.equal(replaced.getSnapshot().shapes[0].page, undefined);
});

test("an editor opens on the first page and resets when it shows another drawing", () => {
	const reordered = createDrawingStore(
		[wire(1, 0, 0, 10), wire(2, 0, 10, 10, 1)],
		[twoPages[1], twoPages[0]],
	);
	const session = createEditorSession(reordered);
	session.connect(reordered, () => undefined);
	assert.equal(session.currentPage(), 2);
	session.setPage(1);
	assert.equal(session.currentPage(), 1);
	const other = createDrawingStore([], twoPages);
	session.connect(other, () => undefined);
	assert.equal(session.currentPage(), 1);
	assert.equal(session.getState().page, null);
});

test("moving a symbol to another page takes its pinned circuit labels", () => {
	const resistor = createSymbol(
		1,
		required(symbolDefinitions.find((item) => item.name === "Resistor")),
		{ x: 0, y: 0 },
	);
	const pin = required(pinTerminals(resistor)[0]);
	const pinned: TextShape = {
		...label(2, "SDA", pin.x, pin.y),
		circuitNet: { id: "sda", label: "SDA", pinId: "p1" },
	};
	const store = createDrawingStore(
		[resistor, pinned, label(3, "SCL", 50, 50)],
		twoPages,
	);
	run(store, moveShapesToPageEffect([1], 2));
	assert.deepEqual(
		store.getSnapshot().shapes.map((shape) => [shape.id, shape.page]),
		[
			[1, 2],
			[2, 2],
			[3, undefined],
		],
	);
});

test("symbols cut wires only on their own page", () => {
	const resistor = createSymbol(
		0,
		required(symbolDefinitions.find((item) => item.name === "Resistor")),
		{ x: 0, y: 0 },
	);
	const [start, end] = [...pinTerminals(resistor)].sort((a, b) => a.x - b.x);
	const across = (id: number, page?: number) => ({
		...drawShape(
			id,
			"wire",
			{ x: start.x - 10, y: start.y },
			{ x: end.x + 10, y: end.y },
		),
		...(page === undefined ? {} : { page }),
	});
	const store = createDrawingStore([across(1, 2), across(2)], twoPages);
	const { id: _id, ...input } = resistor;
	run(store, placeShapesEffect([input], "Place resistor"));
	const wires = store.getSnapshot().shapes.filter((s) => s.kind === "wire");
	assert.deepEqual(
		wires.filter((shape) => shape.page === 2).map((shape) => shape.id),
		[1],
	);
	assert.equal(wires.filter((shape) => shape.page === undefined).length, 2);
});

test("electrical checks join pins on different pages through matching labels", () => {
	const definition = required(
		symbolDefinitions.find((item) => item.name === "Resistor"),
	);
	const first = createSymbol(1, definition, { x: 0, y: 0 });
	const second = { ...createSymbol(2, definition, { x: 0, y: 0 }), page: 2 };
	const [a] = pinTerminals(first);
	const [b] = pinTerminals(second);
	const shapes = [
		first,
		second,
		label(3, "SDA", a.x, a.y),
		label(4, "SDA", b.x, b.y, 2),
	];
	const joined = schematicCircuit(shapes, symbolDefinitions).circuit.nets.find(
		(net) => net.names.includes("SDA"),
	);
	assert.equal(joined?.pinIds.length, 2);
	// Without the labels, the same coordinates on two pages stay apart.
	const apart = schematicCircuit([first, second], symbolDefinitions).circuit;
	assert.ok(apart.nets.every((net) => net.pinIds.length < 2));
});

test("legacy diagonal wires reroute on their own page", () => {
	const diagonal = {
		...wire(1, 0, 0, 10, 2),
		x: 5,
		y: 5,
		width: Math.hypot(10, 10),
		rotation: Math.PI / 4,
	};
	// A wire on the first page sits where the route would run.
	const shapes = [
		diagonal,
		label(2, "A", 0, 0, 2),
		label(3, "A", 10, 10, 2),
		wire(4, 0, 0, 10),
	];
	const reroute = required(rerouteLegacyWires(shapes));
	assert.ok(reroute.replacements.every((shape) => shape.kind === "wire"));
	const pieces = [...reroute.replacements, ...reroute.additions];
	assert.ok(pieces.length > 1);
	assert.ok(pieces.every((shape) => shape.page === 2));
	const store = createDrawingStore(shapes, twoPages);
	const result = run(
		store,
		replaceAndPlaceShapesEffect(
			reroute.replacements,
			reroute.additions,
			"Redraw diagonal wires",
		),
	);
	assert.ok(Either.isRight(result));
	const after = store.getSnapshot().shapes;
	assert.deepEqual(
		after.filter((shape) => shape.page === undefined).map((s) => s.id),
		[4],
	);
	assert.deepEqual(netOf(after, 4), [4]);
});

test("revealing a net that spans pages stays on the current page", () => {
	const store = createDrawingStore(
		[wire(1, 0, 0, 10), label(2, "SDA", 10, 0), wire(3, 0, 0, 10, 2)],
		twoPages,
	);
	const session = createEditorSession(store);
	session.connect(store, () => undefined);
	session.setPage(2);
	session.reveal(new Set([1, 2, 3]));
	assert.equal(session.currentPage(), 2);
	assert.deepEqual([...session.getState().selection], [3]);
	session.reveal(new Set([1]));
	assert.equal(session.currentPage(), 1);
});
