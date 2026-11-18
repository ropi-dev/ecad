import assert from "node:assert/strict";
import { test } from "node:test";
import { drawingShapeSchema } from "@ecad/drawing-core/drawing/schema.ts";
import {
	type EditorSymbol,
	setSymbolLabelPosition,
	shapeBounds,
	symbolLabelPosition,
	symbolSelectionFrame,
	symbolShapes,
	symbolTextShapes,
} from "@ecad/drawing-core/drawing/shapes.ts";
import {
	persistDrawingShapes,
	resolveDrawingSymbols,
} from "#/drawing/symbol-persistence.ts";
import { createSymbol, symbolDefinitions } from "#/drawing/symbols.ts";

const power = (() => {
	const definition = symbolDefinitions.find(
		(candidate) => candidate.netSymbol && candidate.id === "vdd",
	);
	if (!definition) throw new Error("Expected the vdd definition");
	return definition;
})();

function placed(): EditorSymbol {
	return createSymbol(1, power, { x: 10, y: 10 });
}

function worldBounds(instance: EditorSymbol) {
	const boxes = instance.children.map(shapeBounds);
	return {
		minX: instance.x + Math.min(...boxes.map((box) => box.minX)),
		maxX: instance.x + Math.max(...boxes.map((box) => box.maxX)),
		minY: instance.y + Math.min(...boxes.map((box) => box.minY)),
		maxY: instance.y + Math.max(...boxes.map((box) => box.maxY)),
	};
}

function resolve(shapes: EditorSymbol[]): EditorSymbol {
	const [persisted] = persistDrawingShapes(shapes, [power]);
	const restored = drawingShapeSchema.parse(
		JSON.parse(JSON.stringify(persisted)),
	) as never as EditorSymbol;
	// Resolve as a definition-linked instance rather than a library reference.
	const { library: _library, ...instance } = restored;
	return resolveDrawingSymbols([instance], [power], new Map())
		.shapes[0] as EditorSymbol;
}

test("label presets anchor the label outside the geometry on the chosen side", () => {
	const instance = placed();
	const bounds = worldBounds(instance);
	const texts = Object.fromEntries(
		(["above", "below", "left", "right"] as const).map((position) => {
			const next = setSymbolLabelPosition(instance, "name", position);
			return [position, { symbol: next, text: symbolTextShapes(next)[0] }];
		}),
	);
	assert.equal(texts.above.text.x, (bounds.minX + bounds.maxX) / 2);
	assert.ok(texts.above.text.y > bounds.maxY, "above must clear the top edge");
	assert.equal(
		texts.above.symbol.textAlignments?.name?.verticalAlign,
		"bottom",
	);

	assert.equal(texts.below.text.x, (bounds.minX + bounds.maxX) / 2);
	assert.ok(
		texts.below.text.y < bounds.minY,
		"below must clear the bottom edge",
	);
	assert.equal(texts.below.symbol.textAlignments?.name?.verticalAlign, "top");

	assert.ok(texts.left.text.x < bounds.minX, "left must clear the left edge");
	assert.equal(texts.left.text.y, (bounds.minY + bounds.maxY) / 2);
	assert.equal(
		texts.left.symbol.textAlignments?.name?.horizontalAlign,
		"right",
	);

	assert.ok(
		texts.right.text.x > bounds.maxX,
		"right must clear the right edge",
	);
	assert.equal(texts.right.text.y, (bounds.minY + bounds.maxY) / 2);
	assert.equal(
		texts.right.symbol.textAlignments?.name?.horizontalAlign,
		"left",
	);

	for (const position of Object.keys(texts) as (keyof typeof texts)[])
		assert.equal(symbolLabelPosition(texts[position].symbol, "name"), position);
});

test("resetting to default clears the override", () => {
	const instance = setSymbolLabelPosition(placed(), "name", "below");
	const cleared = setSymbolLabelPosition(instance, "name", "default");
	assert.equal(cleared.textPositions, undefined);
	assert.equal(cleared.textAlignments, undefined);
	assert.equal(symbolLabelPosition(cleared, "name"), "default");
});

test("a label stays on its chosen side after the symbol rotates", () => {
	const instance = setSymbolLabelPosition(placed(), "name", "above");
	const rotated = setSymbolLabelPosition(
		{ ...instance, rotation: Math.PI / 2 },
		"name",
		"above",
	);
	const text = symbolTextShapes(rotated)[0];
	assert.ok(text.x < rotated.x, "the arrow points left after +90° rotation");
	assert.equal(symbolLabelPosition(rotated, "name"), "above");
});

test("label positions survive serialization and resolution", () => {
	const instance = setSymbolLabelPosition(placed(), "name", "right");
	const restored = resolve([instance]);
	assert.deepEqual(
		symbolTextShapes(restored).map((text) => ({
			x: text.x,
			y: text.y,
			horizontalAlign: text.horizontalAlign,
			verticalAlign: text.verticalAlign,
		})),
		symbolTextShapes(instance).map((text) => ({
			x: text.x,
			y: text.y,
			horizontalAlign: text.horizontalAlign,
			verticalAlign: text.verticalAlign,
		})),
	);
	assert.equal(symbolLabelPosition(restored, "name"), "right");
});

test("label text never overlaps the symbol geometry at any rotation", () => {
	for (const quarter of [0, 1, 2, 3]) {
		const instance = { ...placed(), rotation: (quarter * Math.PI) / 2 };
		const geometry = {
			minX: Math.min(...symbolShapes(instance).map((s) => shapeBounds(s).minX)),
			maxX: Math.max(...symbolShapes(instance).map((s) => shapeBounds(s).maxX)),
			minY: Math.min(...symbolShapes(instance).map((s) => shapeBounds(s).minY)),
			maxY: Math.max(...symbolShapes(instance).map((s) => shapeBounds(s).maxY)),
		};
		for (const position of ["above", "below", "left", "right"] as const) {
			const text = shapeBounds(
				symbolTextShapes(setSymbolLabelPosition(instance, "name", position))[0],
			);
			const clear =
				position === "above"
					? text.minY > geometry.maxY
					: position === "below"
						? text.maxY < geometry.minY
						: position === "left"
							? text.maxX < geometry.minX
							: text.minX > geometry.maxX;
			assert.ok(
				clear,
				`${position} at ${quarter * 90}° must clear the geometry`,
			);
		}
	}
});

test("the selection outline wraps the geometry and ignores the label", () => {
	const frames = (["default", "above", "below", "left", "right"] as const).map(
		(position) =>
			symbolSelectionFrame(setSymbolLabelPosition(placed(), "name", position)),
	);
	for (const frame of frames.slice(1)) assert.deepEqual(frame, frames[0]);
	const geometry = worldBounds(placed());
	const [frame] = frames;
	assert.ok(frame.x - frame.width / 2 < geometry.minX);
	assert.ok(frame.x + frame.width / 2 > geometry.maxX);
	assert.ok(frame.y - frame.height / 2 < geometry.minY);
	assert.ok(frame.y + frame.height / 2 > geometry.maxY);
	assert.ok(frame.width - (geometry.maxX - geometry.minX) <= 0.5 + 1e-9);
	assert.ok(frame.height - (geometry.maxY - geometry.minY) <= 0.5 + 1e-9);
});
