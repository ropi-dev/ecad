import { Effect, Either } from "effect";
import { z } from "zod";
import {
	type CommandResult,
	type InvalidDrawingCommand,
	jumpHistoryEffect,
	placeRectangleEffect,
	placeShapesEffect,
	redoEffect,
	removeShapesEffect,
	replaceShapesEffect,
	undoEffect,
} from "#/commands/drawing-commands.ts";
import { DrawingStore } from "#/commands/drawing-store.ts";

const shapeId = z.number().int().positive().safe();
const historyId = z.number().int().nonnegative().safe();
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
	kind: z.enum(["rectangle", "circle", "triangle", "wire", "pin"]),
});
const primitiveShapeSchema = primitiveInputSchema.extend({ id: shapeId });
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
	children: z
		.array(primitiveShapeSchema)
		.min(1)
		.describe(
			"Primitive shapes in coordinates relative to the symbol center, with IDs local to this symbol.",
		),
	attributes: z.strictObject({
		name: z.string(),
		reference: z.string(),
		value: z.string(),
	}),
});

export const shapeInputSchema = z.discriminatedUnion("kind", [
	primitiveInputSchema,
	textInputSchema,
	symbolInputSchema,
]);
export const drawingShapeSchema = z.discriminatedUnion("kind", [
	primitiveShapeSchema,
	textInputSchema.extend({ id: shapeId }),
	symbolInputSchema.extend({ id: shapeId }),
]);

export const placeShapesInputSchema = z.strictObject({
	shapes: z
		.array(shapeInputSchema)
		.describe(
			"Complete shapes without top-level IDs; the drawing allocates IDs.",
		),
	label: z
		.string()
		.optional()
		.describe("Optional label for this one history transaction."),
});
export const replaceShapesInputSchema = z.strictObject({
	shapes: z
		.array(drawingShapeSchema)
		.describe("Complete replacement geometry for existing explicit shape IDs."),
	label: z.string().optional(),
	targetIds: z
		.array(shapeId)
		.optional()
		.describe(
			"Existing IDs to retain preferentially when connected wires merge.",
		),
});
export const removeShapesInputSchema = z.strictObject({
	ids: z.array(shapeId).describe("Explicit existing shape IDs to remove."),
	label: z.string().optional(),
});
export const jumpHistoryInputSchema = z.strictObject({ id: historyId });

/** Only resolved document operations cross the bridge. No tool or pointer state. */
export const drawingOperationSchema = z.discriminatedUnion("type", [
	z.strictObject({ type: z.literal("getDrawing") }),
	z.strictObject({
		type: z.literal("placeRectangle"),
		input: rectangleInputSchema,
	}),
	placeShapesInputSchema.extend({ type: z.literal("placeShapes") }),
	replaceShapesInputSchema.extend({ type: z.literal("replaceShapes") }),
	removeShapesInputSchema.extend({ type: z.literal("removeShapes") }),
	z.strictObject({ type: z.literal("undo") }),
	z.strictObject({ type: z.literal("redo") }),
	jumpHistoryInputSchema.extend({ type: z.literal("jumpHistory") }),
]);
export type DrawingOperation = z.infer<typeof drawingOperationSchema>;

export const drawingEnvelopeSchema = z.strictObject({
	requestId: z.string().min(1),
	expiresAt: z.number().int().nonnegative().safe(),
	operation: drawingOperationSchema,
});
export type DrawingEnvelope = z.infer<typeof drawingEnvelopeSchema>;

const drawingStateSchema = z.strictObject({
	shapes: z.array(drawingShapeSchema),
	nextShapeId: shapeId,
	history: z.strictObject({
		currentId: historyId,
		nodes: z.array(
			z.strictObject({
				id: historyId,
				parentId: historyId.nullable(),
				childIds: z.array(historyId),
				preferredChildId: historyId.nullable(),
				label: z.string(),
			}),
		),
	}),
});

export const drawingSuccessReplySchema = z.strictObject({
	ok: z.literal(true),
	drawing: drawingStateSchema,
	result: z
		.strictObject({
			ids: z.array(shapeId),
			idMap: z.record(z.string(), shapeId),
		})
		.optional(),
});
export const drawingFailureReplySchema = z.strictObject({
	ok: z.literal(false),
	error: z.strictObject({ code: z.string().min(1), message: z.string() }),
});
export const drawingReplySchema = z.discriminatedUnion("ok", [
	drawingSuccessReplySchema,
	drawingFailureReplySchema,
]);
export type DrawingReply = z.infer<typeof drawingReplySchema>;

function operationEffect(
	operation: DrawingOperation,
): Effect.Effect<
	CommandResult | undefined,
	InvalidDrawingCommand,
	DrawingStore
> {
	switch (operation.type) {
		case "getDrawing":
			return Effect.succeed(undefined);
		case "placeRectangle":
			return placeRectangleEffect(operation.input);
		case "placeShapes":
			return placeShapesEffect(
				operation.shapes,
				operation.label ?? "Place shapes",
			);
		case "replaceShapes":
			return replaceShapesEffect(
				operation.shapes,
				operation.label ?? "Replace shapes",
				operation.targetIds,
			);
		case "removeShapes":
			return removeShapesEffect(
				operation.ids,
				operation.label ?? "Remove shapes",
			);
		case "undo":
			return undoEffect.pipe(Effect.as(undefined));
		case "redo":
			return redoEffect.pipe(Effect.as(undefined));
		case "jumpHistory":
			return jumpHistoryEffect(operation.id).pipe(Effect.as(undefined));
	}
}

/** The browser and headless callers provide their store at the execution boundary. */
export function executeDrawingOperation(
	operation: DrawingOperation,
): Effect.Effect<DrawingReply, never, DrawingStore> {
	const program = operationEffect(operation);
	return Effect.gen(function* () {
		const store = yield* DrawingStore;
		const result = yield* Effect.either(program);
		if (Either.isLeft(result)) {
			return {
				ok: false,
				error: { code: result.left._tag, message: result.left.message },
			} as const;
		}
		const snapshot = store.getSnapshot();
		return {
			ok: true,
			drawing: {
				shapes: snapshot.shapes,
				nextShapeId: snapshot.nextShapeId,
				history: {
					currentId: snapshot.history.currentId,
					nodes: Object.values(snapshot.history.nodes).map((node) => ({
						id: node.id,
						parentId: node.parentId,
						childIds: [...node.childIds],
						preferredChildId: node.preferredChildId,
						label: node.label,
					})),
				},
			},
			...(result.right
				? {
						result: {
							ids: result.right.ids,
							idMap: Object.fromEntries(result.right.idMap),
						},
					}
				: {}),
		} as const;
	});
}
