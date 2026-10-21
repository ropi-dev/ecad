import { z } from "zod";

export const shapeId = z.number().int().positive().safe();
const geometryFields = {
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
	...geometryFields,
	width: geometryFields.width.positive(),
});

const primitiveInputSchema = z.strictObject({
	...geometryFields,
	kind: z.enum(["rectangle", "circle", "triangle", "line", "wire"]),
});
const primitiveShapeSchema = primitiveInputSchema.extend({ id: shapeId });
const pinInputSchema = z.strictObject({
	...geometryFields,
	kind: z.literal("pin"),
	name: z.string().default("").describe("Pin name, such as VCC or GND."),
});
const pinShapeSchema = pinInputSchema.extend({ id: shapeId });
const textInputSchema = z.strictObject({
	...geometryFields,
	kind: z.literal("text"),
	text: z.string(),
	fontSize: z
		.number()
		.positive()
		.describe(
			"Font size in millimetres; width and height must already be measured.",
		),
});
const symbolInputSchema = z.strictObject({
	...geometryFields,
	kind: z.literal("symbol"),
	definitionId: z.string(),
	library: z
		.strictObject({ scope: z.enum(["user", "project"]), id: z.string().min(1) })
		.optional(),
	strokeOverride: z.number().positive().optional(),
	children: z
		.array(z.discriminatedUnion("kind", [primitiveShapeSchema, pinShapeSchema]))
		.describe(
			"Primitive shapes in coordinates relative to the symbol center, with IDs local to this symbol.",
		)
		.default([]),
	texts: z
		.array(
			z.strictObject({
				attribute: z.enum(["name", "reference", "value"]),
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
