import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { readdir, readFile, readlink, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import { join } from "node:path";
import { type TestContext, test } from "node:test";
import { drawingReplySchema } from "@ecad/drawing-core/mcp/drawing-protocol.ts";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { cliMain, createCliDrawing, startCli } from "./helpers/cli-mcp.ts";
import { required } from "./helpers/required.ts";

const rectangle = {
	x: 12,
	y: -24,
	width: 30,
	height: 20,
	rotation: 0,
	lineWidth: 0.2,
};

async function drawing(context: TestContext) {
	const value = await createCliDrawing();
	context.after(() => value.close());
	return value;
}

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
async function readDrawing(env: NodeJS.ProcessEnv) {
	return required((await call(env, "getDrawing")).drawing);
}

async function exitedPid() {
	const child = spawn(process.execPath, ["-e", ""], { stdio: "ignore" });
	await once(child, "exit");
	assert.ok(child.pid);
	return child.pid;
}

const linux = process.platform === "linux";
const readText = (path: string) =>
	readFile(path, "utf8").then(
		(text) => text.trim() || undefined,
		() => undefined,
	);
// The identity the CLI records on this computer, so test locks look local.
const system = linux
	? {
			machineId: await readText("/etc/machine-id"),
			bootId: await readText("/proc/sys/kernel/random/boot_id"),
			pidNamespace: await readlink("/proc/self/ns/pid"),
		}
	: {};
const lockContent = (owner: { pid: number } & Record<string, unknown>) =>
	JSON.stringify({
		hostname: hostname(),
		...system,
		...owner,
		id: randomUUID(),
	});
const drawingFiles = new Set([
	"drawing.ecaddraw",
	"drawing.ecaddraw.history.json",
]);

async function stdio(context: TestContext, env: Record<string, string>) {
	const transport = new StdioClientTransport({
		command: process.execPath,
		args: ["--import", "tsx", cliMain, "mcp"],
		env,
		stderr: "pipe",
	});
	let stderr = "";
	transport.stderr?.on("data", (chunk) => {
		stderr += chunk;
	});
	const client = new Client({ name: "cli-test", version: "1.0.0" });
	context.after(async () => {
		await client.close();
		assert.equal(stderr, "");
	});
	await client.connect(transport);
	return { client, transport };
}

test("CLI help, version and tool discovery work without an app or a drawing file", async (context) => {
	const fixture = await drawing(context);
	for (const args of [[], ["--help"], ["--version"], ["tools"]]) {
		const result = await startCli(args, fixture.env).result;
		assert.equal(result.code, 0, result.stderr);
		assert.equal(result.stderr, "");
		assert.ok(result.stdout);
	}
	assert.deepEqual(await readdir(fixture.directory), []);
});

test("CLI uses the current directory by default and accepts drawing flags and JSON stdin", async (context) => {
	const fixture = await drawing(context);
	const result = await startCli(
		["call", "placeRectangle", "-"],
		{},
		JSON.stringify(rectangle),
		{ cwd: fixture.directory },
	).result;
	assert.equal(result.code, 0, result.stderr || result.stdout);
	assert.equal((await fixture.read()).shapes.length, 1);
	const other = join(fixture.directory, "other.ecaddraw");
	const read = await startCli(["--drawing", other, "getDrawing"], fixture.env)
		.result;
	assert.equal(read.code, 0, read.stderr);
	assert.deepEqual(
		JSON.parse(read.stdout).structuredContent.drawing.shapes,
		[],
	);
});

test("CLI rejects invalid arguments and preserves structured tool failures", async (context) => {
	const fixture = await drawing(context);
	for (const args of [
		["--unknown"],
		["call"],
		["tools", "{}"],
		["mcp", "{}"],
		["getDrawing", "{}", "{}"],
		["getDrawing", "[]"],
		["getDrawing", "null"],
		["getDrawing", "{"],
		["getDrawing", ""],
		["--timeout", "0", "getDrawing"],
		["missingTool"],
	]) {
		const result = await startCli(args, fixture.env).result;
		assert.equal(result.code, 1, args.join(" "));
		assert.equal(result.stdout, "");
		assert.match(result.stderr, /^ecad: /);
	}
	for (const [tool, args] of [
		["removeShapes", { ids: [999] }],
		["placeRectangle", { x: 1 }],
	] as const) {
		const result = await startCli([tool, JSON.stringify(args)], fixture.env)
			.result;
		assert.equal(result.code, 1);
		assert.equal(result.stderr, "");
		assert.equal(JSON.parse(result.stdout).isError, true);
	}
	assert.deepEqual(await readdir(fixture.directory), []);
});

test("CLI preserves project drawing metadata and resets history after external edits", async (context) => {
	const fixture = await drawing(context);
	const original = {
		id: "schematic",
		name: "Schematic",
		symbolLibraries: [],
		shapes: [{ ...rectangle, kind: "rectangle", id: 10 }],
	};
	await writeFile(fixture.path, JSON.stringify(original));
	await call(fixture.env, "placeRectangle", rectangle);
	const saved = await fixture.read();
	assert.equal(saved.id, original.id);
	assert.equal(saved.name, original.name);
	assert.deepEqual(saved.symbolLibraries, []);
	assert.deepEqual(
		saved.shapes.map((shape: { id: number }) => shape.id),
		[10, 11],
	);
	const changed = JSON.stringify({
		...original,
		shapes: [{ ...original.shapes[0], x: 99 }],
	});
	await writeFile(fixture.path, changed);
	assert.equal((await call(fixture.env, "undo")).summary.historyId, 0);
	const undone = await readDrawing(fixture.env);
	assert.equal(undone.history.nodes.length, 1);
	assert.equal(undone.shapes[0].x, 99);
	assert.equal(await readFile(fixture.path, "utf8"), changed);
});

test("CLI leaves a drawing it cannot read untouched", async (context) => {
	const fixture = await drawing(context);
	await writeFile(fixture.path, "{");
	const result = await startCli(
		["placeRectangle", JSON.stringify(rectangle)],
		fixture.env,
	).result;
	assert.equal(result.code, 1);
	assert.equal(JSON.parse(result.stdout).isError, true);
	assert.equal(await readFile(fixture.path, "utf8"), "{");
});

test("CLI lock timeouts preserve the owner's lock and drawing", async (context) => {
	const fixture = await drawing(context);
	const lock = `${fixture.path}.lock`;
	await writeFile(lock, "another owner");
	const result = await startCli(
		["--timeout", "25", "placeRectangle", JSON.stringify(rectangle)],
		fixture.env,
	).result;
	assert.equal(result.code, 1);
	assert.equal(
		JSON.parse(result.stdout).structuredContent.error.code,
		"DrawingLocked",
	);
	assert.equal(await readFile(lock, "utf8"), "another owner");
	assert.deepEqual(await readdir(fixture.directory), ["drawing.ecaddraw.lock"]);
});

test("CLI recovers a lock left by an exited process", async (context) => {
	const fixture = await drawing(context);
	await writeFile(
		`${fixture.path}.lock`,
		lockContent({ pid: await exitedPid() }),
	);
	const result = await startCli(
		["--timeout", "25", "placeRectangle", JSON.stringify(rectangle)],
		fixture.env,
	).result;
	assert.equal(result.code, 0, result.stderr || result.stdout);
	assert.equal(result.stderr, "");
	assert.equal((await fixture.read()).shapes.length, 1);
	assert.deepEqual(new Set(await readdir(fixture.directory)), drawingFiles);
});

test("standalone stdio MCP and CLI share tools, files and persistent undo history", async (context) => {
	const fixture = await drawing(context);
	const { client } = await stdio(context, fixture.env);
	const tools = await client.listTools();
	const direct = await startCli(["tools"], fixture.env).result;
	assert.deepEqual(tools.tools, JSON.parse(direct.stdout).tools);
	const placed = await client.callTool({
		name: "placeRectangle",
		arguments: rectangle,
	});
	assert.equal(placed.isError, undefined);
	assert.equal((await fixture.read()).shapes.length, 1);
	await call(fixture.env, "placeRectangle", { ...rectangle, x: 50 });
	const read = drawingReplySchema.parse(
		(await client.callTool({ name: "getDrawing", arguments: {} }))
			.structuredContent,
	);
	assert.ok(read.ok);
	assert.equal(read.drawing?.shapes.length, 2);
	await client.callTool({ name: "undo", arguments: {} });
	assert.equal((await fixture.read()).shapes.length, 1);
	await client.close();
	const restarted = await stdio(context, fixture.env);
	await restarted.client.callTool({ name: "redo", arguments: {} });
	assert.equal((await fixture.read()).shapes.length, 2);
	const invalid = await restarted.client.callTool({
		name: "removeShapes",
		arguments: { ids: [999] },
	});
	assert.equal(invalid.isError, true);
	assert.equal(drawingReplySchema.parse(invalid.structuredContent).ok, false);
});

test("concurrent CLI processes and MCP requests allocate distinct IDs without losing edits", async (context) => {
	const fixture = await drawing(context);
	const { client } = await stdio(context, fixture.env);
	await Promise.all([
		...Array.from({ length: 4 }, (_, x) =>
			call(fixture.env, "placeRectangle", { ...rectangle, x }),
		),
		client.callTool({ name: "placeRectangle", arguments: rectangle }),
	]);
	assert.deepEqual(
		(await fixture.read()).shapes
			.map((shape: { id: number }) => shape.id)
			.sort(),
		[1, 2, 3, 4, 5],
	);
	assert.equal((await readDrawing(fixture.env)).history.nodes.length, 6);
});

test("stdio MCP exits on stdin EOF and SIGTERM without stdout diagnostics", async (context) => {
	const fixture = await drawing(context);
	const eof = await startCli(["mcp"], fixture.env).result;
	assert.equal(eof.code, 0, eof.stderr);
	assert.equal(eof.stdout, "");
	assert.equal(eof.stderr, "");
	const { client, transport } = await stdio(context, fixture.env);
	const closed = new Promise<void>((resolve) => {
		client.onclose = resolve;
	});
	assert.ok(transport.pid);
	process.kill(transport.pid, "SIGTERM");
	await closed;
});
