import type { CircuitComponent } from "@ecad/drawing-core/circuit/model.ts";
import { instantiateCircuitPart } from "@ecad/drawing-core/circuit/parts.ts";
import type { SymbolDefinition } from "#/drawing/symbols.ts";
import { measurePerformance } from "#/performance/runtime.ts";

export function componentFromSymbol(
	definition: SymbolDefinition,
	components: readonly CircuitComponent[],
): CircuitComponent {
	return measurePerformance(
		"circuit.component-from-symbol",
		() =>
			instantiateCircuitPart(
				{
					id: definition.id,
					name: definition.name,
					prefix: definition.prefix,
					value: definition.value,
					library: definition.library,
					pins: definition.children.flatMap((child) =>
						child.kind === "pin"
							? [
									{
										name: child.name,
										number: child.number,
										sourcePinId: String(child.id),
										electricalType: child.electricalType,
									},
								]
							: [],
					),
				},
				components,
			),
		{ shapes: definition.children.length, components: components.length },
	);
}
