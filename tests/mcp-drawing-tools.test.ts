import assert from "node:assert/strict";
import { type TestContext, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Effect } from "effect";
import { createDrawingStore, DrawingStore } from "#/commands/drawing-store.ts";
import { drawShape } from "#/drawing/shapes.ts";
import { createSymbol, symbolDefinitions } from "#/drawing/symbols.ts";
import {
	type DrawingOperation,
	drawingEnvelopeSchema,
	drawingOperationSchema,
	drawingReplySchema,
	executeDrawingOperation,
	utf8ByteLength,
} from "#/mcp/drawing-protocol.ts";
import { createDrawingMcpServer } from "#/mcp/drawing-server.ts";
import { required } from "./helpers/required.ts";

const rectangle = {
	x: 12.5,
	y: -9,
	width: 30,
	height: 15,
	rotation: 0,
	lineWidth: 0.25,
};

async function session(context: TestContext) {
	const store = createDrawingStore();
	const server = createDrawingMcpServer((operation) =>
		executeDrawingOperation(operation).pipe(
			Effect.provideService(DrawingStore, store),
		),
	);
	const client = new Client({ name: "drawing-test", version: "1.0.0" });
	const [clientTransport, serverTransport] =
		InMemoryTransport.createLinkedPair();
	await server.connect(serverTransport);
	await client.connect(clientTransport);
	// Discovery enables the SDK client's advertised-output validation.
	await client.listTools();
	context.after(async () => {
		await client.close();
		await server.close();
	});
	const call = async (name: string, args: Record<string, unknown> = {}) => {
		const result = await client.callTool({ name, arguments: args });
		return {
			result,
			reply: drawingReplySchema.parse(result.structuredContent),
		};
	};
	return {
		store,
		client,
		call,
		/** Edits reply without the drawing, so tests read it back. */
		read: async () => {
			const { reply } = await call("getDrawing");
			assert.ok(reply.ok && reply.drawing);
			return reply.drawing;
		},
	};
}

test("MCP lists complete drawing tools and reads the provided store without UI state", async (context) => {
	const { client, call, store } = await session(context);
	const { tools } = await client.listTools();
	assert.deepEqual(tools.map((tool) => tool.name).sort(), [
		"getDrawing",
		"jumpHistory",
		"placeRectangle",
		"placeShapes",
		"redo",
		"removeShapes",
		"replaceShapes",
		"rotateShapes",
		"undo",
	]);
	const place = required(tools.find((tool) => tool.name === "placeRectangle"));
	assert.deepEqual(
		new Set(place.inputSchema.required),
		new Set(Object.keys(rectangle)),
	);
	assert.ok(place.outputSchema);
	assert.equal(
		required(tools.find((tool) => tool.name === "getDrawing")).annotations
			?.readOnlyHint,
		true,
	);
	const before = store.getSnapshot();
	const { result, reply } = await call("getDrawing");
	assert.notEqual(result.isError, true);
	assert.ok(reply.ok);
	assert.deepEqual(reply.drawing, {
		shapes: [],
		nets: [],
		nextShapeId: 1,
		history: {
			currentId: 0,
			nodes: [
				{
					id: 0,
					parentId: null,
					childIds: [],
					preferredChildId: null,
					label: "Empty drawing",
				},
			],
		},
	});
	assert.strictEqual(store.getSnapshot(), before);
	assert.equal(typeof document, "undefined");
});

test("MCP placement commits exact complete geometry and returns JSON-safe IDs and history", async (context) => {
	const { call, read, store } = await session(context);
	const { reply } = await call("placeRectangle", rectangle);
	assert.ok(reply.ok);
	assert.deepEqual(reply, {
		ok: true,
		summary: { shapeCount: 1, nextShapeId: 2, historyId: 1 },
		result: { ids: [1], idMap: { "1": 1 } },
	});
	assert.deepEqual(JSON.parse(JSON.stringify(reply)), reply);
	const drawing = await read();
	assert.deepEqual(drawing.shapes, [
		{ ...rectangle, kind: "rectangle", id: 1 },
	]);
	assert.deepEqual(drawing.shapes, store.getSnapshot().shapes);
	assert.equal(drawing.history.currentId, 1);
	assert.equal("state" in drawing.history.nodes[1], false);
	assert.deepEqual(drawing.nets, []);
});

test("MCP input schemas reject partial geometry and editor state before executing a command", async (context) => {
	const { client, store } = await session(context);
	const before = store.getSnapshot();
	for (const args of [
		{ x: 10, y: 20 },
		{ ...rectangle, lineWidth: undefined },
		{ ...rectangle, selectedIds: [1] },
	]) {
		const result = await client.callTool({
			name: "placeRectangle",
			arguments: args,
		});
		assert.equal(result.isError, true);
		assert.strictEqual(store.getSnapshot(), before);
	}
	const text = await client.callTool({
		name: "placeShapes",
		arguments: {
			shapes: [{ kind: "text", text: "Still unmeasured", fontSize: 5 }],
		},
	});
	assert.equal(text.isError, true);
	assert.strictEqual(store.getSnapshot(), before);
});

test("MCP places every shape kind including complete symbols and measured text in one transaction", async (context) => {
	const { call, read } = await session(context);
	const symbol = createSymbol(99, symbolDefinitions[0], { x: 50, y: 40 });
	const { id: _id, ...symbolInput } = symbol;
	const shapes = [
		...(["rectangle", "circle", "triangle", "wire", "pin"] as const).map(
			(kind, index) => {
				const { id: _id, ...shape } = drawShape(
					index + 1,
					kind,
					{ x: index * 10, y: 0 },
					{ x: index * 10 + 5, y: 3 },
				);
				return shape;
			},
		),
		symbolInput,
		{
			...rectangle,
			kind: "text",
			text: "Known dimensions\nTwo lines",
			fontSize: 5,
		},
	];
	const { reply } = await call("placeShapes", {
		shapes,
		label: "Import complete drawing",
	});
	assert.ok(reply.ok);
	assert.deepEqual(reply.result?.ids, [1, 2, 3, 4, 5, 6, 7]);
	const drawing = await read();
	assert.deepEqual(
		drawing.shapes.map((shape) => shape.kind),
		["rectangle", "circle", "triangle", "wire", "pin", "symbol", "text"],
	);
	assert.equal(drawing.history.nodes.length, 2);
	assert.equal(drawing.history.nodes[1].label, "Import complete drawing");
	assert.equal(drawing.shapes[5].kind, "symbol");
	assert.deepEqual(drawing.shapes[5], { ...symbolInput, id: 6 });
	assert.ok(symbolInput.texts.length > 0);
	const movedSymbol = { ...symbolInput, id: 6, x: 70 };
	const replaced = await call("replaceShapes", { shapes: [movedSymbol] });
	assert.ok(replaced.reply.ok);
	assert.deepEqual((await read()).shapes[5], movedSymbol);
});

test("MCP preserves pin names and numbers through placement, replacement, reads and history", async (context) => {
	const { call, read } = await session(context);
	const { id: _id, ...pin } = drawShape(
		1,
		"pin",
		{ x: 10, y: 20 },
		{ x: 10, y: 20 },
	);
	const placed = await call("placeShapes", {
		shapes: [{ ...pin, name: "VCC", number: "01" }],
	});
	assert.ok(placed.reply.ok);
	const named = { ...pin, id: 1, name: "VCC", number: "01" };
	assert.deepEqual((await read()).shapes, [named]);
	const renamed = { ...named, name: "GND", number: "A1" };
	const replaced = await call("replaceShapes", { shapes: [renamed] });
	assert.ok(replaced.reply.ok);
	assert.deepEqual((await read()).shapes, [renamed]);
	const undone = await call("undo");
	assert.ok(undone.reply.ok);
	assert.deepEqual((await read()).shapes, [named]);
	const redone = await call("redo");
	assert.ok(redone.reply.ok);
	assert.deepEqual((await read()).shapes, [renamed]);
});

test("MCP rotation uses explicit IDs and supports reverse rotation and history", async (context) => {
	const { call, read, store, client } = await session(context);
	const { id: _id, ...symbol } = createSymbol(1, symbolDefinitions[0], {
		x: 50,
		y: 30,
	});
	await call("placeShapes", {
		shapes: [symbol, { ...rectangle, kind: "rectangle" }],
	});
	const before = store.getSnapshot();
	const { reply } = await call("rotateShapes", { ids: [1] });
	assert.ok(reply.ok);
	const rotated = [
		{ ...symbol, id: 1, rotation: Math.PI / 2 },
		before.shapes[1],
	];
	assert.deepEqual((await read()).shapes, rotated);
	// The unrotated rectangle keeps its ID, so the mapping leaves it out.
	assert.deepEqual(reply.result, { ids: [1], idMap: { "1": 1 } });
	const reversed = await call("rotateShapes", {
		ids: [1],
		angle: -Math.PI / 2,
	});
	assert.ok(reversed.reply.ok);
	assert.deepEqual((await read()).shapes, before.shapes);
	const undone = await call("undo");
	assert.ok(undone.reply.ok);
	assert.deepEqual((await read()).shapes, rotated);
	const redone = await call("redo");
	assert.ok(redone.reply.ok);
	assert.deepEqual((await read()).shapes, before.shapes);
	const snapshot = store.getSnapshot();
	const missing = await call("rotateShapes", { ids: [1, 999] });
	assert.equal(missing.result.isError, true);
	assert.equal(missing.reply.ok, false);
	assert.strictEqual(store.getSnapshot(), snapshot);
	const invalid = await client.callTool({
		name: "rotateShapes",
		arguments: { ids: [1], angle: "90" },
	});
	assert.equal(invalid.isError, true);
	assert.strictEqual(store.getSnapshot(), snapshot);
});

test("MCP replacement, deletion and history navigation use explicit IDs", async (context) => {
	const { call, read } = await session(context);
	await call("placeRectangle", rectangle);
	const moved = { ...rectangle, kind: "rectangle", id: 1, x: 70 };
	const replaced = await call("replaceShapes", {
		shapes: [moved],
		label: "Move by ID",
		targetIds: [1],
	});
	assert.ok(replaced.reply.ok);
	assert.equal((await read()).shapes[0].x, 70);
	assert.deepEqual(replaced.reply.result?.ids, [1]);
	const removed = await call("removeShapes", { ids: [1] });
	assert.ok(removed.reply.ok);
	assert.deepEqual((await read()).shapes, []);
	assert.deepEqual(removed.reply.result, { ids: [], idMap: {} });
	assert.equal(removed.reply.summary.shapeCount, 0);
	const undone = await call("undo");
	assert.deepEqual(undone.reply, {
		ok: true,
		summary: { shapeCount: 1, nextShapeId: 2, historyId: 2 },
	});
	assert.equal((await read()).shapes[0].x, 70);
	const redone = await call("redo");
	assert.ok(redone.reply.ok);
	assert.deepEqual((await read()).shapes, []);
	await call("jumpHistory", { id: 1 });
	const branch = await call("placeRectangle", { ...rectangle, x: -30 });
	assert.ok(branch.reply.ok);
	assert.deepEqual(branch.reply.result?.ids, [2]);
	assert.deepEqual(
		(await read()).history.nodes.find((node) => node.id === 1)?.childIds,
		[2, 4],
	);
	const restored = await call("jumpHistory", { id: 3 });
	assert.ok(restored.reply.ok);
	assert.equal(restored.reply.summary.historyId, 3);
	assert.deepEqual((await read()).shapes, []);
	assert.equal(restored.reply.summary.nextShapeId, 3);
});

test("MCP surfaces command failures as structured tool errors without changing the drawing", async (context) => {
	const { call, client, store } = await session(context);
	await call("placeRectangle", rectangle);
	const before = store.getSnapshot();
	for (const [name, args] of [
		["removeShapes", { ids: [999] }],
		["replaceShapes", { shapes: [before.shapes[0], before.shapes[0]] }],
		["rotateShapes", { ids: [999] }],
		["jumpHistory", { id: 999 }],
	] as const) {
		const { result, reply } = await call(name, args);
		assert.equal(result.isError, true);
		assert.equal(reply.ok, false);
		if (!reply.ok) {
			assert.equal(reply.error.code, "InvalidDrawingCommand");
			assert.ok(reply.error.message.length > 0);
		}
		assert.strictEqual(store.getSnapshot(), before);
	}
	// Shape rules live in the input schema, so these fail before any command runs.
	for (const [shape, message] of [
		[
			{ ...rectangle, kind: "circle" },
			/A circle must have equal width and height/,
		],
		[{ ...rectangle, kind: "wire", lineStyle: "dashed" }, /Unrecognized key/],
		[{ ...rectangle, kind: "line", filled: true }, /Unrecognized key/],
	] as const) {
		const result = await client.callTool({
			name: "placeShapes",
			arguments: { shapes: [shape] },
		});
		assert.equal(result.isError, true);
		assert.match(JSON.stringify(result.content), message);
		assert.strictEqual(store.getSnapshot(), before);
	}
});

test("MCP serializes wire normalization mappings without losing merged IDs", async (context) => {
	const { call, read } = await session(context);
	const shapes = [
		drawShape(1, "wire", { x: 0, y: 0 }, { x: 10, y: 0 }),
		drawShape(2, "wire", { x: 5, y: 0 }, { x: 20, y: 0 }),
	].map(({ id: _id, ...shape }) => shape);
	const { reply } = await call("placeShapes", { shapes });
	assert.ok(reply.ok);
	assert.deepEqual(reply.result, { ids: [1], idMap: { "1": 1, "2": 1 } });
	const drawing = await read();
	assert.equal(drawing.shapes.length, 1);
	assert.equal(drawing.shapes[0].width, 20);
});

test("MCP returns expected live-session failures through the tool error channel", async () => {
	const server = createDrawingMcpServer(() =>
		Effect.fail({
			_tag: "DrawingSessionUnavailable",
			message: "The editor is disconnected.",
		}),
	);
	const client = new Client({ name: "failure-test", version: "1.0.0" });
	const [clientTransport, serverTransport] =
		InMemoryTransport.createLinkedPair();
	try {
		await server.connect(serverTransport);
		await client.connect(clientTransport);
		await client.listTools();
		const result = await client.callTool({ name: "getDrawing", arguments: {} });
		assert.equal(result.isError, true);
		assert.deepEqual(result.structuredContent, {
			ok: false,
			error: {
				code: "DrawingSessionUnavailable",
				message: "The editor is disconnected.",
			},
		});
	} finally {
		await client.close();
		await server.close();
	}
});

test("the shared protocol validates complete envelopes and acknowledgment data", () => {
	const envelope = {
		requestId: "request-1",
		expiresAt: Date.now() + 1000,
		operation: { type: "placeRectangle", input: rectangle },
	};
	assert.deepEqual(drawingEnvelopeSchema.parse(envelope), envelope);
	assert.equal(
		drawingEnvelopeSchema.safeParse({ ...envelope, expiresAt: Number.NaN })
			.success,
		false,
	);
	assert.equal(
		drawingOperationSchema.safeParse({
			type: "placeRectangle",
			input: { x: 1, y: 2 },
		}).success,
		false,
	);
	assert.equal(
		drawingOperationSchema.safeParse({
			type: "startDrawing",
			tool: "rectangle",
		}).success,
		false,
	);
	assert.equal(
		drawingReplySchema.safeParse({
			ok: true,
			summary: { shapeCount: 0, nextShapeId: 1, historyId: 0 },
			drawing: {},
		}).success,
		false,
	);
	assert.equal(
		drawingReplySchema.safeParse({
			ok: false,
			error: {
				code: "CommandExpired",
				message: "The drawing command expired before execution.",
			},
		}).success,
		true,
	);
	const store = createDrawingStore();
	const input = { ...rectangle };
	const program = executeDrawingOperation({ type: "placeRectangle", input });
	input.width = 999;
	assert.deepEqual(store.getSnapshot().shapes, []);
	const reply = Effect.runSync(
		program.pipe(Effect.provideService(DrawingStore, store)),
	);
	assert.ok(reply.ok);
	assert.equal(store.getSnapshot().shapes[0].width, rectangle.width);
});

test("MCP replacement records edits that change only text style, circuit nets or KiCad sources", async (context) => {
	const { call, read } = await session(context);
	const label = {
		kind: "text",
		text: "VCC",
		x: 10,
		y: 20,
		width: 8,
		height: 2,
		rotation: 0,
		lineWidth: 0.2,
		fontSize: 2,
	};
	const { id: _id, ...symbol } = createSymbol(2, symbolDefinitions[0], {
		x: 50,
		y: 30,
	});
	await call("placeShapes", { shapes: [label, symbol] });
	const styled = {
		...label,
		id: 1,
		bold: true,
		circuitNet: { id: "net-1", label: "VCC" },
	};
	const replaced = await call("replaceShapes", {
		shapes: [styled],
		label: "Style label",
	});
	assert.ok(replaced.reply.ok);
	assert.deepEqual(replaced.reply.result?.ids, [1]);
	const drawing = await read();
	assert.deepEqual(drawing.shapes[0], styled);
	assert.deepEqual(
		drawing.history.nodes.map((node) => node.label),
		["Empty drawing", "Place shapes", "Style label"],
	);
	const sourced = {
		...symbol,
		id: 2,
		kicad: { libraryId: "Device:R", unit: 1 },
	};
	const linked = await call("replaceShapes", {
		shapes: [sourced],
		label: "Link KiCad",
	});
	assert.ok(linked.reply.ok);
	assert.deepEqual((await read()).shapes[1], sourced);
	assert.equal(linked.reply.summary.historyId, 3);
	const repeated = await call("replaceShapes", {
		shapes: [sourced],
		label: "Unchanged",
	});
	assert.ok(repeated.reply.ok);
	assert.equal((await read()).history.nodes.length, 4);
	const undone = await call("undo");
	assert.ok(undone.reply.ok);
	assert.deepEqual((await read()).shapes, [styled, { ...symbol, id: 2 }]);
});

test("getDrawing pages stay within the reply limit and edits reply without the drawing", () => {
	const shapes = Array.from({ length: 50 }, (_, index) => ({
		...rectangle,
		kind: "rectangle" as const,
		id: index + 1,
		x: index,
	}));
	const store = createDrawingStore(shapes);
	const run = (operation: DrawingOperation, byteLimit: number) =>
		Effect.runSync(
			executeDrawingOperation(operation, byteLimit).pipe(
				Effect.provideService(DrawingStore, store),
			),
		);
	const byteLimit = 2048;
	assert.ok(utf8ByteLength(JSON.stringify(shapes)) > byteLimit);
	const whole = run({ type: "getDrawing" }, byteLimit);
	assert.ok(!whole.ok);
	assert.equal(whole.error.code, "DrawingTooLarge");
	assert.match(whole.error.message, /offset 0/);
	// Every page fits, and the pages together hold every shape exactly once.
	const read: unknown[] = [];
	let pages = 0;
	for (let offset: number | undefined = 0; offset !== undefined; pages++) {
		const reply = run({ type: "getDrawing", offset }, byteLimit);
		assert.ok(reply.ok && reply.drawing && reply.page);
		assert.ok(utf8ByteLength(JSON.stringify(reply)) <= byteLimit);
		assert.equal(reply.drawing.nets !== undefined, offset === 0);
		assert.equal(reply.page.total, 50);
		assert.equal(reply.page.count, reply.drawing.shapes.length);
		read.push(...reply.drawing.shapes);
		offset = reply.page.nextOffset;
	}
	assert.ok(pages > 2);
	assert.deepEqual(read, shapes);
	const limited = run({ type: "getDrawing", offset: 10, limit: 3 }, byteLimit);
	assert.ok(limited.ok);
	assert.deepEqual(
		limited.drawing?.shapes.map((shape) => shape.id),
		[11, 12, 13],
	);
	assert.deepEqual(limited.page, {
		offset: 10,
		count: 3,
		total: 50,
		nextOffset: 13,
	});
	const past = run({ type: "getDrawing", offset: 99 }, byteLimit);
	assert.ok(past.ok);
	assert.deepEqual(past.drawing?.shapes, []);
	assert.deepEqual(past.page, { offset: 50, count: 0, total: 50 });
	// A shape that cannot fit any page fails instead of stalling the caller.
	const empty = utf8ByteLength(JSON.stringify(past));
	const tooSmall = run({ type: "getDrawing", offset: 1 }, empty + 20);
	assert.ok(!tooSmall.ok);
	assert.equal(tooSmall.error.code, "DrawingTooLarge");
	assert.match(tooSmall.error.message, /shape at offset 1/);
	// Edits commit and reply with IDs, however small the limit.
	const placed = run({ type: "placeRectangle", input: rectangle }, 1);
	assert.deepEqual(placed, {
		ok: true,
		summary: { shapeCount: 51, nextShapeId: 52, historyId: 1 },
		result: { ids: [51], idMap: { "51": 51 } },
	});
	assert.equal(store.getSnapshot().shapes.length, 51);
	assert.deepEqual(run({ type: "undo" }, 1), {
		ok: true,
		summary: { shapeCount: 50, nextShapeId: 52, historyId: 0 },
	});
});
