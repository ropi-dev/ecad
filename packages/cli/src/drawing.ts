import { createHash } from "node:crypto";
import { open, readFile, realpath, rename, rm, stat } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { drawingSnapshotSchema } from "@ecad/drawing-core/commands/drawing-snapshot.ts";
import {
	createDrawingStore,
	type DrawingSnapshot,
	DrawingStore,
	restoreDrawingStore,
} from "@ecad/drawing-core/commands/drawing-store.ts";
import { savedDrawingShapesSchema } from "@ecad/drawing-core/drawing/schema.ts";
import { errorMessage } from "@ecad/drawing-core/lib/error-message.ts";
import {
	FileLocked,
	stageFile,
	withFileLock,
} from "@ecad/drawing-core/lib/file-lock.ts";
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
	.object({ shapes: savedDrawingShapesSchema })
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

async function withDrawingLock<T>(
	path: string,
	timeout: number,
	signal: AbortSignal,
	work: () => Promise<T>,
) {
	try {
		return await withFileLock(`${path}.lock`, { timeout, signal }, work);
	} catch (error) {
		if (!(error instanceof FileLocked)) throw error;
		throw new LocalDrawingError({
			code: "DrawingLocked",
			message: error.ownerless
				? `The drawing is locked, and the lock file does not name the process that holds it. If no other process is using the drawing, remove the lock file and retry: ${error.path}`
				: `The drawing is locked by another process. Lock file: ${error.path}`,
		});
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
	// Interrupting an operation aborts its signal without waiting for it, so the
	// operations are tracked until they finish, including their lock release.
	const running = new Set<Promise<unknown>>();
	const track = <T>(work: Promise<T>) => {
		running.add(work);
		const forget = () => running.delete(work);
		work.then(forget, forget);
		return work;
	};
	return {
		// Resolves once every started operation has finished.
		async settled() {
			while (running.size) await Promise.allSettled([...running]);
		},
		execute(operation: DrawingOperation) {
			return Effect.tryPromise({
				try: (signal) =>
					track(
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
								const historyContent = await readOptional(
									`${path}.history.json`,
								);
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
								if (
									reply.ok &&
									(store.getSnapshot() !== before ||
										(saved?.drawingHash === hash(content) &&
											Object.keys(saved.snapshot.history.nodes).length >
												Object.keys(before.history.nodes).length))
								) {
									cachedRead = undefined;
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
					),
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

// An MCP server for a local drawing, and a way to wait for its operations,
// which closing the server interrupts without awaiting.
export function createLocalDrawingSession(options: LocalDrawingOptions = {}) {
	const drawing = createLocalDrawing(options);
	return {
		server: createDrawingMcpServer(drawing.execute),
		settled: drawing.settled,
	};
}

export function createLocalDrawingMcpServer(options: LocalDrawingOptions = {}) {
	return createLocalDrawingSession(options).server;
}
