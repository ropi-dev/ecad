import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	chmodSync,
	copyFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	statSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const sandbox = resolve(root, "scripts/development/sandbox.ts");

function fixtureCommands(directory: string): void {
	for (const [name, output] of Object.entries({
		git: "fixture-revision",
		cat: "fixture-host",
		lscpu: "0,0,0,Y\n1,0,0,Y\n2,1,0,Y\n3,1,0,Y\n4,2,0,Y\n5,2,0,Y",
	})) {
		const path = join(directory, name);
		writeFileSync(
			path,
			`#!/usr/bin/env node\nconsole.log(${JSON.stringify(output)});\n`,
		);
		chmodSync(path, 0o755);
	}
}

test("sandbox forwards perf settings and confines custom baselines to persistent artifacts", {
	skip: process.platform !== "linux",
}, () => {
	const directory = mkdtempSync(join(tmpdir(), "ecad-runner-env-"));
	const engine = join(directory, "engine");
	const output = join(directory, "args.json");
	fixtureCommands(directory);
	mkdirSync(join(directory, "locks"));
	writeFileSync(
		engine,
		`#!/usr/bin/env node\nconst fs=require('node:fs'); if(process.argv[2]==='image') console.log('fixture-image'); else fs.writeFileSync(process.env.ECAD_TEST_ARGS,JSON.stringify(process.argv.slice(2)));\n`,
	);
	chmodSync(engine, 0o755);
	const env = {
		...process.env,
		PATH: `${directory}${delimiter}${process.env.PATH}`,
		ECAD_CONTAINER_ENGINE: engine,
		ECAD_LOCK_DIR: join(directory, "locks"),
		ECAD_TEST_ARGS: output,
		ECAD_PERF_CPU: "2",
		ECAD_PERF_RUNS: "5",
		ECAD_PERF_PORT: "4888",
		ECAD_PERF_BASELINE_PATH: "custom/baseline.json",
	};
	try {
		const result = spawnSync(process.execPath, [sandbox, "perf", "--list"], {
			env,
			encoding: "utf8",
		});
		assert.equal(result.status, 0, result.stderr);
		const args: string[] = JSON.parse(readFileSync(output, "utf8"));
		for (const setting of [
			"ECAD_PERF_CPU=2",
			"ECAD_PERF_RUNS=5",
			"ECAD_PERF_PORT=4888",
			"ECAD_PERF_BASELINE_PATH=/tmp/ecad-artifacts/custom/baseline.json",
		])
			assert.ok(args.includes(setting), setting);
		for (const invalid of ["../outside.json", "/tmp/outside.json"]) {
			rmSync(output);
			const invalidResult = spawnSync(process.execPath, [sandbox, "perf"], {
				env: { ...env, ECAD_PERF_BASELINE_PATH: invalid },
				encoding: "utf8",
			});
			assert.notEqual(invalidResult.status, 0);
			assert.match(
				invalidResult.stderr,
				/must be relative to its artifact directory/,
			);
			assert.equal(existsSync(output), false);
			writeFileSync(output, "");
		}
	} finally {
		rmSync(directory, { recursive: true });
	}
});

test("native perf executes its worker on simulated non-Linux hosts", {
	skip: process.platform !== "linux",
}, () => {
	const directory = mkdtempSync(join(tmpdir(), "ecad-native-platform-"));
	const calls = join(directory, "calls");
	const pnpm = join(directory, "pnpm");
	writeFileSync(
		pnpm,
		`#!/usr/bin/env node\nrequire('node:fs').appendFileSync(process.env.ECAD_TEST_CALLS,JSON.stringify(process.argv.slice(2))+'\\n');\n`,
	);
	chmodSync(pnpm, 0o755);
	symlinkSync(
		join(root, "node_modules"),
		join(directory, "node_modules"),
		"dir",
	);
	try {
		for (const platform of ["darwin", "win32"]) {
			writeFileSync(calls, "");
			const program = `import 'node:path'; import 'node:os'; Object.defineProperty(process,'platform',{value:${JSON.stringify(platform)}}); await import(${JSON.stringify(new URL("../scripts/performance/run.ts", import.meta.url).href)});`;
			const env: NodeJS.ProcessEnv = {
				...process.env,
				PATH: `${directory}${delimiter}${process.env.PATH}`,
				ECAD_TEST_CALLS: calls,
			};
			delete env.ECAD_PERF_LOCK_HELD;
			delete env.ECAD_ARTIFACT_DIR;
			const result = spawnSync(
				process.execPath,
				["--input-type=module", "-e", program],
				{ cwd: directory, env, encoding: "utf8" },
			);
			assert.equal(result.status, 0, result.stderr);
			assert.match(result.stderr, /queue is Linux-only/);
			const commands = readFileSync(calls, "utf8")
				.trim()
				.split("\n")
				.map((line) => JSON.parse(line));
			assert.deepEqual(commands.slice(0, 2), [
				["run", "build:web"],
				["run", "build:cli"],
			]);
			assert.deepEqual(commands[2].slice(0, 3), ["exec", "playwright", "test"]);
		}
	} finally {
		rmSync(directory, { recursive: true });
	}
});

test("fresh checkout mount points remain owned by the developer", {
	skip: process.platform !== "linux",
}, () => {
	const directory = mkdtempSync(join(tmpdir(), "ecad-fresh-mounts-"));
	const scripts = join(directory, "scripts/development");
	mkdirSync(scripts, { recursive: true });
	mkdirSync(join(directory, "packages/core"), { recursive: true });
	for (const name of [
		"sandbox.ts",
		"common.ts",
		"locked-command.ts",
		"artifacts.ts",
		"Containerfile",
		"entrypoint.sh",
	])
		copyFileSync(join(root, "scripts/development", name), join(scripts, name));
	const engine = join(directory, "engine");
	writeFileSync(
		engine,
		"#!/usr/bin/env node\nif(process.argv[2]==='image') console.log('fixture-image');\n",
	);
	chmodSync(engine, 0o755);
	try {
		const result = spawnSync(
			process.execPath,
			[join(scripts, "sandbox.ts"), "dev"],
			{
				env: {
					...process.env,
					PATH: `${directory}${delimiter}${process.env.PATH}`,
					ECAD_CONTAINER_ENGINE: engine,
					ECAD_LOCK_DIR: join(directory, "locks"),
				},
				encoding: "utf8",
			},
		);
		assert.equal(result.status, 0, result.stderr);
		for (const path of ["node_modules", "packages/core/node_modules"]) {
			assert.equal(statSync(join(directory, path)).uid, process.getuid?.());
			assert.equal(statSync(join(directory, path)).isDirectory(), true);
		}
	} finally {
		rmSync(directory, { recursive: true });
	}
});
