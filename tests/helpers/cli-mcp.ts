import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const cliMain = fileURLToPath(
	new URL("../../packages/cli/src/main.ts", import.meta.url),
);
/** A/B performance runs point the base variant at the base commit's CLI. */
export const cliExecutable =
	process.env.ECAD_CLI_EXECUTABLE ??
	fileURLToPath(new URL("../../packages/cli/bin/ecad.mjs", import.meta.url));
const tsxLoader = fileURLToPath(import.meta.resolve("tsx"));

export function startCli(
	args: string[],
	env: NodeJS.ProcessEnv = {},
	input = "",
	options: { built?: boolean; cwd?: string; imports?: string[] } = {},
) {
	const imports = (options.imports ?? []).flatMap((path) => ["--import", path]);
	const child = spawn(
		process.execPath,
		options.built
			? [...imports, cliExecutable, ...args]
			: ["--import", tsxLoader, ...imports, cliMain, ...args],
		{
			cwd: options.cwd,
			env: { ...process.env, ECAD_DRAWING: "", ...env },
			stdio: ["pipe", "pipe", "pipe"],
		},
	);
	let stdout = "";
	let stderr = "";
	child.stdout.setEncoding("utf8").on("data", (chunk) => {
		stdout += chunk;
	});
	child.stderr.setEncoding("utf8").on("data", (chunk) => {
		stderr += chunk;
	});
	child.stdin.end(input);
	return {
		child,
		result: once(child, "close").then(([code, signal]) => ({
			code,
			signal,
			stdout,
			stderr,
		})),
	};
}

export async function createCliDrawing() {
	const directory = await mkdtemp(join(tmpdir(), "ecad-cli-"));
	const path = join(directory, "drawing.ecaddraw");
	return {
		path,
		directory,
		env: { ECAD_DRAWING: path },
		async read() {
			return JSON.parse(await readFile(path, "utf8"));
		},
		async close() {
			await rm(directory, { recursive: true, force: true });
		},
	};
}
