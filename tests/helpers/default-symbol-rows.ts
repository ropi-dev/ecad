import { generateDefaultSymbols } from "@ecad/default-symbols";

export function defaultSymbolRows() {
	const symbols = generateDefaultSymbols();
	return {
		symbols: symbols.filter(({ packaging }) => !packaging).length,
		parts: new Set(symbols.flatMap(({ packaging }) => packaging?.part ?? []))
			.size,
	};
}
