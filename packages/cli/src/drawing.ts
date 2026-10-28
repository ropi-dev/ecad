import { createHash, randomUUID } from "node:crypto";
import {
	type FileHandle,
	open,
	readFile,
	realpath,
	rename,
	rm,
	writeFile,
} from "node:fs/promises";
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

async function stageFile(path: string, content: string) {
	const temporary = join(
		dirname(path),
		`.${basename(path)}.${randomUUID()}.tmp`,
	);
	try {
		await writeFile(temporary, content, { flag: "wx", mode: 0o600 });
		return temporary;
	} catch (error) {
		await rm(temporary, { force: true });
		throw error;
	}
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
	const staged: string[] = [];
	let publishedHistory = false;
	try {
		const drawingTemporary = await stageFile(path, content);
		staged.push(drawingTemporary);
		const historyTemporary = await stageFile(historyPath, history);
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
	} catch (error) {
		if (publishedHistory) {
			if (previousHistory === undefined) await rm(historyPath, { force: true });
			else {
				const temporary = await stageFile(historyPath, previousHistory);
				staged.push(temporary);
				await rename(temporary, historyPath);
			}
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
	const lockPath = `${path}.lock`;
	const deadline = performance.now() + timeout;
	for (;;) {
		signal.throwIfAborted();
		let lock: FileHandle;
		try {
			lock = await open(lockPath, "wx", 0o600);
		} catch (error) {
			if (!hasCode(error, "EEXIST")) throw error;
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
			await lock.writeFile(JSON.stringify({ pid: process.pid }));
			signal.throwIfAborted();
			return await work();
		} finally {
			await lock.close();
			await rm(lockPath, { force: true });
		}
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
