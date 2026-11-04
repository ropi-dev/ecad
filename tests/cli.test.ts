import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { once } from "node:events";
import {
	chmod,
	mkdir,
	readdir,
	readFile,
	readlink,
	rm,
	stat,
	symlink,
	utimes,
	writeFile,
} from "node:fs/promises";
import { hostname } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { PassThrough, Readable, Writable } from "node:stream";
import { type TestContext, test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { createLocalDrawing, runCli } from "@ecad/cli";
import { drawingSnapshotSchema } from "@ecad/drawing-core/commands/drawing-snapshot.ts";
import { runEffect } from "@ecad/drawing-core/lib/effect.ts";
import {
	lockLeftoverTag,
	withFileLock,
} from "@ecad/drawing-core/lib/file-lock.ts";
import { drawingReplySchema } from "@ecad/drawing-core/mcp/drawing-protocol.ts";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { cliMain, createCliDrawing, startCli } from "./helpers/cli-mcp.ts";

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
const ownStartTime = linux
	? (await readText("/proc/self/stat"))?.split(") ")[1]?.split(" ")[19]
	: undefined;
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

// Staged copies and claims of the fixture drawing's lock carry this tag.
const tag = lockLeftoverTag("drawing.ecaddraw.lock");

const fileMode = async (path: string) => (await stat(path)).mode & 0o7777;

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

test("CLI executes every drawing tool and preserves history between processes", async (context) => {
	const fixture = await drawing(context);
	const listed = await startCli(["tools"], fixture.env).result;
	const names = JSON.parse(listed.stdout)
		.tools.map((tool: { name: string }) => tool.name)
		.sort();
	assert.deepEqual(names, [
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
	assert.deepEqual((await call(fixture.env, "getDrawing")).drawing.shapes, []);
	const placed = await call(fixture.env, "placeRectangle", rectangle);
	const shape = placed.drawing.shapes[0];
	await call(fixture.env, "placeShapes", {
		shapes: [{ ...rectangle, kind: "rectangle", x: 50 }],
	});
	assert.equal(
		(await call(fixture.env, "rotateShapes", { ids: [shape.id] })).drawing
			.shapes[0].rotation,
		Math.PI / 2,
	);
	assert.equal(
		(
			await call(fixture.env, "replaceShapes", {
				shapes: [{ ...shape, x: 99 }],
			})
		).drawing.shapes[0].x,
		99,
	);
	assert.equal(
		(await call(fixture.env, "removeShapes", { ids: [shape.id] })).drawing
			.shapes.length,
		1,
	);
	assert.equal((await call(fixture.env, "undo")).drawing.shapes.length, 2);
	assert.equal((await call(fixture.env, "redo")).drawing.shapes.length, 1);
	await call(fixture.env, "jumpHistory", {
		id: placed.drawing.history.currentId,
	});
	const branch = await call(fixture.env, "placeRectangle", {
		...rectangle,
		x: 100,
	});
	assert.deepEqual(branch.result?.ids, [3]);
	assert.equal(branch.drawing.history.nodes.length, 7);
	assert.equal(branch.drawing.history.nodes[1].childIds.length, 2);
	assert.deepEqual((await fixture.read()).shapes, branch.drawing.shapes);
	assert.deepEqual(
		new Set(await readdir(fixture.directory)),
		new Set(["drawing.ecaddraw", "drawing.ecaddraw.history.json"]),
	);
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
	const undone = await call(fixture.env, "undo");
	assert.equal(undone.drawing.history.nodes.length, 1);
	assert.equal(undone.drawing.shapes[0].x, 99);
	assert.equal(await readFile(fixture.path, "utf8"), changed);
});

test("CLI leaves corrupt drawings and corrupt history untouched", async (context) => {
	const fixture = await drawing(context);
	for (const content of [
		"{",
		JSON.stringify({
			shapes: [
				{ ...rectangle, kind: "rectangle", id: 1 },
				{ ...rectangle, kind: "rectangle", id: 1 },
			],
		}),
	]) {
		await writeFile(fixture.path, content);
		const result = await startCli(
			["placeRectangle", JSON.stringify(rectangle)],
			fixture.env,
		).result;
		assert.equal(result.code, 1);
		assert.equal(JSON.parse(result.stdout).isError, true);
		assert.equal(await readFile(fixture.path, "utf8"), content);
	}
	await writeFile(fixture.path, JSON.stringify({ shapes: [] }));
	await call(fixture.env, "placeRectangle", rectangle);
	const before = await readFile(fixture.path, "utf8");
	const historyPath = `${fixture.path}.history.json`;
	const history = JSON.parse(await readFile(historyPath, "utf8"));
	history.snapshot.history.nodes[1].childIds = [0];
	const corrupt = JSON.stringify(history);
	await writeFile(historyPath, corrupt);
	const result = await startCli(["undo"], fixture.env).result;
	assert.equal(result.code, 1);
	assert.equal(await readFile(fixture.path, "utf8"), before);
	assert.equal(await readFile(historyPath, "utf8"), corrupt);
});

test("CLI cannot commit a drawing when its history file is unreadable", async (context) => {
	const fixture = await drawing(context);
	const before = JSON.stringify({ shapes: [] });
	await writeFile(fixture.path, before);
	await mkdir(`${fixture.path}.history.json`);
	const result = await startCli(
		["placeRectangle", JSON.stringify(rectangle)],
		fixture.env,
	).result;
	assert.equal(result.code, 1);
	assert.equal(await readFile(fixture.path, "utf8"), before);
	assert.equal(
		(await readdir(fixture.directory)).some(
			(name) => name.endsWith(".tmp") || name.endsWith(".lock"),
		),
		false,
	);
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

test("CLI recovers a stale lock beside a drawing with a long file name", async (context) => {
	const fixture = await drawing(context);
	// 240 bytes, so the history name (253 bytes) still fits in 255.
	const path = join(fixture.directory, `${"d".repeat(231)}.ecaddraw`);
	await writeFile(`${path}.lock`, lockContent({ pid: await exitedPid() }));
	const result = await startCli([
		"--drawing",
		path,
		"--timeout",
		"25",
		"getDrawing",
	]).result;
	assert.equal(result.code, 0, result.stderr || result.stdout);
	assert.deepEqual(await readdir(fixture.directory), []);
});

test("CLI keeps locks whose owner is running or cannot be checked", async (context) => {
	const fixture = await drawing(context);
	const lock = `${fixture.path}.lock`;
	const live = lockContent({ pid: process.pid, startTime: ownStartTime });
	await writeFile(lock, live);
	const result = await startCli(
		["--timeout", "25", "placeRectangle", JSON.stringify(rectangle)],
		fixture.env,
	).result;
	assert.equal(result.code, 1);
	assert.equal(
		JSON.parse(result.stdout).structuredContent.error.code,
		"DrawingLocked",
	);
	assert.equal(await readFile(lock, "utf8"), live);
	const unknown = [
		lockContent({ pid: await exitedPid(), hostname: `other-${hostname()}` }),
		lockContent({ pid: await exitedPid(), machineId: "another-computer" }),
		lockContent({ pid: await exitedPid(), pidNamespace: "pid:[1]" }),
		JSON.stringify({ pid: await exitedPid() }),
		"",
		// On Linux, a PID is only checked with matching boot and namespace IDs.
		...(linux
			? [
					lockContent({ pid: await exitedPid(), pidNamespace: undefined }),
					lockContent({ pid: await exitedPid(), bootId: undefined }),
				]
			: []),
	];
	for (const content of unknown) {
		await writeFile(lock, content);
		await assert.rejects(
			runEffect(
				createLocalDrawing({ path: fixture.path, lockTimeout: 25 }).execute({
					type: "placeRectangle",
					input: rectangle,
				}),
			),
			{ code: "DrawingLocked" },
			content,
		);
		assert.equal(await readFile(lock, "utf8"), content);
		assert.deepEqual(await readdir(fixture.directory), [
			"drawing.ecaddraw.lock",
		]);
	}
});

test("CLI keeps a lock when it cannot trust its own PID namespace, boot ID or /proc", {
	skip: !ownStartTime,
}, async (context) => {
	const fixture = await drawing(context);
	const lock = `${fixture.path}.lock`;
	const hideIdentity = fileURLToPath(
		new URL("./helpers/hide-linux-identity.ts", import.meta.url),
	);
	const cases = [
		[
			"pidNamespace",
			lockContent({ pid: await exitedPid(), pidNamespace: undefined }),
		],
		["bootId", lockContent({ pid: await exitedPid(), bootId: undefined })],
		// With its parent's /proc, a namespace would read another process's start time.
		["ownProc", lockContent({ pid: process.pid, startTime: "-1" })],
	];
	for (const [field, content] of cases) {
		await writeFile(lock, content);
		const result = await startCli(
			["--timeout", "25", "placeRectangle", JSON.stringify(rectangle)],
			{ ...fixture.env, ECAD_TEST_HIDE_IDENTITY: field },
			"",
			{ imports: [hideIdentity] },
		).result;
		assert.equal(result.code, 1, `${field}: ${result.stderr || result.stdout}`);
		assert.equal(
			JSON.parse(result.stdout).structuredContent.error.code,
			"DrawingLocked",
		);
		assert.equal(await readFile(lock, "utf8"), content);
	}
});

test("local drawing module keeps a live lock that has this process's PID", async (context) => {
	const fixture = await drawing(context);
	const content = lockContent({ pid: process.pid, startTime: ownStartTime });
	await writeFile(`${fixture.path}.lock`, content);
	await assert.rejects(
		runEffect(
			createLocalDrawing({ path: fixture.path, lockTimeout: 25 }).execute({
				type: "placeRectangle",
				input: rectangle,
			}),
		),
		{ code: "DrawingLocked" },
	);
	assert.equal(await readFile(`${fixture.path}.lock`, "utf8"), content);
});

test("CLI recovers a lock from an earlier boot even when its PID is now in use", {
	skip: !(system.machineId && system.bootId),
}, async (context) => {
	const fixture = await drawing(context);
	await writeFile(
		`${fixture.path}.lock`,
		lockContent({ pid: process.pid, bootId: randomUUID() }),
	);
	const result = await startCli(
		["--timeout", "25", "placeRectangle", JSON.stringify(rectangle)],
		fixture.env,
	).result;
	assert.equal(result.code, 0, result.stderr || result.stdout);
	assert.deepEqual(new Set(await readdir(fixture.directory)), drawingFiles);
});

test("local drawing module recovers a lock whose PID now belongs to a later process", {
	skip: !ownStartTime,
}, async (context) => {
	const fixture = await drawing(context);
	// PID 1 usually belongs to another user, so signalling it fails with EPERM.
	for (const pid of [process.pid, 1]) {
		await writeFile(
			`${fixture.path}.lock`,
			lockContent({ pid, startTime: "-1" }),
		);
		const reply = await runEffect(
			createLocalDrawing({ path: fixture.path, lockTimeout: 25 }).execute({
				type: "placeRectangle",
				input: rectangle,
			}),
		);
		assert.ok(reply.ok, `PID ${pid}`);
		assert.deepEqual(new Set(await readdir(fixture.directory)), drawingFiles);
	}
});

test("local drawing module recovers a lock whose owner is a zombie", {
	skip: !ownStartTime,
}, async (context) => {
	const fixture = await drawing(context);
	// The shell becomes sleep 60, which never collects its exited child.
	const parent = spawn("sh", ["-c", "sleep 0.2 & echo $!; exec sleep 60"], {
		stdio: ["ignore", "pipe", "ignore"],
	});
	context.after(() => {
		parent.kill();
	});
	const [line] = await once(createInterface({ input: parent.stdout }), "line");
	let fields: string[] = [];
	for (let attempt = 0; attempt < 500 && fields[0] !== "Z"; attempt++) {
		await delay(10);
		fields =
			(await readText(`/proc/${line}/stat`))?.split(") ")[1]?.split(" ") ?? [];
	}
	assert.equal(fields[0], "Z");
	await writeFile(
		`${fixture.path}.lock`,
		lockContent({ pid: Number(line), startTime: fields[19] }),
	);
	const reply = await runEffect(
		createLocalDrawing({ path: fixture.path, lockTimeout: 25 }).execute({
			type: "placeRectangle",
			input: rectangle,
		}),
	);
	assert.ok(reply.ok);
});

test("CLI follows claims left by processes that exited while recovering a lock", async (context) => {
	const fixture = await drawing(context);
	let previous = lockContent({ pid: await exitedPid() });
	await writeFile(`${fixture.path}.lock`, previous);
	for (let level = 0; level < 4; level++) {
		const claim = lockContent({ pid: await exitedPid() });
		await writeFile(
			join(fixture.directory, `.ecad-claim-${tag}-${JSON.parse(previous).id}`),
			claim,
		);
		previous = claim;
	}
	const result = await startCli(
		["--timeout", "25", "placeRectangle", JSON.stringify(rectangle)],
		fixture.env,
	).result;
	assert.equal(result.code, 0, result.stderr || result.stdout);
	assert.deepEqual(new Set(await readdir(fixture.directory)), drawingFiles);
});

test("local drawing module stops at a cycle of claims", async (context) => {
	const fixture = await drawing(context);
	const [first, second] = [randomUUID(), randomUUID()];
	const pid = await exitedPid();
	const owner = (id: string) =>
		JSON.stringify({ hostname: hostname(), ...system, pid, id });
	await writeFile(`${fixture.path}.lock`, owner(first));
	await writeFile(
		join(fixture.directory, `.ecad-claim-${tag}-${first}`),
		owner(second),
	);
	await writeFile(
		join(fixture.directory, `.ecad-claim-${tag}-${second}`),
		owner(first),
	);
	await assert.rejects(
		runEffect(
			createLocalDrawing({ path: fixture.path, lockTimeout: 25 }).execute({
				type: "placeRectangle",
				input: rectangle,
			}),
		),
		{ code: "DrawingLocked" },
	);
	assert.equal((await readdir(fixture.directory)).length, 3);
});

test("concurrent commands take over an abandoned lock one at a time", async (context) => {
	const fixture = await drawing(context);
	await writeFile(
		`${fixture.path}.lock`,
		lockContent({ pid: await exitedPid() }),
	);
	const replies = await Promise.all([
		...Array.from({ length: 3 }, (_, x) =>
			call(fixture.env, "placeRectangle", { ...rectangle, x }),
		),
		...Array.from({ length: 8 }, (_, x) =>
			runEffect(
				createLocalDrawing({ path: fixture.path }).execute({
					type: "placeRectangle",
					input: { ...rectangle, x: x + 10 },
				}),
			),
		),
	]);
	assert.ok(replies.every((reply) => reply.ok));
	assert.deepEqual(
		(await fixture.read()).shapes
			.map((shape: { id: number }) => shape.id)
			.sort((a: number, b: number) => a - b),
		Array.from({ length: 11 }, (_, index) => index + 1),
	);
	assert.equal(
		(await call(fixture.env, "getDrawing")).drawing.history.nodes.length,
		12,
	);
	assert.deepEqual(new Set(await readdir(fixture.directory)), drawingFiles);
});

test("CLI recovers after a process is killed right after creating its lock or claim", async (context) => {
	const fixture = await drawing(context);
	const lockFaults = fileURLToPath(
		new URL("./helpers/lock-faults.ts", import.meta.url),
	);
	const crashed = async (pattern: string) => {
		const result = await startCli(
			["placeRectangle", JSON.stringify(rectangle)],
			{ ...fixture.env, ECAD_TEST_CRASH_PATTERN: pattern },
			"",
			{ imports: [lockFaults] },
		).result;
		assert.equal(result.signal, "SIGKILL", result.stderr);
	};
	const visible = async () =>
		(await readdir(fixture.directory)).filter((name) => !name.startsWith("."));
	await crashed("\\.lock$");
	assert.deepEqual(await visible(), ["drawing.ecaddraw.lock"]);
	assert.equal(
		typeof JSON.parse(await readFile(`${fixture.path}.lock`, "utf8")).id,
		"string",
	);
	await crashed("^\\.ecad-claim-");
	assert.equal(
		(await readdir(fixture.directory)).filter((name) =>
			name.startsWith(".ecad-claim-"),
		).length,
		1,
	);
	assert.ok(
		(await readdir(fixture.directory)).some(
			(name) => name.startsWith(".ecad-lock-") && name.endsWith(".tmp"),
		),
		"the killed processes left staged copies",
	);
	await call(fixture.env, "placeRectangle", rectangle);
	assert.deepEqual(
		new Set(await readdir(fixture.directory)),
		drawingFiles,
		"recovery removes the staged copies too",
	);
	assert.equal((await fixture.read()).shapes.length, 1);
});

test("without hard links, a lock left empty by a process killed right after creating it is kept and reported until removed", async (context) => {
	const fixture = await drawing(context);
	const lock = `${fixture.path}.lock`;
	const lockFaults = fileURLToPath(
		new URL("./helpers/lock-faults.ts", import.meta.url),
	);
	const result = await startCli(
		["placeRectangle", JSON.stringify(rectangle)],
		{
			...fixture.env,
			ECAD_TEST_NO_HARD_LINKS: "1",
			ECAD_TEST_CRASH_PATTERN: "\\.lock$",
		},
		"",
		{ imports: [lockFaults] },
	).result;
	assert.equal(result.signal, "SIGKILL", result.stderr);
	assert.equal(await readFile(lock, "utf8"), "");
	const place = () =>
		runEffect(
			createLocalDrawing({ path: fixture.path, lockTimeout: 25 }).execute({
				type: "placeRectangle",
				input: rectangle,
			}),
			AbortSignal.timeout(5_000),
		);
	await assert.rejects(place(), {
		code: "DrawingLocked",
		message: `The drawing is locked, but the process holding the lock cannot be confirmed to be running. If no other process is using the drawing, remove the lock file and retry: ${lock}`,
	});
	assert.equal(await readFile(lock, "utf8"), "");
	await rm(lock);
	assert.ok((await place()).ok);
	assert.equal((await fixture.read()).shapes.length, 1);
});

test("locks without a verifiable owner are kept however old they are, and the error names them", async (context) => {
	const fixture = await drawing(context);
	const lock = `${fixture.path}.lock`;
	const twoMinutesAgo = new Date(Date.now() - 120_000);
	// A dead process's staged copy for this lock gives no reason to remove it.
	await writeFile(
		join(fixture.directory, `.ecad-lock-${tag}-${randomUUID()}.tmp`),
		lockContent({ pid: await exitedPid() }),
	);
	for (const content of [
		"",
		"written by another program",
		lockContent({ pid: await exitedPid(), hostname: "another-computer" }),
	]) {
		await writeFile(lock, content);
		await utimes(lock, twoMinutesAgo, twoMinutesAgo);
		await assert.rejects(
			runEffect(
				createLocalDrawing({ path: fixture.path, lockTimeout: 25 }).execute({
					type: "placeRectangle",
					input: rectangle,
				}),
				AbortSignal.timeout(5_000),
			),
			(error: { code?: string; message?: string }) =>
				error.code === "DrawingLocked" &&
				/cannot be confirmed to be running/.test(error.message ?? "") &&
				error.message?.endsWith(lock) === true,
		);
		assert.equal(await readFile(lock, "utf8"), content);
	}
});

test("a lock held by a running process is reported without asking to remove it", {
	// Only Linux records the start time that confirms a running owner.
	skip: process.platform !== "linux",
}, async (context) => {
	const fixture = await drawing(context);
	const lock = `${fixture.path}.lock`;
	const place = () =>
		runEffect(
			createLocalDrawing({ path: fixture.path, lockTimeout: 25 }).execute({
				type: "placeRectangle",
				input: rectangle,
			}),
			AbortSignal.timeout(5_000),
		);
	await withFileLock(lock, { timeout: 1_000 }, () =>
		assert.rejects(place(), {
			code: "DrawingLocked",
			message: `The drawing is locked by another process. Lock file: ${lock}`,
		}),
	);
	assert.ok((await place()).ok);
});

test("recovering one lock leaves the leftovers of other locks in the folder alone", async (context) => {
	const fixture = await drawing(context);
	const other = lockLeftoverTag("other.ecaddraw.lock");
	const dead = async () => lockContent({ pid: await exitedPid() });
	const otherFiles = [
		"other.ecaddraw.lock",
		`.ecad-lock-${other}-${randomUUID()}.tmp`,
		`.ecad-claim-${other}-${randomUUID()}`,
	];
	for (const name of otherFiles)
		await writeFile(join(fixture.directory, name), await dead());
	const ownFiles = [
		`.ecad-lock-${tag}-${randomUUID()}.tmp`,
		`.ecad-claim-${tag}-${randomUUID()}`,
	];
	for (const name of ownFiles)
		await writeFile(join(fixture.directory, name), await dead());
	await writeFile(`${fixture.path}.lock`, await dead());
	assert.ok(
		(
			await runEffect(
				createLocalDrawing({ path: fixture.path, lockTimeout: 25 }).execute({
					type: "placeRectangle",
					input: rectangle,
				}),
			)
		).ok,
	);
	assert.deepEqual(
		new Set(await readdir(fixture.directory)),
		new Set([...drawingFiles, ...otherFiles]),
	);
});

test("recovery removes leftovers of killed processes, and a process whose copy was removed stages a new one", async (context) => {
	const fixture = await drawing(context);
	const twoMinutesAgo = new Date(Date.now() - 120_000);
	const file = async (name: string, content: string, old = false) => {
		await writeFile(join(fixture.directory, name), content);
		if (old)
			await utimes(join(fixture.directory, name), twoMinutesAgo, twoMinutesAgo);
	};
	const fresh = `.ecad-lock-${tag}-${randomUUID()}.tmp`;
	await file(`.ecad-lock-${tag}-${randomUUID()}.tmp`, "", true);
	await file(
		`.ecad-lock-${tag}-${randomUUID()}.tmp`,
		lockContent({ pid: await exitedPid() }),
	);
	await file(fresh, "");
	await file(".ecad-lock-notes.tmp", "", true);
	await file(`.ecad-lock-${"a".repeat(36)}.tmp`, "", true);
	// A claim whose lock is gone, left by a process killed after removing the lock.
	await file(
		`.ecad-claim-${tag}-${randomUUID()}`,
		lockContent({ pid: await exitedPid() }),
	);
	await file("drawing.ecaddraw.lock", lockContent({ pid: await exitedPid() }));
	assert.ok(
		(
			await runEffect(
				createLocalDrawing({ path: fixture.path, lockTimeout: 25 }).execute({
					type: "placeRectangle",
					input: rectangle,
				}),
			)
		).ok,
	);
	const kept = new Set([
		...drawingFiles,
		fresh,
		".ecad-lock-notes.tmp",
		`.ecad-lock-${"a".repeat(36)}.tmp`,
	]);
	assert.deepEqual(new Set(await readdir(fixture.directory)), kept);
	const lockFaults = fileURLToPath(
		new URL("./helpers/lock-faults.ts", import.meta.url),
	);
	const result = await startCli(
		["placeRectangle", JSON.stringify(rectangle)],
		{ ...fixture.env, ECAD_TEST_DROP_COPY: "1" },
		"",
		{ imports: [lockFaults] },
	).result;
	assert.equal(result.code, 0, result.stderr || result.stdout);
	assert.equal((await fixture.read()).shapes.length, 2);
	assert.deepEqual(new Set(await readdir(fixture.directory)), kept);
});

test("recovery skips FIFOs and symbolic links named like claims or lock copies", {
	skip: process.platform === "win32",
}, async (context) => {
	const fixture = await drawing(context);
	const special = [
		`.ecad-claim-${tag}-${randomUUID()}`,
		`.ecad-lock-${tag}-${randomUUID()}.tmp`,
	];
	for (const name of special)
		await once(spawn("mkfifo", [join(fixture.directory, name)]), "exit");
	const link = `.ecad-lock-${tag}-${randomUUID()}.tmp`;
	await symlink("/dev/zero", join(fixture.directory, link));
	await writeFile(
		`${fixture.path}.lock`,
		lockContent({ pid: await exitedPid() }),
	);
	const work = startCli(
		["--timeout", "1000", "placeRectangle", JSON.stringify(rectangle)],
		fixture.env,
	);
	const result = await Promise.race([
		work.result,
		delay(30_000).then(() => undefined),
	]);
	if (!result) work.child.kill("SIGKILL");
	assert.equal(
		result?.code,
		0,
		result ? result.stderr || result.stdout : "the command hung",
	);
	assert.deepEqual(
		new Set(await readdir(fixture.directory)),
		new Set([...drawingFiles, ...special, link]),
	);
});

test("a dangling symbolic link as the lock times out like a held lock", {
	skip: process.platform === "win32",
}, async (context) => {
	const fixture = await drawing(context);
	await symlink(join(fixture.directory, "missing"), `${fixture.path}.lock`);
	const started = performance.now();
	await assert.rejects(
		runEffect(
			createLocalDrawing({ path: fixture.path, lockTimeout: 25 }).execute({
				type: "getDrawing",
			}),
			AbortSignal.timeout(5_000),
		),
		{ code: "DrawingLocked" },
	);
	assert.ok(performance.now() - started < 5_000);
	assert.deepEqual(await readdir(fixture.directory), ["drawing.ecaddraw.lock"]);
});

test("local drawing module cancels a lock wait without removing another owner's lock", async (context) => {
	const fixture = await drawing(context);
	await writeFile(`${fixture.path}.lock`, "another owner");
	const signal = AbortSignal.timeout(50);
	await assert.rejects(
		runEffect(
			createLocalDrawing({ path: fixture.path }).execute({
				type: "placeRectangle",
				input: rectangle,
			}),
			signal,
		),
	);
	assert.equal(await readFile(`${fixture.path}.lock`, "utf8"), "another owner");
});

test("saving keeps the drawing and history file modes", {
	skip: process.platform === "win32",
}, async (context) => {
	const fixture = await drawing(context);
	const historyPath = `${fixture.path}.history.json`;
	const local = createLocalDrawing({ path: fixture.path });
	await writeFile(fixture.path, JSON.stringify({ shapes: [] }));
	await chmod(fixture.path, 0o4700);
	assert.ok(
		(
			await runEffect(
				local.execute({ type: "placeRectangle", input: rectangle }),
			)
		).ok,
	);
	assert.equal(await fileMode(fixture.path), 0o4700);
	assert.equal(
		await fileMode(historyPath),
		0o700,
		"a new history copies the drawing's permission bits",
	);
	await chmod(fixture.path, 0o664);
	await chmod(historyPath, 0o640);
	await call(fixture.env, "placeRectangle", rectangle);
	assert.equal(await fileMode(fixture.path), 0o664);
	assert.equal(await fileMode(historyPath), 0o640);
	await call(fixture.env, "undo");
	assert.equal(await fileMode(fixture.path), 0o664);
	assert.equal(await fileMode(historyPath), 0o640);
	assert.equal((await fixture.read()).shapes.length, 1);
	await chmod(fixture.path, 0o6755);
	assert.ok((await runEffect(local.execute({ type: "redo" }))).ok);
	assert.equal(
		await fileMode(fixture.path),
		0o6755,
		"writing does not clear preserved set-ID bits",
	);
});

test("saving a new drawing applies the umask to the default mode", {
	skip: process.platform === "win32",
}, async (context) => {
	const fixture = await drawing(context);
	const previous = process.umask(0o027);
	context.after(() => {
		process.umask(previous);
	});
	assert.ok(
		(
			await runEffect(
				createLocalDrawing({ path: fixture.path }).execute({
					type: "placeRectangle",
					input: rectangle,
				}),
			)
		).ok,
	);
	assert.equal(await fileMode(fixture.path), 0o640);
	assert.equal(await fileMode(`${fixture.path}.history.json`), 0o640);
});

test("stdio MCP logs malformed input lines to stderr and keeps serving", async (context) => {
	const fixture = await drawing(context);
	const child = spawn(process.execPath, ["--import", "tsx", cliMain, "mcp"], {
		env: { ...process.env, ...fixture.env },
		stdio: "pipe",
	});
	context.after(() => {
		child.kill();
	});
	let stderr = "";
	child.stderr.setEncoding("utf8").on("data", (chunk) => {
		stderr += chunk;
	});
	const lines = createInterface({ input: child.stdout })[
		Symbol.asyncIterator
	]();
	const send = (message: unknown) =>
		child.stdin.write(
			`${typeof message === "string" ? message : JSON.stringify(message)}\n`,
		);
	const request = async (
		id: number,
		method: string,
		params: Record<string, unknown>,
	) => {
		send({ jsonrpc: "2.0", id, method, params });
		const line = await lines.next();
		assert.equal(line.done, false);
		const reply = JSON.parse(line.value);
		assert.equal(reply.id, id, line.value);
		return reply;
	};
	send("garbage");
	send({ jsonrpc: "1.0", id: 7, method: "initialize" });
	const initialized = await request(1, "initialize", {
		protocolVersion: "2025-03-26",
		capabilities: {},
		clientInfo: { name: "test", version: "1.0.0" },
	});
	assert.equal(initialized.result.serverInfo.name, "ecad-drawing");
	send({ jsonrpc: "2.0", method: "notifications/initialized" });
	send("{");
	const placed = await request(2, "tools/call", {
		name: "placeRectangle",
		arguments: rectangle,
	});
	assert.equal(placed.result.structuredContent.ok, true);
	assert.equal((await fixture.read()).shapes.length, 1);
	child.stdin.end();
	const [code] = await once(child, "close");
	assert.equal(code, 0);
	assert.equal(
		(await lines.next()).done,
		true,
		"stdout carries only MCP replies",
	);
	const logged = stderr.trimEnd().split("\n");
	assert.equal(logged.length, 3, stderr);
	assert.match(logged[0], /^ecad: MCP error: .*not valid JSON/);
	assert.equal(
		logged[1],
		"ecad: MCP error: Ignored a message that is not valid JSON-RPC.",
	);
	assert.match(logged[2], /^ecad: MCP error: .*JSON/);
});

test("stdio module reports an input stream failure once", async (context) => {
	const fixture = await drawing(context);
	const input = new PassThrough();
	let error = "";
	const errors = new PassThrough();
	errors.on("data", (chunk) => {
		error += chunk;
	});
	const work = runCli(["mcp"], {
		env: fixture.env,
		input,
		output: new PassThrough(),
		error: errors,
	});
	await new Promise((resolve) => setImmediate(resolve));
	input.destroy(new Error("stdin failed"));
	assert.equal(await work, 1);
	assert.equal(error, "ecad: stdin failed\n");
});

test("stdio module reports an output failure that follows stdin EOF", async (context) => {
	const fixture = await drawing(context);
	for (const outputFailsFirst of [false, true]) {
		const input = new PassThrough();
		const output = new PassThrough();
		let error = "";
		const errors = new PassThrough();
		errors.on("data", (chunk) => {
			error += chunk;
		});
		const work = runCli(["mcp"], {
			env: fixture.env,
			input,
			output,
			error: errors,
		});
		await new Promise((resolve) => setImmediate(resolve));
		if (outputFailsFirst) output.destroy(new Error("write failed"));
		input.end();
		if (!outputFailsFirst) output.destroy(new Error("write failed"));
		assert.equal(await work, 1, `output fails first: ${outputFailsFirst}`);
		assert.equal(error, "ecad: write failed\n");
	}
});

test("stdio module keeps serving when stderr fails", async (context) => {
	const fixture = await drawing(context);
	const input = new PassThrough();
	const output = new PassThrough();
	const errors = new Writable({
		write(_chunk, _encoding, callback) {
			callback(new Error("stderr closed"));
		},
	});
	const work = runCli(["mcp"], {
		env: fixture.env,
		input,
		output,
		error: errors,
	});
	input.write("garbage\n");
	await new Promise((resolve) => setImmediate(resolve));
	input.write("more garbage\n");
	input.write(
		`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "test", version: "1.0.0" } } })}\n`,
	);
	const [reply] = await once(output, "data");
	assert.equal(JSON.parse(String(reply)).id, 1);
	input.end();
	assert.equal(await work, 0);
});

test("stdio module keeps a diagnostic write that fails after stdin EOF handled", async (context) => {
	const fixture = await drawing(context);
	const input = new PassThrough();
	let failWrite!: () => void;
	let logged!: () => void;
	const written = new Promise<void>((resolve) => {
		logged = resolve;
	});
	const errors = new Writable({
		write(_chunk, _encoding, callback) {
			logged();
			failWrite = () => callback(new Error("stderr closed"));
		},
	});
	const work = runCli(["mcp"], {
		env: fixture.env,
		input,
		output: new PassThrough(),
		error: errors,
	});
	input.write("garbage\n");
	await written;
	input.end();
	assert.equal(await work, 0);
	// The pending diagnostic fails after shutdown. Stderr only carries
	// diagnostics, so its failure must stay handled.
	failWrite();
	await new Promise((resolve) => setImmediate(resolve));
	assert.ok(errors.destroyed);
});

test("stdio module reports a reply write that fails after stdin EOF", async (context) => {
	const fixture = await drawing(context);
	const input = new PassThrough();
	let submitted!: () => void;
	const replied = new Promise<void>((resolve) => {
		submitted = resolve;
	});
	const output = new Writable({
		write(_chunk, _encoding, callback) {
			submitted();
			setTimeout(() => callback(new Error("write failed")), 50);
		},
	});
	let error = "";
	const errors = new PassThrough();
	errors.on("data", (chunk) => {
		error += chunk;
	});
	const work = runCli(["mcp"], {
		env: fixture.env,
		input,
		output,
		error: errors,
	});
	input.write(
		`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "test", version: "1.0.0" } } })}\n`,
	);
	await replied;
	input.end();
	assert.equal(await work, 1);
	assert.equal(error, "ecad: write failed\n");
});

test("stdio module handles a reply write that fails after an abort", async (context) => {
	const fixture = await drawing(context);
	const input = new PassThrough();
	let submitted!: () => void;
	const replied = new Promise<void>((resolve) => {
		submitted = resolve;
	});
	let failWrite!: () => void;
	const output = new Writable({
		write(_chunk, _encoding, callback) {
			submitted();
			failWrite = () => callback(new Error("write failed"));
		},
	});
	const controller = new AbortController();
	const work = runCli(["mcp"], {
		env: fixture.env,
		input,
		output,
		error: new PassThrough(),
		signal: controller.signal,
	});
	input.write(
		`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "test", version: "1.0.0" } } })}\n`,
	);
	await replied;
	controller.abort();
	assert.equal(await work, 0, "an abort does not wait for stdout");
	// The pending write fails after the server returned. The stream error must
	// stay handled, or the test process would crash.
	failWrite();
	await new Promise((resolve) => setImmediate(resolve));
	assert.ok(output.destroyed);
	input.destroy();
});

test("stdio module shortens long errors and fails when the transport closes after an oversized message", async (context) => {
	const fixture = await drawing(context);
	const input = new PassThrough();
	let error = "";
	const errors = new PassThrough();
	errors.on("data", (chunk) => {
		error += chunk;
	});
	const work = runCli(["mcp"], {
		env: fixture.env,
		input,
		output: new PassThrough(),
		error: errors,
	});
	input.write("\u001b]0;title\u0007\u202e\u0085\r\n");
	input.write(
		`${JSON.stringify({ jsonrpc: "2.0", id: 99, result: { padding: "x".repeat(200_000) } })}\n`,
	);
	input.write("x".repeat(11 * 1024 * 1024));
	assert.equal(await work, 1);
	const lines = error.trimEnd().split("\n");
	assert.equal(lines.length, 4, error.slice(0, 2000));
	assert.match(lines[0], /^ecad: MCP error: .*not valid JSON/);
	assert.ok(
		lines.every((entry) => !/[\p{Cc}\p{Cf}]/u.test(entry)),
		JSON.stringify(lines[0]),
	);
	assert.ok(
		lines[1].startsWith(
			"ecad: MCP error: Received a response for an unknown message ID",
		) && lines[1].length < 600,
		lines[1].slice(0, 200),
	);
	assert.match(lines[2], /^ecad: MCP error: ReadBuffer exceeded maximum size/);
	assert.equal(
		lines[3],
		"ecad: The MCP transport closed after an input error.",
	);
	input.destroy();
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
	assert.equal(read.drawing.shapes.length, 2);
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
	assert.equal(
		(await call(fixture.env, "getDrawing")).drawing.history.nodes.length,
		6,
	);
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

test("stdio MCP exits promptly on SIGTERM while replies wait for a reader", {
	skip: process.platform === "win32",
}, async (context) => {
	const fixture = await drawing(context);
	const shapes = Array.from({ length: 20_000 }, (_, index) => ({
		...rectangle,
		kind: "rectangle",
		id: index + 1,
	}));
	await writeFile(fixture.path, JSON.stringify({ shapes }));
	const child = spawn(process.execPath, ["--import", "tsx", cliMain, "mcp"], {
		env: { ...process.env, ...fixture.env },
		stdio: ["pipe", "pipe", "ignore"],
	});
	context.after(() => {
		child.kill("SIGKILL");
	});
	const exited = once(child, "exit");
	const send = (message: unknown) =>
		child.stdin.write(`${JSON.stringify(message)}\n`);
	send({
		jsonrpc: "2.0",
		id: 1,
		method: "initialize",
		params: {
			protocolVersion: "2025-03-26",
			capabilities: {},
			clientInfo: { name: "test", version: "1.0.0" },
		},
	});
	send({ jsonrpc: "2.0", method: "notifications/initialized" });
	for (const id of [2, 3])
		send({
			jsonrpc: "2.0",
			id,
			method: "tools/call",
			params: { name: "getDrawing", arguments: {} },
		});
	// Read into the first drawing reply, then stop reading, so megabytes of
	// replies stay queued in the server.
	await new Promise<void>((resolve) => {
		let received = 0;
		const onData = (chunk: Buffer) => {
			received += chunk.length;
			if (received < 100_000) return;
			child.stdout.off("data", onData);
			child.stdout.pause();
			resolve();
		};
		child.stdout.on("data", onData);
	});
	child.stdin.end();
	await delay(500);
	child.kill("SIGTERM");
	const [code] = await Promise.race([
		exited,
		delay(10_000).then(() => ["still running"]),
	]);
	assert.equal(code, 143);
});

test("CLI and stdio MCP finish releasing the lock before exiting on a signal", async (context) => {
	const fixture = await drawing(context);
	const lockFaults = fileURLToPath(
		new URL("./helpers/lock-faults.ts", import.meta.url),
	);
	const env = { ...fixture.env, ECAD_TEST_SIGNAL_ON_RELEASE: "SIGTERM" };
	const signals =
		process.platform === "win32"
			? ([["SIGTERM", 143]] as const)
			: ([
					["SIGTERM", 143],
					["SIGINT", 130],
					["SIGHUP", 129],
				] as const);
	for (const [signal, exitCode] of signals) {
		const command = await startCli(
			["getDrawing"],
			{ ...env, ECAD_TEST_SIGNAL_ON_RELEASE: signal },
			"",
			{ imports: [lockFaults] },
		).result;
		assert.equal(command.code, exitCode, `${signal}: ${command.stderr}`);
		assert.deepEqual(
			await readdir(fixture.directory),
			[],
			`${signal}: the lock was released`,
		);
	}
	const initialize = {
		jsonrpc: "2.0",
		id: 1,
		method: "initialize",
		params: {
			protocolVersion: "2025-03-26",
			capabilities: {},
			clientInfo: { name: "test", version: "1.0.0" },
		},
	};
	const call = {
		jsonrpc: "2.0",
		id: 2,
		method: "tools/call",
		params: { name: "getDrawing", arguments: {} },
	};
	// Stdin stays open, so only the signal stops the server.
	const server = spawn(
		process.execPath,
		["--import", "tsx", "--import", lockFaults, cliMain, "mcp"],
		{ env: { ...process.env, ...env }, stdio: ["pipe", "ignore", "inherit"] },
	);
	context.after(() => {
		server.kill("SIGKILL");
	});
	server.stdin.write(
		`${JSON.stringify(initialize)}\n${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n${JSON.stringify(call)}\n`,
	);
	const [code] = await once(server, "exit");
	assert.equal(code, 143);
	assert.deepEqual(
		await readdir(fixture.directory),
		[],
		"the lock was released",
	);
});

test("stdio module handles an output destroyed during abort cleanup", async (context) => {
	const fixture = await drawing(context);
	const input = new PassThrough();
	let replied!: () => void;
	const reply = new Promise<void>((resolve) => {
		replied = resolve;
	});
	// Destruction finishes later, so the output is destroyed but has not yet
	// emitted its error or closed when the server cleans up.
	const output = new Writable({
		write(_chunk, _encoding, callback) {
			replied();
			callback();
		},
		destroy(error, callback) {
			setTimeout(() => callback(error), 20);
		},
	});
	const controller = new AbortController();
	const work = runCli(["mcp"], {
		env: fixture.env,
		input,
		output,
		error: new PassThrough(),
		signal: controller.signal,
	});
	input.write(
		`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "test", version: "1.0.0" } } })}\n`,
	);
	await reply;
	controller.abort();
	output.destroy(new Error("destroyed"));
	assert.equal(await work, 0);
	await delay(50);
	assert.ok(output.closed);
	input.destroy();
});

test("stdio module releases input listeners when cancelled", async (context) => {
	const fixture = await drawing(context);
	const input = new PassThrough();
	const output = new PassThrough();
	const controller = new AbortController();
	const work = runCli(["mcp"], {
		env: fixture.env,
		input,
		output,
		signal: controller.signal,
	});
	input.write(
		`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "test", version: "1.0.0" } } })}\n`,
	);
	await once(output, "data");
	controller.abort();
	assert.equal(await work, 0);
	assert.equal(input.listenerCount("data"), 0);
	assert.equal(input.listenerCount("end"), 0);
	input.destroy();
	output.destroy();
});

test("CLI module supports injected streams and local command execution", async (context) => {
	const fixture = await drawing(context);
	let output = "";
	const stream = new PassThrough();
	stream.on("data", (chunk) => {
		output += chunk;
	});
	assert.equal(
		await runCli(["placeRectangle", "-"], {
			env: fixture.env,
			input: Readable.from([JSON.stringify(rectangle)]),
			output: stream,
		}),
		0,
	);
	assert.equal(JSON.parse(output).structuredContent.ok, true);
	assert.equal((await fixture.read()).shapes.length, 1);
});

test("CLI keeps persisted edit history bounded across invocations and branches", async (context) => {
	const fixture = await drawing(context);
	const local = createLocalDrawing({ path: fixture.path });
	await runEffect(local.execute({ type: "placeRectangle", input: rectangle }));
	for (let i = 1; i <= 120; i++) {
		assert.ok(
			(
				await runEffect(
					local.execute({
						type: "replaceShapes",
						shapes: [{ ...rectangle, kind: "rectangle", id: 1, x: i }],
					}),
				)
			).ok,
		);
		const saved = JSON.parse(
			await readFile(`${fixture.path}.history.json`, "utf8"),
		);
		assert.ok(Object.keys(saved.snapshot.history.nodes).length <= 100);
	}
	const atTip = await call(fixture.env, "getDrawing");
	assert.equal(atTip.drawing.history.nodes.length, 100);
	await call(fixture.env, "undo");
	const branch = await call(fixture.env, "replaceShapes", {
		shapes: [{ ...rectangle, kind: "rectangle", id: 1, x: -1 }],
	});
	assert.equal(branch.drawing.history.nodes.length, 100);
	assert.ok(branch.drawing.history.currentId > atTip.drawing.history.currentId);
	assert.equal(
		(
			await call(fixture.env, "jumpHistory", {
				id: atTip.drawing.history.currentId,
			})
		).drawing.shapes[0].x,
		120,
	);
	assert.equal(
		(
			await call(fixture.env, "jumpHistory", {
				id: branch.drawing.history.currentId,
			})
		).drawing.shapes[0].x,
		-1,
	);
	assert.equal(
		(await call(fixture.env, "redo")).drawing.history.currentId,
		branch.drawing.history.currentId,
	);
	const saved = JSON.parse(
		await readFile(`${fixture.path}.history.json`, "utf8"),
	);
	assert.ok(drawingSnapshotSchema.safeParse(saved.snapshot).success);
});

for (const currentId of [0, 75, 250]) {
	test(`CLI compacts legacy oversized history at node ${currentId} and reloads the saved tree`, async (context) => {
		const fixture = await drawing(context);
		const shapes = (id: number) => [
			{ ...rectangle, kind: "rectangle", id: 1, x: id },
		];
		const content = JSON.stringify({
			shapes: shapes(currentId),
			title: "Legacy drawing",
		});
		const snapshot = {
			shapes: shapes(currentId),
			nextShapeId: 2,
			history: {
				currentId,
				nextId: 251,
				nodes: Object.fromEntries(
					Array.from({ length: 251 }, (_, id) => [
						id,
						{
							id,
							parentId: id === 0 ? null : id - 1,
							childIds: id === 250 ? [] : [id + 1],
							preferredChildId: id === 250 ? null : id + 1,
							label: `Legacy ${id}`,
							state: { shapes: shapes(id) },
						},
					]),
				),
			},
		};
		assert.ok(drawingSnapshotSchema.safeParse(snapshot).success);
		await writeFile(fixture.path, content);
		await writeFile(
			`${fixture.path}.history.json`,
			JSON.stringify({
				version: 1,
				drawingHash: createHash("sha256").update(content).digest("hex"),
				snapshot,
			}),
		);
		if (process.platform !== "win32")
			await chmod(`${fixture.path}.history.json`, 0o640);
		const read = await call(fixture.env, "getDrawing");
		assert.equal(read.drawing.history.nodes.length, 100);
		assert.equal(read.drawing.history.currentId, currentId);
		assert.equal(read.drawing.shapes[0].x, currentId);
		const saved = JSON.parse(
			await readFile(`${fixture.path}.history.json`, "utf8"),
		);
		assert.equal(Object.keys(saved.snapshot.history.nodes).length, 100);
		assert.equal(saved.version, 1);
		assert.ok(drawingSnapshotSchema.safeParse(saved.snapshot).success);
		assert.equal((await fixture.read()).title, "Legacy drawing");
		if (process.platform !== "win32")
			assert.equal(await fileMode(`${fixture.path}.history.json`), 0o640);
		assert.equal(
			(await call(fixture.env, "getDrawing")).drawing.history.currentId,
			currentId,
		);
		const edit = await call(fixture.env, "replaceShapes", {
			shapes: shapes(-1),
		});
		assert.equal(edit.drawing.history.currentId, 251);
		assert.equal(
			(await call(fixture.env, "undo")).drawing.history.currentId,
			currentId,
		);
		assert.equal(
			(await call(fixture.env, "redo")).drawing.history.currentId,
			251,
		);
	});
}
