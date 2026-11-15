import { z } from "zod";

const length = z.number().positive().max(100);

export const boardRulesSchema = z.strictObject({
	clearance: length.describe(
		"Smallest gap in millimetres between copper on different nets.",
	),
	trackWidth: length.describe("Width in millimetres of new tracks."),
	viaDiameter: length.describe("Copper diameter in millimetres of new vias."),
	viaDrill: length.describe("Drill diameter in millimetres of new vias."),
	edgeClearance: length.describe(
		"Smallest gap in millimetres between copper and the board outline.",
	),
});

export type BoardRules = z.output<typeof boardRulesSchema>;

export const defaultBoardRules: BoardRules = {
	clearance: 0.2,
	trackWidth: 0.25,
	viaDiameter: 0.6,
	viaDrill: 0.3,
	edgeClearance: 0.3,
};
