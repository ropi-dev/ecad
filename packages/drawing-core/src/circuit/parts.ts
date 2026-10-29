import {
	type CircuitComponent,
	type CircuitPin,
	circuitComponentSchema,
} from "./model.ts";

export const circuitParts = [
	{
		id: "connector-2",
		name: "2-pin connector",
		prefix: "J",
		value: "Supply input",
		pins: [
			["1", "+", "passive"],
			["2", "−", "passive"],
		],
	},
	{
		id: "resistor",
		name: "Resistor",
		prefix: "R",
		value: "330 Ω",
		pins: [
			["1", "", "passive"],
			["2", "", "passive"],
		],
	},
	{
		id: "led",
		name: "LED",
		prefix: "D",
		value: "LED",
		pins: [
			["A", "Anode", "passive"],
			["K", "Cathode", "passive"],
		],
	},
	{
		id: "capacitor",
		name: "Capacitor",
		prefix: "C",
		value: "100 nF",
		pins: [
			["1", "", "passive"],
			["2", "", "passive"],
		],
	},
	{
		id: "connector-8",
		name: "8-pin connector",
		prefix: "J",
		value: "Connector",
		pins: Array.from({ length: 8 }, (_, index) => [
			String(index + 1),
			"",
			"passive",
		]),
	},
] as const;

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
			electricalType: pin.electricalType ?? "passive",
		})),
	});
}

export function createCircuitComponent(
	partId: string,
	components: readonly CircuitComponent[],
): CircuitComponent {
	const part = circuitParts.find((part) => part.id === partId);
	if (!part) throw new Error("Unknown circuit part.");
	return instantiateCircuitPart(
		{
			...part,
			revision: "1",
			pins: part.pins.map(([number, name]) => ({ number, name })),
		},
		components,
	);
}
