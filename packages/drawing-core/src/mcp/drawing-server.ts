import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
	CallToolResult,
	ToolAnnotations,
} from "@modelcontextprotocol/sdk/types.js";
import { Effect } from "effect";
import { z } from "zod";
import { runEffect } from "#/lib/effect.ts";
import {
	type DrawingOperation,
	type DrawingReply,
	drawingFailureReplySchema,
	drawingReplySchema,
	drawingSuccessReplySchema,
	drawingToolResultByteLimit,
	getDrawingInputSchema,
	jumpHistoryInputSchema,
	moveShapesToPageInputSchema,
	placeShapesInputSchema,
	rectangleInputSchema,
	removeShapesInputSchema,
	replaceShapesInputSchema,
	rotateShapesInputSchema,
	setPagesInputSchema,
	setSheetInputSchema,
	utf8ByteLength,
} from "#/mcp/drawing-protocol.ts";

// MCP requires an object output schema. Clients validate structured errors too,
// so advertise both outcomes while retaining the strict union at validation.
const drawingToolReplySchema = drawingSuccessReplySchema
	.extend({
		ok: z.boolean(),
		summary: drawingSuccessReplySchema.shape.summary.optional(),
		error: drawingFailureReplySchema.shape.error.optional(),
	})
	.refine((value) => drawingReplySchema.safeParse(value).success, {
		message: "Expected a complete drawing success or failure reply.",
	});

// Edit replies never carry the drawing, so their size does not grow with it.
const replySummary =
	"a summary with shapeCount, nextShapeId and historyId. It has no shapes; call getDrawing to read committed geometry.";
const shapeEditReply = ` The reply has result.ids (the committed IDs of the affected shapes), result.idMap (source ID to committed ID for those shapes and for wires merged or renumbered; other IDs are unchanged) and ${replySummary}`;
const removeReply = ` The reply has result.ids, which is empty because removed shapes have no committed IDs, result.idMap (wires merged or renumbered by the removal; other IDs are unchanged) and ${replySummary}`;
const historyEditReply =
	" The reply has a summary with shapeCount, nextShapeId and historyId but no shapes; call getDrawing to read the restored drawing.";

/** The MCP result for a reply: structured content plus the same reply as JSON text. */
export function drawingToolResult(reply: DrawingReply): CallToolResult {
	return {
		content: [{ type: "text", text: JSON.stringify(reply) }],
		structuredContent: reply,
		...(reply.ok ? {} : { isError: true }),
	};
}

export interface DrawingMcpErrorLike {
	readonly message: string;
	readonly code?: string;
	readonly _tag?: string;
}

export const drawingPathSchema = z
	.string()
	.min(1)
	.describe(
		"Absolute path of the drawing file to read or edit, such as a .ecaddraw file or a drawing inside an ECAD project folder. A missing file reads as an empty drawing, and the first edit creates it in its existing folder.",
	);

/** The executor opens the drawing that each tool call's path names. */
export function createDrawingMcpServer<E extends DrawingMcpErrorLike>(
	execute: (
		operation: DrawingOperation,
		path: string,
	) => Effect.Effect<DrawingReply, E>,
) {
	const server = new McpServer({ name: "ecad-drawing", version: "1.0.0" });
	const call = async (
		operation: DrawingOperation,
		path: string,
		signal: AbortSignal,
	): Promise<CallToolResult> => {
		const reply = await runEffect(
			execute(operation, path).pipe(
				Effect.catchAll((error) =>
					Effect.succeed<DrawingReply>({
						ok: false,
						error: {
							code: error.code ?? error._tag ?? "DrawingBridgeError",
							message: error.message,
						},
					}),
				),
			),
			signal,
		);
		const result = drawingToolResult(reply);
		// Replies are sized to fit, but a larger result would close a stdio client.
		if (utf8ByteLength(JSON.stringify(result)) <= drawingToolResultByteLimit)
			return result;
		return drawingToolResult({
			ok: false,
			error: {
				code: "ReplyTooLarge",
				message:
					"The command ran, but its result was too large to return. Read the drawing with getDrawing before retrying.",
			},
		});
	};
	const tool = <S extends z.ZodObject>(
		name: string,
		{
			inputSchema,
			operation,
			...config
		}: {
			title: string;
			description: string;
			inputSchema: S;
			annotations: ToolAnnotations;
			operation: (input: z.infer<S>) => DrawingOperation;
		},
	) =>
		server.registerTool(
			name,
			{
				...config,
				inputSchema: z.strictObject({
					path: drawingPathSchema,
					...inputSchema.shape,
				}),
				outputSchema: drawingToolReplySchema,
			},
			(
				{ path, ...input }: Record<string, unknown>,
				{ signal }: { signal: AbortSignal },
			) => call(operation(input as z.infer<S>), path as string, signal),
		);
	const readOnly = {
		readOnlyHint: true,
		idempotentHint: true,
		openWorldHint: false,
	};
	const placement = {
		readOnlyHint: false,
		destructiveHint: false,
		idempotentHint: false,
		openWorldHint: false,
	};
	const edit = {
		readOnlyHint: false,
		destructiveHint: true,
		idempotentHint: false,
		openWorldHint: false,
	};

	tool("getDrawing", {
		title: "Read drawing",
		description:
			"Read the drawing's committed shapes, schematic pages, electrical nets, allocated IDs and history branches. drawing.pages lists the schematic pages in display order as { id, name }; a shape's page field names its page, and shapes on the first page omit it. drawing.sheet holds the paper size and title block that every page shares; it is absent while every field has its default. Wires and pins connect only on their own page, while a net in drawing.nets can span pages through net and supply labels with the same name. Positions are shape centers in millimetres with Cartesian positive Y up; rotations are radians. Temporary pointer previews, selection and the page open in the editor are not drawing data. Without offset or limit, a drawing too large for one tool result fails with DrawingTooLarge. Pass offset 0, and optionally limit, to read drawing.shapes in chunks; the reply's page field describes the chunk, not a schematic page. Continue from page.nextOffset until it is absent, passing the revision from the first chunk with every later chunk. If the drawing changed in between, the call fails with DrawingChanged; read again from offset 0. Only the chunk at offset 0 includes nets.",
		inputSchema: getDrawingInputSchema,
		annotations: readOnly,
		operation: (input) => ({ type: "getDrawing", ...input }),
	});
	tool("placeRectangle", {
		title: "Place rectangle",
		description:
			"Place one rectangle with its complete final geometry in the drawing. Supply center x/y, width, height and lineWidth in millimetres and rotation in radians. Positive Y points up. Optional page is a schematic page ID from getDrawing; without it the rectangle goes on the first page. This command commits immediately as one undo step; it does not activate a drawing tool or wait for pointer input." +
			shapeEditReply,
		inputSchema: rectangleInputSchema,
		annotations: placement,
		operation: (input) => ({ type: "placeRectangle", input }),
	});
	tool("placeShapes", {
		title: "Place shapes",
		description:
			"Place complete rectangles, circles, triangles, lines at any angle, orthogonal wires, pins, text or symbols as one undo step. Top-level IDs are allocated by the drawing. Supply final center coordinates and dimensions in millimetres and rotation in radians. Text dimensions must already be measured; symbol children use local coordinates and their own IDs. Wire overlaps normalize within this transaction. Each shape goes on the schematic page its optional page field names, from drawing.pages, or on the first page without it; a symbol cuts wires only on its own page." +
			shapeEditReply,
		inputSchema: placeShapesInputSchema,
		annotations: placement,
		operation: (input) => ({ type: "placeShapes", ...input }),
	});
	tool("replaceShapes", {
		title: "Replace shape geometry",
		description:
			"Replace the complete data of explicit existing shape IDs in one undo step. Read getDrawing first to obtain IDs. All coordinates and dimensions are final millimetres; rotations are radians. Include every affected connected neighbor yourself. The page field is part of a shape's data: keep it from getDrawing, because a replacement without it puts the shape on the first page. To move shapes between pages, use moveShapesToPage, which also moves pinned circuit labels. Optional targetIds choose which existing IDs survive wire merging. This command does not read editor selection." +
			shapeEditReply,
		inputSchema: replaceShapesInputSchema,
		annotations: edit,
		operation: (input) => ({ type: "replaceShapes", ...input }),
	});
	tool("rotateShapes", {
		title: "Rotate shapes",
		description:
			"Rotate explicit existing shape IDs around their own centers in one undo step. The angle is relative radians, positive counterclockwise, and defaults to pi/2. Wires require multiples of pi/2. Symbol geometry, pins and labels rotate together. Unselected wires stay in place. All shapes must be on one schematic page. Read getDrawing to obtain IDs; editor selection is not consulted." +
			shapeEditReply,
		inputSchema: rotateShapesInputSchema,
		annotations: edit,
		operation: (input) => ({ type: "rotateShapes", ...input }),
	});
	tool("removeShapes", {
		title: "Remove shapes",
		description:
			"Remove explicit existing shape IDs from the drawing as one undo step. Read getDrawing to obtain IDs; editor selection is not consulted." +
			removeReply,
		inputSchema: removeShapesInputSchema,
		annotations: edit,
		operation: (input) => ({ type: "removeShapes", ...input }),
	});
	tool("setPages", {
		title: "Edit schematic pages",
		description:
			"Replace the drawing's page list in one undo step to add, rename, reorder or delete schematic pages. getDrawing returns drawing.pages. Each shape names its page with `page`; shapes without it are on the first page. Wires and pins connect only on their own page, while net and supply labels with the same name connect across pages. Deleting a page deletes its shapes." +
			historyEditReply,
		inputSchema: setPagesInputSchema,
		annotations: edit,
		operation: (input) => ({ type: "setPages", ...input }),
	});
	tool("setSheet", {
		title: "Edit sheet settings",
		description:
			"Replace the schematic's paper size and title block in one undo step. Every page uses the same sheet. getDrawing returns drawing.sheet, which is absent while every field has its default. The sheet is centered on the origin, so a size change keeps shapes where they are." +
			historyEditReply,
		inputSchema: setSheetInputSchema,
		annotations: edit,
		operation: (input) => ({ type: "setSheet", ...input }),
	});
	tool("moveShapesToPage", {
		title: "Move shapes to page",
		description:
			"Move explicit existing shape IDs to another schematic page at the same coordinates, as one undo step. Move connected wires and labels together, because wires connect only on one page." +
			shapeEditReply,
		inputSchema: moveShapesToPageInputSchema,
		annotations: edit,
		operation: (input) => ({ type: "moveShapesToPage", ...input }),
	});
	tool("undo", {
		title: "Undo drawing edit",
		description:
			"Undo the drawing's latest committed edit. Preserves alternate history branches and allocated shape IDs. Does nothing at the initial history entry." +
			historyEditReply,
		inputSchema: z.strictObject({}),
		annotations: edit,
		operation: () => ({ type: "undo" }),
	});
	tool("redo", {
		title: "Redo drawing edit",
		description:
			"Restore the drawing's preferred next history entry. Read getDrawing to inspect history branches. Does nothing when no redo entry exists." +
			historyEditReply,
		inputSchema: z.strictObject({}),
		annotations: edit,
		operation: () => ({ type: "redo" }),
	});
	tool("jumpHistory", {
		title: "Restore drawing history entry",
		description:
			"Restore an explicit existing history entry, including an alternate branch. Read getDrawing to obtain entry IDs. Shape ID allocation remains monotonic." +
			historyEditReply,
		inputSchema: jumpHistoryInputSchema,
		annotations: edit,
		operation: (input) => ({ type: "jumpHistory", ...input }),
	});
	return server;
}
