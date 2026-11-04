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
import {
	type DrawingSnapshot,
	DrawingStore,
} from "#/commands/drawing-store.ts";
import { electricalNets } from "#/drawing/named-nets.ts";
import {
	drawingShapeSchema,
	legacyDrawingShapeSchema,
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
export const getDrawingInputSchema = z.strictObject({
	offset: z
		.number()
		.int()
		.nonnegative()
		.safe()
		.optional()
		.describe(
			"Index of the first shape to return. Passing offset or limit reads one page; continue from page.nextOffset until it is absent.",
		),
	limit: z
		.number()
		.int()
		.positive()
		.safe()
		.optional()
		.describe(
			"Maximum shapes in this page. A page also stops early to stay within the reply size limit.",
		),
});

/** The web relay refuses a larger editor acknowledgement, which carries one reply. */
export const drawingAcknowledgementByteLimit = 8 * 1024 * 1024;
/** Every reply fits in one acknowledgement, with room left for its envelope. */
export const drawingReplyByteLimit = 6 * 1024 * 1024;

/** Only resolved document operations cross the bridge. No tool or pointer state. */
export const drawingOperationSchema = z.discriminatedUnion("type", [
	getDrawingInputSchema.extend({ type: z.literal("getDrawing") }),
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
	// A drawing may still hold legacy diagonal wires; edits use the strict schemas.
	shapes: z.array(legacyDrawingShapeSchema),
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

const count = z.number().int().nonnegative().safe();

export const drawingSuccessReplySchema = z.strictObject({
	ok: z.literal(true),
	/** Only `getDrawing` returns shapes; edits stay small however large the drawing is. */
	drawing: drawingStateSchema.optional(),
	page: z
		.strictObject({
			offset: count,
			count,
			total: count,
			nextOffset: count.optional(),
		})
		.optional(),
	summary: z.strictObject({
		shapeCount: count,
		nextShapeId: shapeId,
		historyId,
	}),
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

const netsBySnapshot = new WeakMap<
	DrawingSnapshot,
	ReturnType<typeof electricalNets>
>();

function snapshotNets(snapshot: DrawingSnapshot) {
	const cached = netsBySnapshot.get(snapshot);
	if (cached) return cached;
	const nets = electricalNets(snapshot.shapes);
	for (const net of nets) {
		Object.freeze(net.names);
		Object.freeze(net.wires);
		Object.freeze(net.labels);
		for (const pin of net.pins) Object.freeze(pin);
		Object.freeze(net.pins);
		Object.freeze(net);
	}
	Object.freeze(nets);
	netsBySnapshot.set(snapshot, nets);
	return nets;
}

/** UTF-8 length, counting each surrogate half as three bytes, which only overestimates. */
export function utf8ByteLength(text: string) {
	// biome-ignore lint/suspicious/noControlCharactersInRegex: the ASCII range starts at NUL.
	if (!/[^\u0000-\u007f]/.test(text)) return text.length;
	let bytes = text.length;
	for (let index = 0; index < text.length; index++) {
		const code = text.charCodeAt(index);
		if (code >= 0x80) bytes += code >= 0x800 ? 2 : 1;
	}
	return bytes;
}

// Committed shapes, shape lists and nets are frozen, so a measured size stays
// valid, and repeated reads of a snapshot only measure its history.
const jsonBytes = new WeakMap<object, number>();

function cachedJsonBytes(
	value: object,
	measure = () => utf8ByteLength(JSON.stringify(value)),
) {
	let bytes = jsonBytes.get(value);
	if (bytes === undefined) {
		bytes = measure();
		jsonBytes.set(value, bytes);
	}
	return bytes;
}

/** The JSON size of `shapes`, measured from its shapes so pages reuse them. */
function shapesJsonBytes(shapes: DrawingSnapshot["shapes"]) {
	return cachedJsonBytes(shapes, () => {
		let bytes = 2 + Math.max(shapes.length - 1, 0);
		for (const shape of shapes) bytes += cachedJsonBytes(shape);
		return bytes;
	});
}

type DrawingSuccessReply = z.infer<typeof drawingSuccessReplySchema>;

const tooLarge = (message: string) =>
	({
		ok: false,
		error: { code: "DrawingTooLarge", message },
	}) as const;

function summary(snapshot: DrawingSnapshot): DrawingSuccessReply["summary"] {
	return {
		shapeCount: snapshot.shapes.length,
		nextShapeId: snapshot.nextShapeId,
		historyId: snapshot.history.currentId,
	};
}

function readDrawing(
	snapshot: DrawingSnapshot,
	{ offset, limit }: z.infer<typeof getDrawingInputSchema>,
	byteLimit: number,
): DrawingReply {
	const paged = offset !== undefined || limit !== undefined;
	const total = snapshot.shapes.length;
	const start = Math.min(offset ?? 0, total);
	const end = Math.min(total, start + (limit ?? total));
	const nets = start === 0 ? snapshotNets(snapshot) : undefined;
	const header = {
		ok: true,
		drawing: {
			shapes: [] as DrawingSnapshot["shapes"][number][],
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
		// The largest values each field can take, so the final page is no longer.
		...(paged
			? {
					page: { offset: start, count: end - start, total, nextOffset: total },
				}
			: {}),
		summary: summary(snapshot),
	} satisfies DrawingSuccessReply;
	let remaining =
		byteLimit -
		utf8ByteLength(JSON.stringify(header)) -
		(nets ? ',"nets":'.length + cachedJsonBytes(nets) : 0);
	const reply = (shapes: DrawingSnapshot["shapes"]) => ({
		...header,
		drawing: { ...header.drawing, shapes, ...(nets ? { nets } : {}) },
	});
	if (!paged) {
		if (shapesJsonBytes(snapshot.shapes) - 2 <= remaining)
			return reply(snapshot.shapes);
		return tooLarge(
			`The drawing's ${total} shapes do not fit in one ${byteLimit}-byte reply. Call getDrawing with offset 0 to read it in pages.`,
		);
	}
	let stop = start;
	while (stop < end) {
		const bytes =
			cachedJsonBytes(snapshot.shapes[stop]) + (stop > start ? 1 : 0);
		if (bytes > remaining) break;
		remaining -= bytes;
		stop++;
	}
	if (stop === start && start < end)
		return tooLarge(
			remaining < 0
				? `The drawing's history and nets alone exceed the ${byteLimit}-byte reply limit.`
				: `The shape at offset ${start} exceeds the ${byteLimit}-byte reply limit.`,
		);
	return {
		...reply(snapshot.shapes.slice(start, stop)),
		page: {
			offset: start,
			count: stop - start,
			total,
			...(stop < total ? { nextOffset: stop } : {}),
		},
	};
}

/**
 * The browser and headless callers provide their store at the execution boundary.
 * Edits reply with their result and a summary, never the drawing, so a committed
 * edit is always acknowledged. Reads that do not fit `byteLimit` fail or page.
 */
export function executeDrawingOperation(
	operation: DrawingOperation,
	byteLimit = drawingReplyByteLimit,
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
		if (operation.type === "getDrawing")
			return readDrawing(snapshot, operation, byteLimit);
		if (!result.right) return { ok: true, summary: summary(snapshot) } as const;
		const ids = result.right.ids;
		const listed = new Set(ids);
		// The command's mapping covers every shape; unchanged, unlisted IDs are implied.
		const idMap: Record<string, number> = {};
		for (const [from, to] of result.right.idMap)
			if (from !== to || listed.has(from)) idMap[from] = to;
		return {
			ok: true,
			summary: summary(snapshot),
			result: { ids, idMap },
		} as const;
	});
}
