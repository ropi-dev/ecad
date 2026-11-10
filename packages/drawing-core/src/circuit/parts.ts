import {
	type CircuitComponent,
	type CircuitPin,
	circuitComponentSchema,
} from "#/circuit/model.ts";
import { defaultPinElectricalType } from "#/drawing/pin-types.ts";

export interface CircuitPartDefinition {
	id: string;
	name: string;
	prefix: string;
	value: string;
	library?: CircuitComponent["part"]["library"];
	revision?: string;
	pins: {
		name: string;
		number: string;
		sourcePinId?: string;
		electricalType?: CircuitPin["electricalType"];
	}[];
}

export function instantiateCircuitPart(
	part: CircuitPartDefinition,
	components: readonly CircuitComponent[],
): CircuitComponent {
	const prefix = part.prefix.trim() || "U";
	const references = new Set(
		components.map((component) => component.reference),
	);
	let suffix = 1;
	while (references.has(`${prefix}${suffix}`)) suffix++;
	return circuitComponentSchema.parse({
		id: globalThis.crypto.randomUUID(),
		reference: `${prefix}${suffix}`,
		value: part.value,
		part: {
			id: part.id,
			name: part.name,
			...(part.library ? { library: part.library } : {}),
			...(part.revision ? { revision: part.revision } : {}),
		},
		pins: part.pins.map((pin, index) => ({
			...pin,
			id: globalThis.crypto.randomUUID(),
			number: pin.number.trim() || String(index + 1),
			electricalType: pin.electricalType ?? defaultPinElectricalType,
		})),
	});
}
