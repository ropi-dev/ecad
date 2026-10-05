import {
	PROJECT_FILE,
	projectNameSchema,
	projectPathSchema,
} from "@ecad/core/projects/format.ts";
import {
	type ProjectDirectory,
	ProjectRepository,
} from "@ecad/core/projects/repository.ts";
import type { ProjectStorage } from "@ecad/core/projects/storage.ts";

export interface BrowserDirectory {
	getDirectoryHandle(
		name: string,
		options?: { create?: boolean },
	): Promise<BrowserDirectory>;
	getFileHandle(
		name: string,
		options?: { create?: boolean },
	): Promise<{
		getFile(): Promise<{ arrayBuffer(): Promise<ArrayBuffer> }>;
		createWritable(): Promise<{
			write(data: ArrayBuffer): Promise<void>;
			close(): Promise<void>;
			abort(): Promise<void>;
		}>;
	}>;
	removeEntry(name: string, options?: { recursive?: boolean }): Promise<void>;
	keys(): AsyncIterable<string>;
}
const selectedProjectKey = "ecad.active-project";

export function createBrowserProjectDirectory(
	name: string,
	handle: BrowserDirectory,
): ProjectDirectory {
	async function parent(path: string, create = false) {
		const parts = projectPathSchema.parse(path).split("/");
		const filename = parts.pop() as string;
		let directory = handle;
		for (const part of parts)
			directory = await directory.getDirectoryHandle(part, { create });
		return { directory, filename };
	}
	return {
		name,
		async read(path) {
			const { directory, filename } = await parent(path);
			const file = await (await directory.getFileHandle(filename)).getFile();
			return new Uint8Array(await file.arrayBuffer());
		},
		async write(path, bytes) {
			const { directory, filename } = await parent(path, true);
			const writable = await (
				await directory.getFileHandle(filename, { create: true })
			).createWritable();
			try {
				await writable.write(new Uint8Array(bytes).buffer);
				await writable.close();
			} catch (cause) {
				await writable.abort().catch(() => undefined);
				throw cause;
			}
		},
		async remove(path) {
			const { directory, filename } = await parent(path);
			await directory.removeEntry(filename, { recursive: true });
		},
	};
}

export function createWebProjectStorage(
	getRoot?: () => Promise<BrowserDirectory>,
	selection?: Pick<Storage, "getItem" | "setItem">,
): ProjectStorage {
	let active: { name: string; repository: ProjectRepository } | null = null;
	let operation: Promise<unknown> = Promise.resolve();
	const browserSelection = () => selection ?? globalThis.localStorage;
	const root = async () => {
		if (getRoot) return getRoot();
		if (!globalThis.navigator?.storage?.getDirectory)
			throw new Error(
				"Project directories are unavailable in this browser. Use a browser with local filesystem storage support.",
			);
		return (await navigator.storage.getDirectory()) as unknown as BrowserDirectory;
	};
	function sequential<T>(run: () => Promise<T>) {
		const next = operation.then(run, run);
		operation = next.catch(() => undefined);
		return next;
	}
	function current(directory: string) {
		if (!active || active.name !== directory)
			throw new Error("This project is no longer open.");
		return active.repository;
	}
	async function open(name: string) {
		name = projectNameSchema.parse(name);
		const handle = await (await root()).getDirectoryHandle(name);
		const repository = new ProjectRepository(
			createBrowserProjectDirectory(name, handle),
		);
		const snapshot = await repository.load();
		browserSelection().setItem(selectedProjectKey, name);
		active = { name, repository };
		return snapshot;
	}
	return {
		mode: "web",
		load: () =>
			sequential(async () => {
				const name = browserSelection().getItem(selectedProjectKey);
				return name ? open(name) : null;
			}),
		list: () =>
			sequential(async () => {
				const directory = await root();
				const projects = [];
				for await (const name of directory.keys()) {
					try {
						const handle = await directory.getDirectoryHandle(name);
						await handle.getFileHandle(PROJECT_FILE);
						projects.push(name);
					} catch (cause) {
						if (
							!(cause instanceof Error) ||
							!["NotFoundError", "TypeMismatchError"].includes(cause.name)
						)
							throw cause;
					}
				}
				return projects.sort();
			}),
		create: (name) =>
			sequential(async () => {
				name = projectNameSchema.parse(name);
				const directory = await root();
				try {
					await directory.getDirectoryHandle(name);
				} catch (cause) {
					if (!(cause instanceof Error) || cause.name !== "NotFoundError")
						throw cause;
					const handle = await directory.getDirectoryHandle(name, {
						create: true,
					});
					const repository = new ProjectRepository(
						createBrowserProjectDirectory(name, handle),
					);
					try {
						const snapshot = await repository.create(name);
						browserSelection().setItem(selectedProjectKey, name);
						active = { name, repository };
						return snapshot;
					} catch (error) {
						await directory
							.removeEntry(name, { recursive: true })
							.catch(() => undefined);
						throw error;
					}
				}
				throw new Error("A project with this name already exists.");
			}),
		open: (name) =>
			sequential(() => {
				if (!name) throw new Error("Choose a project to open.");
				return open(name);
			}),
		save: (directory, document) =>
			sequential(() => current(directory).save(document)),
		importAssets: (directory, assets) =>
			sequential(() => current(directory).importAssets(assets)),
		readAsset: (directory, path) =>
			sequential(() => current(directory).readAsset(path)),
	};
}
