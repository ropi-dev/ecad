import type {
	CircuitFile,
	GraphLayout,
} from "@ecad/drawing-core/circuit/model.ts";
import type { EditorShape } from "@ecad/drawing-core/drawing/shapes.ts";
import {
	parseSymbolFile,
	type SymbolLibrary,
} from "#/components/editor/symbolFormat.ts";
import { symbolFileWithShapes } from "#/drawing/symbol-file.ts";
import type { ProjectDrawing } from "#/projects/format.ts";
import type { ConfiguredSymbolLibrary } from "#/symbol-library/config.ts";

export function assembleProjectSave({
	symbols,
	libraries,
	pending,
	mainShapes,
	drawings,
	drawingEdits,
	savedCircuits,
}: {
	symbols: SymbolLibrary;
	libraries: readonly ConfiguredSymbolLibrary[];
	pending: ReadonlyMap<string, EditorShape[]>;
	mainShapes: EditorShape[];
	drawings?: ProjectDrawing[];
	drawingEdits: ReadonlyMap<string, EditorShape[]>;
	savedCircuits?: CircuitFile[];
}) {
	let savedSymbols = symbols;
	if (pending.size) {
		savedSymbols = savedSymbols.map((symbol) => {
			const shapes = pending.get(symbol.id);
			return shapes
				? parseSymbolFile(JSON.stringify(symbolFileWithShapes(symbol, shapes)))
				: symbol;
		});
	}
	return {
		...(savedCircuits === undefined ? {} : { circuits: savedCircuits }),
		shapes: mainShapes,
		...(drawings === undefined
			? {}
			: {
					drawings: drawings.map((file) => ({
						...file,
						shapes: drawingEdits.get(file.id) ?? file.shapes,
					})),
				}),
		symbols: savedSymbols,
		symbolLibraries: libraries.map((library) =>
			library.id === "project-symbols" &&
			library.source.kind === "embedded" &&
			library.source.symbols !== savedSymbols
				? {
						...library,
						source: {
							...library.source,
							symbols: savedSymbols,
						},
					}
				: library,
		),
	};
}

export function withCurrentGraph(
	file: CircuitFile,
	graph: GraphLayout,
): CircuitFile {
	const components = new Set(
		file.circuit.components.map((component) => component.id),
	);
	const nets = new Set(file.circuit.nets.map((net) => net.id));
	const positions = graph.positions.filter((position) =>
		(position.kind === "component" ? components : nets).has(position.id),
	);
	const placed = new Set(positions.map((position) => position.id));
	return {
		circuit: file.circuit,
		graph: {
			...graph,
			positions: [
				...positions,
				...file.graph.positions.filter((position) => !placed.has(position.id)),
			],
			...(graph.collapsedComponentIds === undefined
				? {}
				: {
						collapsedComponentIds: graph.collapsedComponentIds.filter((id) =>
							components.has(id),
						),
					}),
		},
	};
}
