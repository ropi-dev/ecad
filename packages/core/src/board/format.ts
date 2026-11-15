import {
	type BoardRules,
	boardRulesSchema,
	defaultBoardRules,
} from "@ecad/drawing-core/board/rules.ts";
import {
	editorShapeSchema,
	upgradeSavedShapes,
} from "@ecad/drawing-core/drawing/schema.ts";
import type { EditorShape } from "@ecad/drawing-core/drawing/shapes.ts";
import { z } from "zod";

const shapeLimit = 50_000;

const boardShapesSchema = z.preprocess(
	upgradeSavedShapes,
	z
		.array(editorShapeSchema)
		.max(shapeLimit)
		.superRefine((shapes, context) => {
			const ids = new Set<number>();
			for (const [index, shape] of shapes.entries()) {
				if (
					shape.kind === "pin" ||
					shape.kind === "wire" ||
					(shape.kind === "text" && shape.electrical) ||
					(shape.kind === "symbol" && !shape.footprint)
				)
					context.addIssue({
						code: "custom",
						message:
							shape.kind === "symbol"
								? "A board symbol must be a placed footprint."
								: shape.kind === "text"
									? "A board cannot contain net labels."
									: `A board cannot contain a ${shape.kind}.`,
						path: [index, "kind"],
					});
				if (shape.page !== undefined)
					context.addIssue({
						code: "custom",
						message: "Board items have no page.",
						path: [index, "page"],
					});
				if (ids.has(shape.id))
					context.addIssue({
						code: "custom",
						message: `Duplicate shape ID ${shape.id}.`,
						path: [index, "id"],
					});
				ids.add(shape.id);
			}
		}),
);

const boardName = z
	.string()
	.trim()
	.min(1)
	.max(120)
	.refine(
		(name) =>
			Array.from(name).every((character) => character.charCodeAt(0) >= 32),
		"Use a name without control characters.",
	);

export const boardDataSchema = z.strictObject({
	units: z.literal("mm"),
	rules: boardRulesSchema.default(defaultBoardRules),
	shapes: boardShapesSchema,
});

export type BoardData = z.output<typeof boardDataSchema>;

export const boardFileSchema = boardDataSchema.extend({
	circuitId: z.string().min(1).max(200),
	name: boardName,
});

export type BoardFile = z.output<typeof boardFileSchema>;

export const legacyBoardFileSchema = boardDataSchema.extend({
	format: z.literal("ecad-board"),
	version: z.literal(1),
	id: z.string(),
	name: boardName,
	circuitId: z.string().min(1).max(200),
});

export function boardData(file: BoardFile): BoardData {
	return { units: file.units, rules: file.rules, shapes: file.shapes };
}

export function boardFileWith(
	file: BoardFile,
	shapes: EditorShape[],
	rules: BoardRules = file.rules,
): BoardFile {
	return boardFileSchema.parse({ ...file, shapes, rules });
}

export function createBoardFile(name: string, circuitId: string): BoardFile {
	return boardFileSchema.parse({
		units: "mm",
		name,
		circuitId,
		rules: defaultBoardRules,
		shapes: [],
	});
}
