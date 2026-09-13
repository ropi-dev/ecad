import type { FormatParser, ParseResult } from "../engine/types";
import { gerberParser } from "./gerber";

/** Adapters depend on the scene contract. Renderers never depend on adapters. */
export class ParserRegistry {
	private parsers: FormatParser[] = [];

	register(parser: FormatParser): this {
		if (this.parsers.some((existing) => existing.id === parser.id)) {
			throw new Error(`Parser already registered: ${parser.id}`);
		}
		this.parsers.push(parser);
		return this;
	}

	parse(source: string, filename: string): ParseResult {
		const parser = this.parsers.find((candidate) =>
			candidate.detect(source, filename),
		);
		if (!parser)
			throw new Error(
				`No supported format detected in ${filename}. Open a Gerber layer file.`,
			);
		return parser.parse(source, filename);
	}
}

export const parsers = new ParserRegistry().register(gerberParser);
