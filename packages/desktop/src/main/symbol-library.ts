import { randomUUID } from "node:crypto";
import {
	link,
	lstat,
	readdir,
	readFile,
	realpath,
	rm,
	writeFile,
} from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import {
	mergeSymbolLibraries,
	parseSavedSymbolLibrary,
	parseSymbolFile,
	SYMBOL_FILE_LIMIT,
	type SymbolLibrary,
} from "@ecad/core/components/editor/symbolFormat.ts";
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

	constructor(directory?: string) {
		this.snapshot = { symbols: [], directory };
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
