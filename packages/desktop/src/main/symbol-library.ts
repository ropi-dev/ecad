import { randomUUID } from "node:crypto";
import {
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
	type SymbolLibrary,
} from "@ecad/core/components/editor/symbolFormat.ts";
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

/** Resolve a directory once. Nested symlinks are never followed. */
async function readDirectoryData(
	selectedDirectory: string,
): Promise<{ directory: string; symbols: SymbolLibrary; totalBytes: number }> {
	const directory = await realpath(resolve(selectedDirectory));
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
			symbols.push(parseSymbolFile(content.toString("utf8")));
		} catch (error) {
			throw new Error(
				`${relative(directory, path)}: ${error instanceof Error ? error.message : "Unable to read this symbol file."}`,
				{ cause: error },
			);
		}
	}
	return { directory, symbols: mergeSymbolLibraries([], symbols), totalBytes };
}

export async function readSymbolDirectory(
	selectedDirectory: string,
): Promise<SymbolLibrarySnapshot & { directory: string }> {
	const { directory, symbols } = await readDirectoryData(selectedDirectory);
	return { directory, symbols };
}

function orderedLibrary(symbols: SymbolLibrary): string {
	return JSON.stringify(
		[...symbols].sort((left, right) => left.id.localeCompare(right.id)),
	);
}

/** Only the main process chooses paths. Renderer requests contain symbol data. */
export class DesktopSymbolLibrary {
	private snapshot: SymbolLibrarySnapshot;
	private operation: Promise<unknown> = Promise.resolve();
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

	saveConfiguration(config: SymbolLibraryConfig): Promise<string> {
		return this.sequential(async () => {
			const contents = serializeSymbolConfig(config);
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

	loadConfiguredDirectory(path: string): Promise<SymbolLibrary> {
		return this.sequential(async () => {
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
			const directory = path.startsWith("~/")
				? resolve(this.homeDirectory, path.slice(2))
				: resolve(this.homeDirectory, path);
			return (await readSymbolDirectory(directory)).symbols;
		});
	}

	private sequential<T>(run: () => Promise<T>): Promise<T> {
		const pending = this.operation.then(run, run);
		this.operation = pending.catch(() => undefined);
		return pending;
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
