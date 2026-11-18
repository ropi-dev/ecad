import assert from "node:assert/strict";
import test from "node:test";
import { drawingReplySchema } from "@ecad/drawing-core/mcp/drawing-protocol.ts";
import { createCliDrawing, startCli } from "./helpers/cli-mcp.ts";
import { required } from "./helpers/required.ts";

const wire = (x: number) => ({
	kind: "wire",
	x,
	y: 0,
	width: 10,
	height: 0.2,
	lineWidth: 0.2,
	rotation: 0,
});
const label = (x: number, electrical: "net" | "supply", text = "+3V3") => ({
	kind: "text" as const,
	x,
	y: 0,
	width: 8,
	height: 2,
	lineWidth: 0.2,
	rotation: 0,
	fontSize: 1.5,
	horizontalAlign: "left" as const,
	verticalAlign: "bottom" as const,
	electrical,
	text,
});
const expectedNets = [
	{ names: ["+3V3"], wires: [1, 2], labels: [3, 4], pins: [] },
];
const shapes = [wire(5), wire(35), label(0, "net"), label(30, "supply")];

async function call(
	env: NodeJS.ProcessEnv,
	name: string,
	args: Record<string, unknown> = {},
) {
	const result = await startCli([name, JSON.stringify(args)], env).result;
	assert.equal(result.code, 0, result.stderr || result.stdout);
	assert.equal(result.stderr, "");
	const reply = drawingReplySchema.parse(
		JSON.parse(result.stdout).structuredContent,
	);
	assert.ok(reply.ok);
	return reply;
}

/** Edits reply without the drawing, so tests read it back. */
async function read(env: NodeJS.ProcessEnv) {
	return required((await call(env, "getDrawing")).drawing);
}

test("CLI saves electrical roles and exposes named nets across fresh processes, rename, and undo", async (context) => {
	const fixture = await createCliDrawing();
	context.after(() => fixture.close());
	await call(fixture.env, "placeShapes", { shapes });
	const placed = shapes.map((shape, index) => ({ ...shape, id: index + 1 }));
	assert.deepEqual((await fixture.read()).shapes, placed);
	const loaded = await read(fixture.env);
	assert.deepEqual(loaded.nets, expectedNets);
	assert.deepEqual(loaded.shapes, placed);
	await call(fixture.env, "replaceShapes", {
		shapes: [{ ...label(30, "supply", "GND"), id: 4 }],
	});
	const renamed = await read(fixture.env);
	assert.deepEqual(
		required(renamed.nets).map((net) => net.wires),
		[[1], [2]],
	);
	assert.deepEqual(
		required(renamed.nets).map((net) => net.names),
		[["+3V3"], ["GND"]],
	);
	await call(fixture.env, "undo");
	assert.deepEqual((await read(fixture.env)).nets, expectedNets);
});
