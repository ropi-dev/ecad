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
	rotateShapesEffect,
	undoEffect,
} from "#/commands/drawing-commands.ts";
import { DrawingStore } from "#/commands/drawing-store.ts";
import { electricalNets } from "#/drawing/named-nets.ts";
import {
	drawingShapeSchema,
	rectangleInputSchema,
	shapeId,
	shapeInputSchema,
} from "#/drawing/schema.ts";

export {
	drawingShapeSchema,
	rectangleInputSchema,
	shapeInputSchema,
} from "#/drawing/schema.ts";

const historyId = z.number().int().nonnegative().safe();

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
export const rotateShapesInputSchema = z.strictObject({
	ids: z
		.array(shapeId)
		.describe(
			"Explicit existing shape IDs to rotate around their own centers.",
		),
	angle: z
		.number()
		.optional()
		.describe(
			"Relative rotation in radians, positive counterclockwise. Defaults to pi/2. Wires require multiples of pi/2.",
		),
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
	rotateShapesInputSchema.extend({ type: z.literal("rotateShapes") }),
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
	nets: z
		.array(
			z.strictObject({
				names: z.array(z.string()),
				wires: z.array(shapeId),
				labels: z.array(shapeId),
				pins: z.array(z.strictObject({ shapeId, pinId: shapeId })),
			}),
		)
		.optional(),
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
		case "rotateShapes":
			return rotateShapesEffect(operation.ids, operation.angle);
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
				...(operation.type === "getDrawing"
					? { nets: electricalNets(snapshot.shapes) }
					: {}),
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
