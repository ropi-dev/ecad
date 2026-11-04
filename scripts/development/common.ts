import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export function worktreeId(root = process.cwd()): string {
	return createHash("sha256")
		.update(realpathSync(root))
		.digest("hex")
		.slice(0, 12);
}

export function lockDirectory(): string {
	const directory =
		process.env.ECAD_LOCK_DIR ??
		join("/tmp", `ecad-locks-${process.getuid?.() ?? "user"}`);
	mkdirSync(directory, { recursive: true, mode: 0o700 });
	return directory;
}

export function run(
	command: string,
	args: string[],
	env = process.env,
): Promise<number> {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, {
			stdio: "inherit",
			env,
			detached: process.platform !== "win32",
		});
		const forward = (signal: NodeJS.Signals) => {
			if (child.pid) {
				try {
					if (process.platform === "win32") child.kill(signal);
					else process.kill(-child.pid, signal);
				} catch (error) {
					if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
				}
			}
		};
		process.on("SIGINT", forward);
		process.on("SIGTERM", forward);
		process.on("SIGHUP", forward);
		const cleanup = () => {
			process.off("SIGINT", forward);
			process.off("SIGTERM", forward);
			process.off("SIGHUP", forward);
		};
		child.once("error", (error) => {
			cleanup();
			reject(error);
		});
		child.once("exit", (code, signal) => {
			cleanup();
			resolve(
				code ?? (signal === "SIGINT" ? 130 : signal === "SIGHUP" ? 129 : 143),
			);
		});
	});
}

export function runLocked(
	name: string,
	command: string,
	args: string[],
	env = process.env,
	shared = false,
): Promise<number> {
	if (process.platform !== "linux")
		throw new Error(
			"The shared benchmark queue requires Linux flock. Use pnpm sandbox on a Linux host.",
		);
	console.log(`[ecad] Waiting for the host ${name} slot.`);
	return run(
		"flock",
		[
			shared ? "--shared" : "--exclusive",
			"--no-fork",
			join(env.ECAD_LOCK_DIR ?? lockDirectory(), `${name}.lock`),
			...guardedCommandArgs(command, args),
		],
		env,
	);
}

export function capture(command: string, args: string[]): string {
	const result = spawnSync(command, args, { encoding: "utf8" });
	if (result.error) throw result.error;
	if (result.status !== 0)
		throw new Error(
			result.stderr.trim() || `${command} exited ${result.status}`,
		);
	return result.stdout.trim();
}

export function processStart(pid: number): string | undefined {
	try {
		const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
		const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
		return fields[0] === "Z" ? undefined : fields[19];
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
		throw error;
	}
}

export function guardedCommandArgs(command: string, args: string[]): string[] {
	return [
		process.execPath,
		fileURLToPath(new URL("./locked-command.ts", import.meta.url)),
		String(process.pid),
		processStart(process.pid) ?? "",
		command,
		...args,
	];
}
