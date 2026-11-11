import { createSerialQueue } from "@ecad/core/lib/serial-queue.ts";
import {
	InvalidProjectName,
	ProjectClosed,
	ProjectExists,
	ProjectStorageUnavailable,
} from "@ecad/core/projects/errors.ts";
import {
	PROJECT_FILE,
	parseProjectName,
	parseProjectPath,
} from "@ecad/core/projects/format.ts";
import {
	type ProjectDirectory,
	type ProjectLockMode,
	ProjectRepository,
	withLocalLock,
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
		getFile(): Promise<{
			readonly size: number;
			arrayBuffer(): Promise<ArrayBuffer>;
		}>;
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

type ProjectLock = NonNullable<ProjectDirectory["lock"]>;

/**
 * Runs work while holding the project's lock. Project names are unique within
 * the origin's private file system, and Web Locks span every tab and worker of
 * the origin.
 */
function projectLock<T>(
	name: string,
	work: () => Promise<T>,
	mode: ProjectLockMode,
): Promise<T> {
	const locks = globalThis.navigator?.locks;
	return locks
		? (locks.request(`ecad-project:${name}`, { mode }, work) as Promise<T>)
		: withLocalLock(`ecad-project:${name}`, work);
}

export function createBrowserProjectDirectory(
	name: string,
	handle: BrowserDirectory,
	lock: ProjectLock = (work, mode) => projectLock(name, work, mode),
): ProjectDirectory {
	async function parent(path: string, create = false) {
		const parts = parseProjectPath(path).split("/");
		const filename = parts.pop() as string;
		let directory = handle;
		for (const part of parts)
			directory = await directory.getDirectoryHandle(part, { create });
		return { directory, filename };
	}
	return {
		name,
		lock,
		async read(path, beforeRead) {
			const { directory, filename } = await parent(path);
			const file = await (await directory.getFileHandle(filename)).getFile();
			beforeRead?.(file.size);
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
	const sequential = createSerialQueue();
	const browserSelection = () => selection ?? globalThis.localStorage;
	const root = async () => {
		if (getRoot) return getRoot();
		if (!globalThis.navigator?.storage?.getDirectory)
			throw new ProjectStorageUnavailable();
		return (await navigator.storage.getDirectory()) as unknown as BrowserDirectory;
	};
	function current(directory: string) {
		if (!active || active.name !== directory) throw new ProjectClosed();
		return active.repository;
	}
	async function open(name: string) {
		name = parseProjectName(name);
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
				name = parseProjectName(name);
				const directory = await root();
				const displayName = name;
				if (name === "Untitled") name = `Untitled-${crypto.randomUUID()}`;
				const projectName = name;
				// The lock covers the existence check, the creation and the cleanup
				// of a failed creation, so a tab that loses a race to create the
				// same project never removes the project that another tab created.
				return projectLock(
					projectName,
					async () => {
						try {
							await directory.getDirectoryHandle(projectName);
						} catch (cause) {
							if (!(cause instanceof Error) || cause.name !== "NotFoundError")
								throw cause;
							const handle = await directory.getDirectoryHandle(projectName, {
								create: true,
							});
							// Web Locks are not reentrant, so the repository uses the lock
							// held here until the project exists.
							let held = true;
							const repository = new ProjectRepository(
								createBrowserProjectDirectory(
									projectName,
									handle,
									(work, mode) =>
										held ? work() : projectLock(projectName, work, mode),
								),
							);
							try {
								const snapshot = await repository.create(displayName);
								browserSelection().setItem(selectedProjectKey, projectName);
								active = { name: projectName, repository };
								return snapshot;
							} catch (error) {
								await directory
									.removeEntry(projectName, { recursive: true })
									.catch(() => undefined);
								throw error;
							} finally {
								held = false;
							}
						}
						throw new ProjectExists({ projectName: displayName });
					},
					"exclusive",
				);
			}),
		open: (name) =>
			sequential(() => {
				if (!name)
					throw new InvalidProjectName({
						projectName: "",
						reason: "Choose a project to open.",
					});
				return open(name);
			}),
		save: (directory, document) =>
			sequential(() => current(directory).save(document)),
		importAssets: (directory, assets) =>
			sequential(() => current(directory).importAssets(assets)),
		readAsset: (directory, path) =>
			sequential(() => current(directory).readAsset(path)),
		saveSettings: (directory, settings) =>
			sequential(() => current(directory).saveSettings(settings)),
	};
}
