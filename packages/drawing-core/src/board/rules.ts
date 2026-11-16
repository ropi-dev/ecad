import { z } from "zod";

const length = z.number().positive().max(100);

const solderMaskMarginLimit = 0.5;
const defaultSolderMaskMargin = 0.05;

export const boardRulesSchema = z.strictObject({
	clearance: length.describe(
		"Smallest gap in millimetres between copper on different nets, and between copper and an unplated hole.",
	),
	trackWidth: length.describe("Width in millimetres of new tracks."),
	viaDiameter: length.describe("Copper diameter in millimetres of new vias."),
	viaDrill: length.describe("Drill diameter in millimetres of new vias."),
	edgeClearance: length.describe(
		"Smallest gap in millimetres between copper and the board outline.",
	),
	solderMaskMargin: z
		.number()
		.min(-solderMaskMarginLimit)
		.max(solderMaskMarginLimit)
		.default(defaultSolderMaskMargin)
		.describe(
			"How far in millimetres each pad's solder mask opening reaches past its copper. Negative values make the opening smaller than the pad.",
		),
});

export type BoardRules = z.output<typeof boardRulesSchema>;

export const defaultBoardRules: BoardRules = {
	clearance: 0.2,
	trackWidth: 0.25,
	viaDiameter: 0.6,
	viaDrill: 0.3,
	edgeClearance: 0.3,
	solderMaskMargin: defaultSolderMaskMargin,
};
