import { spawnSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	renameSync,
	rmSync,
	statSync,
	utimesSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { processStart, run } from "../development/common.ts";

/**
 * Built base checkouts for A/B runs, one per commit. The cache lives outside
 * the quota-limited /tmp; pnpm hard-links dependencies from its store when the
 * cache shares its filesystem, so an entry mostly costs its build output.
 */
export function cacheRoot(env = process.env): string {
	return resolve(
		env.ECAD_PERF_CACHE_DIR ??
			join(env.XDG_CACHE_HOME ?? join(homedir(), ".cache"), "ecad-perf"),
	);
}

const readyFile = ".ecad-perf-ready";
/** The build process's exit code when the lock's previous holder built it. */
const alreadyBuilt = 10;
const keep = 5;
const maxAgeMs = 14 * 24 * 60 * 60 * 1000;
/** An entry used this recently may be serving another thread's run. */
const inUseMs = 6 * 60 * 60 * 1000;

const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

/** The base commit: the merge base of `ref` and HEAD. */
export function resolveBase(ref: string): string {
	const result = spawnSync("git", ["merge-base", ref, "HEAD"], {
		encoding: "utf8",
	});
	if (result.status !== 0 || !result.stdout.trim())
		throw new Error(
			`cannot find the merge base of ${ref} and HEAD (${(result.stderr || result.error?.message || "no output").trim().split("\n")[0]}). Pass --base <ref>, or run pnpm run perf:budgets for a run without a comparison.`,
		);
	return result.stdout.trim();
}

/** Writes `git archive` of a commit to `file`. */
export function archiveCommit(sha: string, file: string): void {
	if (existsSync(file)) return;
	mkdirSync(resolve(file, ".."), { recursive: true });
	const partial = `${file}.${process.pid}.partial`;
	const result = spawnSync(
		"git",
		["archive", "--format=tar", `--output=${partial}`, sha],
		{ encoding: "utf8" },
	);
	if (result.status !== 0) {
		rmSync(partial, { force: true });
		throw new Error(`git archive ${sha} failed: ${result.stderr.trim()}`);
	}
	renameSync(partial, file);
}

export interface BaseBuild {
	sha: string;
	directory: string;
	/** Whether this run built it, rather than reusing the cache. */
	built: boolean;
	durationMs: number;
}

/**
 * Returns a built checkout of `sha`, building it on a cache miss. Builds of
 * the same commit from parallel threads queue on a per-commit lock. `archive`
 * supplies the source as a tar file when there is no Git repository, as in
 * the sandbox.
 */
export async function prepareBase(
	sha: string,
	options: { archive?: string; env?: NodeJS.ProcessEnv } = {},
): Promise<BaseBuild> {
	const env = options.env ?? process.env;
	const root = cacheRoot(env);
	const directory = join(root, sha);
	const start = Date.now();
	mkdirSync(root, { recursive: true });
	if (!existsSync(join(directory, readyFile))) {
		const archive = options.archive ?? join(root, "archives", `${sha}.tar`);
		if (!options.archive) archiveCommit(sha, archive);
		const args = [
			"--import",
			"tsx",
			fileURLToPath(import.meta.url),
			sha,
			archive,
		];
		console.log(
			`[perf] Building base ${sha.slice(0, 12)} in ${directory}. Output goes to ${join(directory, "build.log")}.`,
		);
		const status = await (process.platform === "linux"
			? run(
					"flock",
					["--exclusive", join(root, `${sha}.lock`), process.execPath, ...args],
					env,
				)
			: withDirectoryLock(join(root, `${sha}.lock.d`), () =>
					run(process.execPath, args, env),
				));
		// Another run may have built it while this one waited for the lock.
		if (status === alreadyBuilt) {
			touch(directory);
			return { sha, directory, built: false, durationMs: Date.now() - start };
		}
		if (status !== 0)
			throw new Error(
				`Building base ${sha.slice(0, 12)} failed. See ${join(directory, "build.log")}.`,
			);
		prune(root, sha);
		return { sha, directory, built: true, durationMs: Date.now() - start };
	}
	touch(directory);
	return { sha, directory, built: false, durationMs: Date.now() - start };
}

/**
 * A portable lock for hosts without `flock`: creating a directory is atomic.
 * A lock older than an hour belongs to a build that died, so it is taken over.
 */
export async function withDirectoryLock<T>(
	path: string,
	task: () => Promise<T>,
	staleMs = 60 * 60 * 1000,
): Promise<T> {
	for (;;) {
		try {
			mkdirSync(path);
			break;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
			try {
				if (Date.now() - statSync(path).mtimeMs > staleMs)
					rmSync(path, { recursive: true, force: true });
			} catch {
				// Released between the two calls.
			}
			await new Promise((done) => setTimeout(done, 1000));
		}
	}
	try {
		return await task();
	} finally {
		rmSync(path, { recursive: true, force: true });
	}
}

/** Marks an entry as used, so pruning keeps it. */
export function touch(directory: string): void {
	const now = new Date();
	try {
		utimesSync(join(directory, readyFile), now, now);
	} catch {
		// A missing marker means the entry is being rebuilt.
	}
}

/**
 * Marks a base build as used by this process until it exits, so another
 * thread's pruning leaves it alone however long the run waits or measures.
 */
export function markInUse(directory: string, pid = process.pid): () => void {
	const markers = `${directory}.in-use`;
	mkdirSync(markers, { recursive: true });
	const marker = join(markers, String(pid));
	writeFileSync(marker, processStart(pid) ?? "");
	const release = () => rmSync(marker, { force: true });
	if (pid === process.pid) process.once("exit", release);
	return release;
}

/** Whether a live process still marks the entry as in use. */
export function inUse(root: string, name: string): boolean {
	const markers = join(root, `${name}.in-use`);
	if (!existsSync(markers)) return false;
	return readdirSync(markers).some((pid) => {
		const start = processStart(Number(pid));
		return (
			start !== undefined && start === readFileSync(join(markers, pid), "utf8")
		);
	});
}

/**
 * Keeps the most recently used entries and removes the rest, along with
 * entries unused for two weeks. Entries used in the last six hours stay, since
 * another thread's run may be serving them, and so do entries a live run marks
 * with `markInUse`.
 */
export function prune(root: string, current: string, now = Date.now()): void {
	const entries = readdirSync(root, { withFileTypes: true })
		.filter((entry) => entry.isDirectory() && /^[0-9a-f]{40}$/.test(entry.name))
		.map((entry) => {
			const marker = join(root, entry.name, readyFile);
			const used = existsSync(marker)
				? statSync(marker).mtimeMs
				: statSync(join(root, entry.name)).mtimeMs;
			return { name: entry.name, used };
		})
		.sort((a, b) => b.used - a.used);
	entries.forEach((entry, index) => {
		if (
			entry.name === current ||
			now - entry.used < inUseMs ||
			inUse(root, entry.name)
		)
			return;
		if (index >= keep || now - entry.used > maxAgeMs) {
			rmSync(join(root, entry.name), { recursive: true, force: true });
			rmSync(join(root, "archives", `${entry.name}.tar`), { force: true });
			rmSync(join(root, `${entry.name}.lock`), { force: true });
			for (const suffix of [".lock.d", ".in-use"])
				rmSync(join(root, `${entry.name}${suffix}`), {
					recursive: true,
					force: true,
				});
		}
	});
}

function step(
	directory: string,
	log: string,
	command: string,
	args: string[],
): void {
	writeFileSync(log, `$ ${command} ${args.join(" ")}\n`, { flag: "a" });
	const result = spawnSync(command, args, {
		cwd: directory,
		encoding: "utf8",
		env: {
			...process.env,
			ELECTRON_SKIP_BINARY_DOWNLOAD: "1",
			PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: "1",
			CI: "1",
		},
		maxBuffer: 256 * 1024 * 1024,
	});
	writeFileSync(log, (result.stdout ?? "") + (result.stderr ?? ""), {
		flag: "a",
	});
	if (result.status !== 0) {
		console.error(
			`[perf] Base build step failed: ${command} ${args.join(" ")}. See ${log}.`,
		);
		process.exit(result.status ?? 1);
	}
}

/** Runs under the per-commit lock; returns false if it was already built. */
function build(sha: string, archive: string): boolean {
	const directory = join(cacheRoot(), sha);
	if (existsSync(join(directory, readyFile))) return false;
	const start = Date.now();
	rmSync(directory, { recursive: true, force: true });
	mkdirSync(directory, { recursive: true });
	const log = join(directory, "build.log");
	writeFileSync(log, "");
	step(directory, log, "tar", ["-xf", archive, "-C", directory]);
	step(directory, log, pnpm, [
		"install",
		"--frozen-lockfile",
		"--prefer-offline",
		...(process.env.ECAD_PERF_PNPM_STORE
			? ["--store-dir", process.env.ECAD_PERF_PNPM_STORE]
			: []),
	]);
	step(directory, log, pnpm, ["run", "build:web"]);
	step(directory, log, pnpm, ["run", "build:cli"]);
	writeFileSync(
		join(directory, readyFile),
		JSON.stringify({
			sha,
			builtAt: new Date().toISOString(),
			ms: Date.now() - start,
		}),
	);
	return true;
}

if (
	process.argv[1] &&
	resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
	const [sha, archive] = process.argv.slice(2);
	if (!build(sha, archive)) process.exitCode = alreadyBuilt;
}
