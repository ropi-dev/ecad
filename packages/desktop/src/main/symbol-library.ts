import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
	access,
	link,
	lstat,
	mkdir,
	readdir,
	readFile,
	realpath,
	rename,
	rm,
	writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import {
	mergeSymbolLibraries,
	parseSavedSymbolLibrary,
	parseSymbolFile,
	SYMBOL_FILE_LIMIT,
	type SymbolFile,
	type SymbolLibrary,
} from "@ecad/core/components/editor/symbolFormat.ts";
import { createSerialQueue } from "@ecad/core/lib/serial-queue.ts";
import {
	type ConfiguredSymbolLibrary,
	defaultSymbolConfig,
	parseSymbolConfig,
	SYMBOL_CONFIG_LIMIT,
	type SymbolLibraryConfig,
	serializeSymbolConfig,
	validateSymbolLibraries,
} from "@ecad/core/symbol-library/config.ts";
import type { SymbolLibrarySnapshot } from "@ecad/core/symbol-library/storage.tsx";

const symbolExtension = /\.(ecadsym|json)$/i;

/**
 * Checks the real path of a library directory before it is read or written.
 * It runs after symbolic links resolve, so a link cannot redirect an approved path.
 */
export type DirectoryAuthorization = (directory: string) => Promise<void>;

/** Resolve a directory once. Nested symlinks are never followed. */
async function readDirectoryData(
	selectedDirectory: string,
	authorize?: DirectoryAuthorization,
): Promise<{
	directory: string;
	symbols: SymbolLibrary;
	totalBytes: number;
	files: Map<string, { path: string; bytes: number }>;
}> {
	const directory = await realpath(resolve(selectedDirectory));
	await authorize?.(directory);
	if (!(await lstat(directory)).isDirectory()) {
		throw new Error("Choose a directory containing symbol files.");
	}
	const files: string[] = [];
	async function visit(current: string) {
		const entries = await readdir(current, { withFileTypes: true });
		entries.sort((left, right) => left.name.localeCompare(right.name));
		for (const entry of entries) {
			const path = join(current, entry.name);
			if (entry.isDirectory()) await visit(path);
			else if (entry.isFile() && symbolExtension.test(entry.name)) {
				files.push(path);
				if (files.length > 100) {
					throw new Error(
						"A symbol directory can contain at most 100 symbol files.",
					);
				}
			}
		}
	}
	await visit(directory);
	let totalBytes = 0;
	const symbols = [];
	const symbolFiles = new Map<string, { path: string; bytes: number }>();
	for (const path of files) {
		try {
			const metadata = await lstat(path);
			if (!metadata.isFile())
				throw new Error("Symbol files must be regular files.");
			if (metadata.size + totalBytes > SYMBOL_FILE_LIMIT) {
				throw new Error(
					"Symbol files in a directory must total 1 MB or smaller.",
				);
			}
			const content = await readFile(path);
			totalBytes += content.byteLength;
			if (totalBytes > SYMBOL_FILE_LIMIT) {
				throw new Error(
					"Symbol files in a directory must total 1 MB or smaller.",
				);
			}
			const symbol = parseSymbolFile(content.toString("utf8"));
			symbols.push(symbol);
			symbolFiles.set(symbol.id, { path, bytes: content.byteLength });
		} catch (error) {
			throw new Error(
				`${relative(directory, path)}: ${error instanceof Error ? error.message : "Unable to read this symbol file."}`,
				{ cause: error },
			);
		}
	}
	return {
		directory,
		symbols: mergeSymbolLibraries([], symbols),
		totalBytes,
		files: symbolFiles,
	};
}

/** Check file permissions as well as the parent needed for atomic replacement. */
export async function canWriteSymbolPath(
	path: string,
	create = false,
): Promise<boolean> {
	try {
		const stat = await lstat(path);
		if ((!stat.isFile() && !stat.isDirectory()) || !(stat.mode & 0o222))
			return false;
		await access(
			path,
			constants.W_OK | (stat.isDirectory() ? constants.X_OK : 0),
		);
		if (stat.isFile()) {
			const parent = await lstat(dirname(path));
			if (!parent.isDirectory() || !(parent.mode & 0o222)) return false;
			await access(dirname(path), constants.W_OK | constants.X_OK);
		}
		return true;
	} catch (cause) {
		if (
			create &&
			(cause as NodeJS.ErrnoException).code === "ENOENT" &&
			dirname(path) !== path
		)
			return canWriteSymbolPath(dirname(path), true);
		return false;
	}
}

export async function inspectDirectorySymbol(
	directory: string,
	id: string,
	authorize?: DirectoryAuthorization,
) {
	const current = await readDirectoryData(directory, authorize);
	const file = current.symbols.find((symbol) => symbol.id === id);
	const entry = current.files.get(id);
	if (!file || !entry)
		throw new Error("The symbol definition no longer exists in this library.");
	return { file, writable: await canWriteSymbolPath(entry.path) };
}

/** Find the source by ID, preserving nested paths and filenames unrelated to IDs. */
export async function saveDirectorySymbol(
	directory: string,
	original: SymbolFile,
	next: SymbolFile,
	authorize?: DirectoryAuthorization,
) {
	original = parseSymbolFile(JSON.stringify(original));
	next = parseSymbolFile(JSON.stringify(next));
	if (next.id !== original.id)
		throw new Error("Editing cannot change a symbol's ID.");
	const current = await readDirectoryData(directory, authorize);
	const entry = current.files.get(original.id);
	const file = current.symbols.find((symbol) => symbol.id === original.id);
	if (!entry || JSON.stringify(file) !== JSON.stringify(original))
		throw new Error("The symbol definition changed. Reopen it before saving.");
	if (!(await canWriteSymbolPath(entry.path)))
		throw new Error("The symbol definition file is read-only.");
	const contents = `${JSON.stringify(next)}\n`;
	if (
		current.totalBytes - entry.bytes + Buffer.byteLength(contents) >
		SYMBOL_FILE_LIMIT
	)
		throw new Error("Symbol files in a directory must total 1 MB or smaller.");
	const previous = await lstat(entry.path);
	const before = await readFile(entry.path);
	if (
		JSON.stringify(parseSymbolFile(before.toString("utf8"))) !==
		JSON.stringify(original)
	)
		throw new Error("The symbol definition changed. Reopen it before saving.");
	const temporary = join(dirname(entry.path), `.ecad-${randomUUID()}.tmp`);
	try {
		await writeFile(temporary, contents, {
			flag: "wx",
			mode: previous.mode & 0o777,
		});
		const latest = await lstat(entry.path);
		if (
			!latest.isFile() ||
			latest.ino !== previous.ino ||
			latest.dev !== previous.dev ||
			!(await readFile(entry.path)).equals(before)
		)
			throw new Error(
				"The symbol definition changed. Reopen it before saving.",
			);
		await rename(temporary, entry.path);
	} finally {
		await rm(temporary, { force: true });
	}
}

export async function readSymbolDirectory(
	selectedDirectory: string,
	authorize?: DirectoryAuthorization,
): Promise<SymbolLibrarySnapshot & { directory: string }> {
	const { directory, symbols } = await readDirectoryData(
		selectedDirectory,
		authorize,
	);
	return { directory, symbols };
}

function orderedLibrary(symbols: SymbolLibrary): string {
	return JSON.stringify(
		[...symbols].sort((left, right) => left.id.localeCompare(right.id)),
	);
}

/**
 * Only the main process chooses paths. A directory reaches the user
 * configuration only after the user picks it in a native dialog or adds it to
 * ~/.ecad/config.json themselves.
 */
export class DesktopSymbolLibrary {
	private snapshot: SymbolLibrarySnapshot;
	private readonly sequential = createSerialQueue();
	private approvedDirectories = new Set<string>();
	readonly configurationPath: string;

	constructor(
		directory?: string,
		private homeDirectory = homedir(),
	) {
		this.snapshot = { symbols: [], directory };
		this.configurationPath = join(homeDirectory, ".ecad", "config.json");
	}

	private async readConfiguration(): Promise<SymbolLibraryConfig> {
		try {
			if ((await lstat(this.configurationPath)).size > SYMBOL_CONFIG_LIMIT)
				throw new Error(
					"Symbol library configuration must be 10 MB or smaller.",
				);
			return parseSymbolConfig(await readFile(this.configurationPath, "utf8"));
		} catch (cause) {
			if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause;
			return defaultSymbolConfig();
		}
	}

	loadConfiguration() {
		return this.sequential(() => this.readConfiguration());
	}
	canWriteConfiguration() {
		return this.sequential(() =>
			canWriteSymbolPath(this.configurationPath, true),
		);
	}

	/** Directories the user chose with a native dialog during this session. */
	isChosenDirectory(directory: string) {
		return this.approvedDirectories.has(directory);
	}

	saveConfiguration(config: SymbolLibraryConfig): Promise<string> {
		return this.sequential(async () => {
			const contents = serializeSymbolConfig(config);
			const trusted = new Set(this.approvedDirectories);
			try {
				for (const library of (await this.readConfiguration()).symbolLibraries)
					if (library.source.kind === "directory")
						trusted.add(library.source.path);
			} catch {
				// A damaged configuration trusts no directories. Saving replaces it.
			}
			// serializeSymbolConfig validated these entries.
			for (const library of config.symbolLibraries)
				if (
					library.source.kind === "directory" &&
					!trusted.has(library.source.path)
				)
					throw new Error(
						`Add "${library.name}" with Add library directory before saving it.`,
					);
			if (!(await canWriteSymbolPath(this.configurationPath, true)))
				throw new Error("The symbol library configuration file is read-only.");
			await mkdir(dirname(this.configurationPath), { recursive: true });
			const temporary = `${this.configurationPath}.${randomUUID()}.tmp`;
			try {
				await writeFile(temporary, contents, { mode: 0o600, flag: "wx" });
				await rename(temporary, this.configurationPath);
			} finally {
				await rm(temporary, { force: true });
			}
			return `Saved to ${this.configurationPath}.`;
		});
	}

	openLibraryDirectory(
		directory: string,
		name = "",
	): Promise<ConfiguredSymbolLibrary> {
		return this.sequential(async () => {
			const snapshot = await readSymbolDirectory(directory);
			const entry: ConfiguredSymbolLibrary = {
				id: randomUUID(),
				name: name.trim() || basename(snapshot.directory),
				enabled: true,
				source: { kind: "directory", path: snapshot.directory },
			};
			validateSymbolLibraries([entry]);
			this.approvedDirectories.add(snapshot.directory);
			return entry;
		});
	}

	private async configuredDirectory(path: string) {
		const config = await this.readConfiguration();
		if (
			!this.approvedDirectories.has(path) &&
			!config.symbolLibraries.some(
				(library) =>
					library.source.kind === "directory" && library.source.path === path,
			)
		)
			throw new Error(
				"This directory is not configured as a user symbol library.",
			);
		return path.startsWith("~/")
			? resolve(this.homeDirectory, path.slice(2))
			: resolve(this.homeDirectory, path);
	}
	loadConfiguredDirectory(path: string): Promise<SymbolLibrary> {
		return this.sequential(
			async () =>
				(await readSymbolDirectory(await this.configuredDirectory(path)))
					.symbols,
		);
	}
	inspectConfiguredSymbol(path: string, id: string) {
		return this.sequential(async () =>
			inspectDirectorySymbol(await this.configuredDirectory(path), id),
		);
	}
	saveConfiguredSymbol(path: string, original: SymbolFile, next: SymbolFile) {
		return this.sequential(async () =>
			saveDirectorySymbol(await this.configuredDirectory(path), original, next),
		);
	}

	load(): Promise<SymbolLibrarySnapshot> {
		return this.sequential(async () => {
			if (this.snapshot.directory) {
				const next = await readSymbolDirectory(this.snapshot.directory);
				this.snapshot = next;
			}
			return this.snapshot;
		});
	}

	openDirectory(directory: string): Promise<SymbolLibrarySnapshot> {
		return this.sequential(async () => {
			const next = await readSymbolDirectory(directory);
			this.snapshot = next;
			return next;
		});
	}

	save(symbols: SymbolLibrary, additions: SymbolLibrary): Promise<string> {
		return this.sequential(async () => {
			const directory = this.snapshot.directory;
			if (!directory) {
				throw new Error("Open a symbol directory before saving symbols.");
			}
			const incoming = parseSavedSymbolLibrary(JSON.stringify(additions));
			const requested = parseSavedSymbolLibrary(JSON.stringify(symbols));
			const current = await readDirectoryData(directory);
			const next = mergeSymbolLibraries(current.symbols, incoming);
			if (orderedLibrary(next) !== orderedLibrary(requested)) {
				// Files may have changed after the editor loaded them. Do not lose those changes.
				throw new Error(
					"The symbol directory changed. Reopen it before saving symbols.",
				);
			}
			const outputs = incoming.map((symbol) => ({
				id: symbol.id,
				content: `${JSON.stringify(symbol)}\n`,
			}));
			if (
				current.totalBytes +
					outputs.reduce(
						(bytes, output) => bytes + Buffer.byteLength(output.content),
						0,
					) >
				SYMBOL_FILE_LIMIT
			) {
				throw new Error(
					"Symbol files in a directory must total 1 MB or smaller.",
				);
			}
			const created: string[] = [];
			try {
				for (const output of outputs) {
					const target = join(current.directory, `${output.id}.ecadsym`);
					const temporary = join(
						current.directory,
						`.ecad-${randomUUID()}.tmp`,
					);
					try {
						await writeFile(temporary, output.content, {
							flag: "wx",
						});
						// A hard link publishes a complete file and refuses to replace an existing one.
						await link(temporary, target);
						created.push(target);
					} finally {
						await rm(temporary, { force: true });
					}
				}
			} catch (error) {
				await Promise.all(created.map((path) => rm(path, { force: true })));
				throw new Error(
					`Unable to save symbols: ${error instanceof Error ? error.message : "Unable to write to this directory."}`,
					{ cause: error },
				);
			}
			this.snapshot = { directory: current.directory, symbols: next };
			return `Saved ${incoming.length} symbol${incoming.length === 1 ? "" : "s"} to ${current.directory}.`;
		});
	}
}
