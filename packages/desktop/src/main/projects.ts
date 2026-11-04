import { randomUUID } from "node:crypto";
import { type BigIntStats, constants } from "node:fs";
import { lstat, mkdir, open, realpath, rename, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { SymbolFile } from "@ecad/core/components/editor/symbolFormat.ts";
import { createSerialQueue } from "@ecad/core/lib/serial-queue.ts";
import {
	InvalidProjectPath,
	ProjectClosed,
	ProjectLocked,
	SymbolLibraryAccessDenied,
} from "@ecad/core/projects/errors.ts";
import {
	type AssetKind,
	PROJECT_FILE,
	type ProjectDocument,
	type ProjectSnapshot,
	parseProjectName,
	parseProjectPath,
} from "@ecad/core/projects/format.ts";
import {
	type ProjectDirectory,
	type ProjectLockMode,
	ProjectRepository,
} from "@ecad/core/projects/repository.ts";
import {
	FileLocked,
	inspectLock,
	withFileLock,
} from "@ecad/drawing-core/lib/file-lock.ts";
import type { ExternalLibraryRequest } from "#/main/library-approvals.ts";
import {
	canWriteSymbolPath,
	type DirectoryAuthorization,
	inspectDirectorySymbol,
	readSymbolDirectory,
	saveDirectorySymbol,
} from "#/main/symbol-library.ts";

const notRegularFile = (path: string) =>
	new InvalidProjectPath({
		path,
		reason: "Project assets must be regular files.",
	});

export async function createDesktopProjectDirectory(
	selected: string,
	{ lockTimeout = 30_000 }: { lockTimeout?: number } = {},
): Promise<ProjectDirectory> {
	const directory = await realpath(resolve(selected));
	if (!(await lstat(directory)).isDirectory())
		throw new InvalidProjectPath({
			path: selected,
			reason: "Choose a project directory.",
		});
	async function target(path: string, create = false) {
		const parts = parseProjectPath(path).split("/");
		let current = directory;
		for (const part of parts.slice(0, -1)) {
			current = join(current, part);
			if (create)
				await mkdir(current).catch((cause: NodeJS.ErrnoException) => {
					if (cause.code !== "EEXIST") throw cause;
				});
			if (!(await lstat(current)).isDirectory())
				throw new InvalidProjectPath({
					path,
					reason: "Project paths cannot contain symbolic links.",
				});
		}
		return join(current, parts[parts.length - 1]);
	}
	// While a read runs without the lock, the identity of each file it reads.
	let reads: Map<string, string> | undefined;
	const recordReads: RecordReads = async (work) => {
		const recorded = new Map<string, string>();
		reads = recorded;
		try {
			const result = await work();
			return {
				result,
				async unchanged() {
					for (const [path, key] of recorded) {
						try {
							const info = await lstat(await target(path), { bigint: true });
							if (fileKey(info) !== key) return false;
						} catch (cause) {
							if (isMissing(cause)) return false;
							throw cause;
						}
					}
					return true;
				},
			};
		} finally {
			if (reads === recorded) reads = undefined;
		}
	};
	return {
		name: directory,
		lock: (work, mode) =>
			lockProject(directory, lockTimeout, work, mode, recordReads),
		async exists(path) {
			try {
				await lstat(await target(path));
				return true;
			} catch (cause) {
				if (
					cause instanceof Error &&
					"code" in cause &&
					cause.code === "ENOENT"
				)
					return false;
				throw cause;
			}
		},
		async read(path) {
			const filename = await target(path);
			if (!(await lstat(filename)).isFile()) throw notRegularFile(path);
			const file = await open(
				filename,
				constants.O_RDONLY | constants.O_NOFOLLOW,
			);
			try {
				const info = await file.stat({ bigint: true });
				if (!info.isFile()) throw notRegularFile(path);
				// The open file's identity is that of the bytes read.
				if (reads && !reads.has(path)) reads.set(path, fileKey(info));
				return new Uint8Array(await file.readFile());
			} finally {
				await file.close();
			}
		},
		async write(path, bytes) {
			const filename = await target(path, true);
			try {
				if (!(await lstat(filename)).isFile()) throw notRegularFile(path);
			} catch (cause) {
				if (
					!(cause instanceof Error) ||
					!("code" in cause) ||
					cause.code !== "ENOENT"
				)
					throw cause;
			}
			const temporary = join(dirname(filename), `.ecad-${randomUUID()}.tmp`);
			const file = await open(temporary, "wx");
			try {
				await file.writeFile(bytes);
				await file.sync();
				await file.close();
				await rename(temporary, filename);
			} finally {
				await file.close();
				await rm(temporary, { force: true });
			}
		},
		async remove(path) {
			await rm(await target(path), { recursive: true, force: true });
		},
	};
}

const unwritable = ["EACCES", "EPERM", "EROFS"];

// Every desktop instance that opens or saves this project takes the same lock
// file, which is removed if its recorded owner has exited. The lock file is
// always exclusive: a shared request takes it like an exclusive one.
//
// Taking the lock creates files in the project directory. A project in a
// directory this process cannot write is therefore read without it, and the
// read is checked with readConsistently. Writes always need the lock.
async function lockProject<T>(
	directory: string,
	timeout: number,
	work: () => Promise<T>,
	mode: ProjectLockMode,
	recordReads: RecordReads,
): Promise<T> {
	let locked = false;
	try {
		return await withFileLock(
			join(directory, `${PROJECT_FILE}.lock`),
			{ timeout },
			() => {
				locked = true;
				return work();
			},
		);
	} catch (cause) {
		if (locked) throw cause;
		if (cause instanceof FileLocked)
			throw new ProjectLocked(cause.ownerRunning ? {} : { path: cause.path });
		if (
			mode === "shared" &&
			cause instanceof Error &&
			"code" in cause &&
			unwritable.includes(String(cause.code))
		)
			return readConsistently(directory, work, recordReads);
		throw cause;
	}
}

// Runs work while recording the identity of every file it reads, and tells
// afterwards whether each of those files is still the one that was read.
type RecordReads = <T>(
	work: () => Promise<T>,
) => Promise<{ result: T; unchanged(): Promise<boolean> }>;

// Desktop writes replace files through new files, so a replaced or restored
// file gets a new inode and new times.
const fileKey = (info: BigIntStats) =>
	`${info.dev}:${info.ino}:${info.size}:${info.mtimeNs}:${info.ctimeNs}`;

const readAttempts = 4;

// Reads without the lock, keeping a read only when no writer held the lock
// after it and every file it read is still the one it read. A writer holds
// the lock for its whole save, including a rollback, so one that wrote
// during the read either still holds the lock or already replaced a file
// that was read before it was written. The read then matches the files as
// they are after a finished save. A lock whose owner certainly exited counts
// as free, because it cannot be removed here. If writers keep interfering,
// the read is rejected, naming the lock file when its owner is unknown.
async function readConsistently<T>(
	directory: string,
	read: () => Promise<T>,
	recordReads: RecordReads,
): Promise<T> {
	const lockPath = join(directory, `${PROJECT_FILE}.lock`);
	const holder = async () => {
		const state = await inspectLock(lockPath);
		return state === "running" || state === "unknown" ? state : undefined;
	};
	for (let attempt = 1; ; attempt++) {
		let writer = await holder();
		if (!writer) {
			const { result, unchanged } = await recordReads(read);
			writer = await holder();
			if (!writer && (await unchanged())) return result;
		}
		if (attempt === readAttempts)
			throw new ProjectLocked(writer === "unknown" ? { path: lockPath } : {});
		await delay(50 * attempt);
	}
}

function isMissing(cause: unknown) {
	return cause instanceof Error && "code" in cause && cause.code === "ENOENT";
}

export interface DesktopProjectsOptions {
	homeDirectory?: string;
	/**
	 * Decides whether the open project may use a library directory outside its
	 * own directory. Without it, such libraries are refused. `prompt` is false
	 * after the user refused, so only approvals that need no question apply.
	 */
	approveExternalLibrary?(
		request: ExternalLibraryRequest,
		options: { prompt: boolean },
	): Promise<boolean>;
}

function isInside(parent: string, path: string) {
	const suffix = relative(parent, path);
	return (
		suffix === "" ||
		(suffix !== ".." && !suffix.startsWith(`..${sep}`) && !isAbsolute(suffix))
	);
}

export class DesktopProjects {
	private active: {
		directory: string;
		repository: ProjectRepository;
		files?: Map<string, Uint8Array>;
		/** Outside libraries the user refused. Reopening the project asks again. */
		refused?: Set<string>;
	} | null = null;
	private snapshot(snapshot: ProjectSnapshot): ProjectSnapshot {
		return this.active?.files ? { ...snapshot, inMemory: true } : snapshot;
	}
	isInMemory(directory: string) {
		this.current(directory);
		return !!this.active?.files;
	}
	private readonly sequential = createSerialQueue();
	constructor(
		private initialPath?: string,
		private options: DesktopProjectsOptions = {},
	) {}
	private opened(directory: string) {
		if (!this.active || this.active.directory !== directory)
			throw new ProjectClosed();
		return this.active;
	}
	private current(directory: string) {
		return this.opened(directory).repository;
	}
	private async openPath(path: string) {
		const selected = path.endsWith(PROJECT_FILE) ? dirname(path) : path;
		const directory = await createDesktopProjectDirectory(selected);
		const repository = new ProjectRepository(directory, { layout: "files" });
		const snapshot = await repository.load();
		this.active = { directory: directory.name, repository };
		return snapshot;
	}
	load() {
		return this.sequential(async () => {
			if (this.active)
				return this.snapshot(await this.active.repository.load());
			if (!this.initialPath) return null;
			if (!this.initialPath.endsWith(PROJECT_FILE)) {
				try {
					await lstat(join(this.initialPath, PROJECT_FILE));
				} catch (cause) {
					if (
						cause instanceof Error &&
						"code" in cause &&
						cause.code === "ENOENT"
					)
						return null;
					throw cause;
				}
			}
			return this.openPath(this.initialPath);
		});
	}
	openDirectory(path: string) {
		return this.sequential(() => this.openPath(path));
	}
	createUntitled() {
		return this.sequential(async () => {
			const files = new Map<string, Uint8Array>();
			const directory: ProjectDirectory = {
				name: `memory:${randomUUID()}`,
				exists: async (path) => files.has(parseProjectPath(path)),
				async read(path) {
					const bytes = files.get(parseProjectPath(path));
					if (!bytes)
						throw Object.assign(new Error("Project file not found."), {
							code: "ENOENT",
						});
					return new Uint8Array(bytes);
				},
				async write(path, bytes) {
					files.set(parseProjectPath(path), new Uint8Array(bytes));
				},
				async remove(path) {
					files.delete(parseProjectPath(path));
				},
			};
			const repository = new ProjectRepository(directory, { layout: "files" });
			const snapshot = await repository.create("Untitled");
			this.active = { directory: directory.name, repository, files };
			return this.snapshot(snapshot);
		});
	}
	saveToDirectory(directory: string, parent: string) {
		return this.sequential(async () => {
			const source = this.current(directory);
			const files = this.active?.files;
			if (!files) return source.load();
			const snapshot = await source.load();
			const base = await realpath(resolve(parent));
			const name = parseProjectName(snapshot.manifest.name);
			let selected = join(base, name);
			for (let suffix = 2; ; suffix++) {
				try {
					await mkdir(selected);
					break;
				} catch (cause) {
					if (
						!(cause instanceof Error) ||
						!("code" in cause) ||
						cause.code !== "EEXIST"
					)
						throw cause;
					selected = join(base, `${name} ${suffix}`);
				}
			}
			try {
				const disk = await createDesktopProjectDirectory(selected);
				for (const [path, bytes] of files) await disk.write(path, bytes);
				const repository = new ProjectRepository(disk, { layout: "files" });
				const saved = await repository.load();
				this.active = { directory: disk.name, repository };
				return saved;
			} catch (cause) {
				await rm(selected, { recursive: true, force: true });
				throw cause;
			}
		});
	}
	create(name: string, parent: string) {
		return this.sequential(async () => {
			name = parseProjectName(name);
			const selected = join(await realpath(resolve(parent)), name);
			await mkdir(selected);
			try {
				const directory = await createDesktopProjectDirectory(selected);
				const repository = new ProjectRepository(directory, {
					layout: "files",
				});
				const snapshot = await repository.create(name);
				this.active = { directory: directory.name, repository };
				return snapshot;
			} catch (cause) {
				await rm(selected, { recursive: true, force: true });
				throw cause;
			}
		});
	}
	save(directory: string, document: ProjectDocument) {
		return this.sequential(async () =>
			this.snapshot(await this.current(directory).save(document)),
		);
	}
	importAssets(
		directory: string,
		assets: { name: string; kind: AssetKind; bytes: Uint8Array }[],
	) {
		return this.sequential(async () =>
			this.snapshot(await this.current(directory).importAssets(assets)),
		);
	}
	readAsset(directory: string, path: string) {
		return this.sequential(() => this.current(directory).readAsset(path));
	}
	/**
	 * Project manifests are untrusted. A configured path is used only when it
	 * resolves inside the project or the user approved the outside directory.
	 */
	private symbolLibraryAccess(
		directory: string,
		path: string,
	): { directory: string; authorize: DirectoryAuthorization } {
		const active = this.opened(directory);
		if (
			!active.repository
				.getSymbolLibraries()
				.some(
					(library) =>
						library.source.kind === "directory" && library.source.path === path,
				)
		)
			throw new SymbolLibraryAccessDenied({
				path,
				reason: "This directory is not configured as a project symbol library.",
			});
		let requested: string;
		if (path.startsWith("~/"))
			requested = resolve(
				this.options.homeDirectory ?? homedir(),
				path.slice(2),
			);
		else if (isAbsolute(path)) requested = resolve(path);
		else if (active.files)
			throw new SymbolLibraryAccessDenied({
				path,
				reason:
					"Save the project before using a library path relative to its directory.",
			});
		else requested = resolve(directory, path);
		return {
			directory: requested,
			authorize: async (library) => {
				if (!active.files && isInside(directory, library)) return;
				const key = JSON.stringify([directory, library]);
				// A refusal stops repeated prompts, but choosing the directory in
				// the native picker afterwards still approves it.
				if (
					await this.options.approveExternalLibrary?.(
						{ project: directory, directory: library },
						{ prompt: !active.refused?.has(key) },
					)
				) {
					active.refused?.delete(key);
					return;
				}
				active.refused ??= new Set();
				active.refused.add(key);
				throw new SymbolLibraryAccessDenied({
					path: library,
					reason:
						"This symbol library is outside the project directory and was not allowed. Reopen the project to be asked again.",
				});
			},
		};
	}
	readSymbolLibrary(directory: string, path: string) {
		return this.sequential(async () => {
			const library = this.symbolLibraryAccess(directory, path);
			return (await readSymbolDirectory(library.directory, library.authorize))
				.symbols;
		});
	}
	inspectLibrarySymbol(directory: string, path: string, id: string) {
		return this.sequential(() => {
			const library = this.symbolLibraryAccess(directory, path);
			return inspectDirectorySymbol(library.directory, id, library.authorize);
		});
	}
	saveLibrarySymbol(
		directory: string,
		path: string,
		original: SymbolFile,
		next: SymbolFile,
	) {
		return this.sequential(() => {
			const library = this.symbolLibraryAccess(directory, path);
			return saveDirectorySymbol(
				library.directory,
				original,
				next,
				library.authorize,
			);
		});
	}
	canWriteFile(directory: string, path: string) {
		return this.sequential(async () => {
			this.current(directory);
			const parts = parseProjectPath(path).split("/");
			if (this.active?.files) return true;
			let current = directory;
			for (const part of parts.slice(0, -1)) {
				current = join(current, part);
				if (!(await lstat(current)).isDirectory()) return false;
			}
			return canWriteSymbolPath(join(current, parts[parts.length - 1]));
		});
	}
}
