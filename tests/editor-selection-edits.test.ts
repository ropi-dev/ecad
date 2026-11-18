import assert from "node:assert/strict";
import { test } from "node:test";
import {
	boxBorder,
	drawShape,
	type EditorShape,
	type EditorSymbol,
	editShapeAttribute,
	moveShapes,
	moveSymbolText,
	normalizeNetSymbol,
	replaceSymbolChild,
	setSymbolLabelPosition,
	symbolChildren,
	symbolLabelPosition,
	symbolTextMoved,
	symbolTextShapes,
} from "@ecad/drawing-core/drawing/shapes.ts";
import {
	applyLineStyle,
	applySelectionEdit,
	type SelectionEditContext,
} from "#/drawing/selection-edit.ts";
import { createSymbol, symbolDefinitions } from "#/drawing/symbols.ts";
import { createTextShape, updateText } from "#/drawing/text.ts";
import { required } from "./helpers/required.ts";

const measureText = (value: string) => value.length * 48;
const box = (id = 1) => {
	const definition = symbolDefinitions.find((item) => item.id === "box");
	assert.ok(definition);
	return createSymbol(id, definition, { x: 20, y: 30 });
};
const resistor = (id = 1) =>
	createSymbol(id, symbolDefinitions[0], { x: -20, y: 10 });
const rectangle = drawShape(5, "rectangle", { x: 0, y: 0 }, { x: 10, y: 10 });
const wire = drawShape(6, "wire", { x: 0, y: 0 }, { x: 50, y: 0 });
const text = createTextShape(8, { x: 5, y: 5 }, measureText);

const context = (
	selection: EditorShape[],
	extra: Partial<SelectionEditContext> = {},
): SelectionEditContext => ({
	selection,
	shapes: selection,
	nextId: 100,
	allowLocked: false,
	measureText,
	...extra,
});

test("line styles apply to basic shapes and to the border of box symbols only", () => {
	assert.deepEqual(applyLineStyle(rectangle, "dashed"), [
		{ ...rectangle, lineStyle: "dashed" },
	]);
	const symbol = box();
	const border = boxBorder(symbol);
	assert.ok(border);
	const [styled] = applyLineStyle(symbol, "dotted");
	assert.deepEqual(
		styled,
		replaceSymbolChild(symbol, border.key, {
			...border.shape,
			lineStyle: "dotted",
		}),
	);
	assert.ok(styled.kind === "symbol");
	assert.equal(boxBorder(styled)?.shape.lineStyle, "dotted");
	assert.deepEqual(applyLineStyle(resistor(), "dashed"), []);
	assert.deepEqual(applyLineStyle(text, "dashed"), []);
	assert.deepEqual(applyLineStyle(wire, "dashed"), []);
	assert.deepEqual(
		applySelectionEdit(
			{ kind: "line-style", lineStyle: "dashed" },
			context([rectangle, text, box(2)]),
		)?.replacements,
		[
			{ ...rectangle, lineStyle: "dashed" },
			...applyLineStyle(box(2), "dashed"),
		],
	);
});

test("position edits move the whole selection with the first shape as anchor", () => {
	const selection = [rectangle, { ...rectangle, id: 10, x: 30 }];
	const shapes = [...selection, wire];
	const edit = applySelectionEdit(
		{ kind: "attribute", attribute: "x", value: 12 },
		context(selection, { shapes, nextId: 40, allowLocked: true }),
	);
	assert.deepEqual(
		edit?.replacements,
		moveShapes(
			selection,
			{ x: 12 - rectangle.x, y: 0 },
			0,
			rectangle,
			shapes,
			40,
			true,
		),
	);
	const y = applySelectionEdit(
		{ kind: "attribute", attribute: "y", value: -3 },
		context(selection),
	);
	assert.deepEqual(
		y?.replacements,
		moveShapes(
			selection,
			{ x: 0, y: -3 - rectangle.y },
			0,
			rectangle,
			selection,
			100,
			false,
		),
	);
});

test("lock edits change every selected shape", () => {
	const selection = [rectangle, text];
	assert.deepEqual(
		applySelectionEdit({ kind: "lock", locked: true }, context(selection))
			?.replacements,
		selection.map((shape) => ({ ...shape, locked: true })),
	);
	assert.deepEqual(
		applySelectionEdit({ kind: "lock", locked: false }, context(selection))
			?.replacements,
		selection.map((shape) => ({ ...shape, locked: false })),
	);
});

test("alignment and symbol edits apply to the matching shapes in a mixed selection", () => {
	const selection: EditorShape[] = [text, rectangle, { ...text, id: 13 }];
	assert.deepEqual(
		applySelectionEdit(
			{
				kind: "text-alignment",
				alignment: { horizontalAlign: "right", verticalAlign: "top" },
			},
			context(selection),
		)?.replacements,
		[text, { ...text, id: 13 }].map((shape) => ({
			...shape,
			horizontalAlign: "right",
			verticalAlign: "top",
		})),
	);
	const symbol = resistor(2);
	const attribute = applySelectionEdit(
		{ kind: "symbol-attribute", attribute: "value", value: "10k" },
		context([symbol, rectangle]),
	);
	assert.deepEqual(attribute?.replacements, [
		{ ...symbol, attributes: { ...symbol.attributes, value: "10k" } },
		rectangle,
	]);
	assert.deepEqual(
		applySelectionEdit(
			{ kind: "net-symbol", netSymbol: true },
			context([symbol, rectangle]),
		)?.replacements,
		[normalizeNetSymbol({ ...symbol, netSymbol: true })],
	);
});

test("a selected symbol child receives geometry, style, text and lock edits", () => {
	const symbol = box(3);
	const children = symbolChildren(symbol);
	const border = children.find((child) => child.shape.kind === "rectangle");
	const label = children.find((child) => child.shape.kind === "text");
	assert.ok(border && label);
	const childContext = (child: typeof border) =>
		context([symbol], { child: { symbol, child } });
	const expected = (child: typeof border, edited: EditorShape) => {
		assert.ok(edited.kind !== "symbol");
		return [replaceSymbolChild(symbol, child.key, edited)];
	};

	assert.deepEqual(
		applySelectionEdit(
			{ kind: "attribute", attribute: "width", value: 40 },
			childContext(border),
		)?.replacements,
		expected(border, editShapeAttribute(border.shape, "width", 40)),
	);
	assert.ok(border.shape.kind === "rectangle");
	assert.deepEqual(
		applySelectionEdit(
			{ kind: "line-style", lineStyle: "dashed" },
			childContext(border),
		)?.replacements,
		expected(border, { ...border.shape, lineStyle: "dashed" }),
	);
	assert.deepEqual(
		applySelectionEdit({ kind: "lock", locked: true }, childContext(border))
			?.replacements,
		expected(border, { ...border.shape, locked: true }),
	);
	assert.ok(label.shape.kind === "text");
	assert.deepEqual(
		applySelectionEdit({ kind: "text", text: "Board" }, childContext(label))
			?.replacements,
		expected(label, updateText(label.shape, "Board", measureText)),
	);
	assert.deepEqual(
		applySelectionEdit(
			{
				kind: "text-alignment",
				alignment: { horizontalAlign: "center", verticalAlign: "middle" },
			},
			childContext(label),
		)?.replacements,
		expected(label, {
			...label.shape,
			horizontalAlign: "center",
			verticalAlign: "middle",
		}),
	);
	// Child edits skip the selection's finite-number guard; editShapeAttribute keeps the child unchanged.
	assert.deepEqual(
		applySelectionEdit(
			{ kind: "attribute", attribute: "width", value: Number.NaN },
			childContext(border),
		)?.replacements,
		expected(border, border.shape),
	);
	// Edits that do not fit the child change nothing.
	assert.equal(
		applySelectionEdit({ kind: "text", text: "Board" }, childContext(border)),
		undefined,
	);
	assert.equal(
		applySelectionEdit(
			{ kind: "line-style", lineStyle: "dashed" },
			childContext(label),
		),
		undefined,
	);
	assert.equal(
		applySelectionEdit(
			{ kind: "pin", attribute: "name", value: "A" },
			childContext(label),
		),
		undefined,
	);
});

test("label position edits move the name label of each selected symbol", () => {
	const vdd = symbolDefinitions.find(
		(definition) => definition.netSymbol && definition.id === "vdd",
	);
	assert.ok(vdd);
	const power = createSymbol(14, vdd, { x: 10, y: 10 });
	const edit = applySelectionEdit(
		{ kind: "symbol-label-position", position: "left" },
		context([power, rectangle]),
	);
	assert.deepEqual(edit?.replacements, [
		setSymbolLabelPosition(power, "name", "left"),
	]);
	const [moved] = edit?.replacements ?? [];
	assert.ok(moved?.kind === "symbol");
	assert.equal(symbolLabelPosition(moved, "name"), "left");
	// A selected child does not take the edit; the parent symbol does.
	const [child] = symbolChildren(power);
	assert.deepEqual(
		applySelectionEdit(
			{ kind: "symbol-label-position", position: "left" },
			context([power], { child: { symbol: power, child } }),
		),
		applySelectionEdit(
			{ kind: "symbol-label-position", position: "left" },
			context([power]),
		),
	);
});

test("resetting a selected symbol text returns it to the definition", () => {
	const original = resistor(20);
	const placement = (symbol: EditorSymbol) =>
		symbolTextShapes(symbol).map(
			({ x, y, rotation, horizontalAlign, verticalAlign }) => ({
				x,
				y,
				rotation,
				horizontalAlign,
				verticalAlign,
			}),
		);
	const labels = (symbol: EditorSymbol) =>
		symbolChildren(symbol).filter((child) =>
			child.key.startsWith("attribute:"),
		);
	const [first, second] = labels(original);
	assert.ok(first?.shape.kind === "text" && second?.shape.kind === "text");
	assert.equal(symbolTextMoved(original, first.key), false);
	const reset = (symbol: EditorSymbol, key: string) =>
		applySelectionEdit(
			{ kind: "symbol-text-reset" },
			context([symbol], {
				child: {
					symbol,
					child: required(labels(symbol).find((child) => child.key === key)),
				},
			}),
		);
	assert.equal(reset(original, first.key), undefined);
	assert.equal(
		applySelectionEdit({ kind: "symbol-text-reset" }, context([original])),
		undefined,
	);
	const moved = moveSymbolText(
		replaceSymbolChild(original, first.key, {
			...first.shape,
			x: first.shape.x + 5,
			y: first.shape.y - 3,
			rotation: Math.PI / 2,
			horizontalAlign: "right",
		}),
		1,
		{ x: 4, y: 4 },
	);
	assert.equal(symbolTextMoved(moved, first.key), true);
	assert.equal(symbolTextMoved(moved, second.key), true);
	const edit = reset(moved, first.key);
	const [restored] = edit?.replacements ?? [];
	assert.ok(restored?.kind === "symbol");
	assert.equal(symbolTextMoved(restored, first.key), false);
	assert.equal(symbolTextMoved(restored, second.key), true);
	assert.deepEqual(placement(restored)[0], placement(original)[0]);
	assert.deepEqual(placement(restored)[1], placement(moved)[1]);
	assert.deepEqual(restored.attributes, moved.attributes);
	const locked = replaceSymbolChild(moved, first.key, {
		...required(labels(moved).find((child) => child.key === first.key)).shape,
		locked: true,
	});
	assert.equal(reset(locked, first.key), undefined);
});

test("a zone's thermal settings change, clear back to the board's, and reject sizes of zero", () => {
	const zone = {
		...rectangle,
		layer: "F.Cu",
		zone: { clearance: 0.3 },
	} as EditorShape;
	const edit = (settings: Record<string, unknown>, shape = zone) =>
		applySelectionEdit({ kind: "zone", zone: settings }, context([shape]));
	const changed = required(edit({ thermalGap: 0.25 }));
	const gapped = required(changed.replacements[0]);
	assert.deepEqual(gapped.kind === "rectangle" && gapped.zone, {
		clearance: 0.3,
		thermalGap: 0.25,
	});
	const cleared = required(
		required(edit({ thermalGap: undefined }, gapped)).replacements[0],
	);
	assert.deepEqual(cleared.kind === "rectangle" && cleared.zone, {
		clearance: 0.3,
	});
	assert.equal(edit({ thermalSpokeWidth: 0 }), undefined);
	assert.equal(edit({ thermalGap: 150 }), undefined);
	const unclear = required(
		required(edit({ clearance: undefined })).replacements[0],
	);
	assert.deepEqual(unclear.kind === "rectangle" && unclear.zone, {});
	assert.equal(edit({ padConnection: "partial" }), undefined);
	assert.equal(edit({}), undefined);
	assert.equal(edit({ thermalGap: undefined }), undefined);
	assert.equal(edit({ clearance: 0.3 }), undefined);
	assert.ok(edit({ padConnection: "solid" }));
});
