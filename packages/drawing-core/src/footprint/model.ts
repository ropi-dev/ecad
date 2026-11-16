import { z } from "zod";
import { footprintIdPattern } from "#/footprint/reference.ts";

export const modelLibraries = ["builtin"] as const;

export const modelReferenceSchema = z
	.strictObject({
		library: z
			.enum(modelLibraries)
			.describe("builtin for the bundled 3D model library."),
		id: z.string().regex(footprintIdPattern).describe("The model's ID."),
	})
	.describe("The 3D model drawn on a footprint in the realistic board view.");

export type ModelReference = z.output<typeof modelReferenceSchema>;

export const modelKey = ({ library, id }: ModelReference) => `${library}:${id}`;
