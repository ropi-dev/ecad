import * as Schema from "effect/Schema";
import {
	libraryDefinitions,
	parseSavedSymbolLibrary,
	type SymbolLibrary,
	savedLibrarySchema,
} from "#/components/editor/symbolFormat.ts";
import { type SymbolDefinition, symbolDefinitions } from "#/drawing/symbols.ts";

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

/** Later libraries win. Project libraries are resolved after user libraries. */
export async function resolveSymbolLibraries(
	user: readonly ConfiguredSymbolLibrary[],
	project: readonly ConfiguredSymbolLibrary[],
	loadDirectory?: (path: string, scope: LibraryScope) => Promise<SymbolLibrary>,
): Promise<{ definitions: SymbolDefinition[]; errors: string[] }> {
	const definitions = new Map<string, SymbolDefinition>();
	const errors: string[] = [];
	for (const [scope, libraries] of [
		["user", user],
		["project", project],
	] as const) {
		for (const library of libraries) {
			if (!library.enabled) continue;
			try {
				let loaded: SymbolDefinition[];
				if (library.source.kind === "builtin") loaded = symbolDefinitions;
				else if (library.source.kind === "embedded")
					loaded = libraryDefinitions(library.source.symbols);
				else {
					if (!loadDirectory)
						throw new Error(
							"Directory paths require the desktop app. Upload the library files in this browser.",
						);
					const symbols = await loadDirectory(library.source.path, scope);
					loaded = libraryDefinitions(
						parseSavedSymbolLibrary(JSON.stringify(symbols)),
					);
				}
				for (const definition of loaded)
					definitions.set(definition.id, definition);
			} catch (cause) {
				errors.push(
					`${library.name}: ${cause instanceof Error ? cause.message : "Unable to load library."}`,
				);
			}
		}
	}
	return { definitions: [...definitions.values()], errors };
}
