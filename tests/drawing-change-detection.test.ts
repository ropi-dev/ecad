import assert from "node:assert/strict";
import { test } from "node:test";
import {
	placeShapesEffect,
	replaceShapesEffect,
	type ShapeInput,
	undoEffect,
} from "@ecad/drawing-core/commands/drawing-commands.ts";
import {
	createDrawingStore,
	DrawingStore,
} from "@ecad/drawing-core/commands/drawing-store.ts";
import type {
	EditorShape,
	EditorSymbol,
} from "@ecad/drawing-core/drawing/shapes.ts";
import { Effect } from "effect";
import { createSymbol, symbolDefinitions } from "#/drawing/symbols.ts";

const geometry = {
	x: 10,
	y: 20,
	width: 30,
	height: 10,
	rotation: 0,
	lineWidth: 0.2,
};
const text: ShapeInput = {
	...geometry,
	kind: "text",
	text: "VCC",
	fontSize: 2,
};
const rectangle: ShapeInput = { ...geometry, kind: "rectangle" };
const { id: _id, ...symbolInput } = createSymbol(1, symbolDefinitions[0], {
	x: 50,
	y: 30,
});
const symbol: ShapeInput = symbolInput;

/** Places one shape, then replaces it with an edited copy of the stored shape. */
function replaceOnly(
	input: ShapeInput,
	edit: (shape: EditorShape) => EditorShape,
) {
	const store = createDrawingStore();
	const run = <A, E>(program: Effect.Effect<A, E, DrawingStore>) =>
		Effect.runSync(Effect.provideService(program, DrawingStore, store));
	run(placeShapesEffect([input], "Place"));
	const before = store.getSnapshot();
	let publications = 0;
	store.subscribe(() => publications++);
	const edited = edit(structuredClone(before.shapes[0]));
	const result = run(replaceShapesEffect([edited], "Edit"));
	assert.deepEqual(result.ids, [1]);
	return { store, run, before, edited, publications: () => publications };
}

function assertRecorded({
	store,
	run,
	before,
	edited,
	publications,
}: ReturnType<typeof replaceOnly>) {
	const after = store.getSnapshot();
	assert.notStrictEqual(after, before);
	assert.equal(publications(), 1);
	assert.equal(
		Object.keys(after.history.nodes).length,
		Object.keys(before.history.nodes).length + 1,
	);
	assert.equal(
		after.history.nodes[after.history.currentId].parentId,
		before.history.currentId,
	);
	assert.deepEqual(after.shapes, [edited]);
	assert.deepEqual(after.history.nodes[after.history.currentId].state.shapes, [
		edited,
	]);
	run(undoEffect);
	assert.deepEqual(store.getSnapshot().shapes, before.shapes);
}

function assertNoOp({
	store,
	before,
	publications,
}: ReturnType<typeof replaceOnly>) {
	assert.strictEqual(store.getSnapshot(), before);
	assert.equal(publications(), 0);
}

function editSymbol(edit: (shape: EditorSymbol) => void) {
	return (shape: EditorShape) => {
		assert.equal(shape.kind, "symbol");
		edit(shape as EditorSymbol);
		return shape;
	};
}

function firstChild(shape: EditorSymbol, kind: EditorShape["kind"]) {
	const child = shape.children.find((candidate) => candidate.kind === kind);
	assert.ok(child, `The fixture symbol has a ${kind} child.`);
	return child;
}

test("replacing only a text's bold flag records history and changes the snapshot", () => {
	assertRecorded(
		replaceOnly(text, (shape) => ({ ...shape, bold: true }) as EditorShape),
	);
	assertRecorded(
		replaceOnly(
			{ ...text, bold: true },
			(shape) => ({ ...shape, bold: false }) as EditorShape,
		),
	);
});

test("a true no-op replacement records no history and keeps the snapshot", () => {
	const kicad = { libraryId: "Device:R", unit: 1 };
	const circuitNet = { id: "net-1", label: "VCC", pinId: "pin-2" };
	assertNoOp(
		replaceOnly({ ...text, bold: true, circuitNet }, (shape) => shape),
	);
	assertNoOp(replaceOnly({ ...symbolInput, kicad }, (shape) => shape));
	assertNoOp(
		replaceOnly(
			text,
			(shape) => ({ ...shape, bold: undefined }) as EditorShape,
		),
	);
});

test("numbers within the comparison tolerance are unchanged at every depth", () => {
	assertNoOp(
		replaceOnly(rectangle, (shape) => ({
			...shape,
			x: shape.x + 1e-12,
			lineWidth: shape.lineWidth + 1e-12,
		})),
	);
	assertNoOp(
		replaceOnly(
			symbol,
			editSymbol((shape) => {
				firstChild(shape, "pin").y += 1e-12;
			}),
		),
	);
	assertRecorded(
		replaceOnly(rectangle, (shape) => ({ ...shape, x: shape.x + 1e-6 })),
	);
	assertRecorded(
		replaceOnly(
			symbol,
			editSymbol((shape) => {
				firstChild(shape, "pin").y += 1e-6;
			}),
		),
	);
});
