import {
	editorShapeSchema,
	upgradeSavedShapes,
} from "@ecad/drawing-core/drawing/schema.ts";
import type { EditorShape } from "@ecad/drawing-core/drawing/shapes.ts";
import {
	isFootprintShape,
	shapeLayer,
} from "@ecad/drawing-core/footprint/shapes.ts";
import { z } from "zod";

const shapeLimit = 4096;

const footprintShapesSchema = z.preprocess(
	upgradeSavedShapes,
	z
		.array(editorShapeSchema)
		.max(shapeLimit)
		.superRefine((shapes, context) => {
			const ids = new Set<number>();
			for (const [index, shape] of shapes.entries()) {
				if (!isFootprintShape(shape))
					context.addIssue({
						code: "custom",
						message:
							shape.kind === "text"
								? "A footprint cannot contain net labels."
								: `A footprint cannot contain a ${shape.kind}.`,
						path: [index, "kind"],
					});
				if (shape.page !== undefined)
					context.addIssue({
						code: "custom",
						message: "Footprint items have no page.",
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
		})
		.transform((shapes) =>
			shapes.map((shape) => ({ ...shape, layer: shapeLayer(shape) })),
		),
);

export const footprintFileSchema = z.strictObject({
	format: z.literal("ecad-footprint"),
	version: z.literal(1),
	units: z.literal("mm"),
	id: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,63}$/),
	name: z
		.string()
		.trim()
		.min(1)
		.max(100)
		.refine(
			(name) =>
				Array.from(name).every((character) => character.charCodeAt(0) >= 32),
			"Use a name without control characters.",
		),
	description: z.string().max(500).default(""),
	shapes: footprintShapesSchema,
});

export type FootprintFile = z.output<typeof footprintFileSchema>;

export function footprintFileWithShapes(
	file: FootprintFile,
	shapes: EditorShape[],
): FootprintFile {
	return footprintFileSchema.parse({ ...file, shapes });
}

export function createEmptyFootprintFile(
	name: string,
	existing: readonly { id: string }[],
): FootprintFile {
	const stem =
		name
			.normalize("NFKD")
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-|-$/g, "")
			.slice(0, 56) || "footprint";
	let id = stem;
	for (let suffix = 2; existing.some((file) => file.id === id); suffix++)
		id = `${stem}-${suffix}`;
	return footprintFileSchema.parse({
		format: "ecad-footprint",
		version: 1,
		units: "mm",
		id,
		name,
		description: "",
		shapes: [],
	});
}
