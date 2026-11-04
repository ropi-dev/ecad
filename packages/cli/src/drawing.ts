import { createHash, randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import {
	link,
	lstat,
	open,
	readdir,
	readFile,
	readlink,
	realpath,
	rename,
	rm,
	stat,
} from "node:fs/promises";
import { hostname } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { drawingSnapshotSchema } from "@ecad/drawing-core/commands/drawing-snapshot.ts";
import {
	createDrawingStore,
	type DrawingSnapshot,
	DrawingStore,
	restoreDrawingStore,
} from "@ecad/drawing-core/commands/drawing-store.ts";
import { drawingShapeSchema } from "@ecad/drawing-core/drawing/schema.ts";
import { errorMessage } from "@ecad/drawing-core/lib/error-message.ts";
import {
	type DrawingOperation,
	executeDrawingOperation,
} from "@ecad/drawing-core/mcp/drawing-protocol.ts";
import { createDrawingMcpServer } from "@ecad/drawing-core/mcp/drawing-server.ts";
import { measurePerformanceAsync } from "@ecad/drawing-core/performance/runtime.ts";
import { Data, Effect } from "effect";
import { z } from "zod";

export class LocalDrawingError extends Data.TaggedError("LocalDrawingError")<{
	readonly code: string;
	readonly message: string;
}> {}

const fileSchema = z
	.object({ shapes: z.array(drawingShapeSchema) })
	.passthrough()
	.refine(
		(file) =>
			new Set(file.shapes.map((shape) => shape.id)).size === file.shapes.length,
		"The drawing contains duplicate shape IDs.",
	);
const savedHistorySchema = z.strictObject({
	version: z.literal(1),
	drawingHash: z.string().regex(/^[a-f0-9]{64}$/),
	snapshot: drawingSnapshotSchema,
});
const hash = (content: string | undefined) =>
	createHash("sha256")
		.update(content ?? "")
		.digest("hex");
const hasCode = (error: unknown, code: string) =>
	!!error &&
	typeof error === "object" &&
	"code" in error &&
	error.code === code;

async function readOptional(path: string) {
	try {
		return await readFile(path, "utf8");
	} catch (error) {
		if (hasCode(error, "ENOENT")) return undefined;
		throw error;
	}
}

async function fileMode(path: string) {
	try {
		return (await stat(path)).mode & 0o7777;
	} catch (error) {
		if (hasCode(error, "ENOENT")) return undefined;
		throw error;
	}
}

// A replacement keeps the replaced file's mode, which the umask could narrow.
// A new file gets the default mode minus the umask. The mode is set after
// writing because a write clears the set-user-ID and set-group-ID bits.
async function stageFile(
	path: string,
	content: string,
	mode?: number,
	temporary = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`),
) {
	try {
		const handle = await open(temporary, "wx", mode ?? 0o666);
		try {
			await handle.writeFile(content);
			if (mode !== undefined) await handle.chmod(mode);
			await handle.sync();
		} finally {
			await handle.close();
		}
		return temporary;
	} catch (error) {
		await rm(temporary, { force: true });
		throw error;
	}
}

// Makes renames durable. The new files are already visible, so a platform
// that cannot sync a directory must not fail the command.
async function syncDirectory(directory: string) {
	try {
		const handle = await open(directory, "r");
		try {
			await handle.sync();
		} finally {
			await handle.close();
		}
	} catch {}
}

async function publish(
	path: string,
	previous: string | undefined,
	previousHistory: string | undefined,
	file: z.infer<typeof fileSchema>,
	snapshot: DrawingSnapshot,
) {
	const content = `${JSON.stringify({ ...file, shapes: snapshot.shapes })}\n`;
	const historyPath = `${path}.history.json`;
	const history = JSON.stringify({
		version: 1,
		drawingHash: hash(content),
		snapshot,
	});
	const drawingMode = await fileMode(path);
	// The history contains the drawing, so a new one is no more readable.
	const historyMode =
		(await fileMode(historyPath)) ??
		(drawingMode === undefined ? undefined : drawingMode & 0o777);
	const staged: string[] = [];
	let publishedHistory = false;
	try {
		const drawingTemporary = await stageFile(path, content, drawingMode);
		staged.push(drawingTemporary);
		const historyTemporary = await stageFile(historyPath, history, historyMode);
		staged.push(historyTemporary);
		if (
			(await readOptional(path)) !== previous ||
			(await readOptional(historyPath)) !== previousHistory
		) {
			throw new LocalDrawingError({
				code: "DrawingChanged",
				message:
					"The drawing changed on disk during this command. Read it again before retrying.",
			});
		}
		await rename(historyTemporary, historyPath);
		publishedHistory = true;
		await rename(drawingTemporary, path);
		await syncDirectory(dirname(path));
	} catch (error) {
		if (publishedHistory) {
			if (previousHistory === undefined) await rm(historyPath, { force: true });
			else {
				const temporary = await stageFile(
					historyPath,
					previousHistory,
					historyMode,
				);
				staged.push(temporary);
				await rename(temporary, historyPath);
			}
			await syncDirectory(dirname(path));
		}
		throw error;
	} finally {
		await Promise.all(
			staged.map((temporary) => rm(temporary, { force: true })),
		);
	}
}

const lockOwnerSchema = z.object({
	pid: z.number().int().positive(),
	hostname: z.string(),
	machineId: z.string().optional(),
	bootId: z.string().optional(),
	pidNamespace: z.string().optional(),
	startTime: z.string().optional(),
	id: z.uuid(),
});
type LockOwner = z.infer<typeof lockOwnerSchema>;

const readText = (path: string) =>
	readFile(path, "utf8").then(
		(text) => text.trim() || undefined,
		() => undefined,
	);

// Reports whether /proc describes this process's PID namespace. A namespace
// that kept its parent's /proc numbers the processes there differently.
let ownProc: Promise<boolean> | undefined;

function hasOwnProc() {
	ownProc ??=
		process.platform === "linux"
			? readlink("/proc/self").then(
					(pid) => pid === String(process.pid),
					() => false,
				)
			: Promise.resolve(false);
	return ownProc;
}

// The state and start time, in clock ticks since boot, of a process. The start
// time tells a process apart from a later one that reuses its PID.
async function processStatus(pid: number | "self") {
	if (!(await hasOwnProc())) return undefined;
	const status = await readText(`/proc/${pid}/stat`);
	if (!status) return undefined;
	// The command name in parentheses can contain spaces. The fields after it
	// start at field 3, the state, and field 22 is the start time.
	const fields = status.slice(status.lastIndexOf(")") + 2).split(" ");
	return { state: fields[0], startTime: fields[19] };
}

// Identifies this computer, boot and PID namespace where the system allows it.
let systemIdentity:
	| Promise<Omit<LockOwner, "pid" | "hostname" | "id">>
	| undefined;

function currentSystem() {
	systemIdentity ??= (async () => {
		if (process.platform !== "linux") return {};
		const [machineId, bootId, pidNamespace, status] = await Promise.all([
			readText("/etc/machine-id"),
			readText("/proc/sys/kernel/random/boot_id"),
			readlink("/proc/self/ns/pid").catch(() => undefined),
			processStatus("self"),
		]);
		return { machineId, bootId, pidNamespace, startTime: status?.startTime };
	})();
	return systemIdentity;
}

async function createLockOwner(): Promise<LockOwner> {
	return {
		pid: process.pid,
		hostname: hostname(),
		...(await currentSystem()),
		id: randomUUID(),
	};
}

// Reads a lock, claim or staged copy. Undefined means that the file is gone.
// Null means that it is not a small regular file this process can read. A FIFO
// would block and a symbolic link could point anywhere, so neither is opened.
const lockFileFlags =
	fsConstants.O_RDONLY |
	(fsConstants.O_NONBLOCK ?? 0) |
	(fsConstants.O_NOFOLLOW ?? 0);

async function readLockFile(path: string) {
	let handle: Awaited<ReturnType<typeof open>>;
	try {
		handle = await open(path, lockFileFlags);
	} catch (error) {
		return hasCode(error, "ENOENT") ? undefined : null;
	}
	try {
		const info = await handle.stat();
		if (!info.isFile() || info.size > 4096) return null;
		return { content: await handle.readFile("utf8"), modified: info.mtimeMs };
	} catch {
		return null;
	} finally {
		await handle.close();
	}
}

const parseLockOwner = (content: string) => {
	try {
		return lockOwnerSchema.parse(JSON.parse(content));
	} catch {
		return null;
	}
};

// Undefined means that the file is gone. Null means that its owner is unknown,
// for example because another program wrote it.
async function readLockOwner(path: string) {
	const file = await readLockFile(path);
	return file && parseLockOwner(file.content);
}

// Returns true only when the owner certainly no longer runs. On Linux, a PID
// is checked only when both sides recorded the same boot and PID namespace.
// Other systems record no such IDs, so the host name identifies the computer.
async function hasExited(owner: LockOwner) {
	const local = { hostname: hostname(), ...(await currentSystem()) };
	if (owner.hostname !== local.hostname || owner.machineId !== local.machineId)
		return false;
	if (process.platform === "linux") {
		if (!owner.bootId || !local.bootId) return false;
		// Only a restart of the same computer changes its boot ID.
		if (owner.bootId !== local.bootId) return !!owner.machineId;
		if (!owner.pidNamespace || owner.pidNamespace !== local.pidNamespace)
			return false;
	} else if (owner.bootId || owner.pidNamespace) return false;
	try {
		process.kill(owner.pid, 0);
	} catch (error) {
		if (hasCode(error, "ESRCH")) return true;
		// Another user's process can reuse the PID too.
		if (!hasCode(error, "EPERM")) return false;
	}
	if (owner.startTime === undefined) return false;
	const status = await processStatus(owner.pid);
	if (!status) return false;
	// A zombie has exited and only waits for its parent to collect it.
	return status.state === "Z" || status.startTime !== owner.startTime;
}

const linkUnsupported = ["EPERM", "ENOTSUP", "EOPNOTSUPP", "ENOSYS"];

// Staged lock copies and claims have short names, so a long drawing name
// still fits. Owner IDs are unique, so drawings in one folder never collide.
const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const lockCopyName = new RegExp(`^\\.ecad-lock-${uuid}\\.tmp$`);
const claimName = new RegExp(`^\\.ecad-claim-${uuid}$`);
const claimPath = (directory: string, owner: LockOwner) =>
	join(directory, `.ecad-claim-${owner.id}`);

// Creates the file at path with the owner's metadata unless the path exists.
// Linking a complete, synced copy publishes the metadata with the file, so a
// crash or power loss never leaves an empty lock. The copy is staged only when
// the path looks free, so a waiting process holds no copy.
async function createLockFile(path: string, owner: LockOwner) {
	const content = JSON.stringify(owner);
	for (let attempt = 1; ; attempt++) {
		try {
			await lstat(path);
			return false;
		} catch (error) {
			if (!hasCode(error, "ENOENT")) throw error;
		}
		const staged = await stageFile(
			path,
			content,
			0o600,
			join(dirname(path), `.ecad-lock-${randomUUID()}.tmp`),
		);
		try {
			await link(staged, path);
			return true;
		} catch (error) {
			if (hasCode(error, "EEXIST")) return false;
			// Recovery removes a copy that stayed incomplete for a minute, for
			// example while this process was paused, so stage it again.
			if (hasCode(error, "ENOENT") && attempt < 3) continue;
			if (!linkUnsupported.some((code) => hasCode(error, code))) throw error;
		} finally {
			await rm(staged, { force: true });
		}
		break;
	}
	// Without hard links, a crash before the write leaves an empty lock.
	let handle: Awaited<ReturnType<typeof open>>;
	try {
		handle = await open(path, "wx", 0o600);
	} catch (error) {
		if (hasCode(error, "EEXIST")) return false;
		throw error;
	}
	try {
		await handle.writeFile(content);
	} finally {
		await handle.close();
	}
	return true;
}

// Removes the lock or claim at target if its owner has exited. Returns
// "removed" after removing an abandoned file, "gone" when the file vanished,
// and "kept" otherwise. Removing a file needs a claim named after its exited
// owner. Creating that claim exclusively lets only one process act on that
// file, and an owner ID is never reused, so a file that still has the owner's
// ID while the claim is held is still the abandoned file. An existing claim is
// either in use or abandoned in the same way, so the chain is followed until
// a file can be removed.
async function removeAbandonedFile(target: string, claimer: LockOwner) {
	const directory = dirname(target);
	const visited = new Set<string>();
	for (;;) {
		const current = await readLockOwner(target);
		if (current === undefined) return "gone";
		if (current === null || visited.has(current.id)) return "kept";
		if (!(await hasExited(current))) return "kept";
		visited.add(current.id);
		const claim = claimPath(directory, current);
		if (!(await createLockFile(claim, claimer))) {
			target = claim;
			continue;
		}
		try {
			const latest = await readLockOwner(target);
			if (latest?.id !== current.id)
				return latest === undefined ? "gone" : "kept";
			await rm(target, { force: true });
			return "removed";
		} finally {
			await rm(claim, { force: true });
		}
	}
}

// Removes what killed processes leave beside locks. A claim whose owner exited
// goes through the same claim protocol, because another process may create a
// claim with that name again. A complete staged copy is removed once its owner
// has exited. Staging takes moments, so a readable but incomplete copy older
// than a minute is removed too, and a paused creator stages a new one.
async function removeLeftovers(directory: string, owner: LockOwner) {
	const names = await readdir(directory);
	await Promise.all(
		names.map(async (name) => {
			const path = join(directory, name);
			if (claimName.test(name)) {
				await removeAbandonedFile(path, { ...owner, id: randomUUID() });
				return;
			}
			if (!lockCopyName.test(name)) return;
			const file = await readLockFile(path);
			if (!file) return;
			const copyOwner = parseLockOwner(file.content);
			const abandoned = copyOwner
				? await hasExited(copyOwner)
				: Date.now() - file.modified > 60_000;
			if (abandoned) await rm(path, { force: true });
		}),
	);
}

async function withDrawingLock<T>(
	path: string,
	timeout: number,
	signal: AbortSignal,
	work: () => Promise<T>,
) {
	const lockPath = `${path}.lock`;
	const deadline = performance.now() + timeout;
	const owner = await createLockOwner();
	for (;;) {
		signal.throwIfAborted();
		if (await createLockFile(lockPath, owner)) break;
		const recovery = await removeAbandonedFile(lockPath, {
			...owner,
			id: randomUUID(),
		});
		if (recovery === "removed")
			await removeLeftovers(dirname(lockPath), owner).catch(() => {});
		if (recovery !== "kept") continue;
		if (performance.now() >= deadline) {
			throw new LocalDrawingError({
				code: "DrawingLocked",
				message: `The drawing is locked by another process. Lock file: ${lockPath}`,
			});
		}
		await delay(25, undefined, { signal });
	}
	try {
		signal.throwIfAborted();
		return await work();
	} finally {
		await rm(lockPath, { force: true });
	}
}

export interface LocalDrawingOptions {
	path?: string;
	lockTimeout?: number;
}

export function createLocalDrawing(options: LocalDrawingOptions = {}) {
	if (options.path !== undefined && !options.path.trim())
		throw new Error("The drawing path must not be empty.");
	const filePath = resolve(options.path ?? "drawing.ecaddraw");
	const timeout = options.lockTimeout ?? 30_000;
	let cachedRead:
		| {
				path: string;
				content: string | undefined;
				historyContent: string | undefined;
				store: ReturnType<typeof createDrawingStore>;
		  }
		| undefined;
	if (!Number.isSafeInteger(timeout) || timeout <= 0)
		throw new Error("The timeout must be a positive integer in milliseconds.");
	return {
		execute(operation: DrawingOperation) {
			return Effect.tryPromise({
				try: (signal) =>
					measurePerformanceAsync("drawing.local-command", async () => {
						const path = await realpath(filePath).catch((error) => {
							if (!hasCode(error, "ENOENT")) throw error;
							return realpath(dirname(filePath)).then((directory) =>
								join(directory, basename(filePath)),
							);
						});
						return withDrawingLock(path, timeout, signal, async () => {
							const content = await readOptional(path);
							const file = fileSchema.parse(
								content === undefined ? { shapes: [] } : JSON.parse(content),
							);
							const historyContent = await readOptional(`${path}.history.json`);
							const saved =
								historyContent === undefined
									? undefined
									: savedHistorySchema.parse(JSON.parse(historyContent));
							if (
								saved?.drawingHash === hash(content) &&
								JSON.stringify(saved.snapshot.shapes) !==
									JSON.stringify(file.shapes)
							) {
								throw new LocalDrawingError({
									code: "DrawingHistoryMismatch",
									message: "The saved history does not match the drawing.",
								});
							}
							if (operation.type !== "getDrawing") cachedRead = undefined;
							const store =
								cachedRead?.path === path &&
								cachedRead.content === content &&
								cachedRead.historyContent === historyContent
									? cachedRead.store
									: saved?.drawingHash === hash(content)
										? restoreDrawingStore(saved.snapshot)
										: createDrawingStore(file.shapes);
							if (operation.type === "getDrawing")
								cachedRead = { path, content, historyContent, store };
							const before = store.getSnapshot();
							signal.throwIfAborted();
							const reply = Effect.runSync(
								executeDrawingOperation(operation).pipe(
									Effect.provideService(DrawingStore, store),
								),
							);
							if (reply.ok && store.getSnapshot() !== before) {
								signal.throwIfAborted();
								await publish(
									path,
									content,
									historyContent,
									file,
									store.getSnapshot(),
								);
							}
							return reply;
						});
					}),
				catch: (error) =>
					error instanceof LocalDrawingError
						? error
						: new LocalDrawingError({
								code: "DrawingFileError",
								message: errorMessage(error),
							}),
			});
		},
	};
}

export function createLocalDrawingMcpServer(options: LocalDrawingOptions = {}) {
	return createDrawingMcpServer(createLocalDrawing(options).execute);
}
