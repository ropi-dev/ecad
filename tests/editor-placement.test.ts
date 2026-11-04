import assert from "node:assert/strict";
import { test } from "node:test";
import { Effect } from "effect";
import { placeShapesEffect } from "#/commands/drawing-commands.ts";
import { createDrawingStore, DrawingStore } from "#/commands/drawing-store.ts";
import { placedSelection } from "#/drawing/command-selection.ts";
import {
	createLabelShape,
	createPlacementShape,
	defaultLabelText,
	isPlacementTool,
	placementLabel,
	placementSnapsToConnection,
} from "#/drawing/placement.ts";
import { drawShape, routeWire, shapeBounds } from "#/drawing/shapes.ts";
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
		const plain = createTextShape(7, anchor, measureText);
		// The text box is measured for the label's own name, not the "Text" placeholder.
		assert.equal(label.height, plain.height);
		assert.notEqual(label.width, plain.width);
	}
});

test("placement tools create the same item for the hover guide and the click", () => {
	for (const tool of ["pin", "no-connect", "text", "net", "supply"] as const) {
		assert.equal(isPlacementTool(tool), true);
		const first = createPlacementShape(tool, 3, anchor, measureText);
		const second = createPlacementShape(tool, 3, anchor, measureText);
		assert.deepEqual(first, second);
		assert.deepEqual(shapeBounds(first), shapeBounds(second));
		assert.equal(first.id, 3);
	}
	assert.deepEqual(createPlacementShape("pin", 3, anchor, measureText), drawShape(3, "pin", anchor, anchor));
	assert.deepEqual(createPlacementShape("no-connect", 3, anchor, measureText), drawShape(3, "no-connect", anchor, anchor));
	assert.deepEqual(createPlacementShape("text", 3, anchor, measureText), createTextShape(3, anchor, measureText));
	assert.deepEqual(createPlacementShape("supply", 3, anchor, measureText), createLabelShape(3, anchor, "supply", measureText));
	for (const tool of ["select", "pan", "wire", "rectangle", "symbol"]) assert.equal(isPlacementTool(tool), false);
});

test("labels and no-connect markers snap to connections; pins and text stay on the grid", () => {
	assert.deepEqual(
		(["pin", "no-connect", "text", "net", "supply"] as const).filter(placementSnapsToConnection),
		["no-connect", "net", "supply"],
	);
	assert.deepEqual(
		(["pin", "no-connect", "text", "net", "supply"] as const).map(placementLabel),
		["Place pin", "Place no connect", "Draw text", "Place net label", "Place net label"],
	);
});

test("placing a route keeps split pieces of an existing wire out of the selection", () => {
	const store = createDrawingStore();
	const run = <A, E>(program: Effect.Effect<A, E, DrawingStore>) =>
		Effect.runSync(Effect.provideService(program, DrawingStore, store));
	run(placeShapesEffect([drawShape(1, "wire", { x: 0, y: 0 }, { x: 100, y: 0 })], "Trunk"));
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
	assert.deepEqual([...selection], result.ids.filter((id) => !trunkPieces.includes(id)));
	assert.equal(selection.has(reused.id), false);
	assert.ok(selection.size > 0);
});

test("placing shapes without wire splits selects every placed shape", () => {
	const result = {
		ids: [4, 5],
		idsBySource: new Map([[1, [1]], [4, [4]], [5, [5]]]),
	};
	const previous = [drawShape(1, "wire", { x: 0, y: 0 }, { x: 100, y: 0 })];
	assert.deepEqual([...placedSelection(previous, result)], [4, 5]);
	// Only existing wires count. A rectangle mapped to several IDs is not a split wire.
	const rectangle = drawShape(1, "rectangle", { x: 0, y: 0 }, { x: 10, y: 10 });
	assert.deepEqual(
		[...placedSelection([rectangle], { ids: [1, 4], idsBySource: new Map([[1, [1, 4]]]) })],
		[1, 4],
	);
});
