import { z } from "zod";

export const footprintLibraries = ["builtin", "project"] as const;

export type FootprintLibrary = (typeof footprintLibraries)[number];

export const footprintIdPattern = /^[a-z0-9][a-z0-9._-]{0,63}$/;

export const footprintReferenceSchema = z
	.strictObject({
		library: z
			.enum(footprintLibraries)
			.describe(
				"builtin for the bundled footprint library, project for a footprint file in the open project.",
			),
		id: z.string().regex(footprintIdPattern).describe("The footprint's ID."),
	})
	.describe("The footprint a component is soldered with on the board.");

export type FootprintReference = z.output<typeof footprintReferenceSchema>;

export const sameFootprint = (
	a: FootprintReference | undefined,
	b: FootprintReference | undefined,
) => a?.library === b?.library && a?.id === b?.id;

export const footprintKey = ({ library, id }: FootprintReference) =>
	`${library}:${id}`;

/**
 * A symbol pin's number on the package. Pins without one take their position
 * among the symbol's pins, counting from 1, as circuit components do.
 */
export function symbolPinNumbers(
	pins: readonly { number?: string }[],
): string[] {
	return pins.map((pin, index) => pin.number?.trim() || String(index + 1));
}

export interface PinPadMatch {
	/** Pin numbers with no pad of that number. */
	readonly pinsWithoutPads: readonly string[];
	/** Numbered pads with no pin of that number. */
	readonly padsWithoutPins: readonly string[];
}

const naturalOrder = new Intl.Collator("en", { numeric: true }).compare;

export function matchPinsToPads(
	pinNumbers: readonly string[],
	padNumbers: readonly string[],
): PinPadMatch {
	const pins = new Set(pinNumbers);
	const pads = new Set(padNumbers.filter((number) => number !== ""));
	return {
		pinsWithoutPads: [...pins]
			.filter((pin) => !pads.has(pin))
			.sort(naturalOrder),
		padsWithoutPins: [...pads]
			.filter((pad) => !pins.has(pad))
			.sort(naturalOrder),
	};
}
