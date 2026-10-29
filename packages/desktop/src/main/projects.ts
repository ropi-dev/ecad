import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
	lstat,
	mkdir,
	open,
	realpath,
	rename,
	rm,
	rmdir,
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { SymbolFile } from "@ecad/core/components/editor/symbolFormat.ts";
import {
	type AssetKind,
	PROJECT_FILE,
	type ProjectDocument,
	type ProjectSnapshot,
	projectNameSchema,
	projectPathSchema,
} from "@ecad/core/projects/format.ts";
import {
	type ProjectDirectory,
	ProjectRepository,
} from "@ecad/core/projects/repository.ts";
import {
	canWriteSymbolPath,
	inspectDirectorySymbol,
	readSymbolDirectory,
	saveDirectorySymbol,
} from "#/main/symbol-library.ts";

export async function createDesktopProjectDirectory(
	selected: string,
): Promise<ProjectDirectory> {
	const directory = await realpath(resolve(selected));
	if (!(await lstat(directory)).isDirectory())
		throw new Error("Choose a project directory.");
	async function target(path: string, create = false) {
		const parts = projectPathSchema.parse(path).split("/");
		let current = directory;
		for (const part of parts.slice(0, -1)) {
			current = join(current, part);
			if (create)
				await mkdir(current).catch((cause: NodeJS.ErrnoException) => {
					if (cause.code !== "EEXIST") throw cause;
				});
			if (!(await lstat(current)).isDirectory())
				throw new Error("Project paths cannot contain symbolic links.");
		}
		return join(current, parts[parts.length - 1]);
	}
	return {
		name: directory,
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
			if (!(await lstat(filename)).isFile())
				throw new Error("Project assets must be regular files.");
			const file = await open(
				filename,
				constants.O_RDONLY | constants.O_NOFOLLOW,
			);
			try {
				if (!(await file.stat()).isFile())
					throw new Error("Project assets must be regular files.");
				return new Uint8Array(await file.readFile());
			} finally {
				await file.close();
			}
		},
		async write(path, bytes) {
			const filename = await target(path, true);
			try {
				if (!(await lstat(filename)).isFile())
					throw new Error("Project assets must be regular files.");
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
		async removeEmptyDirectory(path) {
			await rmdir(await target(path));
		},
	};
}

export class DesktopProjects {
	private active: {
		directory: string;
		repository: ProjectRepository;
		files?: Map<string, Uint8Array>;
	} | null = null;
	private snapshot(snapshot: ProjectSnapshot): ProjectSnapshot {
		return this.active?.files ? { ...snapshot, inMemory: true } : snapshot;
	}
	isInMemory(directory: string) {
		this.current(directory);
		return !!this.active?.files;
	}
	private operation: Promise<unknown> = Promise.resolve();
	constructor(private initialPath?: string) {}
	private sequential<T>(run: () => Promise<T>) {
		const next = this.operation.then(run, run);
		this.operation = next.catch(() => undefined);
		return next;
	}
	private current(directory: string) {
		if (!this.active || this.active.directory !== directory)
			throw new Error("This project is no longer open.");
		return this.active.repository;
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
				exists: async (path) => files.has(projectPathSchema.parse(path)),
				async read(path) {
					const bytes = files.get(projectPathSchema.parse(path));
					if (!bytes)
						throw Object.assign(new Error("Project file not found."), {
							code: "ENOENT",
						});
					return new Uint8Array(bytes);
				},
				async write(path, bytes) {
					files.set(projectPathSchema.parse(path), new Uint8Array(bytes));
				},
				async remove(path) {
					files.delete(projectPathSchema.parse(path));
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
			const selected = join(
				await realpath(resolve(parent)),
				projectNameSchema.parse(snapshot.manifest.name),
			);
			await mkdir(selected);
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
			name = projectNameSchema.parse(name);
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
	private symbolLibraryPath(directory: string, path: string) {
		const repository = this.current(directory);
		if (
			!repository
				.getSymbolLibraries()
				.some(
					(library) =>
						library.source.kind === "directory" && library.source.path === path,
				)
		)
			throw new Error(
				"This directory is not configured as a project symbol library.",
			);
		return path.startsWith("~/")
			? resolve(homedir(), path.slice(2))
			: resolve(directory, path);
	}
	readSymbolLibrary(directory: string, path: string) {
		return this.sequential(
			async () =>
				(await readSymbolDirectory(this.symbolLibraryPath(directory, path)))
					.symbols,
		);
	}
	inspectLibrarySymbol(directory: string, path: string, id: string) {
		return this.sequential(() =>
			inspectDirectorySymbol(this.symbolLibraryPath(directory, path), id),
		);
	}
	saveLibrarySymbol(
		directory: string,
		path: string,
		original: SymbolFile,
		next: SymbolFile,
	) {
		return this.sequential(() =>
			saveDirectorySymbol(
				this.symbolLibraryPath(directory, path),
				original,
				next,
			),
		);
	}
	canWriteFile(directory: string, path: string) {
		return this.sequential(async () => {
			this.current(directory);
			const parts = projectPathSchema.parse(path).split("/");
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
