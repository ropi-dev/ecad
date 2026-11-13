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
	type TextShape,
} from "@ecad/drawing-core/drawing/shapes.ts";
import { createLabelShape } from "#/drawing/placement.ts";
import {
	applyLineStyle,
	applySelectionEdit,
	changeLabelRole,
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
const pin = drawShape(7, "pin", { x: 0, y: 0 }, { x: 0, y: 0 });
const text = createTextShape(8, { x: 5, y: 5 }, measureText);
const linkedLabel: TextShape = {
	...createLabelShape(9, { x: 0, y: 0 }, "net", measureText),
	circuitNet: { id: "net-1", label: "NET" },
};

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

test("a label keeps its circuit net only while it stays a net label", () => {
	assert.deepEqual(changeLabelRole(linkedLabel, "net"), {
		...linkedLabel,
		electrical: "net",
	});
	for (const role of ["supply", undefined] as const) {
		const changed = changeLabelRole(linkedLabel, role);
		assert.equal(changed.electrical, role);
		assert.ok(
			"circuitNet" in changed,
			"the cleared binding stays as an explicit key",
		);
		assert.equal(changed.circuitNet, undefined);
	}
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
		),
		{
			replacements: [
				{ ...rectangle, lineStyle: "dashed" },
				...applyLineStyle(box(2), "dashed"),
			],
			label: "Change line style",
		},
	);
});

test("numeric attribute edits name the attribute and ignore non-finite values", () => {
	const selection = [rectangle, { ...rectangle, id: 10, x: 30 }];
	assert.equal(
		applySelectionEdit(
			{ kind: "attribute", attribute: "width", value: Number.NaN },
			context(selection),
		),
		undefined,
	);
	assert.equal(
		applySelectionEdit(
			{ kind: "attribute", attribute: "x", value: Number.POSITIVE_INFINITY },
			context(selection),
		),
		undefined,
	);
	assert.deepEqual(
		applySelectionEdit(
			{ kind: "attribute", attribute: "width", value: 4 },
			context(selection),
		),
		{
			replacements: selection.map((shape) =>
				editShapeAttribute(shape, "width", 4),
			),
			label: "Change width",
		},
	);
	assert.equal(
		applySelectionEdit(
			{ kind: "attribute", attribute: "lineWidth", value: 0.3 },
			context(selection),
		)?.label,
		"Change line width",
	);
	assert.equal(
		applySelectionEdit(
			{ kind: "attribute", attribute: "fontSize", value: 3 },
			context([text]),
		)?.label,
		"Change font size",
	);
});

test("position edits move the whole selection with the first shape as anchor", () => {
	const selection = [rectangle, { ...rectangle, id: 10, x: 30 }];
	const shapes = [...selection, wire];
	const edit = applySelectionEdit(
		{ kind: "attribute", attribute: "x", value: 12 },
		context(selection, { shapes, nextId: 40, allowLocked: true }),
	);
	assert.deepEqual(edit, {
		replacements: moveShapes(
			selection,
			{ x: 12 - rectangle.x, y: 0 },
			0,
			rectangle,
			shapes,
			40,
			true,
		),
		label: "Change x",
	});
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
		applySelectionEdit({ kind: "lock", locked: true }, context(selection)),
		{
			replacements: selection.map((shape) => ({ ...shape, locked: true })),
			label: "Lock selection",
		},
	);
	assert.equal(
		applySelectionEdit({ kind: "lock", locked: false }, context(selection))
			?.label,
		"Unlock selection",
	);
});

test("text, label role and pin edits need exactly one matching shape", () => {
	assert.deepEqual(
		applySelectionEdit({ kind: "text", text: "Hello" }, context([text])),
		{
			replacements: [updateText(text, "Hello", measureText)],
			label: "Edit text",
		},
	);
	assert.equal(
		applySelectionEdit(
			{ kind: "text", text: "Hello" },
			context([text, { ...text, id: 11 }]),
		),
		undefined,
	);
	assert.equal(
		applySelectionEdit({ kind: "text", text: "Hello" }, context([rectangle])),
		undefined,
	);

	assert.deepEqual(
		applySelectionEdit(
			{ kind: "label-role", role: "supply" },
			context([linkedLabel]),
		),
		{
			replacements: [changeLabelRole(linkedLabel, "supply")],
			label: "Change label role",
		},
	);
	assert.equal(
		applySelectionEdit(
			{ kind: "label-role", role: "net" },
			context([rectangle]),
		),
		undefined,
	);

	assert.deepEqual(
		applySelectionEdit(
			{ kind: "pin", attribute: "name", value: "VCC" },
			context([pin]),
		),
		{
			replacements: [{ ...pin, name: "VCC" }],
			label: "Change pin name",
		},
	);
	assert.deepEqual(
		applySelectionEdit(
			{ kind: "pin", attribute: "showNumber", value: false },
			context([pin]),
		),
		{
			replacements: [{ ...pin, showNumber: false }],
			label: "Change pin showNumber",
		},
	);
	assert.equal(
		applySelectionEdit(
			{ kind: "pin", attribute: "number", value: "1" },
			context([pin, { ...pin, id: 12 }]),
		),
		undefined,
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
		),
		{
			replacements: [text, { ...text, id: 13 }].map((shape) => ({
				...shape,
				horizontalAlign: "right",
				verticalAlign: "top",
			})),
			label: "Align text",
		},
	);
	const symbol = resistor(2);
	const attribute = applySelectionEdit(
		{ kind: "symbol-attribute", attribute: "value", value: "10k" },
		context([symbol, rectangle]),
	);
	assert.deepEqual(attribute, {
		// Shapes that are not symbols pass through unchanged.
		replacements: [
			{ ...symbol, attributes: { ...symbol.attributes, value: "10k" } },
			rectangle,
		],
		label: "Change symbol value",
	});
	assert.deepEqual(
		applySelectionEdit(
			{ kind: "net-symbol", netSymbol: true },
			context([symbol, rectangle]),
		),
		{
			replacements: [normalizeNetSymbol({ ...symbol, netSymbol: true })],
			label: "Change net symbol",
		},
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
		return {
			replacements: [replaceSymbolChild(symbol, child.key, edited)],
			label: "Edit symbol child",
		};
	};

	assert.deepEqual(
		applySelectionEdit(
			{ kind: "attribute", attribute: "width", value: 40 },
			childContext(border),
		),
		expected(border, editShapeAttribute(border.shape, "width", 40)),
	);
	assert.ok(border.shape.kind === "rectangle");
	assert.deepEqual(
		applySelectionEdit(
			{ kind: "line-style", lineStyle: "dashed" },
			childContext(border),
		),
		expected(border, { ...border.shape, lineStyle: "dashed" }),
	);
	assert.deepEqual(
		applySelectionEdit({ kind: "lock", locked: true }, childContext(border)),
		expected(border, { ...border.shape, locked: true }),
	);
	assert.ok(label.shape.kind === "text");
	assert.deepEqual(
		applySelectionEdit({ kind: "text", text: "Board" }, childContext(label)),
		expected(label, updateText(label.shape, "Board", measureText)),
	);
	assert.deepEqual(
		applySelectionEdit(
			{
				kind: "text-alignment",
				alignment: { horizontalAlign: "center", verticalAlign: "middle" },
			},
			childContext(label),
		),
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
		),
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

test("pin edits reach a selected pin child of a symbol", () => {
	const symbol = resistor(5);
	const pinChild = symbolChildren(symbol).find(
		(child) => child.shape.kind === "pin",
	);
	assert.ok(pinChild && pinChild.shape.kind === "pin");
	const withChild = context([symbol], { child: { symbol, child: pinChild } });
	assert.deepEqual(
		applySelectionEdit(
			{ kind: "pin", attribute: "name", value: "A" },
			withChild,
		),
		{
			replacements: [
				replaceSymbolChild(symbol, pinChild.key, {
					...pinChild.shape,
					name: "A",
				}),
			],
			label: "Edit symbol child",
		},
	);
	assert.deepEqual(
		applySelectionEdit(
			{ kind: "pin", attribute: "showName", value: false },
			withChild,
		),
		{
			replacements: [
				replaceSymbolChild(symbol, pinChild.key, {
					...pinChild.shape,
					showName: false,
				}),
			],
			label: "Edit symbol child",
		},
	);
});

test("edits with no matching shapes still commit an empty replacement list", () => {
	// The editor commits these so the selection and preview reset as before.
	assert.deepEqual(
		applySelectionEdit(
			{ kind: "text-alignment", alignment: { horizontalAlign: "left" } },
			context([rectangle]),
		),
		{
			replacements: [],
			label: "Align text",
		},
	);
	assert.deepEqual(
		applySelectionEdit(
			{ kind: "line-style", lineStyle: "dashed" },
			context([text]),
		),
		{
			replacements: [],
			label: "Change line style",
		},
	);
	assert.deepEqual(
		applySelectionEdit(
			{ kind: "net-symbol", netSymbol: true },
			context([rectangle]),
		),
		{
			replacements: [],
			label: "Change net symbol",
		},
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
	assert.deepEqual(edit, {
		replacements: [setSymbolLabelPosition(power, "name", "left")],
		label: "Position label",
	});
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

test("symbol-level edits made while a child is selected still change the parent symbol", () => {
	const symbol: EditorSymbol = box(4);
	const [child] = symbolChildren(symbol);
	const withChild = context([symbol], { child: { symbol, child } });
	assert.deepEqual(
		applySelectionEdit(
			{ kind: "symbol-attribute", attribute: "name", value: "Panel" },
			withChild,
		),
		applySelectionEdit(
			{ kind: "symbol-attribute", attribute: "name", value: "Panel" },
			context([symbol]),
		),
	);
	assert.deepEqual(
		applySelectionEdit({ kind: "net-symbol", netSymbol: true }, withChild),
		applySelectionEdit(
			{ kind: "net-symbol", netSymbol: true },
			context([symbol]),
		),
	);
	assert.equal(
		applySelectionEdit({ kind: "label-role", role: "net" }, withChild),
		undefined,
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
	assert.equal(edit?.label, "Reset text position");
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
