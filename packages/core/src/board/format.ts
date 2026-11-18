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
import {
	boardCopperLayers,
	fewestCopperLayers,
	isInnerCopperLayer,
} from "@ecad/drawing-core/footprint/layers.ts";
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

const boardDataFields = {
	units: z.literal("mm"),
	rules: boardRulesSchema.default(defaultBoardRules),
	shapes: boardShapesSchema,
};

const layersInUse = new WeakMap<readonly EditorShape[], number>();

/** @return The fewest copper layers that keep every inner layer the board's items use. */
export function boardCopperLayersInUse(shapes: readonly EditorShape[]): number {
	let fewest = layersInUse.get(shapes);
	if (fewest === undefined) {
		fewest = fewestCopperLayers(
			(function* () {
				for (const shape of shapes) {
					yield shape.layer;
					if (shape.kind === "symbol")
						for (const child of shape.children ?? []) yield child.layer;
				}
			})(),
		);
		layersInUse.set(shapes, fewest);
	}
	return fewest;
}

function checkBoardLayers(
	board: { rules: BoardRules; shapes: EditorShape[] },
	context: z.RefinementCtx,
) {
	const stack = new Set<string>(boardCopperLayers(board.rules.copperLayers));
	for (const [index, shape] of board.shapes.entries()) {
		const layer =
			shape.kind === "symbol"
				? (shape.children ?? []).find(
						(child) =>
							isInnerCopperLayer(child.layer) && !stack.has(child.layer),
					)?.layer
				: shape.layer;
		if (isInnerCopperLayer(layer) && !stack.has(layer))
			context.addIssue({
				code: "custom",
				message: `${layer} is not one of the board's ${board.rules.copperLayers} copper layers.`,
				path: ["shapes", index, "layer"],
			});
	}
}

export const boardDataSchema = z
	.strictObject(boardDataFields)
	.superRefine(checkBoardLayers);

export const boardFileSchema = z
	.strictObject({
		...boardDataFields,
		circuitId: z.string().min(1).max(200),
		name: boardName,
	})
	.superRefine(checkBoardLayers);

export type BoardFile = z.output<typeof boardFileSchema>;

export function boardData(file: BoardFile): z.output<typeof boardDataSchema> {
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
