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

export const boardFileSchema = z.strictObject({
	format: z.literal("ecad-board"),
	version: z.literal(1),
	units: z.literal("mm"),
	id: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,63}$/),
	name: z
		.string()
		.trim()
		.min(1)
		.max(120)
		.refine(
			(name) =>
				Array.from(name).every((character) => character.charCodeAt(0) >= 32),
			"Use a name without control characters.",
		),
	circuitId: z.string().min(1).max(200),
	rules: boardRulesSchema.default(defaultBoardRules),
	shapes: boardShapesSchema,
});

export type BoardFile = z.output<typeof boardFileSchema>;

export function boardFileWith(
	file: BoardFile,
	shapes: EditorShape[],
	rules: BoardRules = file.rules,
): BoardFile {
	return boardFileSchema.parse({ ...file, shapes, rules });
}

export function createBoardFile(
	name: string,
	circuitId: string,
	existing: readonly { id: string }[],
): BoardFile {
	const stem =
		name
			.normalize("NFKD")
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-|-$/g, "")
			.slice(0, 56) || "board";
	let id = stem;
	for (let suffix = 2; existing.some((file) => file.id === id); suffix++)
		id = `${stem}-${suffix}`;
	return boardFileSchema.parse({
		format: "ecad-board",
		version: 1,
		units: "mm",
		id,
		name,
		circuitId,
		rules: defaultBoardRules,
		shapes: [],
	});
}
