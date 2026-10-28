import { z } from "zod";
import {
	horizontalAlignments,
	verticalAlignments,
} from "#/drawing/text-alignment.ts";

const textAlignmentFields = {
	horizontalAlign: z.enum(horizontalAlignments).optional(),
	verticalAlign: z.enum(verticalAlignments).optional(),
};

import { lineStyles } from "#/drawing/line-style.ts";

export const shapeId = z.number().int().positive().safe();
const geometryFields = {
	locked: z.boolean().optional(),
	x: z.number().describe("Shape center X in millimetres."),
	y: z
		.number()
		.describe("Shape center Y in millimetres; positive Y points up."),
	width: z
		.number()
		.nonnegative()
		.describe(
			"Final width in millimetres. Only a collapsed wire may have zero width.",
		),
	height: z.number().positive().describe("Final height in millimetres."),
	rotation: z.number().describe("Final rotation in radians."),
	lineWidth: z.number().positive().describe("Stroke width in millimetres."),
};

export const rectangleInputSchema = z.strictObject({
	filled: z.boolean().optional(),
	...geometryFields,
	lineStyle: z.enum(lineStyles).optional(),
	width: geometryFields.width.positive(),
});

const primitiveInputSchema = z.strictObject({
	filled: z.boolean().optional(),
	...geometryFields,
	lineStyle: z.enum(lineStyles).optional(),
	kind: z.enum(["rectangle", "circle", "triangle", "line", "wire"]),
});
const primitiveShapeSchema = primitiveInputSchema.extend({ id: shapeId });
const pinInputSchema = z.strictObject({
	...geometryFields,
	kind: z.literal("pin"),
	name: z.string().default("").describe("Pin name, such as VCC or GND."),
	number: z.string().default("").describe("Pin number, such as 1, 01 or A1."),
	length: z.number().min(0).max(1000).optional(),
	labelOffset: z.number().min(-1000).max(1000).optional(),
	showLabels: z.boolean().optional(),
	showName: z.boolean().optional(),
	showNumber: z.boolean().optional(),
});
const pinShapeSchema = pinInputSchema.extend({ id: shapeId });
const textInputSchema = z.strictObject({
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
});
export const symbolChildOverridesSchema = z.record(
	z.string().regex(/^(shape:[1-9]\d*|attribute:(name|reference|value))$/),
	z.strictObject({
		x: z.number().optional(),
		y: z.number().optional(),
		width: z.number().nonnegative().optional(),
		height: z.number().positive().optional(),
		rotation: z.number().optional(),
		lineWidth: z.number().nonnegative().optional(),
		fontSize: z.number().positive().optional(),
		text: z.string().optional(),
		name: z.string().optional(),
		number: z.string().optional(),
		showLabels: z.boolean().optional(),
		showName: z.boolean().optional(),
		showNumber: z.boolean().optional(),
		length: z.number().min(0).max(1000).optional(),
		locked: z.boolean().optional(),
		lineStyle: z.enum(lineStyles).optional(),
		...textAlignmentFields,
	}),
);
const symbolInputSchema = z.strictObject({
	...geometryFields,
	kind: z.literal("symbol"),
	definitionId: z.string(),
	library: z
		.strictObject({ scope: z.enum(["user", "project"]), id: z.string().min(1) })
		.optional(),
	strokeOverride: z.number().positive().optional(),
	childOverrides: symbolChildOverridesSchema.optional(),
	textAlignments: z
		.strictObject({
			name: z.strictObject(textAlignmentFields).optional(),
			reference: z.strictObject(textAlignmentFields).optional(),
			value: z.strictObject(textAlignmentFields).optional(),
		})
		.optional(),
	textPositions: z
		.strictObject({
			name: z.strictObject({ x: z.number(), y: z.number() }).optional(),
			reference: z.strictObject({ x: z.number(), y: z.number() }).optional(),
			value: z.strictObject({ x: z.number(), y: z.number() }).optional(),
		})
		.optional()
		.describe(
			"Instance label anchors in millimetres relative to the symbol center, before rotation.",
		),
	children: z
		.array(
			z.discriminatedUnion("kind", [
				primitiveShapeSchema,
				pinShapeSchema,
				textInputSchema.extend({ id: shapeId }),
			]),
		)
		.describe(
			"Primitive shapes in coordinates relative to the symbol center, with IDs local to this symbol.",
		)
		.default([]),
	texts: z
		.array(
			z.strictObject({
				attribute: z.enum(["name", "reference", "value"]),
				locked: z.boolean().optional(),
				...textAlignmentFields,
				x: z.number(),
				y: z.number(),
				fontSize: z.number().positive(),
			}),
		)
		.describe(
			"Attribute labels in coordinates relative to the symbol center, in millimetres.",
		)
		.default([]),
	attributes: z.strictObject({
		name: z.string(),
		reference: z.string(),
		value: z.string(),
	}),
});

export const shapeInputSchema = z
	.discriminatedUnion("kind", [
		primitiveInputSchema,
		pinInputSchema,
		textInputSchema,
		symbolInputSchema,
	])
	.refine(
		(shape) =>
			shape.kind !== "symbol" ||
			shape.library !== undefined ||
			shape.children.length > 0,
		"Symbols require a library reference or legacy inline geometry.",
	);
export const drawingShapeSchema = z
	.discriminatedUnion("kind", [
		primitiveShapeSchema,
		pinShapeSchema,
		textInputSchema.extend({ id: shapeId }),
		symbolInputSchema.extend({ id: shapeId }),
	])
	.refine(
		(shape) =>
			shape.kind !== "symbol" ||
			shape.library !== undefined ||
			shape.children.length > 0,
		"Symbols require a library reference or legacy inline geometry.",
	);
