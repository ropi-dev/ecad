import { createHash, randomUUID } from "node:crypto";
import {
	type FileHandle,
	open,
	readFile,
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
// A new file gets the default mode minus the umask.
async function stageFile(path: string, content: string, mode?: number) {
	const temporary = join(
		dirname(path),
		`.${basename(path)}.${randomUUID()}.tmp`,
	);
	try {
		const handle = await open(temporary, "wx", mode ?? 0o666);
		try {
			if (mode !== undefined) await handle.chmod(mode);
			await handle.writeFile(content);
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
	const historyMode = (await fileMode(historyPath)) ?? drawingMode;
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
	bootId: z.string().optional(),
	id: z.uuid(),
});
type LockOwner = z.infer<typeof lockOwnerSchema>;
// IDs of the locks and claims this process holds. They tell a crashed
// process's lock apart from this one's after the operating system reuses its
// PID.
const heldLocks = new Set<string>();
let bootId: Promise<string | undefined> | undefined;

function currentBootId() {
	bootId ??= readFile("/proc/sys/kernel/random/boot_id", "utf8").then(
		(id) => id.trim() || undefined,
		() => undefined,
	);
	return bootId;
}

async function createLockOwner(): Promise<LockOwner> {
	const owner = {
		pid: process.pid,
		hostname: hostname(),
		bootId: await currentBootId(),
		id: randomUUID(),
	};
	heldLocks.add(owner.id);
	return owner;
}

// Undefined means that the lock is gone. Null means that its owner is unknown,
// for example while the owner is still writing the file.
async function readLockOwner(path: string) {
	let content: string;
	try {
		content = await readFile(path, "utf8");
	} catch (error) {
		return hasCode(error, "ENOENT") ? undefined : null;
	}
	try {
		return lockOwnerSchema.parse(JSON.parse(content));
	} catch {
		return null;
	}
}

// Only processes on this computer can be checked. Treat all others as alive.
async function hasExited(owner: LockOwner) {
	if (owner.hostname !== hostname()) return false;
	const boot = await currentBootId();
	if (owner.bootId && boot && owner.bootId !== boot) return true;
	if (owner.pid === process.pid) return !heldLocks.has(owner.id);
	try {
		process.kill(owner.pid, 0);
		return false;
	} catch (error) {
		return hasCode(error, "ESRCH");
	}
}

// Removes the file at target if it is a lock or claim whose owner has exited.
// Returns true when the caller can retry at once, because that file or a claim
// blocking its removal is gone. Removal needs a claim file named after the
// exited owner. Creating it exclusively lets only one process act on that
// lock, and a lock ID is never reused, so a lock that still has the owner's ID
// while the claim is held is still the abandoned lock.
async function removeAbandonedLock(
	lockPath: string,
	target = lockPath,
	depth = 0,
): Promise<boolean> {
	const owner = await readLockOwner(target);
	if (owner === undefined) return true;
	if (owner === null || !(await hasExited(owner))) return false;
	const claimPath = `${lockPath}.${owner.id}.claim`;
	const claimer = await createLockOwner();
	let claim: FileHandle;
	try {
		claim = await open(claimPath, "wx", 0o600);
	} catch (error) {
		heldLocks.delete(claimer.id);
		if (!hasCode(error, "EEXIST")) throw error;
		// Another process is removing the lock, or exited while doing so. Retry
		// once a claim left by an exited process is gone.
		return (
			depth < 2 && (await removeAbandonedLock(lockPath, claimPath, depth + 1))
		);
	}
	try {
		await claim.writeFile(JSON.stringify(claimer));
		const current = await readLockOwner(target);
		if (current?.id !== owner.id) return current === undefined;
		await rm(target, { force: true });
		return true;
	} finally {
		await claim.close();
		await rm(claimPath, { force: true });
		heldLocks.delete(claimer.id);
	}
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
	try {
		for (;;) {
			signal.throwIfAborted();
			let lock: FileHandle;
			try {
				lock = await open(lockPath, "wx", 0o600);
			} catch (error) {
				if (!hasCode(error, "EEXIST")) throw error;
				if (await removeAbandonedLock(lockPath)) continue;
				if (performance.now() >= deadline) {
					throw new LocalDrawingError({
						code: "DrawingLocked",
						message: `The drawing is locked by another process. Lock file: ${lockPath}`,
					});
				}
				await delay(25, undefined, { signal });
				continue;
			}
			try {
				await lock.writeFile(JSON.stringify(owner));
				signal.throwIfAborted();
				return await work();
			} finally {
				await lock.close();
				await rm(lockPath, { force: true });
			}
		}
	} finally {
		heldLocks.delete(owner.id);
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
								message: error instanceof Error ? error.message : String(error),
							}),
			});
		},
	};
}

export function createLocalDrawingMcpServer(options: LocalDrawingOptions = {}) {
	return createDrawingMcpServer(createLocalDrawing(options).execute);
}
