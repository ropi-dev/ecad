import assert from "node:assert/strict";
import { test } from "node:test";
import { Effect } from "effect";
import { sameDrawing } from "@ecad/drawing-core/commands/drawing-equality.ts";
import { placeShapesEffect, replaceShapesEffect, type ShapeInput, undoEffect } from "#/commands/drawing-commands.ts";
import { createDrawingStore, type DrawingDocument, DrawingStore } from "#/commands/drawing-store.ts";
import { canSelectSymbolChild, type EditorShape, type EditorSymbol, symbolChildren } from "#/drawing/shapes.ts";
import { createSymbol, symbolDefinitions } from "#/drawing/symbols.ts";

const geometry = { x: 10, y: 20, width: 30, height: 10, rotation: 0, lineWidth: 0.2 };
const text: ShapeInput = { ...geometry, kind: "text", text: "VCC", fontSize: 2 };
const rectangle: ShapeInput = { ...geometry, kind: "rectangle" };
const { id: _id, ...symbolInput } = createSymbol(1, symbolDefinitions[0], { x: 50, y: 30 });
const symbol: ShapeInput = symbolInput;

/** Places one shape, then replaces it with an edited copy of the stored shape. */
function replaceOnly(input: ShapeInput, edit: (shape: EditorShape) => EditorShape) {
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

function assertRecorded({ store, run, before, edited, publications }: ReturnType<typeof replaceOnly>) {
	const after = store.getSnapshot();
	assert.notStrictEqual(after, before);
	assert.equal(publications(), 1);
	assert.equal(Object.keys(after.history.nodes).length, Object.keys(before.history.nodes).length + 1);
	assert.equal(after.history.nodes[after.history.currentId].parentId, before.history.currentId);
	assert.deepEqual(after.shapes, [edited]);
	assert.deepEqual(after.history.nodes[after.history.currentId].state.shapes, [edited]);
	run(undoEffect);
	assert.deepEqual(store.getSnapshot().shapes, before.shapes);
}

function assertNoOp({ store, before, publications }: ReturnType<typeof replaceOnly>) {
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
	assertRecorded(replaceOnly(text, (shape) => ({ ...shape, bold: true }) as EditorShape));
	assertRecorded(replaceOnly({ ...text, bold: true }, (shape) => ({ ...shape, bold: false }) as EditorShape));
});

test("replacing only a text's circuit net records history and changes the snapshot", () => {
	const circuitNet = { id: "net-1", label: "VCC" };
	assertRecorded(replaceOnly(text, (shape) => ({ ...shape, circuitNet }) as EditorShape));
	assertRecorded(
		replaceOnly({ ...text, circuitNet }, (shape) => ({ ...shape, circuitNet: { ...circuitNet, label: "VDD" } }) as EditorShape),
	);
	assertRecorded(
		replaceOnly({ ...text, circuitNet }, (shape) => ({ ...shape, circuitNet: { ...circuitNet, pinId: "pin-2" } }) as EditorShape),
	);
});

test("replacing only a symbol's KiCad source records history and changes the snapshot", () => {
	const kicad = { libraryId: "Device:R", unit: 1 };
	assertRecorded(replaceOnly(symbol, editSymbol((shape) => { shape.kicad = kicad; })));
	assertRecorded(replaceOnly({ ...symbolInput, kicad }, editSymbol((shape) => { shape.kicad = { ...kicad, unit: 2 }; })));
});

test("replacing only a nested symbol field records history and changes the snapshot", () => {
	assertRecorded(replaceOnly(symbol, editSymbol((shape) => {
		const pin = firstChild(shape, "pin");
		assert.equal(pin.kind, "pin");
		if (pin.kind === "pin") pin.name = `${pin.name}-renamed`;
	})));
	assertRecorded(replaceOnly(symbol, editSymbol((shape) => {
		shape.children.push({ ...geometry, id: 999, kind: "text", text: "Note", fontSize: 1 });
	})));
	assertRecorded(replaceOnly(
		{ ...symbolInput, children: [...symbolInput.children, { ...geometry, id: 999, kind: "text", text: "Note", fontSize: 1 }] },
		editSymbol((shape) => {
			const note = firstChild(shape, "text");
			if (note.kind === "text") note.bold = true;
		}),
	));
	assertRecorded(replaceOnly(symbol, editSymbol((shape) => {
		shape.childOverrides = { [`shape:${firstChild(shape, "pin").id}`]: { name: "EN" } };
	})));
	assertRecorded(replaceOnly(symbol, editSymbol((shape) => { shape.texts[0].fontSize *= 2; })));
});

test("a true no-op replacement records no history and keeps the snapshot", () => {
	const kicad = { libraryId: "Device:R", unit: 1 };
	const circuitNet = { id: "net-1", label: "VCC", pinId: "pin-2" };
	assertNoOp(replaceOnly({ ...text, bold: true, circuitNet }, (shape) => shape));
	assertNoOp(replaceOnly({ ...symbolInput, kicad }, (shape) => shape));
	assertNoOp(replaceOnly(text, (shape) => ({ ...shape, bold: undefined }) as EditorShape));
});

test("numbers within the comparison tolerance are unchanged at every depth", () => {
	assertNoOp(replaceOnly(rectangle, (shape) => ({ ...shape, x: shape.x + 1e-12, lineWidth: shape.lineWidth + 1e-12 })));
	assertNoOp(replaceOnly(symbol, editSymbol((shape) => { firstChild(shape, "pin").y += 1e-12; })));
	assertRecorded(replaceOnly(rectangle, (shape) => ({ ...shape, x: shape.x + 1e-6 })));
	assertRecorded(replaceOnly(symbol, editSymbol((shape) => { firstChild(shape, "pin").y += 1e-6; })));
});

test("absent top-level defaults equal explicit defaults in both directions", () => {
	const defaults = { locked: false, lineStyle: "solid", filled: false } as const;
	assertNoOp(replaceOnly(rectangle, (shape) => ({ ...shape, ...defaults })));
	assertNoOp(replaceOnly({ ...rectangle, ...defaults }, (shape) => {
		const { locked: _locked, lineStyle: _lineStyle, filled: _filled, ...rest } = shape as typeof shape & typeof defaults;
		return rest as EditorShape;
	}));
	assertNoOp(replaceOnly(text, (shape) => ({ ...shape, locked: false })));
	assertRecorded(replaceOnly(rectangle, (shape) => ({ ...shape, locked: true })));
	assertRecorded(replaceOnly(rectangle, (shape) => ({ ...shape, lineStyle: "dashed" }) as EditorShape));
	assertRecorded(replaceOnly(rectangle, (shape) => ({ ...shape, filled: true }) as EditorShape));
	assertRecorded(replaceOnly({ ...rectangle, ...defaults }, (shape) => ({ ...shape, filled: true }) as EditorShape));
});

test("symbol children and overrides keep exact optional fields because their defaults differ", () => {
	// An absent child lock means locked, so an explicit false unlocks the child.
	const unlocked = replaceOnly(symbol, editSymbol((shape) => {
		const child = firstChild(shape, "pin");
		assert.equal(child.locked, undefined);
		child.locked = false;
	}));
	const [before] = unlocked.before.shapes as EditorSymbol[];
	const pinKey = `shape:${firstChild(before, "pin").id}`;
	const selectable = (shape: EditorSymbol) =>
		canSelectSymbolChild(shape, symbolChildren(shape).find((child) => child.key === pinKey)!);
	assert.equal(selectable(before), false);
	assert.equal(selectable(unlocked.edited as EditorSymbol), true);
	assertRecorded(unlocked);
	// An explicit override default still replaces the child's own value.
	assertRecorded(replaceOnly(symbol, editSymbol((shape) => {
		shape.childOverrides = { [`shape:${firstChild(shape, "pin").id}`]: { locked: false } };
	})));
});

test("override keys set to undefined match the saved form, which drops them", () => {
	const pinId = symbolInput.children.find((child) => child.kind === "pin")!.id;
	const hiddenName = {
		...symbolInput,
		children: symbolInput.children.map((child) => (child.id === pinId ? { ...child, showName: false } : child)),
	};
	const withOverride = (override: Record<string, unknown>) => ({ ...hiddenName, childOverrides: { [`shape:${pinId}`]: override } });
	const replaceOverride = (override: Record<string, unknown>) =>
		editSymbol((shape) => { shape.childOverrides = { [`shape:${pinId}`]: override }; });
	// Saving drops the undefined value, so both overrides restore as {} and keep the name hidden.
	assert.equal(JSON.stringify(withOverride({ showName: undefined })), JSON.stringify(withOverride({})));
	assertNoOp(replaceOnly(withOverride({}), replaceOverride({ showName: undefined })));
	assertNoOp(replaceOnly(withOverride({ showName: undefined }), replaceOverride({})));
	assertRecorded(replaceOnly(withOverride({}), replaceOverride({ showName: true })));
});

/** Asserts the comparison result in both argument orders. */
function assertSame(first: DrawingDocument, second: DrawingDocument, expected: boolean) {
	assert.equal(sameDrawing(first, second), expected);
	assert.equal(sameDrawing(second, first), expected);
}

test("the drawing comparison covers fields it does not know about, symmetrically", () => {
	const shape = { ...geometry, id: 1, kind: "rectangle" } as EditorShape;
	const drawing = (fields: Record<string, unknown> = {}) => ({ shapes: [{ ...shape, ...fields } as unknown as EditorShape] });
	const extended = (value: unknown) => drawing({ future: value });
	assertSame(drawing(), { shapes: [structuredClone(shape)] }, true);
	assertSame(drawing(), extended({ nested: [1, 2] }), false);
	assertSame(extended({ nested: [1, 2] }), extended({ nested: [1, 2 + 1e-12] }), true);
	assertSame(extended({ nested: [1, 2] }), extended({ nested: [1, 3] }), false);
	assertSame(extended({ nested: [1, 2] }), extended({ nested: [1, 2, 3] }), false);
	assertSame(extended({ nested: [1] }), extended({ nested: { 0: 1 } }), false);
	assertSame(extended(undefined), drawing(), true);
	assertSame(extended(null), drawing(), false);
	assertSame(extended(new Map()), extended(new Map()), false);
	assertSame(drawing(), { shapes: [shape, { ...shape, id: 2 }] }, false);
	assertSame({ shapes: [shape], layer: "top" } as never, { shapes: [shape], layer: "bottom" } as never, false);
	// Defaults apply to whichever side lacks the field.
	for (const field of ["locked", "lineStyle", "filled"]) assertSame(drawing({ [field]: null }), drawing(), true);
	assertSame(drawing({ lineStyle: null }), drawing({ lineStyle: "dashed" }), false);
	// Only own keys count, so names on Object.prototype behave like any other key.
	assertSame(extended({ constructor: undefined }), extended({}), true);
	assertSame(extended({ toString: undefined }), extended({ hasOwnProperty: undefined }), true);
	assertSame(extended({ constructor: 1 }), extended({}), false);
	assertSame(drawing({ constructor: "x" }), drawing(), false);
});
