import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Effect } from "effect";
import { createDrawingStore, DrawingStore } from "#/commands/drawing-store.ts";
import { drawShape } from "#/drawing/shapes.ts";
import { createSymbol, symbolDefinitions } from "#/drawing/symbols.ts";
import {
	drawingEnvelopeSchema,
	drawingOperationSchema,
	drawingReplySchema,
	executeDrawingOperation,
} from "#/mcp/drawing-protocol.ts";
import { createDrawingMcpServer } from "#/mcp/drawing-server.ts";

const rectangle = { x: 12.5, y: -9, width: 30, height: 15, rotation: 0, lineWidth: 0.25 };

async function session(context: TestContext) {
	const store = createDrawingStore();
	const server = createDrawingMcpServer((operation) => executeDrawingOperation(operation).pipe(
		Effect.provideService(DrawingStore, store),
	));
	const client = new Client({ name: "drawing-test", version: "1.0.0" });
	const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
	await server.connect(serverTransport);
	await client.connect(clientTransport);
	// Discovery enables the SDK client's advertised-output validation.
	await client.listTools();
	context.after(async () => {
		await client.close();
		await server.close();
	});
	return {
		store,
		client,
		call: async (name: string, args: Record<string, unknown> = {}) => {
			const result = await client.callTool({ name, arguments: args });
			return { result, reply: drawingReplySchema.parse(result.structuredContent) };
		},
	};
}

test("MCP lists complete drawing tools and reads the provided store without UI state", async (context) => {
	const { client, call, store } = await session(context);
	const { tools } = await client.listTools();
	assert.deepEqual(tools.map((tool) => tool.name).sort(), [
		"getDrawing", "jumpHistory", "placeRectangle", "placeShapes", "redo", "removeShapes", "replaceShapes", "undo",
	]);
	const place = tools.find((tool) => tool.name === "placeRectangle")!;
	assert.deepEqual(new Set(place.inputSchema.required), new Set(Object.keys(rectangle)));
	assert.ok(place.outputSchema);
	assert.equal(tools.find((tool) => tool.name === "getDrawing")!.annotations?.readOnlyHint, true);
	const before = store.getSnapshot();
	const { result, reply } = await call("getDrawing");
	assert.notEqual(result.isError, true);
	assert.ok(reply.ok);
	assert.deepEqual(reply.drawing, {
		shapes: [], nextShapeId: 1,
		history: { currentId: 0, nodes: [{ id: 0, parentId: null, childIds: [], preferredChildId: null, label: "Empty drawing" }] },
	});
	assert.strictEqual(store.getSnapshot(), before);
	assert.equal(typeof document, "undefined");
});

test("MCP placement commits exact complete geometry and returns JSON-safe IDs and history", async (context) => {
	const { call, store } = await session(context);
	const { reply } = await call("placeRectangle", rectangle);
	assert.ok(reply.ok);
	assert.deepEqual(reply.result, { ids: [1], idMap: { "1": 1 } });
	assert.deepEqual(reply.drawing.shapes, [{ ...rectangle, kind: "rectangle", id: 1 }]);
	assert.deepEqual(reply.drawing.shapes, store.getSnapshot().shapes);
	assert.equal(reply.drawing.history.currentId, 1);
	assert.equal("state" in reply.drawing.history.nodes[1], false);
	assert.deepEqual(JSON.parse(JSON.stringify(reply)), reply);
	const latest = await call("getDrawing");
	assert.ok(latest.reply.ok);
	assert.deepEqual(latest.reply.drawing, reply.drawing);
});

test("MCP input schemas reject partial geometry and editor state before executing a command", async (context) => {
	const { client, store } = await session(context);
	const before = store.getSnapshot();
	for (const args of [
		{ x: 10, y: 20 },
		{ ...rectangle, lineWidth: undefined },
		{ ...rectangle, selectedIds: [1] },
	]) {
		const result = await client.callTool({ name: "placeRectangle", arguments: args });
		assert.equal(result.isError, true);
		assert.strictEqual(store.getSnapshot(), before);
	}
	const text = await client.callTool({ name: "placeShapes", arguments: { shapes: [{ kind: "text", text: "Still unmeasured", fontSize: 5 }] } });
	assert.equal(text.isError, true);
	assert.strictEqual(store.getSnapshot(), before);
});

test("MCP places every shape kind including complete symbols and measured text in one transaction", async (context) => {
	const { call } = await session(context);
	const symbol = createSymbol(99, symbolDefinitions[0], { x: 50, y: 40 });
	const { id: _id, ...symbolInput } = symbol;
	const shapes = [
		...(["rectangle", "circle", "triangle", "wire", "pin"] as const).map((kind, index) => {
			const { id: _id, ...shape } = drawShape(index + 1, kind, { x: index * 10, y: 0 }, { x: index * 10 + 5, y: 3 });
			return shape;
		}),
		symbolInput,
		{ ...rectangle, kind: "text", text: "Known dimensions\nTwo lines", fontSize: 5 },
	];
	const { reply } = await call("placeShapes", { shapes, label: "Import complete drawing" });
	assert.ok(reply.ok);
	assert.deepEqual(reply.result?.ids, [1, 2, 3, 4, 5, 6, 7]);
	assert.deepEqual(reply.drawing.shapes.map((shape) => shape.kind), ["rectangle", "circle", "triangle", "wire", "pin", "symbol", "text"]);
	assert.equal(reply.drawing.history.nodes.length, 2);
	assert.equal(reply.drawing.history.nodes[1].label, "Import complete drawing");
	assert.equal(reply.drawing.shapes[5].kind, "symbol");
	assert.deepEqual(reply.drawing.shapes[5], { ...symbolInput, id: 6 });
	assert.ok(symbolInput.texts.length > 0);
	const latest = await call("getDrawing");
	assert.ok(latest.reply.ok);
	assert.deepEqual(latest.reply.drawing.shapes[5], { ...symbolInput, id: 6 });
	const movedSymbol = { ...symbolInput, id: 6, x: 70 };
	const replaced = await call("replaceShapes", { shapes: [movedSymbol] });
	assert.ok(replaced.reply.ok);
	assert.deepEqual(replaced.reply.drawing.shapes[5], movedSymbol);
});

test("MCP preserves pin names through placement, replacement, reads and history", async (context) => {
	const { call } = await session(context);
	const { id: _id, ...pin } = drawShape(1, "pin", { x: 10, y: 20 }, { x: 10, y: 20 });
	const placed = await call("placeShapes", { shapes: [{ ...pin, name: "VCC" }] });
	assert.ok(placed.reply.ok);
	const named = { ...pin, id: 1, name: "VCC" };
	assert.deepEqual(placed.reply.drawing.shapes, [named]);
	const renamed = { ...named, name: "GND" };
	const replaced = await call("replaceShapes", { shapes: [renamed] });
	assert.ok(replaced.reply.ok);
	assert.deepEqual(replaced.reply.drawing.shapes, [renamed]);
	const read = await call("getDrawing");
	assert.ok(read.reply.ok);
	assert.deepEqual(read.reply.drawing.shapes, [renamed]);
	const undone = await call("undo");
	assert.ok(undone.reply.ok);
	assert.deepEqual(undone.reply.drawing.shapes, [named]);
	const redone = await call("redo");
	assert.ok(redone.reply.ok);
	assert.deepEqual(redone.reply.drawing.shapes, [renamed]);
});

test("MCP replacement, deletion and history navigation use explicit IDs", async (context) => {
	const { call } = await session(context);
	await call("placeRectangle", rectangle);
	const moved = { ...rectangle, kind: "rectangle", id: 1, x: 70 };
	const replaced = await call("replaceShapes", { shapes: [moved], label: "Move by ID", targetIds: [1] });
	assert.ok(replaced.reply.ok);
	assert.equal(replaced.reply.drawing.shapes[0].x, 70);
	assert.deepEqual(replaced.reply.result?.ids, [1]);
	const removed = await call("removeShapes", { ids: [1] });
	assert.ok(removed.reply.ok);
	assert.deepEqual(removed.reply.drawing.shapes, []);
	assert.deepEqual(removed.reply.result?.ids, []);
	const undone = await call("undo");
	assert.ok(undone.reply.ok);
	assert.equal(undone.reply.drawing.shapes[0].x, 70);
	const redone = await call("redo");
	assert.ok(redone.reply.ok);
	assert.deepEqual(redone.reply.drawing.shapes, []);
	await call("jumpHistory", { id: 1 });
	const branch = await call("placeRectangle", { ...rectangle, x: -30 });
	assert.ok(branch.reply.ok);
	assert.deepEqual(branch.reply.result?.ids, [2]);
	assert.deepEqual(branch.reply.drawing.history.nodes.find((node) => node.id === 1)?.childIds, [2, 4]);
	const restored = await call("jumpHistory", { id: 3 });
	assert.ok(restored.reply.ok);
	assert.deepEqual(restored.reply.drawing.shapes, []);
	assert.equal(restored.reply.drawing.nextShapeId, 3);
});

test("MCP surfaces command failures as structured tool errors without changing the drawing", async (context) => {
	const { call, store } = await session(context);
	await call("placeRectangle", rectangle);
	const before = store.getSnapshot();
	for (const [name, args] of [
		["removeShapes", { ids: [999] }],
		["replaceShapes", { shapes: [before.shapes[0], before.shapes[0]] }],
		["placeShapes", { shapes: [{ ...rectangle, kind: "circle" }] }],
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
});

test("MCP serializes wire normalization mappings without losing merged IDs", async (context) => {
	const { call } = await session(context);
	const shapes = [
		drawShape(1, "wire", { x: 0, y: 0 }, { x: 10, y: 0 }),
		drawShape(2, "wire", { x: 5, y: 0 }, { x: 20, y: 0 }),
	].map(({ id: _id, ...shape }) => shape);
	const { reply } = await call("placeShapes", { shapes });
	assert.ok(reply.ok);
	assert.deepEqual(reply.result, { ids: [1], idMap: { "1": 1, "2": 1 } });
	assert.equal(reply.drawing.shapes.length, 1);
	assert.equal(reply.drawing.shapes[0].width, 20);
});

test("MCP returns expected live-session failures through the tool error channel", async () => {
	const server = createDrawingMcpServer(() => Effect.fail({ _tag: "DrawingSessionUnavailable", message: "The editor is disconnected." }));
	const client = new Client({ name: "failure-test", version: "1.0.0" });
	const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
	try {
		await server.connect(serverTransport);
		await client.connect(clientTransport);
		await client.listTools();
		const result = await client.callTool({ name: "getDrawing", arguments: {} });
		assert.equal(result.isError, true);
		assert.deepEqual(result.structuredContent, { ok: false, error: { code: "DrawingSessionUnavailable", message: "The editor is disconnected." } });
	} finally {
		await client.close();
		await server.close();
	}
});

test("the shared protocol validates complete envelopes and acknowledgment data", () => {
	const envelope = { requestId: "request-1", expiresAt: Date.now() + 1000, operation: { type: "placeRectangle", input: rectangle } };
	assert.deepEqual(drawingEnvelopeSchema.parse(envelope), envelope);
	assert.equal(drawingEnvelopeSchema.safeParse({ ...envelope, expiresAt: Number.NaN }).success, false);
	assert.equal(drawingOperationSchema.safeParse({ type: "placeRectangle", input: { x: 1, y: 2 } }).success, false);
	assert.equal(drawingOperationSchema.safeParse({ type: "startDrawing", tool: "rectangle" }).success, false);
	assert.equal(drawingReplySchema.safeParse({ ok: true, drawing: {} }).success, false);
	assert.equal(drawingReplySchema.safeParse({ ok: false, error: { code: "CommandExpired", message: "The drawing command expired before execution." } }).success, true);
	const store = createDrawingStore();
	const input = { ...rectangle };
	const program = executeDrawingOperation({ type: "placeRectangle", input });
	input.width = 999;
	assert.deepEqual(store.getSnapshot().shapes, []);
	const reply = Effect.runSync(program.pipe(Effect.provideService(DrawingStore, store)));
	assert.ok(reply.ok);
	assert.equal(reply.drawing.shapes[0].width, rectangle.width);
});
