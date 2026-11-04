import { z } from "zod";
import { lineStyles } from "#/drawing/line-style.ts";
import {
	electricalLabelRoles,
	fillableShapeKinds,
	type SymbolAttribute,
	symbolAttributes,
} from "#/drawing/shape-kinds.ts";
import { normalizeNetSymbol } from "#/drawing/shapes.ts";
import { symbolLibraryScopes } from "#/drawing/symbol-reference.ts";
import {
	horizontalAlignments,
	verticalAlignments,
} from "#/drawing/text-alignment.ts";

/*
 * The shape types at the end of this file are inferred from these schemas.
 * Each shape has up to three variants built from the same fields:
 * - input (`shapeInputSchema`): no top-level ID; commands allocate it.
 * - editor (`editorShapeSchema`): a shape in memory. Commands validate with it.
 * - saved (`drawingShapeSchema`): a file or transfer may omit pin names and
 *   symbol children or texts, so defaults fill them in.
 */

const textAlignmentFields = {
	horizontalAlign: z.enum(horizontalAlignments).optional(),
	verticalAlign: z.enum(verticalAlignments).optional(),
};
const lineStyle = z.enum(lineStyles).optional();
const point = z.strictObject({ x: z.number(), y: z.number() });
const pinLength = z.number().min(0).max(1000);

/** One field per symbol attribute, such as name, reference and value. */
function perAttribute<T extends z.ZodType>(value: T) {
	return Object.fromEntries(
		symbolAttributes.map((attribute) => [attribute, value]),
	) as Record<SymbolAttribute, T>;
}

export const shapeId = z.number().int().positive().safe();
const geometryFields = {
	locked: z.boolean().optional(),
	x: z.number().describe("Shape center X in millimetres."),
	y: z
		.number()
		.describe("Shape center Y in millimetres; positive Y points up."),
	width: z.number().positive().describe("Final width in millimetres."),
	height: z.number().positive().describe("Final height in millimetres."),
	rotation: z.number().describe("Final rotation in radians."),
	lineWidth: z.number().positive().describe("Stroke width in millimetres."),
};

const fillableShapeFields = {
	filled: z.boolean().optional(),
	...geometryFields,
	lineStyle,
	kind: z.enum(fillableShapeKinds),
};
const lineShapeFields = {
	...geometryFields,
	lineStyle,
	kind: z.literal("line"),
};
const wireShapeFields = {
	...geometryFields,
	width: z
		.number()
		.nonnegative()
		.describe(
			"Final length in millimetres. A collapsed wire may have zero length.",
		),
	kind: z.literal("wire"),
};
const pinShapeFields = {
	...geometryFields,
	kind: z.literal("pin"),
	name: z.string().describe("Pin name, such as VCC or GND."),
	number: z.string().describe("Pin number, such as 1, 01 or A1."),
	length: pinLength.optional(),
	labelOffset: z.number().min(-1000).max(1000).optional(),
	showLabels: z.boolean().optional(),
	showName: z.boolean().optional(),
	showNumber: z.boolean().optional(),
};
const savedPinFields = {
	...pinShapeFields,
	name: pinShapeFields.name.default(""),
	number: pinShapeFields.number.default(""),
};
/** Text fields that symbol children share with standalone text. */
const plainTextFields = {
	...geometryFields,
	kind: z.literal("text"),
	...textAlignmentFields,
	text: z.string(),
	fontSize: z
		.number()
		.positive()
		.describe(
			"Font size in millimetres; width and height must already be measured.",
		),
	bold: z.boolean().optional(),
};
const textShapeFields = {
	circuitNet: z
		.strictObject({
			id: z.string().min(1).max(200),
			label: z.string(),
			pinId: z.string().min(1).max(200).optional(),
		})
		.optional(),
	electrical: z
		.enum(electricalLabelRoles)
		.optional()
		.describe(
			"Electrical label role. text is the drawing-wide, case-sensitive net name; x and y are the connection anchor. Omit for ordinary text.",
		),
	...plainTextFields,
};

const roundCircle = (shape: { kind: string; width: number; height: number }) =>
	shape.kind !== "circle" || Math.abs(shape.width - shape.height) <= 1e-9;
const roundCircleError = {
	error: "A circle must have equal width and height.",
};
const orthogonalWire = (wire: { rotation: number }) =>
	Math.abs(Math.sin(2 * wire.rotation)) <= 1e-9;
const orthogonalWireError = {
	error: "Wire segments must be horizontal or vertical.",
};

const fillableInputSchema = z
	.strictObject(fillableShapeFields)
	.refine(roundCircle, roundCircleError);
const fillableShapeSchema = z
	.strictObject({ ...fillableShapeFields, id: shapeId })
	.refine(roundCircle, roundCircleError);
const lineInputSchema = z.strictObject(lineShapeFields);
const lineShapeSchema = z.strictObject({ ...lineShapeFields, id: shapeId });
const wireInputSchema = z
	.strictObject(wireShapeFields)
	.refine(orthogonalWire, orthogonalWireError);
const wireShapeSchema = z
	.strictObject({ ...wireShapeFields, id: shapeId })
	.refine(orthogonalWire, orthogonalWireError);
/**
 * Only drawing wires form nets, and those must be horizontal or vertical.
 * Symbol wires are artwork: symbol files may draw them at any angle. Saved
 * drawings may also hold legacy diagonal wires (`legacyDrawingShapeSchema`).
 */
const symbolWireSchema = z.strictObject({ ...wireShapeFields, id: shapeId });
const pinInputSchema = z.strictObject(savedPinFields);
const pinShapeSchema = z.strictObject({ ...pinShapeFields, id: shapeId });
const savedPinSchema = z.strictObject({ ...savedPinFields, id: shapeId });
const textInputSchema = z.strictObject(textShapeFields);
const textShapeSchema = z.strictObject({ ...textShapeFields, id: shapeId });
const symbolChildTextSchema = z.strictObject(
	{ ...plainTextFields, id: shapeId },
	{
		error: (issue) =>
			issue.code === "unrecognized_keys" &&
			issue.keys.some((key) => key === "electrical" || key === "circuitNet")
				? "Electrical labels must remain standalone drawing items."
				: undefined,
	},
);

const unknownKind = {
	error: (issue: { code?: string }) =>
		issue.code === "invalid_union"
			? "A supported shape kind is required."
			: undefined,
};
export const symbolChildSchema = z.discriminatedUnion(
	"kind",
	[
		fillableShapeSchema,
		lineShapeSchema,
		symbolWireSchema,
		pinShapeSchema,
		symbolChildTextSchema,
	],
	unknownKind,
);
const savedSymbolChildSchema = z.discriminatedUnion(
	"kind",
	[
		fillableShapeSchema,
		lineShapeSchema,
		symbolWireSchema,
		savedPinSchema,
		symbolChildTextSchema,
	],
	unknownKind,
);

/**
 * Instance edits to one child, keyed `shape:<id>` or `attribute:<name>`.
 * Symbol files use the same schema and limits as drawings. Coordinates and
 * sizes have no upper bound, because earlier versions saved drawings without
 * one. Sizes and strokes must be positive: a zero size draws nothing and
 * cannot be selected.
 */
const overrideCoordinate = z.number();
const overrideSize = z
	.number()
	.positive({ error: "Sizes and strokes must be greater than zero." });
export const symbolChildOverrideSchema = z.strictObject({
	x: overrideCoordinate.optional(),
	y: overrideCoordinate.optional(),
	width: overrideSize.optional(),
	height: overrideSize.optional(),
	rotation: z.number().optional(),
	lineWidth: overrideSize.optional(),
	fontSize: overrideSize.optional(),
	text: z.string().optional(),
	name: z.string().optional(),
	number: z.string().optional(),
	showLabels: z.boolean().optional(),
	showName: z.boolean().optional(),
	showNumber: z.boolean().optional(),
	length: pinLength.optional(),
	locked: z.boolean().optional(),
	lineStyle,
	...textAlignmentFields,
});
export const symbolChildOverridesSchema = z.record(
	z
		.string()
		.regex(
			new RegExp(
				`^(shape:[1-9]\\d*|attribute:(${symbolAttributes.join("|")}))$`,
			),
		),
	symbolChildOverrideSchema,
);

const symbolTextSchema = z.strictObject({
	attribute: z.enum(symbolAttributes),
	locked: z.boolean().optional(),
	...textAlignmentFields,
	x: z.number(),
	y: z.number(),
	fontSize: z.number().positive(),
});
const childrenDescription =
	"Primitive shapes in coordinates relative to the symbol center, with IDs local to this symbol.";
const symbolShapeFields = {
	...geometryFields,
	kind: z.literal("symbol"),
	definitionId: z.string(),
	netSymbol: z.boolean().optional(),
	kicad: z
		.strictObject({
			libraryId: z.string().min(1),
			unit: z.number().int().nonnegative(),
		})
		.optional(),
	library: z
		.strictObject({
			scope: z.enum(symbolLibraryScopes),
			id: z.string().min(1),
		})
		.optional(),
	strokeOverride: z.number().positive().optional(),
	childOverrides: symbolChildOverridesSchema.optional(),
	textAlignments: z
		.strictObject(perAttribute(z.strictObject(textAlignmentFields).optional()))
		.optional(),
	textPositions: z
		.strictObject(perAttribute(point.optional()))
		.optional()
		.describe(
			"Instance label anchors in millimetres relative to the symbol center, before rotation.",
		),
	children: z.array(symbolChildSchema).describe(childrenDescription),
	texts: z
		.array(symbolTextSchema)
		.describe(
			"Attribute labels in coordinates relative to the symbol center, in millimetres.",
		),
	attributes: z.strictObject(perAttribute(z.string())),
};
const savedSymbolFields = {
	...symbolShapeFields,
	children: z
		.array(savedSymbolChildSchema)
		.describe(childrenDescription)
		.default([]),
	texts: symbolShapeFields.texts.default([]),
};
const symbolInputObject = z.strictObject(savedSymbolFields);

/** Rules that span fields, including each child with its override applied. */
function checkSymbol(
	symbol: z.output<typeof symbolInputObject>,
	context: z.RefinementCtx,
) {
	if (symbol.library === undefined && symbol.children.length === 0)
		context.addIssue({
			code: "custom",
			message: "Symbols require a library reference or inline geometry.",
		});
	const ids = new Set<number>();
	for (const [index, child] of symbol.children.entries()) {
		if (ids.has(child.id))
			context.addIssue({
				code: "custom",
				message: `Duplicate shape ID ${child.id}.`,
				path: ["children", index, "id"],
			});
		ids.add(child.id);
		const key = `shape:${child.id}`;
		const override = symbol.childOverrides?.[key];
		// An override that fails on its own already has its issue reported.
		if (!override || !symbolChildOverrideSchema.safeParse(override).success)
			continue;
		const merged = symbolChildSchema.safeParse({ ...child, ...override });
		for (const issue of merged.error?.issues ?? [])
			context.addIssue({
				code: "custom",
				message: issue.message,
				path: ["childOverrides", key, ...issue.path],
			});
	}
}
const symbolInputSchema = symbolInputObject.superRefine(checkSymbol);

/**
 * The overrides that still fit their children. Editing a library symbol can
 * renumber its children, so an instance override may name a child of another
 * kind. Applying it would produce an invalid child, so it is dropped.
 */
export function fittingChildOverrides(
	children: readonly z.output<typeof symbolChildSchema>[],
	overrides: Readonly<Record<string, SymbolChildOverride>>,
) {
	const byKey = new Map(children.map((child) => [`shape:${child.id}`, child]));
	const kept = Object.entries(overrides).filter(([key, override]) => {
		const child = byKey.get(key);
		return (
			!child || symbolChildSchema.safeParse({ ...child, ...override }).success
		);
	});
	return kept.length === Object.keys(overrides).length
		? overrides
		: Object.fromEntries(kept);
}
const symbolShapeSchema = z
	.strictObject({ ...symbolShapeFields, id: shapeId })
	.superRefine(checkSymbol);
const savedSymbolSchema = z
	.strictObject({ ...savedSymbolFields, id: shapeId })
	.superRefine(checkSymbol);

export const rectangleInputSchema = z.strictObject({
	filled: fillableShapeFields.filled,
	...geometryFields,
	lineStyle,
});

/** A complete shape without its top-level ID; commands allocate IDs. */
export const shapeInputSchema = z.discriminatedUnion(
	"kind",
	[
		fillableInputSchema,
		lineInputSchema,
		wireInputSchema,
		pinInputSchema,
		textInputSchema,
		symbolInputSchema,
	],
	unknownKind,
);
/** A shape in memory. Commands accept exactly the shapes this accepts. */
export const editorShapeSchema = z.discriminatedUnion(
	"kind",
	[
		fillableShapeSchema,
		lineShapeSchema,
		wireShapeSchema,
		pinShapeSchema,
		textShapeSchema,
		symbolShapeSchema,
	],
	unknownKind,
);
/** A saved or transferred shape. Parsing also normalizes legacy net symbols. */
export const drawingShapeSchema = z
	.discriminatedUnion(
		"kind",
		[
			fillableShapeSchema,
			lineShapeSchema,
			wireShapeSchema,
			savedPinSchema,
			textShapeSchema,
			savedSymbolSchema,
		],
		unknownKind,
	)
	.overwrite((shape) =>
		shape.kind === "symbol" ? normalizeNetSymbol(shape) : shape,
	);

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);
const overrideSizes = new Set(["width", "height", "lineWidth", "fontSize"]);

function upgradeSavedShape(shape: unknown): unknown {
	if (!isRecord(shape)) return shape;
	if (shape.kind === "wire") {
		const { filled: _filled, lineStyle: _lineStyle, ...wire } = shape;
		return wire;
	}
	if (shape.kind !== "symbol") return shape;
	return {
		...shape,
		...(Array.isArray(shape.children)
			? { children: shape.children.map(upgradeSavedShape) }
			: {}),
		...(isRecord(shape.childOverrides)
			? {
					childOverrides: Object.fromEntries(
						Object.entries(shape.childOverrides).map(([key, override]) => [
							key,
							isRecord(override)
								? Object.fromEntries(
										Object.entries(override).filter(
											([field, value]) =>
												!overrideSizes.has(field) ||
												typeof value !== "number" ||
												value > 0,
										),
									)
								: override,
						]),
					),
				}
			: {}),
	};
}

/**
 * Upgrades shapes saved by earlier versions before validation. They could save
 * fields that never had an effect: a fill or line style on a wire, and a zero
 * size in a child override, which drew nothing.
 */
export const upgradeSavedShapes = (shapes: unknown) =>
	Array.isArray(shapes) ? shapes.map(upgradeSavedShape) : shapes;

/**
 * Reads saved drawings, which may hold diagonal wires from before wires had to
 * be horizontal or vertical, such as KiCad imports from older versions. The
 * editor redraws them when it opens the drawing. Everything that creates or
 * edits shapes uses the strict schemas above.
 */
export const legacyDrawingShapeSchema = z
	.discriminatedUnion(
		"kind",
		[
			fillableShapeSchema,
			lineShapeSchema,
			symbolWireSchema,
			savedPinSchema,
			textShapeSchema,
			savedSymbolSchema,
		],
		unknownKind,
	)
	.overwrite((shape) =>
		shape.kind === "symbol" ? normalizeNetSymbol(shape) : shape,
	);

/** A saved drawing's shapes, upgraded from earlier versions where needed. */
export const savedDrawingShapesSchema = z.preprocess(
	upgradeSavedShapes,
	z.array(legacyDrawingShapeSchema),
);

export interface FillableShape extends z.output<typeof fillableShapeSchema> {}
export interface LineShape extends z.output<typeof lineShapeSchema> {}
export interface WireShape extends z.output<typeof wireShapeSchema> {}
export interface PinShape extends z.output<typeof pinShapeSchema> {}
export interface TextShape extends z.output<typeof textShapeSchema> {}
export interface SymbolText extends z.output<typeof symbolTextSchema> {}
export type SymbolChildOverride = z.output<typeof symbolChildOverrideSchema>;
export interface EditorSymbol extends z.output<typeof symbolShapeSchema> {}
export type RectangleInput = z.output<typeof rectangleInputSchema>;

export type BasicShape = FillableShape | LineShape;
export type PrimitiveShape = BasicShape | WireShape | PinShape;
export type SymbolShape = PrimitiveShape | TextShape;
export type EditorShape = SymbolShape | EditorSymbol;

export type Same<A, B> = [A] extends [B]
	? [B] extends [A]
		? true
		: false
	: false;
// The named unions must list every member, and every variant must agree.
true satisfies Same<z.output<typeof editorShapeSchema>, EditorShape>;
true satisfies Same<z.output<typeof drawingShapeSchema>, EditorShape>;
true satisfies Same<z.output<typeof legacyDrawingShapeSchema>, EditorShape>;
