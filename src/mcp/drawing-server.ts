import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { Effect } from "effect";
import { z } from "zod";
import { runEffect } from "#/lib/effect.ts";
import {
	type DrawingOperation,
	type DrawingReply,
	drawingFailureReplySchema,
	drawingReplySchema,
	drawingSuccessReplySchema,
	jumpHistoryInputSchema,
	placeShapesInputSchema,
	rectangleInputSchema,
	removeShapesInputSchema,
	replaceShapesInputSchema,
} from "#/mcp/drawing-protocol.ts";

// MCP requires an object output schema. Clients validate structured errors too,
// so advertise both outcomes while retaining the strict union at validation.
const drawingToolReplySchema = drawingSuccessReplySchema
	.extend({
		ok: z.boolean(),
		drawing: drawingSuccessReplySchema.shape.drawing.optional(),
		error: drawingFailureReplySchema.shape.error.optional(),
	})
	.refine((value) => drawingReplySchema.safeParse(value).success, {
		message: "Expected a complete drawing success or failure reply.",
	});

export interface DrawingMcpErrorLike {
	readonly message: string;
	readonly code?: string;
	readonly _tag?: string;
}

/** The supplied executor chooses the live drawing; tools never create another store. */
export function createDrawingMcpServer<E extends DrawingMcpErrorLike>(
	execute: (operation: DrawingOperation) => Effect.Effect<DrawingReply, E>,
) {
	const server = new McpServer({ name: "ecad-drawing", version: "1.0.0" });
	const call = async (
		operation: DrawingOperation,
		signal: AbortSignal,
	): Promise<CallToolResult> => {
		const reply = await runEffect(
			execute(operation).pipe(
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
		return {
			content: [{ type: "text", text: JSON.stringify(reply) }],
			structuredContent: reply,
			...(reply.ok ? {} : { isError: true }),
		};
	};
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

	server.registerTool(
		"getDrawing",
		{
			title: "Read drawing",
			description:
				"Read the connected editor's committed shapes, allocated IDs and history branches. Positions are shape centers in millimetres with Cartesian positive Y up; rotations are radians. Temporary pointer previews and selection are not drawing data.",
			inputSchema: z.strictObject({}),
			outputSchema: drawingToolReplySchema,
			annotations: readOnly,
		},
		(_input, { signal }) => call({ type: "getDrawing" }, signal),
	);
	server.registerTool(
		"placeRectangle",
		{
			title: "Place rectangle",
			description:
				"Place one rectangle with its complete final geometry in the connected editor. Supply center x/y, width, height and lineWidth in millimetres and rotation in radians. Positive Y points up. This command commits immediately as one undo step; it does not activate a drawing tool or wait for pointer input.",
			inputSchema: rectangleInputSchema,
			outputSchema: drawingToolReplySchema,
			annotations: placement,
		},
		(input, { signal }) => call({ type: "placeRectangle", input }, signal),
	);
	server.registerTool(
		"placeShapes",
		{
			title: "Place shapes",
			description:
				"Place complete rectangles, circles, triangles, lines at any angle, orthogonal wires, pins, text or symbols as one undo step. Top-level IDs are allocated by the drawing. Supply final center coordinates and dimensions in millimetres and rotation in radians. Text dimensions must already be measured; symbol children use local coordinates and their own IDs. Wire overlaps normalize within this transaction.",
			inputSchema: placeShapesInputSchema,
			outputSchema: drawingToolReplySchema,
			annotations: placement,
		},
		(input, { signal }) => call({ type: "placeShapes", ...input }, signal),
	);
	server.registerTool(
		"replaceShapes",
		{
			title: "Replace shape geometry",
			description:
				"Replace the complete data of explicit existing shape IDs in one undo step. Read getDrawing first to obtain IDs. All coordinates and dimensions are final millimetres; rotations are radians. Include every affected connected neighbor yourself. Optional targetIds choose which existing IDs survive wire merging. This command does not read editor selection.",
			inputSchema: replaceShapesInputSchema,
			outputSchema: drawingToolReplySchema,
			annotations: edit,
		},
		(input, { signal }) => call({ type: "replaceShapes", ...input }, signal),
	);
	server.registerTool(
		"removeShapes",
		{
			title: "Remove shapes",
			description:
				"Remove explicit existing shape IDs from the connected drawing as one undo step. Read getDrawing to obtain IDs; editor selection is not consulted.",
			inputSchema: removeShapesInputSchema,
			outputSchema: drawingToolReplySchema,
			annotations: edit,
		},
		(input, { signal }) => call({ type: "removeShapes", ...input }, signal),
	);
	server.registerTool(
		"undo",
		{
			title: "Undo drawing edit",
			description:
				"Undo the connected drawing's latest committed edit. Preserves alternate history branches and allocated shape IDs. Does nothing at the initial history entry.",
			inputSchema: z.strictObject({}),
			outputSchema: drawingToolReplySchema,
			annotations: edit,
		},
		(_input, { signal }) => call({ type: "undo" }, signal),
	);
	server.registerTool(
		"redo",
		{
			title: "Redo drawing edit",
			description:
				"Restore the connected drawing's preferred next history entry. Read getDrawing to inspect history branches. Does nothing when no redo entry exists.",
			inputSchema: z.strictObject({}),
			outputSchema: drawingToolReplySchema,
			annotations: edit,
		},
		(_input, { signal }) => call({ type: "redo" }, signal),
	);
	server.registerTool(
		"jumpHistory",
		{
			title: "Restore drawing history entry",
			description:
				"Restore an explicit existing history entry, including an alternate branch. Read getDrawing to obtain entry IDs. Shape ID allocation remains monotonic.",
			inputSchema: jumpHistoryInputSchema,
			outputSchema: drawingToolReplySchema,
			annotations: edit,
		},
		(input, { signal }) => call({ type: "jumpHistory", ...input }, signal),
	);
	return server;
}
