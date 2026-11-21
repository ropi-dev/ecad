import type { CircuitComponent } from "@ecad/drawing-core/circuit/model.ts";
import {
	type CircuitPartDefinition,
	instantiateCircuitPart,
} from "@ecad/drawing-core/circuit/parts.ts";
import type { SymbolDefinition } from "#/drawing/symbols.ts";
import { measurePerformance } from "#/performance/runtime.ts";

const TEMPLATE_LIMIT = 4096;
const templates = new Map<string, CircuitComponent>();

function instantiate(
	part: CircuitPartDefinition,
	components: readonly CircuitComponent[],
): CircuitComponent {
	const key = JSON.stringify(part);
	const template = templates.get(key);
	const prefix = part.prefix.trim() || "U";
	if (!template || prefix.length > 190) {
		const component = instantiateCircuitPart(part, components);
		if (templates.size >= TEMPLATE_LIMIT) templates.clear();
		templates.set(key, component);
		return structuredClone(component);
	}
	const references = new Set(
		components.map((component) => component.reference),
	);
	let suffix = 1;
	while (references.has(`${prefix}${suffix}`)) suffix++;
	return {
		...template,
		id: globalThis.crypto.randomUUID(),
		reference: `${prefix}${suffix}`,
		part: {
			...template.part,
			...(template.part.library
				? { library: { ...template.part.library } }
				: {}),
		},
		pins: template.pins.map((pin) => ({
			...pin,
			id: globalThis.crypto.randomUUID(),
		})),
	};
}

export function componentFromSymbol(
	definition: SymbolDefinition,
	components: readonly CircuitComponent[],
): CircuitComponent {
	return measurePerformance(
		"circuit.component-from-symbol",
		() =>
			instantiate(
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
										...(child.activeLow ? { activeLow: true as const } : {}),
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
