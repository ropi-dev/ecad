import {
	type CircuitFile,
	circuitFileSchema,
} from "@ecad/drawing-core/circuit/model.ts";
import { ParseResult } from "effect";
import { parse, stringify } from "smol-toml";
import { z } from "zod";
import {
	parseSavedSymbolLibrary,
	type SymbolLibrary,
} from "#/components/editor/symbolFormat.ts";
import { drawingShapeSchema } from "#/drawing/schema.ts";
import type { EditorShape } from "#/drawing/shapes.ts";
import { errorMessage } from "#/lib/error-message.ts";
import {
	InvalidProjectDocument,
	InvalidProjectFile,
	InvalidProjectName,
	InvalidProjectPath,
	schemaReason,
} from "#/projects/errors.ts";
import {
	type ConfiguredSymbolLibrary,
	validateSymbolLibraries,
} from "#/symbol-library/config.ts";

export const PROJECT_FILE = ".ecadprj";
export const projectNameSchema = z
	.string()
	.trim()
	.min(1)
	.max(120)
	.refine(
		(name) =>
			!/[<>:"/\\|?*]/.test(name) &&
			Array.from(name).every((character) => character.charCodeAt(0) >= 32) &&
			name !== "." &&
			name !== ".." &&
			!/[. ]$/.test(name) &&
			!/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name),
		"Use a project name that is valid as a directory name.",
	);
export const projectPathSchema = z
	.string()
	.min(1)
	.refine(
		(path) =>
			!/[\\:]/.test(path) &&
			Array.from(path).every((character) => character.charCodeAt(0) >= 32) &&
			path
				.split("/")
				.every((part) => part !== "" && part !== "." && part !== ".."),
		"Project assets must use paths inside the project directory.",
	);
export const assetSchema = z.strictObject({
	path: projectPathSchema,
	name: z.string().min(1),
	kind: z.enum(["gerber", "step"]),
});
export const manifestSchema = z.strictObject({
	format: z.literal("ecad-project"),
	version: z.literal(1),
	name: projectNameSchema,
	drawing: projectPathSchema,
	drawings: z.array(projectPathSchema).optional(),
	circuits: z
		.array(
			z.strictObject({
				circuit: projectPathSchema,
			}),
		)
		.optional(),
	symbols: z.array(projectPathSchema),
	assets: z.array(assetSchema).default([]),
});
export type ProjectManifest = z.infer<typeof manifestSchema>;
export type ProjectAsset = z.infer<typeof assetSchema>;
export type AssetKind = ProjectAsset["kind"];
export const drawingFileSchema = z
	.strictObject({
		id: z.string().regex(/^[a-z0-9][a-z0-9_-]*$/),
		name: projectNameSchema,
		circuitId: z.string().min(1).optional(),
		shapes: z.array(drawingShapeSchema),
	})
	.refine(
		(file) =>
			new Set(file.shapes.map((shape) => shape.id)).size === file.shapes.length,
		"The drawing contains duplicate shape IDs.",
	);
export type ProjectDrawing = z.infer<typeof drawingFileSchema>;
export interface ProjectDocument {
	shapes: EditorShape[];
	drawings?: ProjectDrawing[];
	circuits?: CircuitFile[];
	symbols: SymbolLibrary;
	symbolLibraries?: readonly ConfiguredSymbolLibrary[];
}
export interface ProjectSnapshot extends ProjectDocument {
	inMemory?: boolean;
	directory: string;
	manifest: ProjectManifest;
}

/** @throws {InvalidProjectName} with a readable reason. */
export function parseProjectName(name: string): string {
	const result = projectNameSchema.safeParse(name);
	if (result.success) return result.data;
	throw new InvalidProjectName({
		projectName: name,
		reason: schemaReason(result.error.issues),
	});
}

/** @throws {InvalidProjectPath} when the path leaves the project directory. */
export function parseProjectPath(path: string): string {
	const result = projectPathSchema.safeParse(path);
	if (result.success) return result.data;
	throw new InvalidProjectPath({
		path,
		reason: schemaReason(result.error.issues),
	});
}

/** @throws {InvalidProjectFile} naming the project manifest. */
export function parseProjectManifest(content: string): ProjectManifest {
	let value: unknown;
	try {
		value = parse(content);
	} catch (cause) {
		throw new InvalidProjectFile({
			path: PROJECT_FILE,
			reason: "The file is not valid TOML.",
			cause,
		});
	}
	return check(manifestSchema, value, { file: PROJECT_FILE });
}
export function serializeProjectManifest(manifest: ProjectManifest): string {
	return stringify(manifestSchema.parse(manifest));
}

/**
 * The files a loaded document came from. Validation errors then name the
 * file; without it they describe the document passed to `save`.
 */
export interface ProjectDocumentFiles {
	drawing: string;
	drawings?: readonly string[];
	circuits?: readonly string[];
}

function invalid(file: string | undefined, reason: string, cause?: unknown) {
	return file === undefined
		? new InvalidProjectDocument({ reason, cause })
		: new InvalidProjectFile({ path: file, reason, cause });
}

/**
 * Parses with a readable error. With `items`, an issue in array element `n`
 * is reported against `items[n]`; otherwise against `file` and `field`.
 */
function check<T>(
	schema: z.ZodType<T>,
	value: unknown,
	source: { file?: string; field?: string; items?: readonly string[] },
): T {
	const result = schema.safeParse(value);
	if (result.success) return result.data;
	const first = result.error.issues[0]?.path[0];
	const item =
		source.items && typeof first === "number" ? source.items[first] : undefined;
	const issues =
		item === undefined
			? result.error.issues.map((issue) => ({
					...issue,
					path: source.field ? [source.field, ...issue.path] : issue.path,
				}))
			: result.error.issues
					.filter((issue) => issue.path[0] === first)
					.map((issue) => ({ ...issue, path: issue.path.slice(1) }));
	throw invalid(
		item ?? (source.items ? undefined : source.file),
		schemaReason(issues),
		result.error,
	);
}

/**
 * @throws {InvalidProjectFile} when `files` is given and a file breaks a rule.
 * @throws {InvalidProjectDocument} when a document to be saved breaks a rule.
 */
export function validateProjectDocument(
	document: ProjectDocument,
	files?: ProjectDocumentFiles,
): ProjectDocument {
	const shapes = check(z.array(drawingShapeSchema), document.shapes, {
		file: files?.drawing,
		field: "shapes",
	});
	if (new Set(shapes.map((shape) => shape.id)).size !== shapes.length) {
		throw invalid(
			files?.drawing,
			"The project drawing contains duplicate shape IDs.",
		);
	}
	const drawings =
		document.drawings === undefined
			? undefined
			: check(z.array(drawingFileSchema), document.drawings, {
					field: "drawings",
					items: files?.drawings,
				});
	if (
		drawings &&
		new Set(drawings.map((file) => file.id)).size !== drawings.length
	)
		throw invalid(
			files && PROJECT_FILE,
			"The project contains duplicate drawing IDs.",
		);
	const circuits =
		document.circuits === undefined
			? undefined
			: check(z.array(circuitFileSchema), document.circuits, {
					field: "circuits",
					items: files?.circuits,
				});
	if (
		circuits &&
		new Set(circuits.map((file) => file.circuit.id)).size !== circuits.length
	)
		throw invalid(files && PROJECT_FILE, "Duplicate circuit identity.");
	let symbols: SymbolLibrary;
	try {
		symbols = parseSavedSymbolLibrary(JSON.stringify(document.symbols));
	} catch (cause) {
		throw invalid(
			files && PROJECT_FILE,
			errorMessage(cause, "The project symbols are invalid."),
			cause,
		);
	}
	let symbolLibraries: readonly ConfiguredSymbolLibrary[] | undefined;
	try {
		symbolLibraries =
			document.symbolLibraries === undefined
				? undefined
				: validateSymbolLibraries(document.symbolLibraries);
	} catch (cause) {
		throw invalid(
			files?.drawing,
			ParseResult.isParseError(cause)
				? schemaReason(
						ParseResult.ArrayFormatter.formatErrorSync(cause).map((issue) => ({
							path: ["symbolLibraries", ...issue.path],
							message: issue.message,
						})),
					)
				: errorMessage(cause, "The project symbol libraries are invalid."),
			cause,
		);
	}
	return {
		shapes,
		...(drawings === undefined ? {} : { drawings }),
		...(circuits === undefined ? {} : { circuits }),
		symbols,
		...(symbolLibraries === undefined ? {} : { symbolLibraries }),
	};
}
