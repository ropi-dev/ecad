import { SymbolPicker } from "#/components/editor/SymbolPicker.tsx";
import { useSymbolLibrary } from "#/components/editor/useSymbolLibrary.ts";
import type { SymbolDefinition } from "#/drawing/symbols.ts";

export function CircuitComponentPicker({
	active,
	onChoose,
}: {
	active: boolean;
	onChoose(definition: SymbolDefinition): void;
}) {
	const library = useSymbolLibrary();
	return (
		<SymbolPicker
			mode="component"
			onOpen={() => void library.refresh()}
			disabled={library.loading}
			active={active}
			library={library}
			onChoose={onChoose}
		/>
	);
}
