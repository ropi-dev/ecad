import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createCliDrawing } from "./helpers/cli-mcp.ts";

const run = promisify(execFile);

test("built CLI and stdio MCP work outside the repository with networking and UI imports blocked", async (context) => {
	const fixture = await createCliDrawing();
	context.after(() => fixture.close());
	const source = fileURLToPath(new URL("../packages/cli", import.meta.url));
	await run(process.execPath, ["scripts/build.mjs"], { cwd: source });
	await cp(join(source, "dist"), join(fixture.directory, "dist"), {
		recursive: true,
	});
	assert.match(
		await readFile(join(fixture.directory, "dist", "LICENSE.txt"), "utf8"),
		/MIT License/,
	);
	const notices = await readFile(
		join(fixture.directory, "dist", "THIRD_PARTY_NOTICES.txt"),
		"utf8",
	);
	assert.match(notices, /effect@/);
	assert.match(notices, /zod@/);
	await cp(join(source, "bin"), join(fixture.directory, "bin"), {
		recursive: true,
	});
	await writeFile(
		join(fixture.directory, "package.json"),
		JSON.stringify({ type: "module" }),
	);
	for (const name of ["effect", "zod", "@modelcontextprotocol/sdk"]) {
		const dependency = fileURLToPath(
			new URL(`../node_modules/${name}`, import.meta.url),
		);
		const target = join(fixture.directory, "node_modules", name);
		await mkdir(join(target, ".."), { recursive: true });
		await symlink(dependency, target, "dir");
	}
	const guard = join(fixture.directory, "guard.mjs");
	await writeFile(
		guard,
		`import { registerHooks } from "node:module";
registerHooks({ resolve(specifier, context, next) {
  if (/^(?:@ecad\\/|react(?:$|[/-])|three(?:$|\\/))/.test(specifier)) throw new Error("Unexpected app dependency: " + specifier);
  return next(specifier, context);
} });
globalThis.fetch = () => { throw new Error("Networking is unavailable"); };
`,
	);
	const executable = join(fixture.directory, "bin", "ecad.mjs");
	const args = ["--import", guard, executable];
	const { stdout, stderr } = await run(
		process.execPath,
		[
			...args,
			"placeRectangle",
			JSON.stringify({
				x: 0,
				y: 0,
				width: 10,
				height: 20,
				rotation: 0,
				lineWidth: 0.2,
			}),
		],
		{ cwd: fixture.directory },
	);
	assert.equal(stderr, "");
	assert.equal(JSON.parse(stdout).structuredContent.ok, true);
	const client = new Client({
		name: "standalone-package-test",
		version: "1.0.0",
	});
	context.after(() => client.close());
	await client.connect(
		new StdioClientTransport({
			command: process.execPath,
			args: [...args, "mcp"],
			cwd: fixture.directory,
		}),
	);
	assert.equal((await client.listTools()).tools.length, 9);
	const result = await client.callTool({ name: "undo", arguments: {} });
	assert.notEqual(result.isError, true);
	assert.deepEqual(JSON.parse(await readFile(fixture.path, "utf8")).shapes, []);
});
