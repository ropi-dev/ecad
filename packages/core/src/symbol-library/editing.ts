import {
	parseSymbolFile,
	type SymbolFile,
} from "#/components/editor/symbolFormat.ts";
import type { SymbolSource } from "#/symbol-library/config.ts";
import type {
	SymbolEditTarget,
	SymbolLibraryStorage,
} from "#/symbol-library/storage.tsx";

/** An edit keeps the winning library and original file, including its metadata. */
export async function prepareSymbolEdit(
	source: SymbolSource,
	userStorage: SymbolLibraryStorage,
	projectStorage?: SymbolLibraryStorage | null,
): Promise<SymbolEditTarget | null> {
	const { library, scope } = source;
	if (!source.file || library.source.kind === "builtin") return null;
	let original: SymbolFile = source.file;
	const key = `${scope}:${library.id}:${original.id}`;
	const target = scope === "user" ? userStorage : projectStorage;
	if (!target) return null;
	if (library.source.kind === "directory") {
		const inspect = userStorage.inspectDirectorySymbol;
		const save = userStorage.saveDirectorySymbol;
		if (!inspect || !save) return null;
		const request = {
			path: library.source.path,
			scope,
			projectDirectory:
				scope === "project" ? (await target.load()).directory : undefined,
			id: original.id,
		};
		const current = await inspect(request);
		if (!current.writable) return null;
		original = current.file;
		return {
			key,
			file: original,
			async save(next) {
				await save(request, original, next);
				original = next;
			},
		};
	}
	if (!target.loadConfiguration || !target.saveConfiguration) return null;
	const writable =
		scope === "project" &&
		library.id === "project-symbols" &&
		target.canEditSymbol
			? await target.canEditSymbol(original.id)
			: ((await target.canWriteConfiguration?.()) ?? true);
	if (!writable) return null;
	const load = target.loadConfiguration;
	const save = target.saveConfiguration;
	return {
		key,
		file: original,
		async save(next) {
			next = parseSymbolFile(JSON.stringify(next));
			if (next.id !== original.id)
				throw new Error("Editing cannot change a symbol's ID.");
			const config = await load();
			const current = config.symbolLibraries.find(
				(entry) => entry.id === library.id,
			);
			const file =
				current?.source.kind === "embedded"
					? current.source.symbols.find((entry) => entry.id === original.id)
					: undefined;
			if (JSON.stringify(file) !== JSON.stringify(original))
				throw new Error(
					"The symbol definition changed. Reopen it before saving.",
				);
			await save(
				{
					...config,
					symbolLibraries: config.symbolLibraries.map((entry) =>
						entry.id === library.id && entry.source.kind === "embedded"
							? {
									...entry,
									source: {
										...entry.source,
										symbols: entry.source.symbols.map((file) =>
											file.id === next.id ? next : file,
										),
									},
								}
							: entry,
					),
				},
				{ requirePersistence: true },
			);
			original = next;
		},
	};
}
