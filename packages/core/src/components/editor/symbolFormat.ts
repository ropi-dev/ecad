import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as ParseResult from "effect/ParseResult";
import * as Schema from "effect/Schema";
import { lineStyles } from "#/drawing/line-style.ts";
import { type EditorSymbol, symbolShapes } from "#/drawing/shapes.ts";
import { symbolFileWithShapes } from "#/drawing/symbol-file.ts";
import { symbolDefinitions } from "#/drawing/symbols.ts";
import { readFile } from "#/formats/import-effects.ts";

export const SYMBOL_FILE_LIMIT = 1024 * 1024;
export const SYMBOL_STORAGE_KEY = "ecad.symbol-library.v1";

const coordinate = Schema.Number.pipe(Schema.between(-1000, 1000));
const dimension = Schema.Number.pipe(Schema.between(0.01, 1000));
const label = Schema.String.pipe(Schema.minLength(1), Schema.maxLength(100));
const lineWidth = Schema.optional(
	Schema.Number.pipe(Schema.greaterThan(0), Schema.lessThanOrEqualTo(1000)),
);
const lineStyle = Schema.optional(Schema.Literal(...lineStyles));
const textAlignmentFields = {
	horizontalAlign: Schema.optional(Schema.Literal("left", "center", "right")),
	verticalAlign: Schema.optional(Schema.Literal("top", "middle", "bottom")),
};
const textAlignment = Schema.Struct(textAlignmentFields);
const locked = Schema.optional(Schema.Boolean);
const childOverrides = Schema.optional(
	Schema.Record({
		key: Schema.String.pipe(
			Schema.pattern(/^(shape:[1-9]\d*|attribute:(name|reference|value))$/),
		),
		value: Schema.Struct({
			x: Schema.optional(coordinate),
			y: Schema.optional(coordinate),
			width: Schema.optional(Schema.Number.pipe(Schema.between(0, 1000))),
			height: Schema.optional(dimension),
			rotation: Schema.optional(Schema.Finite),
			lineWidth: Schema.optional(Schema.Number.pipe(Schema.between(0, 1000))),
			fontSize: Schema.optional(dimension),
			text: Schema.optional(Schema.String),
			name: Schema.optional(Schema.String),
			number: Schema.optional(Schema.String),
			showLabels: Schema.optional(Schema.Boolean),
			showName: Schema.optional(Schema.Boolean),
			showNumber: Schema.optional(Schema.Boolean),
			length: Schema.optional(Schema.Number.pipe(Schema.between(0, 1000))),
			locked,
			lineStyle,
			...textAlignmentFields,
		}),
	}),
);
const shapeSchema = Schema.Union(
	Schema.Struct({
		kind: Schema.Literal("text"),
		locked,
		x: coordinate,
		y: coordinate,
		width: dimension,
		height: dimension,
		fontSize: dimension,
		bold: Schema.optional(Schema.Boolean),
		text: Schema.String.pipe(Schema.maxLength(2000)),
		rotation: Schema.optional(Schema.Number.pipe(Schema.between(-360, 360))),
		lineWidth,
		...textAlignmentFields,
	}),
	Schema.Struct({
		kind: Schema.Literal("symbol"),
		netSymbol: Schema.optional(
			Schema.Boolean.pipe(
				Schema.filter((value) => !value, {
					message: () =>
						"Net symbols cannot be nested inside reusable symbols.",
				}),
			),
		),
		locked,
		childOverrides,
		library: Schema.Struct({
			scope: Schema.Literal("user", "project"),
			id: label,
		}),
		definitionId: Schema.String.pipe(
			Schema.pattern(/^[a-z][a-z0-9._-]{0,63}$/),
		),
		x: coordinate,
		y: coordinate,
		rotation: Schema.optional(Schema.Number.pipe(Schema.between(-360, 360))),
		lineWidth,
		attributes: Schema.optional(
			Schema.Struct({
				name: Schema.String,
				reference: Schema.String,
				value: Schema.String,
			}),
		),
		textAlignments: Schema.optional(
			Schema.Struct({
				name: Schema.optional(textAlignment),
				reference: Schema.optional(textAlignment),
				value: Schema.optional(textAlignment),
			}),
		),
		textPositions: Schema.optional(
			Schema.Struct({
				name: Schema.optional(Schema.Struct({ x: coordinate, y: coordinate })),
				reference: Schema.optional(
					Schema.Struct({ x: coordinate, y: coordinate }),
				),
				value: Schema.optional(Schema.Struct({ x: coordinate, y: coordinate })),
			}),
		),
	}),
	Schema.Struct({
		kind: Schema.Literal("wire", "line"),
		locked,
		lineWidth,
		lineStyle,
		x1: coordinate,
		y1: coordinate,
		x2: coordinate,
		y2: coordinate,
	}).pipe(
		Schema.filter(
			(line) =>
				Math.hypot(line.x2 - line.x1, line.y2 - line.y1) >= 0.01 ||
				"Line or wire length must be at least 0.01 mm.",
		),
	),
	Schema.Struct({
		kind: Schema.Literal("rectangle", "triangle", "no-connect"),
		filled: Schema.optional(Schema.Boolean),
		locked,
		lineWidth,
		lineStyle,
		x: coordinate,
		y: coordinate,
		width: dimension,
		height: dimension,
		rotation: Schema.optional(Schema.Number.pipe(Schema.between(-360, 360))),
	}),
	Schema.Struct({
		kind: Schema.Literal("circle"),
		filled: Schema.optional(Schema.Boolean),
		locked,
		lineWidth,
		lineStyle,
		x: coordinate,
		y: coordinate,
		radius: dimension,
	}),
	Schema.Struct({
		kind: Schema.Literal("pin"),
		locked,
		name: Schema.optional(Schema.String),
		number: Schema.optional(Schema.String),
		showLabels: Schema.optional(Schema.Boolean),
		showName: Schema.optional(Schema.Boolean),
		showNumber: Schema.optional(Schema.Boolean),
		labelOffset: Schema.optional(coordinate),
		length: Schema.optional(Schema.Number.pipe(Schema.between(0, 1000))),
		rotation: Schema.optional(Schema.Number.pipe(Schema.between(-360, 360))),
		lineWidth,
		x: coordinate,
		y: coordinate,
	}),
);
const symbolFileSchema = Schema.Struct({
	format: Schema.Literal("ecad-symbol"),
	version: Schema.Literal(1),
	units: Schema.Literal("mm"),
	id: Schema.String.pipe(Schema.pattern(/^[a-z][a-z0-9._-]{0,63}$/)),
	name: label.pipe(Schema.filter((name) => name.trim().length > 0)),
	description: Schema.String.pipe(Schema.maxLength(500)),
	prefix: Schema.String.pipe(Schema.pattern(/^[A-Za-z][A-Za-z0-9_]{0,15}$/)),
	value: Schema.String.pipe(Schema.maxLength(100)),
	netSymbol: Schema.optional(Schema.Boolean),
	shapes: Schema.Array(shapeSchema).pipe(Schema.maxItems(256)),
});
export type SymbolFile = typeof symbolFileSchema.Type;
export type SymbolLibrary = readonly SymbolFile[];
export const savedLibrarySchema = Schema.Array(symbolFileSchema).pipe(
	Schema.maxItems(100),
);

export class SymbolFormatError extends Data.TaggedError("SymbolFormatError")<{
	readonly message: string;
}> {}

function checkSize(text: string) {
	if (new TextEncoder().encode(text).length > SYMBOL_FILE_LIMIT)
		throw new SymbolFormatError({
			message: "Symbol files and the saved library must be 1 MB or smaller.",
		});
}

function decodeJson(text: string): unknown {
	checkSize(text);
	try {
		return JSON.parse(text);
	} catch {
		throw new SymbolFormatError({
			message: "Invalid JSON. Start with the example .ecadsym file.",
		});
	}
}

function decode<A>(schema: Schema.Schema<A>, value: unknown): A {
	try {
		return Schema.decodeUnknownSync(schema)(value, {
			onExcessProperty: "error",
		});
	} catch (error) {
		const issue = ParseResult.isParseError(error)
			? ParseResult.ArrayFormatter.formatErrorSync(error)[0]
			: undefined;
		throw new SymbolFormatError({
			message: `Invalid symbol file: ${issue ? `${issue.path.map(String).join(".") || "file"}: ${issue.message}` : "Check the file format."}`,
		});
	}
}

function checkIds(symbols: SymbolLibrary) {
	const ids = new Set(symbolDefinitions.map((definition) => definition.id));
	for (const symbol of symbols) {
		if (ids.has(symbol.id))
			throw new SymbolFormatError({
				message: `Symbol ID "${symbol.id}" is duplicated or reserved by a built-in symbol. Choose a unique ID.`,
			});
		ids.add(symbol.id);
	}
}

/** A portable symbol file always describes exactly one symbol. */
export function parseSymbolFile(text: string): SymbolFile {
	const symbol = decode(symbolFileSchema, decodeJson(text));
	checkIds([symbol]);
	return symbol;
}

/** New files start empty; shape insertion uses the normal symbol editor commands. */
export function createEmptySymbolFile(
	name: string,
	existing: SymbolLibrary,
): SymbolFile {
	name = name.trim();
	const base =
		name
			.normalize("NFKD")
			.toLowerCase()
			.replace(/[\u0300-\u036f]/g, "")
			.replace(/[^a-z0-9._-]+/g, "-")
			.replace(/^[^a-z]+/, "")
			.slice(0, 56)
			.replace(/[-.]+$/, "") || "symbol";
	const ids = new Set(
		[...symbolDefinitions, ...existing].map((symbol) => symbol.id),
	);
	let id = base;
	for (let suffix = 2; ids.has(id); suffix++) id = `${base}-${suffix}`;
	return parseSymbolFile(
		JSON.stringify({
			format: "ecad-symbol",
			version: 1,
			units: "mm",
			id,
			name,
			description: "",
			prefix: "U",
			value: "",
			shapes: [],
		}),
	);
}

/** Save a reusable definition using the same format as imported libraries. */
export function symbolFileFromSymbol(symbol: EditorSymbol): SymbolFile {
	return parseSymbolFile(
		JSON.stringify(
			symbolFileWithShapes(
				{
					format: "ecad-symbol",
					version: 1,
					units: "mm",
					id: symbol.definitionId,
					name: symbol.attributes.name,
					description: "",
					prefix: "U",
					value: symbol.attributes.value,
					shapes: [],
				},
				symbolShapes({ ...symbol, x: 0, y: 0, rotation: 0 }),
			),
		),
	);
}

/** Browser storage is an internal cache of the individual symbol files. */
export function parseSavedSymbolLibrary(text: string): SymbolLibrary {
	const value = decodeJson(text);
	const library = decode(savedLibrarySchema, value);
	checkIds(library);
	checkSize(JSON.stringify(library));
	return library;
}

export function mergeSymbolLibraries(
	current: SymbolLibrary,
	incoming: SymbolLibrary,
): SymbolLibrary {
	return parseSavedSymbolLibrary(JSON.stringify([...current, ...incoming]));
}

export function importSymbolFile(file: File) {
	return Effect.gen(function* () {
		if (!/\.(ecadsym|json)$/i.test(file.name))
			return yield* new SymbolFormatError({
				message: "Choose a .ecadsym or .json symbol file.",
			});
		if (file.size > SYMBOL_FILE_LIMIT)
			return yield* new SymbolFormatError({
				message: "Symbol files must be 1 MB or smaller.",
			});
		const text = yield* readFile(() => file.text());
		return yield* Effect.try({
			try: () => parseSymbolFile(text),
			catch: (error) =>
				error instanceof SymbolFormatError
					? error
					: new SymbolFormatError({
							message: "Unable to import this symbol file.",
						}),
		});
	});
}

/** Read a directory or file selection completely before adding any symbols. */
export function importSymbolFiles(files: readonly File[], directory = false) {
	return Effect.gen(function* () {
		const selected = directory
			? files.filter((file) => /\.(ecadsym|json)$/i.test(file.name))
			: files;
		if (selected.length === 0)
			return yield* new SymbolFormatError({
				message: "No .ecadsym or .json symbol files found.",
			});
		if (selected.length > 100)
			return yield* new SymbolFormatError({
				message: "Choose at most 100 symbol files at a time.",
			});
		if (
			selected.reduce((bytes, file) => bytes + file.size, 0) > SYMBOL_FILE_LIMIT
		)
			return yield* new SymbolFormatError({
				message: "The selected symbol files must total 1 MB or smaller.",
			});
		const symbols: SymbolFile[] = [];
		for (const file of selected) {
			const symbol = yield* importSymbolFile(file).pipe(
				Effect.mapError(
					(error) =>
						new SymbolFormatError({
							message: `${file.webkitRelativePath || file.name}: ${error.message}`,
						}),
				),
			);
			symbols.push(symbol);
		}
		return yield* Effect.try({
			try: () => mergeSymbolLibraries([], symbols),
			catch: (error) =>
				error instanceof SymbolFormatError
					? error
					: new SymbolFormatError({
							message: "Unable to import these symbol files.",
						}),
		});
	});
}

export { libraryDefinitions } from "#/drawing/symbol-file.ts";
