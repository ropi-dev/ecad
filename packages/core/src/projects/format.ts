import { parse, stringify } from "smol-toml";
import { z } from "zod";
import {
	parseSavedSymbolLibrary,
	type SymbolLibrary,
} from "#/components/editor/symbolFormat.ts";
import { drawingShapeSchema } from "#/drawing/schema.ts";
import type { EditorShape } from "#/drawing/shapes.ts";
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
	symbols: SymbolLibrary;
	symbolLibraries?: readonly ConfiguredSymbolLibrary[];
}
export interface ProjectSnapshot extends ProjectDocument {
	directory: string;
	manifest: ProjectManifest;
}

export function parseProjectManifest(content: string): ProjectManifest {
	return manifestSchema.parse(parse(content));
}
export function serializeProjectManifest(manifest: ProjectManifest): string {
	return stringify(manifestSchema.parse(manifest));
}
export function validateProjectDocument(
	document: ProjectDocument,
): ProjectDocument {
	const shapes = z.array(drawingShapeSchema).parse(document.shapes);
	if (new Set(shapes.map((shape) => shape.id)).size !== shapes.length) {
		throw new Error("The project drawing contains duplicate shape IDs.");
	}
	return {
		shapes,
		...(document.drawings === undefined
			? {}
			: {
					drawings: z
						.array(drawingFileSchema)
						.refine(
							(files) =>
								new Set(files.map((file) => file.id)).size === files.length,
							"The project contains duplicate drawing IDs.",
						)
						.parse(document.drawings),
				}),
		symbols: parseSavedSymbolLibrary(JSON.stringify(document.symbols)),
		...(document.symbolLibraries === undefined
			? {}
			: { symbolLibraries: validateSymbolLibraries(document.symbolLibraries) }),
	};
}
