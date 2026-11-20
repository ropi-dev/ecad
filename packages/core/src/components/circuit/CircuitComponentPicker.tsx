import { SymbolPicker } from "#/components/editor/SymbolPicker.tsx";
import { useSymbolLibrary } from "#/components/editor/useSymbolLibrary.ts";
import type { SymbolDefinition } from "#/drawing/symbols.ts";

export function CircuitComponentPicker(props: {
	active: boolean;
	onChoose(definition: SymbolDefinition): void;
}) {
	const library = useSymbolLibrary();
	return (
		<SymbolPicker
			mode="component"
			onOpen={() => void library.refresh()}
			disabled={library.loading}
			active={props.active}
			library={library}
			onChoose={(definition) => props.onChoose(definition)}
		/>
	);
}
