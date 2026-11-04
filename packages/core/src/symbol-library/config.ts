import * as Schema from "effect/Schema";
import {
	libraryDefinitions,
	parseSavedSymbolLibrary,
	type SymbolLibrary,
	savedLibrarySchema,
} from "#/components/editor/symbolFormat.ts";
import {
	type SymbolLibraryReference,
	symbolReferenceKey,
} from "#/drawing/symbol-reference.ts";
import { type SymbolDefinition, symbolDefinitions } from "#/drawing/symbols.ts";
import { errorMessage } from "#/lib/error-message.ts";

export const USER_SYMBOL_CONFIG_KEY = "ecad.user-config.v1";
export const SYMBOL_CONFIG_LIMIT = 10 * 1024 * 1024;

const librarySchema = Schema.Struct({
	id: Schema.String.pipe(Schema.pattern(/^[a-zA-Z0-9._-]{1,100}$/)),
	name: Schema.String.pipe(
		Schema.minLength(1),
		Schema.maxLength(100),
		Schema.filter((name) => name.trim().length > 0),
	),
	enabled: Schema.Boolean,
	source: Schema.Union(
		Schema.Struct({ kind: Schema.Literal("builtin") }),
		Schema.Struct({
			kind: Schema.Literal("embedded"),
			symbols: savedLibrarySchema,
		}),
		Schema.Struct({
			kind: Schema.Literal("directory"),
			path: Schema.String.pipe(
				Schema.maxLength(4096),
				Schema.filter((path) => path.trim().length > 0),
			),
		}),
	),
});
const librariesSchema = Schema.Array(librarySchema).pipe(Schema.maxItems(32));
const configSchema = Schema.Struct({
	version: Schema.Literal(1),
	symbolLibraries: librariesSchema,
});

export type ConfiguredSymbolLibrary = typeof librarySchema.Type;
export type SymbolLibraryConfig = typeof configSchema.Type;
export type LibraryScope = "user" | "project";
export interface SymbolSource {
	scope: LibraryScope;
	library: ConfiguredSymbolLibrary;
	file?: SymbolLibrary[number];
}

export function defaultSymbolConfig(): SymbolLibraryConfig {
	return {
		version: 1,
		symbolLibraries: [
			{
				id: "builtin",
				name: "Built-in symbols",
				enabled: true,
				source: { kind: "builtin" },
			},
		],
	};
}

export function validateSymbolLibraries(
	value: unknown,
): readonly ConfiguredSymbolLibrary[] {
	const libraries = Schema.decodeUnknownSync(librariesSchema)(value, {
		onExcessProperty: "error",
	});
	const ids = new Set<string>();
	for (const library of libraries) {
		if (ids.has(library.id))
			throw new Error(`Library ID "${library.id}" is duplicated.`);
		ids.add(library.id);
		if (library.source.kind === "embedded") {
			parseSavedSymbolLibrary(JSON.stringify(library.source.symbols));
		}
	}
	if (
		new TextEncoder().encode(JSON.stringify(libraries)).length >
		SYMBOL_CONFIG_LIMIT
	) {
		throw new Error("Symbol library configuration must be 10 MB or smaller.");
	}
	return libraries;
}

export function parseSymbolConfig(text: string): SymbolLibraryConfig {
	if (new TextEncoder().encode(text).length > SYMBOL_CONFIG_LIMIT) {
		throw new Error("Symbol library configuration must be 10 MB or smaller.");
	}
	const config = Schema.decodeUnknownSync(configSchema)(JSON.parse(text), {
		onExcessProperty: "error",
	});
	return {
		...config,
		symbolLibraries: validateSymbolLibraries(config.symbolLibraries),
	};
}

export function serializeSymbolConfig(config: SymbolLibraryConfig): string {
	const text = JSON.stringify(config);
	parseSymbolConfig(text);
	return text;
}

/**
 * True when a library failed to load, or when one of its loaded symbols could
 * not resolve. Either way the symbol's full definition is unavailable.
 */
export type SymbolAvailability = (
	library: SymbolLibraryReference,
	id: string,
) => boolean;

export function unavailableSymbols(resolved: {
	unavailable: readonly SymbolLibraryReference[];
	unavailableSymbols: readonly string[];
}): SymbolAvailability {
	const libraries = new Set(
		resolved.unavailable.map((library) => `${library.scope}:${library.id}`),
	);
	const symbols = new Set(resolved.unavailableSymbols);
	return (library, id) =>
		libraries.has(`${library.scope}:${library.id}`) ||
		symbols.has(symbolReferenceKey(library, id));
}

/** Later libraries win. Project libraries are resolved after user libraries. */
export async function resolveSymbolLibraries(
	user: readonly ConfiguredSymbolLibrary[],
	project: readonly ConfiguredSymbolLibrary[],
	loadDirectory?: (path: string, scope: LibraryScope) => Promise<SymbolLibrary>,
): Promise<{
	definitions: SymbolDefinition[];
	sources: Map<string, SymbolSource>;
	byReference: Map<string, SymbolDefinition>;
	referenceSources: Map<string, SymbolSource>;
	errors: string[];
	/** Enabled libraries that failed to load. Their symbols are missing. */
	unavailable: SymbolLibraryReference[];
	/**
	 * `symbolReferenceKey`s of loaded symbols that failed to resolve, for
	 * example because a symbol they place is missing, its library failed to
	 * load, or the references form a cycle. Their definitions are incomplete.
	 */
	unavailableSymbols: string[];
}> {
	const definitions = new Map<string, SymbolDefinition>();
	const sources = new Map<string, SymbolSource>();
	const errors: string[] = [];
	const unavailable: SymbolLibraryReference[] = [];
	const entries = new Map<
		string,
		{
			definition: SymbolDefinition;
			file?: SymbolLibrary[number];
			library: SymbolLibraryReference;
		}
	>();
	const winners = new Map<string, string>();
	const referenceSources = new Map<string, SymbolSource>();
	for (const [scope, libraries] of [
		["user", user],
		["project", project],
	] as const) {
		for (const library of libraries) {
			if (!library.enabled) continue;
			try {
				let loaded: SymbolDefinition[];
				let files: SymbolLibrary = [];
				if (library.source.kind === "builtin") loaded = symbolDefinitions;
				else if (library.source.kind === "embedded") {
					files = library.source.symbols;
					loaded = libraryDefinitions(files);
				} else {
					if (!loadDirectory)
						throw new Error(
							"Directory paths require the desktop app. Upload the library files in this browser.",
						);
					const symbols = await loadDirectory(library.source.path, scope);
					files = parseSavedSymbolLibrary(JSON.stringify(symbols));
					loaded = libraryDefinitions(files);
				}
				for (const [index, definition] of loaded.entries()) {
					const reference = { scope, id: library.id };
					const key = symbolReferenceKey(reference, definition.id);
					entries.set(key, {
						definition,
						file: files[index],
						library: reference,
					});
					winners.set(definition.id, key);
					referenceSources.set(key, { scope, library, file: files[index] });
				}
			} catch (cause) {
				unavailable.push({ scope, id: library.id });
				errors.push(
					`${library.name}: ${errorMessage(cause, "Unable to load library.")}`,
				);
			}
		}
	}
	const byReference = new Map<string, SymbolDefinition>();
	const depths = new Map<string, number>();
	const resolving = new Set<string>();
	function resolve(
		library: SymbolLibraryReference | undefined,
		id: string,
	): SymbolDefinition {
		const key = library ? symbolReferenceKey(library, id) : winners.get(id);
		const entry = key ? entries.get(key) : undefined;
		if (!key || !entry)
			throw new Error(
				`Symbol "${id}" is unavailable in library "${library?.id ?? "unknown"}".`,
			);
		const cached = byReference.get(key);
		if (cached) return cached;
		if (resolving.has(key))
			throw new Error(
				`Circular symbol reference at "${id}" in library "${entry.library.id}".`,
			);
		if (resolving.size >= 32)
			throw new Error("Symbol references may be nested at most 32 levels.");
		resolving.add(key);
		try {
			let depth = 1;
			const definition = {
				...(entry.file
					? libraryDefinitions([entry.file], (library, id) => {
							const child = resolve(library, id);
							depth = Math.max(
								depth,
								1 + (depths.get(symbolReferenceKey(library, id)) ?? 1),
							);
							return child;
						})[0]
					: entry.definition),
				library: entry.library,
			};
			if (depth > 32)
				throw new Error("Symbol references may be nested at most 32 levels.");
			if (definition.children.length > 65_536)
				throw new Error("Resolved symbols may contain at most 65536 shapes.");
			byReference.set(key, definition);
			depths.set(key, depth);
			return definition;
		} finally {
			resolving.delete(key);
		}
	}
	const unresolved: string[] = [];
	for (const entry of entries.values()) {
		try {
			resolve(entry.library, entry.definition.id);
		} catch (cause) {
			unresolved.push(symbolReferenceKey(entry.library, entry.definition.id));
			errors.push(errorMessage(cause, "Unable to resolve symbol references."));
		}
	}
	for (const [id, key] of winners) {
		const definition = byReference.get(key);
		const source = referenceSources.get(key);
		if (definition && source) {
			definitions.set(id, definition);
			sources.set(id, source);
		}
	}
	return {
		definitions: [...definitions.values()],
		sources,
		byReference,
		referenceSources,
		errors: [...new Set(errors)],
		unavailable,
		unavailableSymbols: unresolved,
	};
}
