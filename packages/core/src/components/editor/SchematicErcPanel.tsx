import type { EditorShape } from "@ecad/drawing-core/drawing/shapes.ts";
import { runErc } from "@ecad/drawing-core/erc/engine.ts";
import { schematicErcInput } from "@ecad/drawing-core/erc/schematic.ts";
import { schematicErcRules } from "@ecad/drawing-core/erc/schematic-rules.ts";
import { schematicCircuit } from "#/circuit/linked-schematic.ts";
import { ErcPanel } from "#/components/circuit/ErcPanel.tsx";
import type { SymbolDefinition } from "#/drawing/symbols.ts";

/**
 * Electrical rules check for the schematic editor. It checks the circuit that
 * the current drawing describes, and a finding selects the shapes involved.
 */
export function SchematicErcPanel(props: {
	shapes: EditorShape[];
	definitions: readonly SymbolDefinition[];
	onClose(): void;
	onSelect(shapeIds: ReadonlySet<number>): void;
}) {
	let checked: ReturnType<typeof schematicCircuit> | null = null;
	return (
		<ErcPanel
			source="schematic"
			revision={props.shapes}
			ruleCount={schematicErcRules.length}
			check={(severity) => {
				const circuit = schematicCircuit(props.shapes, props.definitions);
				checked = circuit;
				return runErc(circuit.circuit, schematicErcRules, {
					schematic: schematicErcInput(props.shapes),
					severity,
				});
			}}
			onClose={() => props.onClose()}
			onSelect={(item) => {
				const ids = (item.target ? [item.target] : item.subjects).flatMap(
					(subject) => checked?.shapeIds(subject) ?? [],
				);
				if (ids.length) props.onSelect(new Set(ids));
			}}
		/>
	);
}
