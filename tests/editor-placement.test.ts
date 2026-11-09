import assert from "node:assert/strict";
import { test } from "node:test";
import { placeShapesEffect } from "@ecad/drawing-core/commands/drawing-commands.ts";
import {
	createDrawingStore,
	DrawingStore,
} from "@ecad/drawing-core/commands/drawing-store.ts";
import {
	drawShape,
	type EditorShape,
	routeWire,
} from "@ecad/drawing-core/drawing/shapes.ts";
import {
	DEFAULT_TEXT_SIZE,
	NET_LABEL_SIZE,
} from "@ecad/drawing-core/drawing/units.ts";
import { wireEnds } from "@ecad/drawing-core/drawing/wire-routing.ts";
import { Effect } from "effect";
import { placedSelection } from "#/drawing/command-selection.ts";
import {
	createLabelShape,
	createPlacementShape,
	defaultLabelText,
	isPlacementTool,
	placementLabel,
	placementSnapsToConnection,
} from "#/drawing/placement.ts";
import { createSymbol, symbolDefinitions } from "#/drawing/symbols.ts";
import { createTextShape } from "#/drawing/text.ts";

const measureText = (value: string) => value.length * 48;
const anchor = { x: 25, y: -50 };

test("new net and supply labels start as NET and GND, anchored at their bottom left", () => {
	assert.equal(defaultLabelText("net"), "NET");
	assert.equal(defaultLabelText("supply"), "GND");
	for (const role of ["net", "supply"] as const) {
		const label = createLabelShape(7, anchor, role, measureText);
		assert.equal(label.id, 7);
		assert.equal(label.kind, "text");
		assert.equal(label.electrical, role);
		assert.equal(label.text, defaultLabelText(role));
		assert.equal(label.horizontalAlign, "left");
		assert.equal(label.verticalAlign, "bottom");
		assert.deepEqual({ x: label.x, y: label.y }, anchor);
		// Net labels use 75 mil text; supply labels keep the default text size.
		const fontSize = role === "net" ? NET_LABEL_SIZE : DEFAULT_TEXT_SIZE;
		assert.equal(label.fontSize, fontSize);
		const plain = createTextShape(7, anchor, measureText);
		// The text box is measured for the label's own name, not the "Text" placeholder.
		assert.equal(label.height, (plain.height * fontSize) / plain.fontSize);
		assert.notEqual(label.width, plain.width);
	}
});

// tests/browser/editor.spec.ts checks that the hover guide and the click place the same item.
test("each placement tool creates its own kind of item at the anchor", () => {
	for (const tool of ["pin", "no-connect", "text", "net", "supply"] as const) {
		assert.equal(isPlacementTool(tool), true);
		const shape = createPlacementShape(tool, 3, anchor, measureText);
		assert.equal(shape.id, 3);
		assert.equal(
			shape.kind,
			tool === "net" || tool === "supply" ? "text" : tool,
		);
		assert.deepEqual({ x: shape.x, y: shape.y }, anchor);
	}
	assert.deepEqual(
		createPlacementShape("pin", 3, anchor, measureText),
		drawShape(3, "pin", anchor, anchor),
	);
	assert.deepEqual(
		createPlacementShape("no-connect", 3, anchor, measureText),
		drawShape(3, "no-connect", anchor, anchor),
	);
	assert.deepEqual(
		createPlacementShape("text", 3, anchor, measureText),
		createTextShape(3, anchor, measureText),
	);
	assert.deepEqual(
		createPlacementShape("supply", 3, anchor, measureText),
		createLabelShape(3, anchor, "supply", measureText),
	);
	for (const tool of ["select", "pan", "wire", "rectangle", "symbol"])
		assert.equal(isPlacementTool(tool), false);
});

test("labels and no-connect markers snap to connections; pins and text stay on the grid", () => {
	assert.deepEqual(
		(["pin", "no-connect", "text", "net", "supply"] as const).filter(
			placementSnapsToConnection,
		),
		["no-connect", "net", "supply"],
	);
	assert.deepEqual(
		(["pin", "no-connect", "text", "net", "supply"] as const).map(
			placementLabel,
		),
		[
			"Place pin",
			"Place no connect",
			"Draw text",
			"Place net label",
			"Place net label",
		],
	);
});

test("placing a route keeps split pieces of an existing wire out of the selection", () => {
	const store = createDrawingStore();
	const run = <A, E>(program: Effect.Effect<A, E, DrawingStore>) =>
		Effect.runSync(Effect.provideService(program, DrawingStore, store));
	run(
		placeShapesEffect(
			[drawShape(1, "wire", { x: 0, y: 0 }, { x: 100, y: 0 })],
			"Trunk",
		),
	);
	const before = store.getSnapshot();
	// The last leg runs along the trunk, which normalization splits at the junction.
	const legs = routeWire(before.nextShapeId, { x: 50, y: 50 }, { x: 80, y: 0 });
	const result = run(placeShapesEffect(legs, "Draw wire"));
	const trunkPieces = result.idsBySource.get(1) ?? [];
	assert.equal(trunkPieces.length, 2);
	const reused = legs.find((leg) => trunkPieces.includes(leg.id));
	assert.ok(reused, "a trunk piece reuses a new leg's ID");
	assert.ok(result.ids.includes(reused.id));
	const selection = placedSelection(before.shapes, result);
	assert.deepEqual(
		[...selection],
		result.ids.filter((id) => !trunkPieces.includes(id)),
	);
	assert.equal(selection.has(reused.id), false);
	assert.ok(selection.size > 0);
});

test("placing shapes without wire splits selects every placed shape", () => {
	const result = {
		ids: [4, 5],
		idsBySource: new Map([
			[1, [1]],
			[4, [4]],
			[5, [5]],
		]),
	};
	const previous = [drawShape(1, "wire", { x: 0, y: 0 }, { x: 100, y: 0 })];
	assert.deepEqual([...placedSelection(previous, result)], [4, 5]);
	// Only existing wires count. A rectangle mapped to several IDs is not a split wire.
	const rectangle = drawShape(1, "rectangle", { x: 0, y: 0 }, { x: 10, y: 10 });
	assert.deepEqual(
		[
			...placedSelection([rectangle], {
				ids: [1, 4],
				idsBySource: new Map([[1, [1, 4]]]),
			}),
		],
		[1, 4],
	);
});

const resistor = symbolDefinitions.find(({ id }) => id === "resistor");
if (!resistor) throw new Error("The built-in resistor is missing.");

function placeOnto(existing: EditorShape[], placed: EditorShape[]) {
	const store = createDrawingStore();
	const run = <A, E>(program: Effect.Effect<A, E, DrawingStore>) =>
		Effect.runSync(Effect.provideService(program, DrawingStore, store));
	run(placeShapesEffect(existing, "Existing"));
	run(placeShapesEffect(placed, "Insert Resistor"));
	return store.getSnapshot();
}

const wireSpans = (shapes: readonly EditorShape[]) =>
	shapes
		.filter((shape) => shape.kind === "wire")
		.map((wire) =>
			wireEnds(wire).map(({ x, y }) => ({
				x: Number(x.toFixed(6)) + 0,
				y: Number(y.toFixed(6)) + 0,
			})),
		)
		.sort((a, b) => a[0].x - b[0].x || a[0].y - b[0].y);

test("placing a component on a wire splits the wire at its terminals and removes the part under it", () => {
	const snapshot = placeOnto(
		[drawShape(1, "wire", { x: -20, y: 0 }, { x: 20, y: 0 })],
		[createSymbol(1, resistor, { x: 0, y: 0 })],
	);
	assert.deepEqual(wireSpans(snapshot.shapes), [
		[
			{ x: -20, y: 0 },
			{ x: -3.81, y: 0 },
		],
		[
			{ x: 3.81, y: 0 },
			{ x: 20, y: 0 },
		],
	]);
	const { nodes, currentId } = snapshot.history;
	assert.equal(nodes[currentId].label, "Insert Resistor");
	const parentId = nodes[currentId].parentId ?? 0;
	assert.deepEqual(wireSpans(nodes[parentId].state.shapes), [
		[
			{ x: -20, y: 0 },
			{ x: 20, y: 0 },
		],
	]);
});

test("a rotated component cuts a vertical wire drawn in either direction", () => {
	const snapshot = placeOnto(
		[drawShape(1, "wire", { x: 10, y: 30 }, { x: 10, y: -30 })],
		[
			{
				...createSymbol(1, resistor, { x: 10, y: 0 }),
				rotation: Math.PI / 2,
			},
		],
	);
	assert.deepEqual(wireSpans(snapshot.shapes), [
		[
			{ x: 10, y: -3.81 },
			{ x: 10, y: -30 },
		],
		[
			{ x: 10, y: 30 },
			{ x: 10, y: 3.81 },
		],
	]);
});

test("a wire that ends inside a component loses the part under the component", () => {
	const snapshot = placeOnto(
		[drawShape(1, "wire", { x: -20, y: 0 }, { x: 1, y: 0 })],
		[createSymbol(1, resistor, { x: 0, y: 0 })],
	);
	assert.deepEqual(wireSpans(snapshot.shapes), [
		[
			{ x: -20, y: 0 },
			{ x: -3.81, y: 0 },
		],
	]);
});

test("placing a component keeps wires that do not run between its terminals", () => {
	const existing = [
		drawShape(1, "wire", { x: -20, y: 5 }, { x: 20, y: 5 }),
		drawShape(2, "wire", { x: 0, y: -20 }, { x: 0, y: 20 }),
	];
	const snapshot = placeOnto(existing, [
		createSymbol(1, resistor, { x: 30, y: 0 }),
	]);
	assert.deepEqual(wireSpans(snapshot.shapes), wireSpans(existing));
});

test("placing a component on a locked wire leaves the part under it", () => {
	const snapshot = placeOnto(
		[
			{
				...drawShape(1, "wire", { x: -20, y: 0 }, { x: 20, y: 0 }),
				locked: true,
			},
		],
		[createSymbol(1, resistor, { x: 0, y: 0 })],
	);
	assert.deepEqual(wireSpans(snapshot.shapes)[1], [
		{ x: -3.81, y: 0 },
		{ x: 3.81, y: 0 },
	]);
});

test("wires placed together with a component are not cut by it", () => {
	const shorted = [
		createSymbol(1, resistor, { x: 0, y: 0 }),
		drawShape(2, "wire", { x: -3.81, y: 0 }, { x: 3.81, y: 0 }),
	];
	const snapshot = placeOnto([], shorted);
	assert.deepEqual(wireSpans(snapshot.shapes), [
		[
			{ x: -3.81, y: 0 },
			{ x: 3.81, y: 0 },
		],
	]);
});
