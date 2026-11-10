import type { EditorShape } from "@ecad/drawing-core/drawing/shapes.ts";
import { runErc } from "@ecad/drawing-core/erc/engine.ts";
import { defaultErcRules } from "@ecad/drawing-core/erc/rules.ts";
import { useRef } from "react";
import { schematicCircuit } from "#/circuit/linked-schematic.ts";
import { ErcPanel } from "#/components/circuit/ErcPanel.tsx";
import type { SymbolDefinition } from "#/drawing/symbols.ts";

/**
 * Electrical rules check for the schematic editor. It checks the circuit that
 * the current drawing describes, and a finding selects the shapes involved.
 */
export function SchematicErcPanel({
	shapes,
	definitions,
	onClose,
	onSelect,
}: {
	shapes: EditorShape[];
	definitions: readonly SymbolDefinition[];
	onClose(): void;
	onSelect(shapeIds: ReadonlySet<number>): void;
}) {
	const checked = useRef<ReturnType<typeof schematicCircuit>>(null);
	return (
		<ErcPanel
			source="schematic"
			revision={shapes}
			check={() => {
				checked.current = schematicCircuit(shapes, definitions);
				return runErc(checked.current.circuit, defaultErcRules);
			}}
			onClose={onClose}
			onSelect={(subject) => {
				const ids = checked.current?.shapeIds(subject) ?? [];
				if (ids.length) onSelect(new Set(ids));
			}}
		/>
	);
}
