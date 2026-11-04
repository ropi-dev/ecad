import assert from "node:assert/strict";
import { test } from "node:test";
import {
	containsSelection,
	type EditorSymbol,
	shapeAt,
	shapeBounds,
	symbolLabelPosition,
	symbolSelectionFrame,
	symbolShapes,
	symbolTextShapes,
	setSymbolLabelPosition,
} from "#/drawing/shapes.ts";
import { createSymbol, symbolDefinitions } from "#/drawing/symbols.ts";
import { pinTerminals } from "#/drawing/shapes.ts";
import { drawingShapeSchema } from "#/drawing/schema.ts";
import {
	persistDrawingShapes,
	resolveDrawingSymbols,
} from "#/drawing/symbol-persistence.ts";

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

test("unplaced net symbol labels report the default position", () => {
	assert.equal(symbolLabelPosition(placed(), "name"), "default");
});

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

test("the default label sits on the wire side, so presets move it clear", () => {
	const instance = placed();
	const bounds = worldBounds(instance);
	const defaultText = symbolTextShapes(instance)[0];
	// VDD geometry sits above the pin and the wire leaves downward: the raw
	// default anchor is inside the wire route.
	assert.ok(defaultText.y < bounds.minY);
	const above = setSymbolLabelPosition(instance, "name", "above");
	assert.ok(symbolTextShapes(above)[0].y > bounds.maxY);
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

test("resetting to default keeps the label's appearance overrides", () => {
	const instance = setSymbolLabelPosition(
		{ ...placed(), childOverrides: { "attribute:name": { fontSize: 4 } } },
		"name",
		"left",
	);
	const cleared = setSymbolLabelPosition(instance, "name", "default");
	assert.deepEqual(cleared.childOverrides, {
		"attribute:name": { fontSize: 4 },
	});
	assert.equal(symbolTextShapes(cleared)[0].fontSize, 4);
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

test("a neighbour's outline does not steal clicks on drawn content", () => {
	const vdd = placed();
	const resistor = createSymbol(
		2,
		symbolDefinitions.find((definition) => definition.id === "resistor")!,
		{ x: 0, y: 0 },
		"R1",
	);
	const offset = {
		x: pinTerminals(vdd)[0].x - pinTerminals(resistor)[0].x,
		y: pinTerminals(vdd)[0].y - pinTerminals(resistor)[0].y,
	};
	const r1 = {
		...resistor,
		x: resistor.x + offset.x,
		y: resistor.y + offset.y,
	};
	// The resistor is on top and its value label reaches over the VDD arrow.
	const arrow = { x: vdd.x, y: vdd.y + 1.5 };
	assert.equal(shapeAt([vdd, r1], arrow, 0)?.id, vdd.id);
	// Empty outline area still selects the symbol when nothing is drawn there.
	const frame = symbolSelectionFrame(r1);
	const corner = {
		x: frame.x + frame.width / 2 - 0.01,
		y: frame.y + frame.height / 2 - 0.01,
	};
	assert.equal(shapeAt([vdd, r1], corner, 0)?.id, r1.id);
});

test("tilted labels align outward on both axes and still clear the geometry", () => {
	for (const degrees of [30, 45, 135, 200, 315]) {
		const instance: EditorSymbol = {
			...placed(),
			childOverrides: {
				"attribute:name": { rotation: (degrees * Math.PI) / 180 },
			},
		};
		const geometry = worldBounds(instance);
		for (const position of ["above", "below", "left", "right"] as const) {
			const text = symbolTextShapes(
				setSymbolLabelPosition(instance, "name", position),
			)[0];
			// Corners of the rotated text box in world space.
			const center = { x: 0, y: 0 };
			const shifted = shapeBounds({ ...text, rotation: 0 });
			center.x = (shifted.minX + shifted.maxX) / 2 - text.x;
			center.y = (shifted.minY + shifted.maxY) / 2 - text.y;
			const corners = [-1, 1].flatMap((sx) =>
				[-1, 1].map((sy) => {
					const x = center.x + (sx * text.width) / 2;
					const y = center.y + (sy * text.height) / 2;
					return {
						x:
							text.x +
							x * Math.cos(text.rotation) -
							y * Math.sin(text.rotation),
						y:
							text.y +
							x * Math.sin(text.rotation) +
							y * Math.cos(text.rotation),
					};
				}),
			);
			const clear = corners.every((corner) =>
				position === "above"
					? corner.y > geometry.maxY
					: position === "below"
						? corner.y < geometry.minY
						: position === "left"
							? corner.x < geometry.minX
							: corner.x > geometry.maxX,
			);
			assert.ok(clear, `${position} at ${degrees}° must clear the geometry`);
		}
	}
});

test("unresolved symbols without geometry stay selectable and ignore presets", () => {
	const unresolved: EditorSymbol = { ...placed(), children: [], texts: [] };
	const frame = symbolSelectionFrame(unresolved);
	for (const value of [frame.x, frame.y, frame.width, frame.height])
		assert.ok(Number.isFinite(value));
	assert.equal(
		shapeAt([unresolved], { x: unresolved.x, y: unresolved.y }, 0),
		unresolved,
	);
	assert.equal(setSymbolLabelPosition(unresolved, "name", "above"), unresolved);
});

test("window selection checks an unresolved symbol's stored bounds", () => {
	const unresolved: EditorSymbol = { ...placed(), children: [], texts: [] };
	const far = { minX: 500, maxX: 600, minY: 500, maxY: 600 };
	assert.equal(containsSelection(unresolved, far), false);
	const around = {
		minX: unresolved.x - unresolved.width,
		maxX: unresolved.x + unresolved.width,
		minY: unresolved.y - unresolved.height,
		maxY: unresolved.y + unresolved.height,
	};
	assert.equal(containsSelection(unresolved, around), true);
});
