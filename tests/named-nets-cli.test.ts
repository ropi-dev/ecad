import assert from "node:assert/strict";
import test from "node:test";
import { drawingReplySchema } from "@ecad/drawing-core/mcp/drawing-protocol.ts";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { cliMain, createCliDrawing, startCli } from "./helpers/cli-mcp.ts";

const wire = (x: number) => ({
	kind: "wire", x, y: 0, width: 10, height: 0.2, lineWidth: 0.2, rotation: 0,
});
const label = (x: number, electrical: "net" | "supply", text = "+3V3") => ({
	kind: "text" as const, x, y: 0, width: 8, height: 2, lineWidth: 0.2, rotation: 0,
	fontSize: 1.5, horizontalAlign: "left" as const, verticalAlign: "bottom" as const, electrical, text,
});
const expectedNets = [{ names: ["+3V3"], wires: [1, 2], labels: [3, 4], pins: [] }];
const shapes = [wire(5), wire(35), label(0, "net"), label(30, "supply")];

async function call(env: NodeJS.ProcessEnv, name: string, args: Record<string, unknown> = {}) {
	const result = await startCli([name, JSON.stringify(args)], env).result;
	assert.equal(result.code, 0, result.stderr || result.stdout);
	assert.equal(result.stderr, "");
	const reply = drawingReplySchema.parse(JSON.parse(result.stdout).structuredContent);
	assert.ok(reply.ok);
	return reply.drawing;
}

test("CLI saves electrical roles and exposes named nets across fresh processes, rename, and undo", async (context) => {
	const fixture = await createCliDrawing();
	context.after(() => fixture.close());
	const placed = await call(fixture.env, "placeShapes", { shapes });
	assert.deepEqual(placed.shapes, shapes.map((shape, index) => ({ ...shape, id: index + 1 })));
	assert.deepEqual((await fixture.read()).shapes, placed.shapes);
	const loaded = await call(fixture.env, "getDrawing");
	assert.deepEqual(loaded.nets, expectedNets);
	assert.deepEqual(loaded.shapes, placed.shapes);
	await call(fixture.env, "replaceShapes", { shapes: [{ ...label(30, "supply", "GND"), id: 4 }] });
	const renamed = await call(fixture.env, "getDrawing");
	assert.deepEqual(renamed.nets!.map((net) => net.wires), [[1], [2]]);
	assert.deepEqual(renamed.nets!.map((net) => net.names), [["+3V3"], ["GND"]]);
	await call(fixture.env, "undo");
	assert.deepEqual((await call(fixture.env, "getDrawing")).nets, expectedNets);
});

test("stdio MCP accepts named-net shapes and shares persisted electrical connectivity with CLI", async (context) => {
	const fixture = await createCliDrawing();
	context.after(() => fixture.close());
	const transport = new StdioClientTransport({
		command: process.execPath,
		args: ["--import", "tsx", cliMain, "mcp"],
		env: fixture.env,
		stderr: "pipe",
	});
	let stderr = "";
	transport.stderr?.on("data", (chunk) => { stderr += chunk; });
	const client = new Client({ name: "named-nets-test", version: "1.0.0" });
	context.after(async () => { await client.close(); assert.equal(stderr, ""); });
	await client.connect(transport);
	const tools = await client.listTools();
	assert.ok(tools.tools.find((tool) => tool.name === "placeShapes")?.outputSchema);
	const result = await client.callTool({ name: "placeShapes", arguments: { shapes } });
	assert.notEqual(result.isError, true);
	const placed = drawingReplySchema.parse(result.structuredContent);
	assert.ok(placed.ok);
	const loaded = await call(fixture.env, "getDrawing");
	assert.deepEqual(loaded.shapes, placed.drawing.shapes);
	assert.deepEqual(loaded.nets, expectedNets);
	await client.callTool({ name: "replaceShapes", arguments: { shapes: [{ ...label(30, "supply", "GND"), id: 4 }] } });
	assert.deepEqual((await call(fixture.env, "getDrawing")).nets!.map((net) => net.wires), [[1], [2]]);
	await client.callTool({ name: "undo", arguments: {} });
	const read = drawingReplySchema.parse((await client.callTool({ name: "getDrawing", arguments: {} })).structuredContent);
	assert.ok(read.ok);
	assert.deepEqual(read.drawing.nets, expectedNets);
});

test("CLI and MCP reject rotated symbol payloads with hidden electrical child labels", async (context) => {
	const fixture = await createCliDrawing();
	context.after(() => fixture.close());
	const child = { ...label(0, "supply", "GND"), id: 2 };
	const symbol = { kind: "symbol", definitionId: "nested-label", x: 40, y: 30, width: 10, height: 10, rotation: Math.PI / 2, lineWidth: 0.2,
		children: [{ kind: "pin", id: 1, x: 0, y: 0, width: 0.508, height: 0.508, rotation: 0, lineWidth: 0.2, name: "", number: "1" }, child], texts: [], attributes: { name: "Nested label", reference: "U1", value: "" } };
	const args = { shapes: [symbol, label(100, "supply", "GND")] };
	await call(fixture.env, "placeShapes", { shapes: [label(100, "supply", "GND")] });
	const before = await fixture.read();
	const result = await startCli(["placeShapes", JSON.stringify(args)], fixture.env).result;
	assert.notEqual(result.code, 0);
	assert.deepEqual(await fixture.read(), before);
	const client = new Client({ name: "nested-label-regression", version: "1.0.0" });
	context.after(() => client.close());
	await client.connect(new StdioClientTransport({ command: process.execPath, args: ["--import", "tsx", cliMain, "mcp"], env: fixture.env, stderr: "pipe" }));
	await client.listTools();
	const rejected = await client.callTool({ name: "placeShapes", arguments: args });
	assert.equal(rejected.isError, true);
	assert.deepEqual(await fixture.read(), before);
});

test("local MCP drawing reads reuse nets and invalidate on commands and external file edits", async (context) => {
	const { Effect } = await import("effect");
	const { writeFile } = await import("node:fs/promises");
	const { createLocalDrawing } = await import("../packages/cli/src/drawing.ts");
	const fixture = await createCliDrawing();
	context.after(() => fixture.close());
	await call(fixture.env, "placeShapes", { shapes });
	const local = createLocalDrawing({ path: fixture.path });
	const read = async () => {
		const reply = await Effect.runPromise(local.execute({ type: "getDrawing" }));
		assert.ok(reply.ok);
		return reply.drawing.nets!;
	};
	const first = await read();
	assert.equal(await read(), first);
	await Effect.runPromise(local.execute({ type: "replaceShapes", shapes: [{ ...label(30, "supply", "GND"), id: 4 }] }));
	const renamed = await read();
	assert.notEqual(renamed, first);
	assert.equal(renamed.length, 2);
	assert.equal(await read(), renamed);
	const external = await fixture.read();
	external.shapes[3].text = "+3V3";
	await writeFile(fixture.path, JSON.stringify(external));
	const updated = await read();
	assert.notEqual(updated, renamed);
	assert.deepEqual(updated, first);
	assert.equal(await read(), updated);
});
